#!/usr/bin/env tsx
/**
 * ヤフオクwatch チェッカー本体
 * GitHub Actions から1時間毎に実行される
 *
 * 実行: npx tsx scripts/run-check.ts
 * 環境変数: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { getAllEnabledConditions, getAllNotifiedIds, markNotified, addHistory, updateCondition, cleanupOldNotified, cleanupOldHistory, resetStalledNotified } from '../lib/storage'
import { fetchAuctionRss, checkAuctionEnded } from '../lib/scraper'
import { sendWebPushSummary, sendWebPushNoItems } from '../lib/webpush'
import { sendAdminErrorAlert } from '../lib/emailer'
import { getSupabaseAdmin } from '../lib/supabase'
const supabaseAdmin = { from: (...args: Parameters<ReturnType<typeof getSupabaseAdmin>['from']>) => getSupabaseAdmin().from(...args) }
import { User, SearchCondition, AuctionItem } from '../lib/types'

type RssKey = Pick<SearchCondition, 'keyword' | 'maxPrice' | 'minPrice' | 'minBids' | 'sellerType' | 'itemCondition' | 'sortBy' | 'sortOrder' | 'buyItNow'>
interface ConditionGroup { key: RssKey; conditions: SearchCondition[] }

async function getAllUsers(userIds: string[]): Promise<Map<string, User>> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, push_sub')
    .in('id', userIds)
  const map = new Map<string, User>()
  for (const row of data ?? []) {
    map.set(row.id, {
      id: row.id,
      ntfyTopic: '',
      discordWebhook: '',
      notificationChannel: 'webpush',
      pushSub: row.push_sub ?? null,
    })
  }
  return map
}

function groupConditions(conditions: SearchCondition[]): ConditionGroup[] {
  const map = new Map<string, ConditionGroup>()
  for (const cond of conditions) {
    // buyItNow はユーザー設定をそのまま使う（自動オーバーライドなし）
    // 理由: abuynow=2 は「オークション+即決オプション付き出品」も除外してしまい
    //        入札件数フィルターと組み合わせると正規の入札あり商品が0件になる
    const resolvedBuyItNow = cond.buyItNow
    const rssKey: RssKey = {
      keyword: cond.keyword, maxPrice: cond.maxPrice, minPrice: cond.minPrice,
      minBids: cond.minBids ?? 0, sellerType: cond.sellerType ?? 'all',
      itemCondition: cond.itemCondition ?? 'all', sortBy: cond.sortBy ?? 'endTime',
      sortOrder: cond.sortOrder ?? 'asc', buyItNow: resolvedBuyItNow,
    }
    const key = JSON.stringify(rssKey)
    if (!map.has(key)) map.set(key, { key: rssKey, conditions: [] })
    map.get(key)!.conditions.push(cond)
  }
  return Array.from(map.values())
}

// GitHub Actions は Vercel の CPU コスト制限がないため 10 ページ取得（最大 500 件）
// Vercel route.ts は FETCH_PAGES=3 のまま維持（コスト削減のため）
const GH_FETCH_PAGES = 10

async function fetchWithRetry(key: RssKey, retries = 2, startOffset = 1): Promise<AuctionItem[]> {
  for (let i = 0; i <= retries; i++) {
    try {
      const items = await fetchAuctionRss(key, startOffset, GH_FETCH_PAGES)
      if (items.length > 0 || i === retries) return items
      await new Promise(r => setTimeout(r, 2000))
    } catch (err) {
      console.error(`  [fetch] "${key.keyword}" 取得エラー (試行${i + 1}/${retries + 1}): ${err instanceof Error ? err.message : err}`)
      if (i === retries) return []
      await new Promise(r => setTimeout(r, 2000))
    }
  }
  return []
}

async function main() {
  console.log(`\n=== ヤフオクwatch チェック開始 ${new Date().toLocaleString('ja-JP')} ===`)

  // Supabase接続確認（環境変数チェック）
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error(`[設定エラー] 環境変数未設定: NEXT_PUBLIC_SUPABASE_URL=${!!supabaseUrl} SUPABASE_SERVICE_KEY=${!!serviceKey}`)
  }
  console.log(`[DB] Supabase接続先: ${supabaseUrl.slice(0, 40)}...`)

  // 全有効条件を取得（DB + JS の二重フィルター）
  // リトライ付き: Supabase瞬断(upstream timeout)対策で最大3回試みる
  let allConditions: Awaited<ReturnType<typeof getAllEnabledConditions>> = []
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      allConditions = (await getAllEnabledConditions()).filter(c => c.enabled === true)
      break
    } catch (err) {
      console.error(`[DB] 取得失敗 (試行${attempt}/3): ${err instanceof Error ? err.message : err}`)
      if (attempt === 3) throw err
      console.log(`[DB] 30秒後にリトライ...`)
      await new Promise(r => setTimeout(r, 30_000))
    }
  }
  console.log(`対象条件: ${allConditions.length}件`)
  if (allConditions.length === 0) { console.log('条件なし。終了。'); return }

  // ユーザー情報を一括取得
  const uniqueUserIds = [...new Set(allConditions.map(c => c.userId))]
  let usersMap = new Map<string, User>()
  try {
    usersMap = await getAllUsers(uniqueUserIds)
  } catch (err) {
    console.error(`[DB] ユーザー情報取得失敗: ${err instanceof Error ? err.message : err}`)
    // 取得失敗時は空マップで継続（各条件処理内の if (!user) continue で安全にスキップ）
  }
  console.log(`対象ユーザー: ${uniqueUserIds.length}人`)

  // push_sub 設定済みユーザーID（通知送信判定に使用）
  const pushUserIds = new Set(
    [...usersMap.values()]
      .filter(u => (u as any).pushSub?.endpoint)
      .map(u => u.id)
  )

  // 全有効条件を処理（push_sub なしのユーザーも履歴記録・フェッチは行う）
  // 理由: push_sub が期限切れで null になっても条件チェック・履歴記録は継続すべき
  //       通知送信ステップのみ push_sub の有無で制御する
  const activeConditions = allConditions
  console.log(`処理対象条件: ${activeConditions.length}件（うち通知可能ユーザー: ${pushUserIds.size}人）`)

  // 通知済みIDを全ユーザー分まとめて1クエリで取得
  // 100ユーザー時でもDBアクセスは1回のみ（スケーラブル設計）
  const activeUserIds = [...new Set(activeConditions.map(c => c.userId))]
  let notifiedIdsCache: Awaited<ReturnType<typeof getAllNotifiedIds>> = new Map()
  try {
    notifiedIdsCache = await getAllNotifiedIds(activeUserIds)
  } catch (err) {
    console.error(`[DB] 通知済みID取得失敗: ${err instanceof Error ? err.message : err}`)
    // 取得失敗時は空マップで継続（重複通知リスクはあるが処理は止めない）
  }
  console.log(`通知済みIDキャッシュ取得完了: ${activeUserIds.length}ユーザー分（1クエリ）`)

  // キーワード+価格でグループ化（同じ検索は1回のみRSSフェッチ）
  const groups = groupConditions(activeConditions)
  console.log(`ユニーク検索: ${groups.length}件（重複排除後）`)

  let totalNotified = 0
  // ユーザーごとの新着アイテム収集（メインループ後にサマリー1回で通知）
  const pendingByUser = new Map<string, AuctionItem[]>()

  // 並列でRSSフェッチ（10並列）
  // GitHub Actions: GH_FETCH_PAGES=10 ページ取得（b=1〜451 = 最大500件）
  // → Vercel route は CPU コスト制限で FETCH_PAGES=3 のままだが、GitHub Actions は制限なし
  // → 人気キーワードで4ページ目以降の商品（残り8〜24h）も確実に取得できる
  const CONCURRENCY = 10
  for (let i = 0; i < groups.length; i += CONCURRENCY) {
    const batch = groups.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async (group) => {
      let items: AuctionItem[] = []
      try {
        items = await fetchWithRetry(group.key)
      } catch (err) {
        console.error(`  [fetch] "${group.key.keyword}" 全リトライ失敗、スキップ: ${err instanceof Error ? err.message : err}`)
        return
      }
      console.log(`  🔍 [${group.key.keyword}] 取得: ${items.length}件`)
      if (items.length === 0) return

      // このグループの全ユーザーを処理
      for (const cond of group.conditions) {
        if (!cond.enabled) continue  // 念のため二重チェック（オフ条件を絶対に通さない）
        const user = usersMap.get(cond.userId)
        if (!user) continue

        const minBids = cond.minBids ?? 0
        const maxBids = cond.maxBids ?? null
        // 入札数・出品形式フィルターのみ事前適用（通知済みチェックは直前に行う）
        const candidateItems = items
          .filter(item => {
            // 入札数フィルター
            if (minBids <= 0 && maxBids === null) return true
            if (item.bids === null) return minBids <= 0
            if (minBids > 0 && item.bids < minBids) return false
            if (maxBids !== null && item.bids >= maxBids) return false
            return true
          })
          .filter(item => {
            // 出品形式フィルター
            if (minBids > 0 && cond.buyItNow === null && item.isBuyItNow === true) return false
            if (cond.buyItNow === null) return true
            if (cond.buyItNow === true) return item.isBuyItNow === true
            return item.isBuyItNow !== true
          })

        let conditionNotified = 0
        for (const item of candidateItems) {
          // 通知済みチェック: 送信直前にキャッシュを参照（並列グループ間の重複防止）
          if (notifiedIdsCache.get(cond.userId)?.has(item.auctionId)) continue

          // 履歴への記録と通知済みマーク（個別通知はせずサマリー用に収集）
          try {
            await markNotified(cond.userId, item.auctionId)
            notifiedIdsCache.get(cond.userId)?.add(item.auctionId)
            await addHistory({
              userId: cond.userId,
              conditionId: cond.id,
              conditionName: cond.name,
              auctionId: item.auctionId,
              title: item.title,
              price: item.price,
              url: item.url,
              imageUrl: item.imageUrl ?? '',
              notifiedAt: new Date().toISOString(),
              remaining: item.remaining ?? null,
              endAt: item.endtimeMs ? new Date(item.endtimeMs).toISOString() : null,
            })
          } catch (err) {
            console.error(`  [DB] [${cond.name}] ${item.auctionId} 記録失敗: ${err instanceof Error ? err.message : err}`)
            continue
          }
          // サマリー通知用に収集（同一実行内で同一商品の重複を除く）
          if (!pendingByUser.has(cond.userId)) pendingByUser.set(cond.userId, [])
          const alreadyPending = pendingByUser.get(cond.userId)!
          if (!alreadyPending.some(a => a.auctionId === item.auctionId)) {
            alreadyPending.push(item)
          }
          conditionNotified++
          totalNotified++
        }

        // 変化があった時のみ更新（DB帯域節約: 変化なし=スキップで月間UPDATE数を大幅削減）
        if (conditionNotified > 0 || candidateItems.length !== (cond.lastFoundCount ?? -1)) {
          try {
            await updateCondition(cond.id, {
              lastCheckedAt: new Date().toISOString(),
              lastFoundCount: candidateItems.length,
            })
          } catch (err) {
            console.error(`  [DB] [${cond.name}] updateCondition 失敗: ${err instanceof Error ? err.message : err}`)
          }
        }

        if (conditionNotified > 0) {
          console.log(`  ✅ [${cond.name}] ${conditionNotified}件新着`)
        }
      }
    }))

    // バッチ間の待機（Yahoo RSS への負荷分散）
    if (i + CONCURRENCY < groups.length) {
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  // ─── 通知（push_sub 保持ユーザーのみ・10並列で送信）───
  // 新着あり → Web Push サマリー / 新着なし → Web Push「新着情報なし」
  // push_sub なし（期限切れ・未登録）ユーザーはスキップ（内部でも空振りになるだけだが DB 問い合わせを節約）
  const pushActiveUserIds = activeUserIds.filter(id => pushUserIds.has(id))
  const NOTIFY_CONCURRENCY = 10
  for (let i = 0; i < pushActiveUserIds.length; i += NOTIFY_CONCURRENCY) {
    const batch = pushActiveUserIds.slice(i, i + NOTIFY_CONCURRENCY)
    await Promise.all(batch.map(async (userId) => {
      const items = pendingByUser.get(userId)
      try {
        if (items && items.length > 0) {
          await sendWebPushSummary(userId, items.length, items[0])
          console.log(`  📨 [${userId.slice(0,8)}] 新着${items.length}件 通知`)
        } else {
          await sendWebPushNoItems(userId)
          console.log(`  📭 [${userId.slice(0,8)}] 新着なし通知`)
        }
      } catch (err) {
        console.error(`  [push] [${userId.slice(0,8)}] 通知失敗: ${err instanceof Error ? err.message : err}`)
      }
    }))
  }

  // ─── 時間ベースクリーンアップ ───
  // end_at あり: 終了12時間後に削除 / end_at なし(旧データ): 通知36時間後に削除
  try { await cleanupOldHistory() } catch (err) {
    console.error(`[cleanup] cleanupOldHistory 失敗: ${err instanceof Error ? err.message : err}`)
  }
  try { await cleanupOldNotified() } catch (err) {
    console.error(`[cleanup] cleanupOldNotified 失敗: ${err instanceof Error ? err.message : err}`)
  }

  // ─── end_at なし旧レコードのYahoo確認クリーンアップ（安全網）───
  try { await cleanupEndedAuctions() } catch (err) {
    console.error(`[cleanup] cleanupEndedAuctions 失敗: ${err instanceof Error ? err.message : err}`)
  }

  // ─── 自己修復: 48時間通知なし + 20件溜まりユーザーをリセット ───
  try {
    const stalledUsers = await resetStalledNotified()
    if (stalledUsers.length > 0) {
      console.log(`[自己修復] ${stalledUsers.length}ユーザーの通知ログをリセット`)
    }
  } catch (err) {
    console.error(`[cleanup] resetStalledNotified 失敗: ${err instanceof Error ? err.message : err}`)
  }

  // ─── 幽霊ユーザー削除（通知設定なし + 14日以上経過）───
  try {
    const ghostCount = await cleanupGhostUsers()
    if (ghostCount > 0) {
      console.log(`[幽霊ユーザー] ${ghostCount}件削除（通知設定なし+14日経過）`)
    }
  } catch (err) {
    console.error(`[cleanup] cleanupGhostUsers 失敗: ${err instanceof Error ? err.message : err}`)
  }

  console.log(`\n=== 完了: 合計${totalNotified}件通知 ===\n`)
}

/** end_at なし旧レコードを Yahoo 確認して削除する安全網（1run あたり最大20件） */
async function cleanupEndedAuctions(): Promise<void> {
  // end_at が設定済みのレコードは cleanupOldHistory() で処理済み。
  // end_at がない旧レコードのみYahoo確認して終了済みなら即削除。
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()

  const { data: items } = await supabaseAdmin
    .from('notification_history')
    .select('id, auction_id, user_id')
    .is('end_at', null)
    .lt('notified_at', cutoff)
    .limit(20)

  if (!items?.length) return

  const toDeleteHistoryIds: string[] = []
  const toDeleteNotified: Array<{ userId: string; auctionId: string }> = []

  for (const item of items) {
    const ended = await checkAuctionEnded(item.auction_id as string)
    if (ended) {
      toDeleteHistoryIds.push(item.id as string)
      toDeleteNotified.push({ userId: item.user_id as string, auctionId: item.auction_id as string })
    }
    await new Promise(r => setTimeout(r, 400))  // Yahoo への負荷分散
  }

  if (toDeleteHistoryIds.length === 0) return

  // 1. 通知履歴から削除
  await supabaseAdmin
    .from('notification_history')
    .delete()
    .in('id', toDeleteHistoryIds)

  // 2. notified_items からも削除（重要: ここを消さないと終了済みIDが残り続け、新着通知を妨げる）
  //    アプリ削除→再インストール後も新規ユーザーのnotified_itemsは空なので自動的にクリーンな状態になる
  for (const { userId, auctionId } of toDeleteNotified) {
    await supabaseAdmin
      .from('notified_items')
      .delete()
      .eq('user_id', userId)
      .eq('auction_id', auctionId)
  }

  console.log(`終了オークション ${toDeleteHistoryIds.length}件を履歴・通知ログから削除`)
}

