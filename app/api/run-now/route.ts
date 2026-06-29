import { NextRequest, NextResponse } from 'next/server'
import { getConditions, getNotifiedIds, markNotified, addHistory, addHistories, updateCondition, addConditionCheckHistory } from '@/lib/storage'
import { getSupabaseAdmin } from '@/lib/supabase'
import { fetchAuctionRssWithMeta, fetchAuctionRssSimple } from '@/lib/scraper'
import { selectConditionCandidates } from '@/lib/condition-match'
import { notifyUserSummary } from '@/lib/notifier'
import { sendWebPushCheckComplete, sendWebPushSummary } from '@/lib/webpush'
import { checkRateLimit } from '@/lib/rateLimiter'
import { User, SearchCondition, AuctionItem } from '@/lib/types'

// 1ユーザーあたり同時に処理する条件数
// 30条件 ÷ 5 = 6バッチ × ~2s = 12s << USER_TIMEOUT_MS(30s)
const CONDITION_CONCURRENCY = 5
const SEND_NO_ITEMS_PUSH = process.env.SEND_NO_ITEMS_PUSH === 'true'
const DISPLAY_ITEMS_PER_CONDITION_LIMIT = Math.max(
  1,
  Number.parseInt(process.env.CHECK_DISPLAY_ITEMS_PER_CONDITION_LIMIT ?? '300', 10) || 300,
)

type RssKey = Pick<SearchCondition, 'keyword' | 'maxPrice' | 'minPrice' | 'minBids' | 'sellerType' | 'itemCondition' | 'sortBy' | 'sortOrder' | 'buyItNow'>

type FetchResult = {
  cond: SearchCondition
  items: AuctionItem[]
  rawCount: number
  rssUrl?: string
  httpStatus?: number
  xmlPreview?: string
  pagesFetched?: number
  successfulPages?: number
  failedPages?: number
  statusSummary?: string
  truncated?: boolean
  simpleCount?: number
  priceWarning: boolean
}

