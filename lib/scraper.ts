/**
 * ヤフオク RSSフィード スクレイパー
 * 公式RSSを使用するためボット検知なし・安定稼働
 */
import { AuctionItem, SearchCondition } from './types'

const USER_AGENT = 'Mozilla/5.0 (compatible; YahooAuctionWatch/1.0)'

type RssParams = Pick<
  SearchCondition,
  'keyword' | 'maxPrice' | 'minPrice' | 'minBids' | 'sellerType' | 'itemCondition' | 'sortBy' | 'sortOrder' | 'buyItNow'
>

/**
 * Yahoo Auction RSSフィードURL生成
 */
export function buildRssUrl(p: RssParams): string {
  // min > max は自動スワップ（フォームの入力ミス保護）
  const maxPrice = Math.max(p.maxPrice, p.minPrice)
  const minPrice = Math.min(p.maxPrice, p.minPrice)

  const params = new URLSearchParams({ p: p.keyword, pc: String(maxPrice) })

  if (minPrice > 0) params.set('pf', String(minPrice))
  if (p.minBids > 0) params.set('aucmin_bidorbuy', String(p.minBids))
  if (p.sellerType === 'store') params.set('abatch', '1')
  if (p.sellerType === 'individual') params.set('abatch', '2')
  if (p.itemCondition === 'new') params.set('istatus', '1')
  if (p.itemCondition === 'used') params.set('istatus', '2')
  if (p.buyItNow) params.set('buynow', '1')

  const sortMap: Record<string, string> = { endTime: 'end', bids: 'bids', price: 'price' }
  params.set('s1', sortMap[p.sortBy] ?? 'end')
  params.set('o1', p.sortOrder === 'desc' ? 'd' : 'a')

  return `https://auctions.yahoo.co.jp/rss/search/search?${params}`
}

/**
 * RSSフィードから商品リストを取得（URLも返す）
 */
export async function fetchAuctionRss(p: RssParams): Promise<AuctionItem[]> {
  const { items } = await fetchAuctionRssWithMeta(p)
  return items
}

export async function fetchAuctionRssWithMeta(p: RssParams): Promise<{ items: AuctionItem[]; url: string; httpStatus: number; rawCount: number }> {
  const url = buildRssUrl(p)
  let xml = ''
  let httpStatus = 0

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(12000),
    })
    httpStatus = res.status
    if (!res.ok) return { items: [], url, httpStatus, rawCount: 0 }
    xml = await res.text()
  } catch {
    return { items: [], url, httpStatus, rawCount: 0 }
  }

  // <item>タグの生の数（パース前）
  const rawCount = (xml.match(/<item>/g) ?? []).length
  const items = parseRss(xml)
  return { items, url, httpStatus, rawCount }
}

/**
 * フィルターなし（キーワード+価格のみ）でフェッチ — 診断用
 */
export async function fetchAuctionRssSimple(keyword: string, maxPrice: number, minPrice: number): Promise<number> {
  const params = new URLSearchParams({ p: keyword, pc: String(Math.max(maxPrice, minPrice)) })
  if (Math.min(maxPrice, minPrice) > 0) params.set('pf', String(Math.min(maxPrice, minPrice)))
  params.set('s1', 'end')
  params.set('o1', 'a')
  const url = `https://auctions.yahoo.co.jp/rss/search/search?${params}`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10000) })
    if (!res.ok) return -1
    const xml = await res.text()
    return (xml.match(/<item>/g) ?? []).length
  } catch {
    return -1
  }
}

/**
 * RSS XMLをパースして商品リストに変換
 */
export function parseRss(xml: string): AuctionItem[] {
  const items: AuctionItem[] = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match: RegExpExecArray | null

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]
    try {
      const item = parseRssItem(block)
      if (item) items.push(item)
    } catch {}
  }

  return items
}

function extractTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'))
  return m ? m[1].trim() : ''
}

function parseRssItem(block: string): AuctionItem | null {
  const title = extractTag(block, 'title')
  const link = extractTag(block, 'link').trim()
  const description = extractTag(block, 'description')
  const pubDate = extractTag(block, 'pubDate')

  if (!title || !link) return null

  const idMatch = link.match(/\/([a-zA-Z][0-9]+)(?:[?#]|$)/)
  const auctionId = idMatch ? idMatch[1] : ''
  if (!auctionId) return null

  const priceFromTitle =
    title.match(/現在\s*(?:価格)?[:\s]*([0-9,]+)\s*円/)?.[1] ||
    title.match(/¥([0-9,]+)/)?.[1] ||
    title.match(/([0-9,]+)\s*円/)?.[1] || ''

  const priceInt = priceFromTitle ? parseInt(priceFromTitle.replace(/,/g, '')) : null
  const priceStr = priceInt ? `¥${priceInt.toLocaleString()}` : '価格不明'

  const bidsMatch = description.match(/入札[件数]*[:\s]*([0-9]+)/)
  const bids = bidsMatch ? parseInt(bidsMatch[1]) : null

  const endTimeMatch = description.match(/終了[:\s]*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/)
  let remaining: string | null = null
  if (endTimeMatch) {
    const endTime = new Date(endTimeMatch[1])
    const diffMs = endTime.getTime() - Date.now()
    if (diffMs > 0) {
      const diffH = Math.floor(diffMs / 3600000)
      const diffM = Math.floor((diffMs % 3600000) / 60000)
      remaining = diffH > 0 ? `残り${diffH}時間${diffM}分` : `残り${diffM}分`
    }
  }

  const imgMatch = description.match(/src="([^"]+\.(?:jpg|jpeg|png|gif|webp)[^"]*)"/i)
  const imageUrl = imgMatch ? imgMatch[1] : ''

  const cleanTitle = title
    .replace(/\s*[-–]\s*(?:現在|価格)?[\s:]*[¥¥][0-9,]+/g, '')
    .replace(/\s*\(現在[^)]*\)/g, '')
    .trim()

  return {
    auctionId,
    title: cleanTitle || title,
    price: priceStr,
    priceInt,
    bids,
    remaining,
    url: link,
    imageUrl,
    pubDate,
  }
}
