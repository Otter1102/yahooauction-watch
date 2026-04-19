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
import { notifyUserSummary } from '../lib/notifier'
import { sendWebPushSummary } from '../lib/webpush'
import { getSupabaseAdmin } from '../lib/supabase'
const supabaseAdmin = { from: (...args: Parameters<ReturnType<typeof getSupabaseAdmin>['from']>) => getSupabaseAdmin().from(...args) }
import { User, SearchCondition, AuctionItem } from '../lib/types'

type RssKey = Pick<SearchCondition, 'keyword' | 'maxPrice' | 'minPrice' | 'minBids' | 'sellerType' | 'itemCondition' | 'sortBy' | 'sortOrder' | 'buyItNow'>
interface ConditionGroup { key: RssKey; conditions: SearchCondition[] }

async function getAllUsers(userIds: string[]): Promise<Map<string, User>> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, ntfy_topic, discord_webhook, notification_channel, push_sub')
    .in('id', userIds)
  const map = new Map<string, User>()
  for (const row of data ?? []) {
    map.set(row.id, {
      id: row.id,
      ntfyTopic: row.ntfy_topic ?? '',
      discordWebhook: row.discord_webhook ?? '',
      notificationChannel: row.notification_channel ?? 'ntfy',
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

async function fetchWithRetry(key: RssKey, retries = 2, startOffset = 1): Promise<AuctionItem[]> {
  for (let i = 0; i <= retries; i++) {
    const items = await fetchAuctionRss(key, startOffset)
    if (items.length > 0 || i === retries) return items
    await new Promise(r => setTimeout(r, 2000))
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
  const usersMap = await getAllUsers(uniqueUserIds)
  console.log(`対象ユーザー: ${uniqueUserIds.length}人`)

  // push_sub 設定済みユーザーID
  const pushUserIds = new Set(
    [...usersMap.values()]
      .filter(u => (u as any).pushSub?.endpoint)
      .map(u => u.id)
  )

  // 通知設定済みユーザーのみ処理（ntfy/discord または webpush）
  const activeConditions = allConditions.filter(c => {
    const user = usersMap.get(c.userId)
    return user && (user.ntfyTopic || user.discordWebhook || pushUserIds.has(c.userId))
  })
  console.log(`通知設定済みユーザーの条件: ${activeConditions.length}件`)

  // 通知済みIDを全ユーザー分まとめて1クエリで取得
  // 100ユーザー時でもDBアクセスは1回のみ（スケーラブル設計）
  const activeUserIds = [...new Set(activeConditions.map(c => c.userId))]
  const notifiedIdsCache = await getAllNotifiedIds(activeUserIds)
  console.log(`通知済みIDキャッシュ取得完了: ${activeUserIds.length}ユーザー分（1クエリ）`)

  // キーワード+価格でグループ化（同じ検索は1回のみRSSフェッチ）
  const groups = groupConditions(activeConditions)
  console.log(`ユニーク検索: ${groups.length}件（重複排除後）`)

  let totalNotified = 0
  // ユーザーごとの新着アイテム収集（メインループ後にサマリー1回で通知）
  const pendingByUser = new Map<string, AuctionItem[]>()

  // 並列でRSSフェッチ（10並列）
  // startOffset=1: スクレイパー内で FETCH_PAGES=3 ページを自動取得（b=1,51,101 = 最大150件）
  // 【2026-04-19 変更】 Vercel CPU コスト削減のため10→3ページに削減
  const CONCURRENCY = 10
  for (let i = 0; i < groups.length; i += CONCURRENCY) {
    const batch = groups.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async (group) => {
      const items = await fetchWithRetry(group.key)
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
          })
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
          await updateCondition(cond.id, {
            lastCheckedAt: new Date().toISOString(),
            lastFoundCount: candidateItems.length,
          })
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

  // ─── サマリー通知（ユーザーごとに1回のみ）───
  // 個別にブーブー鳴らすのをやめ、1時間に1回「N件新着」でまとめて通知
  for (const [userId, items] of pendingByUser) {
    if (items.length === 0) continue
    const user = usersMap.get(userId)
    if (!user) continue

    // Web Push サマリー（push購読あり）
    if (pushUserIds.has(userId)) {
      await sendWebPushSummary(userId, items.length, items[0])
    }
    // ntfy / Discord サマリー
    if (user.ntfyTopic || user.discordWebhook) {
      await notifyUserSummary(items.length, user)
    }
    console.log(`  📨 [${userId.slice(0,8)}] サマリー通知: 新着${items.length}件`)
  }

  // ─── 終了済みオークションを履歴から削除 ───
  await cleanupEndedAuctions()

  // ─── 時間ベースのフォールバッククリーンアップ ───
  // notification_history: 72時間後（ステータス確認できなかった場合の安全網）
  // notified_items: 25時間後（オークション終了後のIDを安全に削除）
  await cleanupOldHistory(72)
  await cleanupOldNotified()

  // ─── 自己修復: 48時間通知なし + 20件溜まりユーザーをリセット ───
  const stalledUsers = await resetStalledNotified()
  if (stalledUsers.length > 0) {
    console.log(`[自己修復] ${stalledUsers.length}ユーザーの通知ログをリセット`)
  }

  // ─── 幽霊ユーザー削除（通知設定なし + 14日以上経過）───
  const ghostCount = await cleanupGhostUsers()
  if (ghostCount > 0) {
    console.log(`[幽霊ユーザー] ${ghostCount}件削除（通知設定なし+14日経過）`)
  }

  console.log(`\n=== 完了: 合計${totalNotified}件通知 ===\n`)
}

/** 終了したオークションの通知履歴を削除する（1run あたり最大20件チェック） */
async function cleanupEndedAuctions(): Promise<void> {
  // 通知から30分以上経過したものを対象（直後の誤削除を防ぐ）
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()

  const { data: items } = await supabaseAdmin
    .from('notification_history')
    .select('id, auction_id, user_id')
    .lt('notified_at', cutoff)
    .limit(20)  // 1run あたり上限 → レート制限対策（24h設計で回転が速いため増量）

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

main().catch(err => {
  console.error('エラー:', err)
  process.exit(1)
})
