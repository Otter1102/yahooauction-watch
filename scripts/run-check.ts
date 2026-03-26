#!/usr/bin/env tsx
/**
 * ヤフオクwatch チェッカー本体
 * GitHub Actions から30分毎に実行される
 *
 * 実行: npx tsx scripts/run-check.ts
 * 環境変数: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { getAllEnabledConditions, getNotifiedIds, markNotified, addHistory, updateCondition } from '../lib/storage'
import { fetchAuctionRss } from '../lib/scraper'
import { notifyUser } from '../lib/notifier'
import { getSupabaseAdmin } from '../lib/supabase'
const supabaseAdmin = { from: (...args: Parameters<ReturnType<typeof getSupabaseAdmin>['from']>) => getSupabaseAdmin().from(...args) }
import { User, SearchCondition, AuctionItem } from '../lib/types'

type RssKey = Pick<SearchCondition, 'keyword' | 'maxPrice' | 'minPrice' | 'minBids' | 'sellerType' | 'itemCondition' | 'sortBy' | 'sortOrder' | 'buyItNow'>
interface ConditionGroup { key: RssKey; conditions: SearchCondition[] }

async function getAllUsers(userIds: string[]): Promise<Map<string, User>> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('*')
    .in('id', userIds)
  const map = new Map<string, User>()
  for (const row of data ?? []) {
    map.set(row.id, {
      id: row.id,
      ntfyTopic: row.ntfy_topic ?? '',
      discordWebhook: row.discord_webhook ?? '',
      notificationChannel: row.notification_channel ?? 'ntfy',
    })
  }
  return map
}

function groupConditions(conditions: SearchCondition[]): ConditionGroup[] {
  const map = new Map<string, ConditionGroup>()
  for (const cond of conditions) {
    const rssKey: RssKey = {
      keyword: cond.keyword, maxPrice: cond.maxPrice, minPrice: cond.minPrice,
      minBids: cond.minBids ?? 0, sellerType: cond.sellerType ?? 'all',
      itemCondition: cond.itemCondition ?? 'all', sortBy: cond.sortBy ?? 'endTime',
      sortOrder: cond.sortOrder ?? 'asc', buyItNow: cond.buyItNow ?? false,
    }
    const key = JSON.stringify(rssKey)
    if (!map.has(key)) map.set(key, { key: rssKey, conditions: [] })
    map.get(key)!.conditions.push(cond)
  }
  return Array.from(map.values())
}

async function fetchWithRetry(key: RssKey, retries = 2): Promise<AuctionItem[]> {
  for (let i = 0; i <= retries; i++) {
    const items = await fetchAuctionRss(key)
    if (items.length > 0 || i === retries) return items
    await new Promise(r => setTimeout(r, 2000))
  }
  return []
}

async function main() {
  console.log(`\n=== ヤフオクwatch チェック開始 ${new Date().toLocaleString('ja-JP')} ===`)

  // 全有効条件を取得
  const allConditions = await getAllEnabledConditions()
  console.log(`対象条件: ${allConditions.length}件`)
  if (allConditions.length === 0) { console.log('条件なし。終了。'); return }

  // ユーザー情報を一括取得
  const uniqueUserIds = [...new Set(allConditions.map(c => c.userId))]
  const usersMap = await getAllUsers(uniqueUserIds)
  console.log(`対象ユーザー: ${uniqueUserIds.length}人`)

  // 通知設定済みユーザーのみ処理
  const activeConditions = allConditions.filter(c => {
    const user = usersMap.get(c.userId)
    return user && (user.ntfyTopic || user.discordWebhook)
  })
  console.log(`通知設定済みユーザーの条件: ${activeConditions.length}件`)

  // キーワード+価格でグループ化（同じ検索は1回のみRSSフェッチ）
  const groups = groupConditions(activeConditions)
  console.log(`ユニーク検索: ${groups.length}件（重複排除後）`)

  let totalNotified = 0

  // 並列でRSSフェッチ（10並列）
  const CONCURRENCY = 10
  for (let i = 0; i < groups.length; i += CONCURRENCY) {
    const batch = groups.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async (group) => {
      const items = await fetchWithRetry(group.key)
      if (items.length === 0) return

      // このグループの全ユーザーを処理
      for (const cond of group.conditions) {
        const user = usersMap.get(cond.userId)
        if (!user) continue

        // 通知済みIDを取得
        const notifiedIds = await getNotifiedIds(cond.userId)
        const newItems = items.filter(item => !notifiedIds.has(item.auctionId))

        let conditionNotified = 0
        for (const item of newItems) {
          const sent = await notifyUser(item, user)
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
              notifiedAt: new Date().toISOString(),
            })
            conditionNotified++
            totalNotified++
            // ntfy.sh レート制限対策
            await new Promise(r => setTimeout(r, 300))
          }
        }

        // lastCheckedAt / lastFoundCount を更新
        await updateCondition(cond.id, {
          lastCheckedAt: new Date().toISOString(),
          lastFoundCount: newItems.length,
        })

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

  console.log(`\n=== 完了: 合計${totalNotified}件通知 ===\n`)
}

main().catch(err => {
  console.error('エラー:', err)
  process.exit(1)
})
