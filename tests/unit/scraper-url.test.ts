import { describe, expect, it } from 'vitest'
import { buildSearchUrl } from '@/lib/scraper'

const baseKey = {
  keyword: 'コーチ',
  maxPrice: 10000,
  minPrice: 0,
  minBids: 0,
  itemCondition: 'all' as const,
  sortBy: 'endTime' as const,
  sortOrder: 'asc' as const,
  buyItNow: null,
}

describe('Yahoo検索URL生成', () => {
  it('ストア絞り込みは現行Yahooパラメータ abatch=1 を使う', () => {
    const url = new URL(buildSearchUrl({ ...baseKey, sellerType: 'store' }, 1))
    expect(url.searchParams.get('abatch')).toBe('1')
    expect(url.searchParams.has('seller')).toBe(false)
    expect(url.searchParams.has('auctype')).toBe(false)
  })

  it('個人絞り込みは abatch=2,3 を使う', () => {
    const url = new URL(buildSearchUrl({ ...baseKey, sellerType: 'individual' }, 1))
    expect(url.searchParams.get('abatch')).toBe('2,3')
    expect(url.searchParams.has('seller')).toBe(false)
    expect(url.searchParams.has('auctype')).toBe(false)
  })
})
