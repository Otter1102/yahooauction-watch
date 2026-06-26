#!/usr/bin/env tsx
/**
 * ヤフオクwatch チェッカー本体
 * GitHub Actions から1時間毎に実行される
 *
 * 実行: npx tsx scripts/run-check.ts
 * 環境変数: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { getAllEnabledConditions, getAllNotifiedIds, markNotified, addHistory, updateCondition, cleanupOldNotified, cleanupOldHistory, resetStalledNotified, updateHistorySnapshot, addConditionCheckHistory } from '../lib/storage'
import { fetchAuctionRssWithMeta } from '../lib/scraper'
import { sendWebPushCheckComplete, sendWebPushSummary } from '../lib/webpush'
import { sendAdminErrorAlert } from '../lib/emailer'
import { getSupabaseAdmin } from '../lib/supabase'
const supabaseAdmin = { from: (...args: Parameters<ReturnType<typeof getSupabaseAdmin>['from']>) => getSupabaseAdmin().from(...args) }
import { User, SearchCondition, AuctionItem } from '../lib/types'

type RssKey = Pick<SearchCondition, 'keyword' | 'maxPrice' | 'minPrice' | 'minBids' | 'sellerType' | 'itemCondition' | 'sortBy' | 'sortOrder' | 'buyItNow'>
interface ConditionGroup { key: RssKey; conditions: SearchCondition[] }
type PendingNotification = { item: AuctionItem; cond: SearchCondition }
const CHECK_COMPLETE_MARKER_PREFIX = '__check_complete_'

function toHistoryRecord(cond: SearchCondition, item: AuctionItem) {
  return {
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
  }
}

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

// 定期巡回は1時間以内に確実に終えるため、GitHub Actionsでは最大40ページに抑える。
// 40ページ = 最大2000件/検索。条件作成・手動API側の深掘り上限は別途 scraper.ts で維持する。
const GH_FETCH_PAGES = Math.max(1, Number.parseInt(process.env.GH_FETCH_PAGES ?? '40', 10) || 40)
const SEND_NO_ITEMS_PUSH = process.env.SEND_NO_ITEMS_PUSH === 'true'
const FORCE_CHECK_COMPLETE_PUSH = process.env.FORCE_CHECK_COMPLETE_PUSH === 'true'
const ALLOW_NIGHT_NOTIFICATIONS = process.env.ALLOW_NIGHT_NOTIFICATIONS === 'true'
const CHECK_SHARD_TOTAL = Math.max(1, Number.parseInt(process.env.CHECK_SHARD_TOTAL ?? '1', 10) || 1)
const CHECK_SHARD_INDEX = Math.max(0, Number.parseInt(process.env.CHECK_SHARD_INDEX ?? '0', 10) || 0)

function getJstHour(date = new Date()): number {
  return Number(new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(date))
}

function isJstQuietHour(date = new Date()): boolean {
  const hour = getJstHour(date)
  return hour >= 1 && hour <= 6
}

function stringShard(value: string, totalShards: number): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % totalShards
}

async function fetchWithRetry(key: RssKey, retries = 2, startOffset = 1): Promise<AuctionItem[]> {
  for (let i = 0; i <= retries; i++) {
    const meta = await fetchAuctionRssWithMeta(key, GH_FETCH_PAGES)
    const items = meta.items
    console.log(`  📄 [${key.keyword}] ページ取得: ${meta.pagesFetched}p / raw ${meta.rawCount}件 / 24h ${items.length}件${meta.truncated ? ' / 上限到達' : ''}`)
    if (items.length > 0 || i === retries) return items
    await new Promise(r => setTimeout(r, 2000))
  }
  return []
}

async function canSendCheckCompleteThisHour(userId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 50 * 60 * 1000).toISOString()
  const { data, error } = await supabaseAdmin
    .from('notified_items')
    .select('auction_id')
    .eq('user_id', userId)
    .like('auction_id', `${CHECK_COMPLETE_MARKER_PREFIX}%`)
    .gte('notified_at', cutoff)
    .limit(1)
  if (error) {
    console.warn(`  ⚠️ [${userId.slice(0,8)}] チェック完了通知の重複確認失敗:`, error.message)
    return true
  }
  return !data?.length
}

async function markCheckCompleteSent(userId: string): Promise<void> {
  const marker = `${CHECK_COMPLETE_MARKER_PREFIX}${new Date().toISOString().slice(0, 13)}`
  const { error } = await supabaseAdmin
    .from('notified_items')
    .upsert({ user_id: userId, auction_id: marker })
  if (error) {
    console.warn(`  ⚠️ [${userId.slice(0,8)}] チェック完了通知マーカー保存失敗:`, error.message)
  }
}

async function main() {
  console.log(`\n=== ヤフオクwatch チェック開始 ${new Date().toLocaleString('ja-JP')} ===`)
  if (!ALLOW_NIGHT_NOTIFICATIONS && isJstQuietHour()) {
    console.log('[quiet-hours] JST 25:00-06:59 は通知停止時間のため、巡回せず終了します')
    return
  }

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

  // キーワード+価格でグループ化（同じ検索は1回のみRSSフェッチ）
  // シャード分割はユーザー単位ではなく検索グループ単位で行う。
  // 理由: ユーザー単位だと同じ検索URLを各シャードで重複取得し、深いページング時に20分上限を超える。
  let groups = groupConditions(allConditions)
  if (CHECK_SHARD_TOTAL > 1) {
    groups = groups.filter(group => stringShard(JSON.stringify(group.key), CHECK_SHARD_TOTAL) === CHECK_SHARD_INDEX)
    console.log(`シャード: ${CHECK_SHARD_INDEX + 1}/${CHECK_SHARD_TOTAL}`)
  }
  const activeConditions = groups.flatMap(group => group.conditions)
  console.log(`ユニーク検索: ${groups.length}件（重複排除後）`)
  if (activeConditions.length === 0) { console.log('担当条件なし。終了。'); return }

  // ユーザー情報を一括取得
  const uniqueUserIds = [...new Set(activeConditions.map(c => c.userId))]
  const usersMap = await getAllUsers(uniqueUserIds)
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
  console.log(`処理対象条件: ${activeConditions.length}件（うち通知可能ユーザー: ${pushUserIds.size}人）`)

  // 自己修復は通知判定前に実行する。
  // 通知送信後に実行すると、直前に通知したユーザーの notified_items を誤って消し、
  // 次回以降の重複通知・判定乱れにつながる。
  const stalledUsers = await resetStalledNotified()
  if (stalledUsers.length > 0) {
    console.log(`[自己修復] ${stalledUsers.length}ユーザーの通知ログをリセット`)
  }

  // 通知済みIDを全ユーザー分まとめて1クエリで取得
  // 100ユーザー時でもDBアクセスは1回のみ（スケーラブル設計）
  const activeUserIds = [...new Set(activeConditions.map(c => c.userId))]
  const notifiedIdsCache = await getAllNotifiedIds(activeUserIds)
  console.log(`通知済みIDキャッシュ取得完了: ${activeUserIds.length}ユーザー分（1クエリ）`)

  let totalNotified = 0
  // ユーザーごとの新着アイテム収集（メインループ後にサマリー1回で通知）
  const pendingByUser = new Map<string, PendingNotification[]>()
  const failedFetchByUser = new Map<string, number>()

  // 並列でRSSフェッチ（3並列）
  // GitHub Actions: GH_FETCH_PAGES=120ページまで終端探索（最大6000件）
  // → 人気キーワードで深いページにある入札あり商品も拾う
  // → 深いページングのため、Yahoo側にブロックされないよう検索単位の並列数は抑える
  const FETCH_CONCURRENCY = CHECK_SHARD_TOTAL > 1 ? 1 : 3
  for (let i = 0; i < groups.length; i += FETCH_CONCURRENCY) {
    const batch = groups.slice(i, i + FETCH_CONCURRENCY)
    await Promise.all(batch.map(async (group) => {
      let items: AuctionItem[] = []
      try {
        items = await fetchWithRetry(group.key)
      } catch (e: any) {
        console.error(`  ⚠️ [${group.key.keyword}] RSS取得失敗 (継続):`, e?.message ?? e)
        for (const cond of group.conditions) {
          failedFetchByUser.set(cond.userId, (failedFetchByUser.get(cond.userId) ?? 0) + 1)
          await addConditionCheckHistory(cond, { status: 'failed' }).catch(err => {
            console.warn(`  ⚠️ [${cond.name}] チェック履歴保存失敗:`, err?.message ?? err)
          })
        }
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
          if (notifiedIdsCache.get(cond.userId)?.has(item.auctionId)) {
            await updateHistorySnapshot(toHistoryRecord(cond, item))
            continue
          }

          // サマリー通知用に収集（同一実行内で同一商品の重複を除く）
          if (!pendingByUser.has(cond.userId)) pendingByUser.set(cond.userId, [])
          const alreadyPending = pendingByUser.get(cond.userId)!
          if (!alreadyPending.some(a => a.item.auctionId === item.auctionId)) {
            alreadyPending.push({ item, cond })
            conditionNotified++
          }
        }

        // 最終チェック時刻は、件数変化がなくても巡回成功の証跡として必ず更新する。
        await updateCondition(cond.id, {
          lastCheckedAt: new Date().toISOString(),
          lastFoundCount: candidateItems.length,
        })
        await addConditionCheckHistory(cond, {
          status: 'ok',
          matchedCount: candidateItems.length,
          freshCount: conditionNotified,
        }).catch(err => {
          console.warn(`  ⚠️ [${cond.name}] チェック履歴保存失敗:`, err?.message ?? err)
        })

        if (conditionNotified > 0) {
          console.log(`  ✅ [${cond.name}] ${conditionNotified}件新着`)
        }
      }
    }))

    // バッチ間の待機（Yahoo RSS への負荷分散）
    if (i + FETCH_CONCURRENCY < groups.length) {
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  // ─── 通知（10並列で送信）───
  // 通常: 新着あり → Web Push サマリー / 新着なし → 通知しない。
  // テスト期間のみ SEND_NO_ITEMS_PUSH=true で、全通知可能ユーザーへ検査完了通知も送る。
  const pushActiveUserIds = activeUserIds.filter(id => pushUserIds.has(id))
  const NOTIFY_CONCURRENCY = 10
  let totalCheckCompleteNotified = 0
  for (let i = 0; i < pushActiveUserIds.length; i += NOTIFY_CONCURRENCY) {
    const batch = pushActiveUserIds.slice(i, i + NOTIFY_CONCURRENCY)
    await Promise.all(batch.map(async (userId) => {
      const items = pendingByUser.get(userId)
      if (items && items.length > 0) {
        const delivered = await sendWebPushSummary(userId, items.length, items[0].item)
        if (!delivered) {
          console.warn(`  ⚠️ [${userId.slice(0,8)}] Push失敗: ${items.length}件は通知済みにせず次回再試行`)
          return
        }
        let marked = 0
        let recordErrors = 0
        for (const { item, cond } of items) {
          if (notifiedIdsCache.get(userId)?.has(item.auctionId)) continue
          try {
            await addHistory(toHistoryRecord(cond, item))
            await markNotified(userId, item.auctionId)
            notifiedIdsCache.get(userId)?.add(item.auctionId)
            marked++
          } catch (e: any) {
            recordErrors++
            console.warn(`  ⚠️ [${userId.slice(0,8)}] 通知後記録失敗:`, e?.message ?? e)
          }
        }
        totalNotified += marked
        console.log(`  📨 [${userId.slice(0,8)}] 新着${marked}件 通知`)
        if (recordErrors > 0) {
          console.error(`  ⚠️ [${userId.slice(0,8)}] 通知後記録失敗 ${recordErrors}/${items.length}件（未記録分は次回再試行）`)
        }
      }

      if (SEND_NO_ITEMS_PUSH) {
        const shouldSendCheckComplete = FORCE_CHECK_COMPLETE_PUSH || await canSendCheckCompleteThisHour(userId)
        if (!shouldSendCheckComplete) {
          console.log(`  ↪️ [${userId.slice(0,8)}] チェック完了Pushは50分以内に送信済みのためスキップ`)
          return
        }
        if (FORCE_CHECK_COMPLETE_PUSH) {
          console.log(`  🔁 [${userId.slice(0,8)}] 手動実行のためチェック完了Push抑制を解除`)
        }
        const freshCount = items?.length ?? 0
        const fetchFailedCount = failedFetchByUser.get(userId) ?? 0
        const delivered = await sendWebPushCheckComplete(userId, {
          freshCount,
          noItems: freshCount === 0,
          failed: fetchFailedCount > 0,
          fetchFailedCount,
        })
        if (delivered) {
          await markCheckCompleteSent(userId)
          totalCheckCompleteNotified++
        }
        else console.warn(`  ⚠️ [${userId.slice(0,8)}] チェック完了Push失敗`)
      }
    }))
  }

  // ─── 時間ベースクリーンアップ ───
  // end_at あり: 終了12時間後に削除 / end_at なし(旧データ): 通知36時間後に削除
  await cleanupOldHistory()
  await cleanupOldNotified()

  // ─── end_at なし旧レコードのYahoo確認クリーンアップ（安全網）───
  await cleanupEndedAuctions()

  // ─── 幽霊ユーザー削除（通知設定なし + 14日以上経過）───
  const ghostCount = await cleanupGhostUsers()
  if (ghostCount > 0) {
    console.log(`[幽霊ユーザー] ${ghostCount}件削除（通知設定なし+14日経過）`)
  }

  console.log(`\n=== 完了: 合計${totalNotified}件通知 / チェック完了通知${totalCheckCompleteNotified}件 ===\n`)
}

/** end_at なし旧レコードを Yahoo 確認して削除する安全網（停止中） */
async function cleanupEndedAuctions(): Promise<void> {
  // 履歴消失の報告が出たため、終了済みオークションのDB削除は一時停止。
  // notified_items の整理も含め、復旧後に「履歴は残す/表示だけ非表示」で再設計する。
  console.log('[cleanup] 終了済みオークション削除は一時停止中')
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
      .select('id')
      .is('push_sub', null)
      .lt('created_at', cutoff)
    if (!candidates?.length) return 0

    const ghostIds = candidates.map(u => u.id as string)
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
