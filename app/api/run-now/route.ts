import { NextRequest, NextResponse } from 'next/server'
import { getConditions, getNotifiedIds, markNotified, addHistory, updateCondition } from '@/lib/storage'
import { getSupabaseAdmin } from '@/lib/supabase'
import { fetchAuctionRssWithMeta, fetchAuctionRssSimple } from '@/lib/scraper'
import { notifyUser } from '@/lib/notifier'
import { sendWebPushToUser, sendWebPushSummary } from '@/lib/webpush'
import { checkRateLimit } from '@/lib/rateLimiter'
import { User, SearchCondition, AuctionItem } from '@/lib/types'

// 1ユーザーあたり同時に処理する条件数
// 30条件 ÷ 5 = 6バッチ × ~2s = 12s << USER_TIMEOUT_MS(30s)
const CONDITION_CONCURRENCY = 5

type RssKey = Pick<SearchCondition, 'keyword' | 'maxPrice' | 'minPrice' | 'minBids' | 'sellerType' | 'itemCondition' | 'sortBy' | 'sortOrder' | 'buyItNow'>

type FetchResult = {
  cond: SearchCondition
  items: AuctionItem[]
  rawCount: number
  rssUrl?: string
  httpStatus?: number
  xmlPreview?: string
  simpleCount?: number
  priceWarning: boolean
}

