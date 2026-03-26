import { NextRequest, NextResponse } from 'next/server'
import { getConditions, getNotifiedIds, markNotified, addHistory, updateCondition } from '@/lib/storage'
import { getSupabaseAdmin } from '@/lib/supabase'
import { fetchAuctionRss } from '@/lib/scraper'
import { notifyUser } from '@/lib/notifier'
import { User, SearchCondition, AuctionItem } from '@/lib/types'

type RssKey = Pick<SearchCondition, 'keyword' | 'maxPrice' | 'minPrice' | 'minBids' | 'sellerType' | 'itemCondition' | 'sortBy' | 'sortOrder' | 'buyItNow'>

async function getUser(userId: string): Promise<User | null> {
  const { data } = await getSupabaseAdmin()
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()
  if (!data) return null
  return {
    id: data.id,
    ntfyTopic: data.ntfy_topic ?? '',
    discordWebhook: data.discord_webhook ?? '',
    notificationChannel: data.notification_channel ?? 'ntfy',
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json()
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    const user = await getUser(userId)
    if (!user) return NextResponse.json({ error: 'user not found' }, { status: 404 })

    if (!user.ntfyTopic && !user.discordWebhook) {
      return NextResponse.json({ error: '通知先が設定されていません' }, { status: 400 })
    }

    const conditions = await getConditions(userId)
    const enabled = conditions.filter(c => c.enabled)
    if (enabled.length === 0) {
      return NextResponse.json({ notified: 0, checked: 0, message: '有効な条件がありません' })
    }

    const notifiedIds = await getNotifiedIds(userId)
    let totalNotified = 0
    const results: { name: string; fetched: number; newItems: number; notified: number; priceWarning?: boolean }[] = []

    for (const cond of enabled) {
      const priceWarning = cond.minPrice > 0 && cond.minPrice >= cond.maxPrice
      const key: RssKey = {
        keyword: cond.keyword, maxPrice: cond.maxPrice, minPrice: cond.minPrice,
        minBids: cond.minBids ?? 0, sellerType: cond.sellerType ?? 'all',
        itemCondition: cond.itemCondition ?? 'all', sortBy: cond.sortBy ?? 'endTime',
        sortOrder: cond.sortOrder ?? 'asc', buyItNow: cond.buyItNow ?? false,
      }
      const items = await fetchAuctionRss(key)
      const freshItems = items.filter((item: AuctionItem) => !notifiedIds.has(item.auctionId))
      let condNotified = 0

      for (const item of freshItems.slice(0, 5)) { // 手動実行は最大5件
        const sent = await notifyUser(item, user)
        if (sent) {
          await markNotified(userId, item.auctionId)
          notifiedIds.add(item.auctionId)
          await addHistory({
            userId,
            conditionId: cond.id,
            conditionName: cond.name,
            auctionId: item.auctionId,
            title: item.title,
            price: item.price,
            url: item.url,
            notifiedAt: new Date().toISOString(),
          })
          condNotified++
          totalNotified++
        }
        await new Promise(r => setTimeout(r, 300))
      }

      await updateCondition(cond.id, {
        lastCheckedAt: new Date().toISOString(),
        lastFoundCount: items.length,
      })

      results.push({ name: cond.name, fetched: items.length, newItems: freshItems.length, notified: condNotified, priceWarning })
    }

    return NextResponse.json({ notified: totalNotified, checked: enabled.length, results })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
