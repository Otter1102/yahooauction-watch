#!/usr/bin/env tsx
/**
 * ヤフオクwatch チェッカー本体
 * GitHub Actions から30分毎に実行される
 *
 * 実行: npx tsx scripts/run-check.ts
 * 環境変数: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { getAllEnabledConditions, getNotifiedIds, markNotified, addHistory, updateCondition, cleanupOldNotified, cleanupOldHistory, cleanupExpiredTrialSessions, cleanupGhostUsers, resetStalledNotified } from '../lib/storage'
import { fetchAuctionRss, checkAuctionEnded } from '../lib/scraper'
import { notifyUser } from '../lib/notifier'
import { sendWebPushToUser } from '../lib/webpush'
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
      const errMsg = (err instanceof Error ? err.message : String(err))
        .replace(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', '[SUPABASE_URL]')
        .replace(process.env.SUPABASE_SERVICE_KEY     ?? '', '[SERVICE_KEY]')
      console.error(`[DB] 取得失敗 (試行${attempt}/3): ${errMsg}`)
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

  // キーワード+価格でグループ化（同じ検索は1回のみRSSフェッチ）
  const groups = groupConditions(activeConditions)
  console.log(`ユニーク検索: ${groups.length}件（重複排除後）`)

  let totalNotified = 0

  // 並列でRSSフェッチ（10並列）
  // startOffset=1: スクレイパー内で b=1(1〜50件) + b=51(51〜100件) の2ページを自動取得
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

        // 通知済みIDを取得
        const notifiedIds = await getNotifiedIds(cond.userId)
        const minBids = cond.minBids ?? 0
        const maxBids = cond.maxBids ?? null
        const newItems = items
          .filter(item => !notifiedIds.has(item.auctionId))
          .filter(item => {
            // 入札数フィルター
            if (minBids <= 0 && maxBids === null) return true
            // bids=null: startPrice取得失敗で入札数が本当に不明 → minBids>0 なら保守的に除外
            if (item.bids === null) return minBids <= 0
            if (minBids > 0 && item.bids < minBids) return false
            if (maxBids !== null && item.bids >= maxBids) return false
            return true
          })
          .filter(item => {
            // 出品形式フィルター
            // 入札1件以上 かつ 出品形式=両方 → 純即決（isBuyItNow=true）を除外
            //   理由: 入札があるということはオークション商品確定。純即決は入札不可なので除外。
            //   ※ オークション+即決オプション付き商品（isBuyItNow=false）は除外しない
            if (minBids > 0 && cond.buyItNow === null && item.isBuyItNow === true) return false
            if (cond.buyItNow === null) return true                       // 両方OK
            if (cond.buyItNow === true) return item.isBuyItNow === true   // 即決ボタン押した時のみ即決
            return item.isBuyItNow !== true                               // false = オークションのみ
          })

        let conditionNotified = 0
        for (const item of newItems) {
          // ntfy / Discord 通知
          const sentLegacy = user.ntfyTopic || user.discordWebhook
            ? await notifyUser(item, user)
            : false
          // Web Push 通知（push購読があれば常に送信）
          let sentPush = false
          if (pushUserIds.has(cond.userId)) {
            const pushResult = await sendWebPushToUser(cond.userId, item, undefined, undefined, { conditionName: cond.name })
            sentPush = pushResult > 0
            if (!sentPush) console.log(`    ⚠️ Push失敗 [${cond.name}] userId=${cond.userId.slice(0,8)}`)
          }
          const sent = sentLegacy || sentPush
          if (sent) {
            await markNotified(cond.userId, item.auctionId)
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
            conditionNotified++
            totalNotified++
            // ntfy.sh レート制限対策
            await new Promise(r => setTimeout(r, 300))
          }
        }

        // 変化があった時のみ更新（DB帯域節約: 変化なし=スキップで月間UPDATE数を大幅削減）
        if (conditionNotified > 0 || newItems.length !== (cond.lastFoundCount ?? -1)) {
          await updateCondition(cond.id, {
            lastCheckedAt: new Date().toISOString(),
            lastFoundCount: newItems.length,
          })
        }

        if (conditionNotified > 0) {
          console.log(`  ✅ [${cond.name}] ${conditionNotified}件通知`)
        }
      }
    }))

    // バッチ間の待機（Yahoo RSS への負荷分散）
    if (i + CONCURRENCY < groups.length) {
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  // ─── 終了済みオークションを履歴から削除 ───
  await cleanupEndedAuctions()

  // ─── 多層クリーンアップ ───────────────────────────────────────
  // 【短期】notified_items: 25時間超を削除（オークション終了後のIDを安全に回収）
  const deletedNotified = await cleanupOldNotified()
  if (deletedNotified > 0) console.log(`[掃除] notified_items ${deletedNotified}件削除`)

  // 【短期】notification_history: 24時間超を削除（履歴はIndexedDB端末側で保持）
  const deletedHistory = await cleanupOldHistory(24)
  if (deletedHistory > 0) console.log(`[掃除] notification_history ${deletedHistory}件削除`)

  // 【長期】trial_sessions: 30日超の期限切れを削除（月次相当・毎回実行しても軽量）
  const deletedTrials = await cleanupExpiredTrialSessions()
  if (deletedTrials > 0) console.log(`[掃除] trial_sessions ${deletedTrials}件削除`)

  // 【長期】ゴーストユーザー: 条件なし・push_subなし・24h超を削除（再インストール孤立UUID回収）
  const deletedGhosts = await cleanupGhostUsers()
  if (deletedGhosts > 0) console.log(`[掃除] ゴーストユーザー ${deletedGhosts}件削除`)

  // ─── 自己修復: 6時間通知なし + notified_items溜まりユーザーをリセット ───
  const stalledUsers = await resetStalledNotified()
  if (stalledUsers.length > 0) {
    console.log(`[自己修復] ${stalledUsers.length}ユーザーの通知ログをリセット`)
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

main().catch(err => {
  // 秘密情報をマスクしてからログ出力（GitHub Actionsログへの漏洩防止）
  const raw = err instanceof Error ? err.message : String(err)
  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? ''
  const serviceKey   = process.env.SUPABASE_SERVICE_KEY       ?? ''
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY          ?? ''
  const sanitized = raw
    .replace(supabaseUrl,  '[SUPABASE_URL]')
    .replace(serviceKey,   '[SERVICE_KEY]')
    .replace(vapidPrivate, '[VAPID_PRIVATE]')
  console.error('[FATAL]', sanitized)
  process.exit(1)
})
