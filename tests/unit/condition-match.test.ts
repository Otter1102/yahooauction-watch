import { describe, expect, it } from 'vitest'
import { selectConditionCandidates } from '@/lib/condition-match'
import type { AuctionItem, SearchCondition } from '@/lib/types'

const condition: SearchCondition = {
  id: 'c1',
  userId: 'u1',
  name: 'store used coach',
  keyword: 'Coach',
  maxPrice: 20_000,
  minPrice: 0,
  minBids: 1,
  maxBids: null,
  sellerType: 'store',
  itemCondition: 'used',
  sortBy: 'endTime',
  sortOrder: 'asc',
  buyItNow: null,
  enabled: true,
  createdAt: new Date().toISOString(),
}

function item(auctionId: string, bids: number | null, isBuyItNow = false): AuctionItem {
  return {
    auctionId,
    title: `Coach bag ${auctionId}`,
    price: '¥10,000',
    priceInt: 10_000,
    bids,
    isBuyItNow,
    remaining: '残り1時間',
    endtimeMs: Date.now() + 60 * 60 * 1000,
    url: `https://example.com/${auctionId}`,
    imageUrl: '',
    pubDate: new Date().toISOString(),
  }
}

describe('selectConditionCandidates', () => {
  it('厳密一致がある場合は入札数条件を維持する', () => {
    const selected = selectConditionCandidates(condition, [
      item('a1', 0),
      item('a2', 1),
      item('a3', 3),
    ])

    expect(selected.relaxed).toBe(false)
    expect(selected.items.map(i => i.auctionId)).toEqual(['a2', 'a3'])
  })

  it('入札条件だけで全件落ちる場合は候補条件として緩和する', () => {
    const selected = selectConditionCandidates(condition, [
      item('a1', 0),
      item('a2', 0, true),
    ])

    expect(selected.relaxed).toBe(true)
    expect(selected.exactCount).toBe(0)
    expect(selected.items.map(i => i.auctionId)).toEqual(['a1', 'a2'])
  })

  it('オークションのみ指定は緩和時も即決商品を含めない', () => {
    const selected = selectConditionCandidates({ ...condition, buyItNow: false }, [
      item('a1', 0),
      item('a2', 0, true),
    ])

    expect(selected.relaxed).toBe(true)
    expect(selected.items.map(i => i.auctionId)).toEqual(['a1'])
  })
})
