import type { AuctionItem, SearchCondition } from './types'
import { fetchAuctionRssWithMeta } from './scraper'
import { selectConditionCandidates } from './condition-match'
import { addHistory, markNotified, updateCondition } from './storage'
import { sendWebPushInitialFetch } from './webpush'

type RssKey = Pick<SearchCondition, 'keyword' | 'maxPrice' | 'minPrice' | 'minBids' | 'sellerType' | 'itemCondition' | 'sortBy' | 'sortOrder' | 'buyItNow'>

export type InitialConditionCheckResult = {
  ok: boolean
  matched: number
  recorded: number
  notified: boolean
  rawCount?: number
  pagesFetched?: number
  truncated?: boolean
  httpStatus?: number
  rssUrl?: string
  debug?: string
}

const MAX_INITIAL_HISTORY_ITEMS = 100

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

async function runInChunks<T>(items: T[], chunkSize: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    await Promise.all(items.slice(i, i + chunkSize).map(fn))
  }
}

export async function runInitialConditionCheck(
  userId: string,
  condition: SearchCondition,
): Promise<InitialConditionCheckResult> {
  try {
    const key: RssKey = {
      keyword: condition.keyword,
      maxPrice: condition.maxPrice,
      minPrice: condition.minPrice,
      minBids: condition.minBids ?? 0,
      sellerType: condition.sellerType ?? 'all',
      itemCondition: condition.itemCondition ?? 'all',
      sortBy: condition.sortBy ?? 'endTime',
      sortOrder: condition.sortOrder ?? 'asc',
      buyItNow: condition.buyItNow,
    }

    const {
      items, rawCount, httpStatus, url, pagesFetched, truncated,
      successfulPages, statusSummary,
    } = await fetchAuctionRssWithMeta(key)
    if (pagesFetched > 0 && successfulPages === 0) {
      throw new Error(`Yahoo検索取得失敗: status=${statusSummary || 'none'} pages=${pagesFetched}`)
    }
    const selection = selectConditionCandidates(condition, items)
    const matched = selection.items
    const toRecord = matched.slice(0, MAX_INITIAL_HISTORY_ITEMS)

    await runInChunks(toRecord, 10, item => addHistory(toHistoryRecord(userId, condition, item)))

    let notified = false
    if (toRecord.length > 0) {
      notified = await sendWebPushInitialFetch(
        userId,
        toRecord.length,
        condition.name,
        toRecord[0],
      )
      if (notified) {
        await runInChunks(toRecord, 10, item => markNotified(userId, item.auctionId))
      }
    }

    await updateCondition(condition.id, {
      lastCheckedAt: new Date().toISOString(),
      lastFoundCount: items.length,
    })

    return {
      ok: true,
      matched: matched.length,
      recorded: toRecord.length,
      notified,
      rawCount,
      pagesFetched,
      truncated,
      httpStatus,
      rssUrl: url,
      debug: toRecord.length > 0
        ? selection.relaxed
          ? `取得完了: 厳密一致0件のため候補${toRecord.length}件を履歴に反映`
          : `取得完了: ${toRecord.length}件を履歴に反映`
        : '取得完了: 現時点の該当オークションはありません',
    }
  } catch (e: any) {
    console.warn('[initial-check] 初回取得失敗:', e?.message ?? e)
    return {
      ok: false,
      matched: 0,
      recorded: 0,
      notified: false,
      debug: e?.message ?? String(e),
    }
  }
}
