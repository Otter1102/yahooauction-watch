import type { AuctionItem, SearchCondition } from './types'

export type CandidateSelection = {
  items: AuctionItem[]
  exactCount: number
  relaxed: boolean
  filteredByBids: number
  filteredByFormat: number
}

function passesBidRange(cond: SearchCondition, item: AuctionItem): boolean {
  const minBids = cond.minBids ?? 0
  const maxBids = cond.maxBids ?? null
  if (minBids <= 0 && maxBids === null) return true
  if (item.bids === null) return minBids <= 0
  if (minBids > 0 && item.bids < minBids) return false
  if (maxBids !== null && item.bids >= maxBids) return false
  return true
}

function passesFormat(cond: SearchCondition, item: AuctionItem, relaxed: boolean): boolean {
  const minBids = cond.minBids ?? 0
  if (!relaxed && minBids > 0 && cond.buyItNow === null && item.isBuyItNow === true) return false
  if (cond.buyItNow === null) return true
  if (cond.buyItNow === true) return item.isBuyItNow === true
  return item.isBuyItNow !== true
}

export function selectConditionCandidates(cond: SearchCondition, items: AuctionItem[]): CandidateSelection {
  const exactAfterBids = items.filter(item => passesBidRange(cond, item))
  const exact = exactAfterBids.filter(item => passesFormat(cond, item, false))
  const filteredByBids = items.length - exactAfterBids.length
  const filteredByFormat = exactAfterBids.length - exact.length

  if (exact.length > 0 || (cond.minBids ?? 0) <= 0) {
    return {
      items: exact,
      exactCount: exact.length,
      relaxed: false,
      filteredByBids,
      filteredByFormat,
    }
  }

  // ストア中古などで「入札1件以上」を厳密必須にすると、候補は取れていても
  // 履歴・通知が完全に空になる。厳密一致が0件の時だけ入札数条件を候補条件へ
  // 緩和し、価格/キーワード/Yahoo側のストア・中古絞り込みで取れた開催中商品を返す。
  const relaxed = items.filter(item => passesFormat(cond, item, true))
  return {
    items: relaxed,
    exactCount: 0,
    relaxed: relaxed.length > 0,
    filteredByBids,
    filteredByFormat: items.length - relaxed.length,
  }
}
