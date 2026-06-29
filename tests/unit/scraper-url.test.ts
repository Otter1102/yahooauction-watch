import { describe, expect, it } from 'vitest'
import { buildSearchUrl, normalizeYahooSearchKeyword } from '@/lib/scraper'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')

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

  it('入札件数ソートはYahoo現行UIの「多い順」パラメータを使う', () => {
    const url = new URL(buildSearchUrl({ ...baseKey, sellerType: 'all', sortBy: 'bids' }, 1))
    expect(url.searchParams.get('s1')).toBe('bids')
    expect(url.searchParams.get('o1')).toBe('a')
  })

  it('検索結果は固定3ページではなく終端までページングする', () => {
    const source = readFileSync(path.join(root, 'lib/scraper.ts'), 'utf8')
    expect(source).toContain('fetchAuctionPages')
    expect(source).toContain('isLastSearchPage')
    expect(source).toContain('API_FETCH_MAX_PAGES = 120')
    expect(source).toContain('truncated')
  })

  it('通知対象は開催中かつ終了48時間以内に限定する', () => {
    const source = readFileSync(path.join(root, 'lib/scraper.ts'), 'utf8')
    expect(source).toContain('ENDING_SOON_WINDOW_HOURS = 48')
    expect(source).toContain('開催中 + 48時間以内フィルター')
    expect(source).toContain('shouldStopEndTimePage')
    expect(source).toContain('ページ全体が48時間より先なら以降のページも通知対象外')
    expect(source).toContain('item.endtimeMs !== null')
    expect(source).toContain('item.endtimeMs > now')
    expect(source).toContain('item.endtimeMs - now <= ENDING_SOON_WINDOW_MS')
    expect(buildSearchUrl({ ...baseKey, sellerType: 'all' }, 1)).not.toContain('aucend=')
  })

  it('Yahooへ送る検索語はHTTP 500になりやすい括弧・読点を空白へ正規化する', () => {
    const keyword = '（COACH コーチ）(バッグ　鞄), リュック／ショルダー'
    const normalized = normalizeYahooSearchKeyword(keyword)
    expect(normalized).toBe('COACH コーチ バッグ 鞄 リュック ショルダー')

    const url = new URL(buildSearchUrl({ ...baseKey, keyword, sellerType: 'all' }, 1))
    expect(url.searchParams.get('p')).toBe(normalized)
  })
})
