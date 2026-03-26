/**
 * ヤフオク スクレイパー
 * Yahoo Auction の検索URLからHTMLをパースして商品リストを取得
 */
import { AuctionItem, SearchCondition } from './types'

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ja-JP,ja;q=0.9',
  'Referer': 'https://auctions.yahoo.co.jp/',
  'Cache-Control': 'no-cache',
}

type RssParams = Pick<
  SearchCondition,
  'keyword' | 'maxPrice' | 'minPrice' | 'minBids' | 'sellerType' | 'itemCondition' | 'sortBy' | 'sortOrder' | 'buyItNow'
>

/**
 * Yahoo Auction 検索URL生成（HTML検索ページ）
 */
export function buildRssUrl(p: RssParams): string {
  const maxPrice = Math.max(p.maxPrice, p.minPrice)
  const minPrice = Math.min(p.maxPrice, p.minPrice)

  const params = new URLSearchParams({ p: p.keyword })
  if (maxPrice > 0) params.set('aucmaxprice', String(maxPrice))
  if (minPrice > 0) params.set('aucminprice', String(minPrice))
  if (p.minBids > 0) params.set('aucmin_bidorbuy', String(p.minBids))
  if (p.sellerType === 'store') params.set('abatch', '1')
  if (p.sellerType === 'individual') params.set('abatch', '2')
  if (p.itemCondition === 'new') params.set('istatus', '1')
  if (p.itemCondition === 'used') params.set('istatus', '2')
  if (p.buyItNow) params.set('buynow', '1')

  const sortMap: Record<string, string> = { endTime: 'end', bids: 'bids', price: 'cbids' }
  params.set('s1', sortMap[p.sortBy] ?? 'end')
  params.set('o1', p.sortOrder === 'desc' ? 'd' : 'a')
  params.set('mode', '2')  // list mode

  return `https://auctions.yahoo.co.jp/search/search?${params}`
}

/**
 * HTMLレスポンスからオークション商品を抽出
 * Next.js __NEXT_DATA__ JSONと正規表現の2段階で解析
 */
function parseHtmlAuctions(html: string): AuctionItem[] {
  // --- 方法1: __NEXT_DATA__ JSONから構造データを取得 ---
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]{50,})<\/script>/)
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1])
      const items = extractItemsFromNextData(data)
      if (items.length > 0) return items
    } catch {}
  }

  // --- 方法2: HTMLからオークションURLを正規表現で抽出 ---
  return extractItemsFromHtml(html)
}

function extractItemsFromNextData(data: unknown): AuctionItem[] {
  const items: AuctionItem[] = []
  const seen = new Set<string>()

  function walk(obj: unknown): void {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) { obj.forEach(walk); return }
    const o = obj as Record<string, unknown>

    // Yahoo Auction のアイテムオブジェクトを探す（auctionId フィールドが存在）
    if (typeof o.auctionID === 'string' && o.auctionID && typeof o.title === 'string') {
      const auctionId = o.auctionID
      if (seen.has(auctionId)) return
      seen.add(auctionId)

      const priceInt = typeof o.price === 'number' ? o.price
        : typeof o.bidOrBuyPrice === 'number' ? o.bidOrBuyPrice : null
      const bids = typeof o.bids === 'number' ? o.bids : null
      const imageUrl = typeof o.thumbnail === 'string' ? o.thumbnail
        : typeof o.img === 'string' ? o.img : ''

      // 残り時間
      let remaining: string | null = null
      if (typeof o.endTime === 'string' || typeof o.endtime === 'string') {
        const endStr = (o.endTime || o.endtime) as string
        const diff = new Date(endStr).getTime() - Date.now()
        if (diff > 0) {
          const h = Math.floor(diff / 3600000)
          const m = Math.floor((diff % 3600000) / 60000)
          remaining = h > 0 ? `残り${h}時間${m}分` : `残り${m}分`
        }
      }

      items.push({
        auctionId,
        title: String(o.title),
        price: priceInt ? `¥${priceInt.toLocaleString()}` : '価格不明',
        priceInt,
        bids,
        remaining,
        url: `https://page.auctions.yahoo.co.jp/jp/auction/${auctionId}`,
        imageUrl,
        pubDate: new Date().toISOString(),
      })
    }

    for (const v of Object.values(o)) walk(v)
  }

  walk(data)
  return items
}