function toHistoryRecord(userId: string, cond: SearchCondition, item: AuctionItem) {
  return {
    userId,
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

async function getUser(userId: string): Promise<User | null> {
  const { data } = await getSupabaseAdmin()
    .from('users')
    .select('id, push_sub')
    .eq('id', userId)
    .single()
  if (!data) return null
  return {
    id: data.id,
    ntfyTopic: '',
    discordWebhook: '',
    notificationChannel: 'webpush',
    pushSub: data.push_sub ?? null,
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, manual = false } = await req.json()
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    // サーバーサイドcronからの内部呼び出しはレート制限をスキップ
    const isCronCall = !!process.env.CRON_SECRET &&
      req.headers.get('x-cron-secret')?.trim() === process.env.CRON_SECRET.trim()

    // レート制限: 1分に3回まで（通知スパム防止）
    if (!isCronCall && !checkRateLimit(`run-now:${userId}`, 3, 60_000)) {
      return NextResponse.json({ error: 'リクエストが多すぎます。しばらく待ってください' }, { status: 429 })
    }

    const user = await getUser(userId)
    if (!user) return NextResponse.json({ error: 'user not found' }, { status: 404 })

    const hasPush = !!(user as any).pushSub?.endpoint
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
      conditionId: string
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
      pagesFetched?: number
      truncated?: boolean
    }
    const results: ResultRow[] = []
    let fetchFailedCount = 0

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
          const {
            items, url: rssUrl, httpStatus, rawCount, xmlPreview, pagesFetched,
            successfulPages, failedPages, statusSummary, truncated,
          } = await fetchAuctionRssWithMeta(key)
          if (pagesFetched > 0 && successfulPages === 0) {
            throw new Error(`Yahoo検索取得失敗: status=${statusSummary || 'none'} pages=${pagesFetched}`)
          }
          let simpleCount: number | undefined
          if (rawCount === 0) {
            simpleCount = await fetchAuctionRssSimple(cond.keyword, cond.maxPrice, cond.minPrice)
          }
          return {
            cond, items, rawCount, rssUrl, httpStatus, xmlPreview, pagesFetched,
            successfulPages, failedPages, statusSummary, truncated, simpleCount,
            priceWarning: cond.minPrice > 0 && cond.minPrice >= cond.maxPrice,
          }
        })
      )
      for (let j = 0; j < settled.length; j++) {
        const r = settled[j]
        if (r.status === 'fulfilled') {
          fetchResults.push(r.value)
        } else {
          fetchFailedCount++
          console.error(`[run-now] 条件フェッチ失敗 "${batch[j].name}" (スキップ):`, r.reason)
          await addConditionCheckHistory(batch[j], { status: 'failed' }).catch(e => {
            console.warn('[run-now] チェック履歴保存失敗 (継続):', e?.message ?? e)
          })
        }
      }
    }

    // ── Phase 2: 条件ごとにフィルター → 通知対象を収集 ──────────────────────────
    const allFreshForSummary: { item: AuctionItem; cond: SearchCondition }[] = []
    const pendingAuctionIds = new Set<string>()
    const pendingCountByCondition = new Map<string, number>()

    for (const { cond, items, rawCount, rssUrl, httpStatus, xmlPreview, pagesFetched, truncated, simpleCount, priceWarning } of fetchResults) {
      const selection = selectConditionCandidates(cond, items)
      const matchingItems = selection.items
      const filteredByBids = selection.filteredByBids
      const filteredByFormat = selection.filteredByFormat
      const freshItems = matchingItems.filter((item: AuctionItem) => !notifiedIds.has(item.auctionId))
      const alreadyNotified = matchingItems.length - freshItems.length
      let condPending = 0
      let condRecordErrors = 0

      // 表示用の商品欄は、通知送信の成否とは独立して最新化する。
      // Push失敗・未設定・履歴削除済みでも、アプリ上では取得商品を確認できるようにする。
      try {
        await addHistories(
          matchingItems
            .slice(0, DISPLAY_ITEMS_PER_CONDITION_LIMIT)
            .map(item => toHistoryRecord(userId, cond, item)),
        )
      } catch (e: any) {
        condRecordErrors++
        console.warn('[run-now] 表示用履歴保存失敗 (継続):', e?.message)
      }

      // 新規商品はPush送信が成功するまで notified_items に入れない。
      // 先に通知済みにすると、Push失敗後も次回以降スキップされて通知が止まる。
      for (const item of freshItems) {
        if (pendingAuctionIds.has(item.auctionId)) continue
        pendingAuctionIds.add(item.auctionId)
        allFreshForSummary.push({ item, cond })
        condPending++
      }
      if (condPending > 0) {
        pendingCountByCondition.set(cond.id, condPending)
      }
      if (condRecordErrors > 0) {
        console.error(`[run-now] 条件"${cond.name}" 履歴更新失敗 ${condRecordErrors}/${matchingItems.length}件`)
      }

      results.push({
        conditionId: cond.id,
        name: cond.name, fetched: items.length, rawCount, alreadyNotified,
        filteredByBids, filteredByFormat, newItems: freshItems.length,
        notified: 0, priceWarning, simpleCount, rssUrl, httpStatus, xmlPreview,
        pagesFetched, truncated,
      })
    }

    // ── サマリー通知 ──
    let checkCompleteNotified = false
    if (allFreshForSummary.length > 0) {
      const topItem = allFreshForSummary[0].item
      let delivered = false
      if (hasPush) {
        try {
          delivered = await sendWebPushSummary(userId, allFreshForSummary.length, topItem, getSupabaseAdmin())
        } catch (e: any) {
          console.warn('[run-now] サマリーPush送信失敗 (継続):', e?.message)
        }
      }
      if (user.ntfyTopic || user.discordWebhook) {
        try {
          delivered = (await notifyUserSummary(allFreshForSummary.length, user)) || delivered
        } catch (e: any) {
          console.warn('[run-now] ntfy/Discordサマリー送信失敗 (継続):', e?.message)
        }
      }

      if (delivered) {
        const notifiedByCondition = new Map<string, number>()
        let recordErrors = 0
        for (const { item, cond } of allFreshForSummary) {
          if (notifiedIds.has(item.auctionId)) continue
          try {
            await addHistory(toHistoryRecord(userId, cond, item))
            await markNotified(userId, item.auctionId)
            notifiedIds.add(item.auctionId)
            notifiedByCondition.set(cond.id, (notifiedByCondition.get(cond.id) ?? 0) + 1)
            totalNotified++
          } catch (e: any) {
            recordErrors++
            console.warn('[run-now] 通知後記録失敗 (継続):', e?.message)
          }
        }
        if (recordErrors > 0) {
          console.error(`[run-now] 通知後記録失敗 ${recordErrors}/${allFreshForSummary.length}件`)
        }
        for (const row of results) {
          row.notified = notifiedByCondition.get(row.conditionId) ?? 0
        }
      } else {
        console.warn(`[run-now] 通知送信失敗: ${allFreshForSummary.length}件は notified_items に記録せず次回再試行`)
      }
    }

    if (hasPush && SEND_NO_ITEMS_PUSH) {
      try {
        checkCompleteNotified = await sendWebPushCheckComplete(userId, {
          freshCount: allFreshForSummary.length,
          noItems: allFreshForSummary.length === 0,
          failed: fetchFailedCount > 0,
          fetchFailedCount,
        }, getSupabaseAdmin())
      } catch (e: any) {
        console.warn('[run-now] チェック完了Push送信失敗 (継続):', e?.message)
      }
    }

    for (const { cond, items } of fetchResults) {
      try {
        await updateCondition(cond.id, {
          lastCheckedAt: new Date().toISOString(),
          lastFoundCount: items.length,
        })
        await addConditionCheckHistory(cond, {
          status: 'ok',
          matchedCount: items.length,
          freshCount: pendingCountByCondition.get(cond.id) ?? 0,
        })
      } catch (e: any) {
        console.warn('[run-now] updateCondition失敗 (継続):', e?.message)
      }
    }

    return NextResponse.json({ notified: totalNotified, checkCompleteNotified, checked: enabled.length, results })
  } catch (e: any) {
    const name = e?.name ?? 'UnknownError'
    const msg  = e?.message ?? String(e)
    console.error('[run-now] エラー:', name, msg, e?.stack)
    return NextResponse.json({ error: `${name}: ${msg}` }, { status: 500 })
  }
}