async function getUser(userId: string): Promise<User | null> {
  const { data } = await getSupabaseAdmin()
    .from('users')
    .select('id, ntfy_topic, discord_webhook, notification_channel, push_sub')
    .eq('id', userId)
    .single()
  if (!data) return null
  return {
    id: data.id,
    ntfyTopic: data.ntfy_topic ?? '',
    discordWebhook: data.discord_webhook ?? '',
    notificationChannel: data.notification_channel ?? 'ntfy',
    pushSub: data.push_sub ?? null,
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, manual = false } = await req.json()
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    // サーバーサイドcronからの内部呼び出しはレート制限をスキップ
    const isCronCall = !!process.env.CRON_SECRET &&
      req.headers.get('x-cron-secret') === process.env.CRON_SECRET?.trim()

    // レート制限: 1分に3回まで（通知スパム防止）
    if (!isCronCall && !checkRateLimit(`run-now:${userId}`, 3, 60_000)) {
      return NextResponse.json({ error: 'リクエストが多すぎます。しばらく待ってください' }, { status: 429 })
    }

    const user = await getUser(userId)
    if (!user) return NextResponse.json({ error: 'user not found' }, { status: 404 })

    const hasPush = !!(user as any).pushSub?.endpoint
    if (!user.ntfyTopic && !user.discordWebhook && !hasPush) {
      return NextResponse.json({ error: '通知先が設定されていません' }, { status: 400 })
    }

    const allConditions = await getConditions(userId)
    // cron経由・手動実行ともに有効な全条件を処理（上限なし）
    // CONDITION_CONCURRENCY=5 の並列バッチで30条件も12秒以内に完了
    const enabled = allConditions.filter(c => c.enabled)
    if (enabled.length === 0) {
      return NextResponse.json({ notified: 0, checked: 0, message: '有効な条件がありません' })
    }

    const notifiedIds = await getNotifiedIds(userId)
    let totalNotified = 0
    type ResultRow = {
      name: string
      fetched: number
      rawCount: number
      alreadyNotified: number
      filteredByBids: number
      filteredByFormat: number
      newItems: number
      notified: number
      priceWarning?: boolean
      simpleCount?: number
      rssUrl?: string
      httpStatus?: number
      xmlPreview?: string
    }
    const results: ResultRow[] = []

    // ── Phase 1: 全条件を CONDITION_CONCURRENCY=5 並列バッチでフェッチ ─────────────
    const fetchResults: FetchResult[] = []
    for (let i = 0; i < enabled.length; i += CONDITION_CONCURRENCY) {
      const batch = enabled.slice(i, i + CONDITION_CONCURRENCY)
      const settled = await Promise.allSettled(
        batch.map(async (cond): Promise<FetchResult> => {
          const key: RssKey = {
            keyword: cond.keyword, maxPrice: cond.maxPrice, minPrice: cond.minPrice,
            minBids: cond.minBids ?? 0, sellerType: cond.sellerType ?? 'all',
            itemCondition: cond.itemCondition ?? 'all', sortBy: cond.sortBy ?? 'endTime',
            sortOrder: cond.sortOrder ?? 'asc', buyItNow: cond.buyItNow,
          }
          const { items, url: rssUrl, httpStatus, rawCount, xmlPreview } = await fetchAuctionRssWithMeta(key)
          let simpleCount: number | undefined
          if (rawCount === 0) {
            simpleCount = await fetchAuctionRssSimple(cond.keyword, cond.maxPrice, cond.minPrice)
          }
          return {
            cond, items, rawCount, rssUrl, httpStatus, xmlPreview, simpleCount,
            priceWarning: cond.minPrice > 0 && cond.minPrice >= cond.maxPrice,
          }
        })
      )
      for (let j = 0; j < settled.length; j++) {
        const r = settled[j]
        if (r.status === 'fulfilled') {
          fetchResults.push(r.value)
        } else {
          console.error(`[run-now] 条件フェッチ失敗 "${batch[j].name}" (スキップ):`, r.reason)
        }
      }
    }

    // ── Phase 2 + 3: 条件ごとにフィルター → 通知 ─────────────────────────────────
    // manual=true: 全件を履歴に記録し、最後にサマリーPush1通だけ送信（遅延なし）
    // manual=false(cron): アイテムごとにPush送信、成功時のみ履歴記録（300ms遅延あり）

    // manual モード用: 全条件の fresh items を集約
    const allFreshForSummary: { item: AuctionItem; cond: SearchCondition }[] = []

    for (const { cond, items, rawCount, rssUrl, httpStatus, xmlPreview, simpleCount, priceWarning } of fetchResults) {
      const minBids = cond.minBids ?? 0
      const maxBids = cond.maxBids ?? null
      // 新規条件（lastCheckedAt=null）は初回プレビューのため notifiedIds チェックをスキップ
      const isNewCondition = !cond.lastCheckedAt
      const afterNotifiedFilter = items.filter(
        (item: AuctionItem) => isNewCondition || !notifiedIds.has(item.auctionId)
      )
      const alreadyNotified = items.length - afterNotifiedFilter.length
      const afterBidsFilter = afterNotifiedFilter.filter((item: AuctionItem) => {
        if (minBids <= 0 && maxBids === null) return true
        if (item.bids === null) return minBids <= 0
        if (minBids > 0 && item.bids < minBids) return false
        if (maxBids !== null && item.bids >= maxBids) return false
        return true
      })
      const filteredByBids = afterNotifiedFilter.length - afterBidsFilter.length
      const freshItems = afterBidsFilter.filter((item: AuctionItem) => {
        if (minBids > 0 && cond.buyItNow === null && item.isBuyItNow === true) return false
        if (cond.buyItNow === null) return true
        if (cond.buyItNow === true) return item.isBuyItNow === true
        return item.isBuyItNow !== true
      })
      const filteredByFormat = afterBidsFilter.length - freshItems.length
      let condNotified = 0

      if (manual) {
        // ── 手動チェック: 全件を履歴に無条件記録（Push は後でサマリー1通）──
        for (const item of freshItems) {
          if (notifiedIds.has(item.auctionId)) continue
          try {
            await markNotified(userId, item.auctionId)
            notifiedIds.add(item.auctionId)
            await addHistory({
              userId, conditionId: cond.id, conditionName: cond.name,
              auctionId: item.auctionId, title: item.title, price: item.price,
              url: item.url, imageUrl: item.imageUrl ?? '',
              notifiedAt: new Date().toISOString(), remaining: item.remaining ?? null,
            })
            allFreshForSummary.push({ item, cond })
            condNotified++
            totalNotified++
          } catch (e: any) {
            console.warn('[run-now] manual 記録失敗 (継続):', e?.message)
          }
        }
      } else {
        // ── cron: アイテムごとにPush送信、成功時のみ履歴記録 ──
        for (const item of freshItems) {
          if (notifiedIds.has(item.auctionId)) continue
          try {
            const sentLegacy = (user.ntfyTopic || user.discordWebhook)
              ? await notifyUser(item, user)
              : false
            let sentPush = false
            if (hasPush) {
              const pushResult = await sendWebPushToUser(userId, item)
              sentPush = pushResult > 0
            }
            const sent = sentLegacy || sentPush
            if (sent) {
              try { await markNotified(userId, item.auctionId) } catch (e: any) {
                console.warn('[run-now] markNotified失敗 (継続):', e?.message)
              }
              notifiedIds.add(item.auctionId)
              try {
                await addHistory({
                  userId, conditionId: cond.id, conditionName: cond.name,
                  auctionId: item.auctionId, title: item.title, price: item.price,
                  url: item.url, imageUrl: item.imageUrl ?? '',
                  notifiedAt: new Date().toISOString(), remaining: item.remaining ?? null,
                })
              } catch (e: any) {
                console.warn('[run-now] addHistory失敗 (継続):', e?.message)
              }
              condNotified++
              totalNotified++
            }
          } catch (e: any) {
            console.error('[run-now] 通知送信エラー (スキップして継続):', e?.name, e?.message)
          }
          await new Promise(r => setTimeout(r, 300))
        }
      }

      try {
        await updateCondition(cond.id, {
          lastCheckedAt: new Date().toISOString(),
          lastFoundCount: items.length,
        })
      } catch (e: any) {
        console.warn('[run-now] updateCondition失敗 (継続):', e?.message)
      }

      results.push({
        name: cond.name, fetched: items.length, rawCount, alreadyNotified,
        filteredByBids, filteredByFormat, newItems: freshItems.length,
        notified: condNotified, priceWarning, simpleCount, rssUrl, httpStatus, xmlPreview,
      })
    }

    // ── manual モード: サマリーPush1通送信 ──
    if (manual && allFreshForSummary.length > 0 && hasPush) {
      try {
        const topItem = allFreshForSummary[0].item
        await sendWebPushSummary(userId, allFreshForSummary.length, topItem, getSupabaseAdmin())
      } catch (e: any) {
        console.warn('[run-now] サマリーPush送信失敗 (継続):', e?.message)
      }
    }

    return NextResponse.json({ notified: totalNotified, checked: enabled.length, results })
  } catch (e: any) {
    const name = e?.name ?? 'UnknownError'
    const msg  = e?.message ?? String(e)
    console.error('[run-now] エラー:', name, msg, e?.stack)
    return NextResponse.json({ error: `${name}: ${msg}` }, { status: 500 })
  }
}