/**
 * 幽霊ユーザーを削除する
 * 条件: push_sub なし + ntfy/discord 未設定 + 14日以上経過
 * → PWA未インストールのまま放置されたゴーストアカウントを定期削除
 * conditions は users に CASCADE DELETE されるため一緒に消える
 */
async function cleanupGhostUsers(): Promise<number> {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  try {
    // 幽霊ユーザー候補: push_sub なし かつ 14日以上前に作成
    const { data: candidates } = await supabaseAdmin
      .from('users')
      .select('id, ntfy_topic, discord_webhook')
      .is('push_sub', null)
      .lt('created_at', cutoff)
    if (!candidates?.length) return 0

    // JS側でntfy/discordも未設定を確認（null/空文字両方対応）
    const ghostIds = candidates
      .filter(u => !u.ntfy_topic && !u.discord_webhook)
      .map(u => u.id as string)
    if (ghostIds.length === 0) return 0

    await supabaseAdmin.from('users').delete().in('id', ghostIds)
    return ghostIds.length
  } catch (err) {
    console.error('[幽霊ユーザー削除エラー]', err instanceof Error ? err.message : err)
    return 0
  }
}

main().catch(async err => {
  const message = err instanceof Error ? err.message : String(err)
  const stack   = err instanceof Error ? err.stack : undefined
  console.error('エラー:', message)
  await sendAdminErrorAlert(message, stack).catch(() => {})
  process.exit(1)
})