function extractItemsFromHtml(html: string): AuctionItem[] {
  const items: AuctionItem[] = []
  const seen = new Set<string>()

  // オークションページURLを検索
  const urlRegex = /https?:\/\/page\.auctions\.yahoo\.co\.jp\/(?:jp\/)?auction\/([a-zA-Z][a-zA-Z0-9]+)/g

  let m: RegExpExecArray | null
  while ((m = urlRegex.exec(html)) !== null) {
    const auctionId = m[1]
    if (seen.has(auctionId)) continue
    seen.add(auctionId)

    const pos = m.index
    const context = html.slice(Math.max(0, pos - 600), Math.min(html.length, pos + 600))

    // タイトル抽出（複数パターン）
    let title = ''
    const titlePatterns = [
      /alt="([^"]{5,200})"/,
      /"title"\s*:\s*"([^"]{5,200})"/,
      /"name"\s*:\s*"([^"]{5,200})"/,
      /class="[^"]*[Tt]itle[^"]*"[^>]*>([^<]{5,150})</,
      />([ぁ-んァ-ン一-龯Ａ-Ｚａ-ｚA-Za-z][^<]{4,150})</,
    ]
    for (const pat of titlePatterns) {
      const tm = context.match(pat)
      if (tm?.[1]) {
        const candidate = tm[1]
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
        if (candidate.length >= 5) { title = candidate; break }
      }
    }
    if (!title) continue

    // 価格抽出
    const priceMatch = context.match(/(?:¥|￥)\s*([0-9,]+)/)
    const priceInt = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null
    const priceStr = priceInt ? `¥${priceInt.toLocaleString()}` : '価格不明'

    // Yahoo CDN画像
    const imgMatch = context.match(/https?:\/\/(?:auctions|item-shopping)\.c\.yimg\.jp\/[^\s"'<>]+\.jpg[^\s"'<>]*/i)
    const imageUrl = imgMatch ? imgMatch[0] : ''

    // 入札数
    const bidsMatch = context.match(/"bids"\s*:\s*([0-9]+)/) || context.match(/([0-9]+)\s*件/)
    const bids = bidsMatch ? parseInt(bidsMatch[1]) : null

    items.push({
      auctionId,
      title,
      price: priceStr,
      priceInt,
      bids,
      remaining: null,
      url: `https://page.auctions.yahoo.co.jp/jp/auction/${auctionId}`,
      imageUrl,
      pubDate: new Date().toISOString(),
    })
  }

  return items
}

/**
 * フィードから商品リストを取得
 */
export async function fetchAuctionRss(p: RssParams): Promise<AuctionItem[]> {
  const { items } = await fetchAuctionRssWithMeta(p)
  return items
}

export async function fetchAuctionRssWithMeta(p: RssParams): Promise<{
  items: AuctionItem[]
  url: string
  httpStatus: number
  rawCount: number
  xmlPreview: string
}> {
  const url = buildRssUrl(p)
  let body = ''
  let httpStatus = 0

  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(15000) })
    httpStatus = res.status
    if (!res.ok) return { items: [], url, httpStatus, rawCount: 0, xmlPreview: '' }
    body = await res.text()
  } catch (e) {
    return { items: [], url, httpStatus, rawCount: 0, xmlPreview: String(e) }
  }

  const xmlPreview = body.slice(0, 300).replace(/\s+/g, ' ').trim()

  // HTMLかXMLかを判定
  const isHtml = body.trimStart().startsWith('<!DOCTYPE') || body.trimStart().toLowerCase().startsWith('<html')

  let items: AuctionItem[]
  let rawCount: number

  if (isHtml) {
    items = parseHtmlAuctions(body)
    rawCount = items.length
  } else {
    rawCount = (body.match(/<item>/g) ?? []).length
    items = parseRss(body)
  }

  return { items, url, httpStatus, rawCount, xmlPreview }
}

/**
 * フィルターなし（キーワード+価格のみ）でフェッチ — 診断用
 */
export async function fetchAuctionRssSimple(keyword: string, maxPrice: number, minPrice: number): Promise<number> {
  const params = new URLSearchParams({ p: keyword, mode: '2' })
  const hi = Math.max(maxPrice, minPrice)
  const lo = Math.min(maxPrice, minPrice)
  if (hi > 0) params.set('aucmaxprice', String(hi))
  if (lo > 0) params.set('aucminprice', String(lo))
  const url = `https://auctions.yahoo.co.jp/search/search?${params}`
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(10000) })
    if (!res.ok) return -1
    const body = await res.text()
    const isHtml = body.trimStart().startsWith('<!DOCTYPE') || body.trimStart().toLowerCase().startsWith('<html')
    if (isHtml) {
      return parseHtmlAuctions(body).length
    }
    return (body.match(/<item>/g) ?? []).length
  } catch {
    return -1
  }
}

/**
 * RSS XMLをパースして商品リストに変換（RSS形式が返った場合のフォールバック）
 */
export function parseRss(xml: string): AuctionItem[] {
  const items: AuctionItem[] = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match: RegExpExecArray | null
  while ((match = itemRegex.exec(xml)) !== null) {
    try {
      const item = parseRssItem(match[1])
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

  const idMatch = link.match(/\/([a-zA-Z][a-zA-Z0-9]+)(?:[?#]|$)/)
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
    const diff = new Date(endTimeMatch[1]).getTime() - Date.now()
    if (diff > 0) {
      const h = Math.floor(diff / 3600000)
      const m2 = Math.floor((diff % 3600000) / 60000)
      remaining = h > 0 ? `残り${h}時間${m2}分` : `残り${m2}分`
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
