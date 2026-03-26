/**
 * ヤフオク スクレイパー
 *
 * 取得戦略（順番に試す）:
 *   1. /_next/data/{buildId}/search/search.json — Next.js SSR JSON（最もクリーン）
 *   2. __NEXT_DATA__ JSON 内のオークションURLを文字列検索
 *   3. HTML内のオークションURLを正規表現で抽出
 */
import { AuctionItem, SearchCondition } from './types'

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'ja-JP,ja;q=0.9',
  'Referer': 'https://auctions.yahoo.co.jp/',
  'Cache-Control': 'no-cache',
}

export type RssParams = Pick<
  SearchCondition,
  'keyword' | 'maxPrice' | 'minPrice' | 'minBids' | 'sellerType' | 'itemCondition' | 'sortBy' | 'sortOrder' | 'buyItNow'
>

// ==================== URL生成 ====================

export function buildRssUrl(p: RssParams): string {
  const maxP = Math.max(p.maxPrice, p.minPrice)
  const minP = Math.min(p.maxPrice, p.minPrice)

  const params = new URLSearchParams({ p: p.keyword })
  if (maxP > 0) params.set('aucmaxprice', String(maxP))
  if (minP > 0) params.set('aucminprice', String(minP))
  if (p.minBids > 0) params.set('aucmin_bidorbuy', String(p.minBids))
  if (p.sellerType === 'store') params.set('abatch', '1')
  if (p.sellerType === 'individual') params.set('abatch', '2')
  if (p.itemCondition === 'new') params.set('istatus', '1')
  if (p.itemCondition === 'used') params.set('istatus', '2')
  if (p.buyItNow) params.set('buynow', '1')
  const sortMap: Record<string, string> = { endTime: 'end', bids: 'bids', price: 'cbids' }
  params.set('s1', sortMap[p.sortBy] ?? 'end')
  params.set('o1', p.sortOrder === 'desc' ? 'd' : 'a')
  params.set('mode', '2')

  return `https://auctions.yahoo.co.jp/search/search?${params}`
}

// ==================== メイン取得 ====================

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
  const isHtml = /^<!DOCTYPE|^<html/i.test(body.trimStart())

  if (!isHtml) {
    // XMLフォールバック
    const rawCount = (body.match(/<item>/g) ?? []).length
    return { items: parseRssXml(body), url, httpStatus, rawCount, xmlPreview }
  }

  // HTML — 3段階で取得を試みる
  const items = await parseYahooHtml(body, url)
  return { items, url, httpStatus, rawCount: items.length, xmlPreview }
}

// ==================== 診断用（フィルターなし）====================

export async function fetchAuctionRssSimple(keyword: string, maxPrice: number, minPrice: number): Promise<number> {
  const hi = Math.max(maxPrice, minPrice)
  const lo = Math.min(maxPrice, minPrice)
  const params = new URLSearchParams({ p: keyword, mode: '2' })
  if (hi > 0) params.set('aucmaxprice', String(hi))
  if (lo > 0) params.set('aucminprice', String(lo))
  const url = `https://auctions.yahoo.co.jp/search/search?${params}`
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(10000) })
    if (!res.ok) return -1
    const body = await res.text()
    const isHtml = /^<!DOCTYPE|^<html/i.test(body.trimStart())
    if (isHtml) {
      const items = await parseYahooHtml(body, url)
      return items.length
    }
    return (body.match(/<item>/g) ?? []).length
  } catch {
    return -1
  }
}

// ==================== HTML解析メイン ====================

async function parseYahooHtml(html: string, originalUrl: string): Promise<AuctionItem[]> {
  // 戦略1: /_next/data/ JSONエンドポイント
  const buildIdMatch = html.match(/"buildId"\s*:\s*"([^"]+)"/)
  if (buildIdMatch) {
    const buildId = buildIdMatch[1]
    try {
      const parsedUrl = new URL(originalUrl)
      const nextDataUrl = `${parsedUrl.origin}/_next/data/${buildId}${parsedUrl.pathname}.json${parsedUrl.search}`
      const res = await fetch(nextDataUrl, {
        headers: { ...FETCH_HEADERS, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(12000),
      })
      if (res.ok) {
        const data = await res.json()
        const items = extractItemsFromJsonObj(data)
        if (items.length > 0) return items
      }
    } catch {}
  }

  // 戦略2: __NEXT_DATA__ JSON内をテキスト検索
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1])
      // JSON.stringifyで通常のスラッシュに変換してから検索
      const jsonStr = JSON.stringify(data)
      const items = extractItemsFromText(jsonStr)
      if (items.length > 0) return items
    } catch {}
  }

  // 戦略3: 生HTML内のオークションURLを直接検索
  return extractItemsFromText(html)
}

// ==================== JSON オブジェクト再帰探索 ====================

function extractItemsFromJsonObj(data: unknown): AuctionItem[] {
  const items: AuctionItem[] = []
  const seen = new Set<string>()

  function walk(obj: unknown): void {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) { obj.forEach(walk); return }
    const o = obj as Record<string, unknown>

    // auctionIdまたはURLからauctionIdを取得
    const rawId = o.auctionID ?? o.auctionId ?? o.auction_id ?? o.itemId ?? o.id
    const urlStr = String(o.pageUrl ?? o.url ?? o.link ?? '')
    const urlMatch = urlStr.match(/auction\/([a-zA-Z][a-zA-Z0-9]+)/)

    const auctionId = (typeof rawId === 'string' && /^[a-zA-Z][a-zA-Z0-9]+$/.test(rawId) && rawId.length > 3)
      ? rawId
      : urlMatch?.[1]

    const title = String(o.title ?? o.name ?? o.itemTitle ?? o.product_name ?? '')

    if (auctionId && title.length >= 3 && !seen.has(auctionId)) {
      seen.add(auctionId)

      const priceRaw = o.price ?? o.currentPrice ?? o.bidPrice ?? o.lowestPrice
      const priceInt = typeof priceRaw === 'number' ? priceRaw
        : typeof priceRaw === 'string' ? parseInt(priceRaw.replace(/[^0-9]/g, '')) : null

      const bidsRaw = o.bids ?? o.bidCount ?? o.bids_count
      const bids = typeof bidsRaw === 'number' ? bidsRaw : null

      const imgRaw = o.thumbnail ?? o.image ?? o.imageUrl ?? o.img
      const imageUrl = typeof imgRaw === 'string' ? imgRaw : ''

      let remaining: string | null = null
      const endRaw = o.endTime ?? o.endtime ?? o.end_time ?? o.closingTime
      if (typeof endRaw === 'string') {
        const diff = new Date(endRaw).getTime() - Date.now()
        if (diff > 0) {
          const h = Math.floor(diff / 3600000)
          const m = Math.floor((diff % 3600000) / 60000)
          remaining = h > 0 ? `残り${h}時間${m}分` : `残り${m}分`
        }
      }

      items.push({
        auctionId,
        title,
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

// ==================== テキスト内オークションURL検索（HTML/JSON両対応）====================

function extractItemsFromText(text: string): AuctionItem[] {
  const items: AuctionItem[] = []
  const seen = new Set<string>()

  // オークションIDを含むURLパターン（絶対・相対両対応）
  const patterns = [
    /(?:page\.auctions\.yahoo\.co\.jp\/(?:jp\/)?|\/(?:jp\/)?|auction\/)auction\/([a-zA-Z][a-zA-Z0-9]{5,})/g,
    /"auctionI[dD]"\s*:\s*"([a-zA-Z][a-zA-Z0-9]{5,})"/g,
    /"auction_id"\s*:\s*"([a-zA-Z][a-zA-Z0-9]{5,})"/g,
  ]

  for (const pat of patterns) {
    let m: RegExpExecArray | null
    while ((m = pat.exec(text)) !== null) {
      const auctionId = m[1]
      if (seen.has(auctionId)) continue
      seen.add(auctionId)

      const pos = m.index
      const ctx = text.slice(Math.max(0, pos - 400), Math.min(text.length, pos + 600))

      // タイトル（HTMLとJSON両形式）
      const titlePatterns = [
        /"(?:title|name|itemTitle|product_name)"\s*:\s*"([^"\\]{3,200})"/,
        /alt="([^"]{5,200})"/,
        /title="([^"]{5,200})"/,
        /class="[^"]*[Tt]itle[^"]*"[^>]*>([^<]{5,150})</,
        />([ぁ-んァ-ン一-龯A-Za-z][^<]{4,150})</,
      ]
      let title = ''
      for (const tp of titlePatterns) {
        const tm = ctx.match(tp)
        const candidate = tm?.[1]?.trim() ?? ''
        if (candidate.length >= 3) {
          const clean = candidate.replace(/\\n/g, '').replace(/\\"/g, '"').replace(/&amp;/g, '&').trim()
          // auctionIDだけのような短い文字列を除外
          if (clean.length >= 3 && !/^[a-z][0-9]+$/.test(clean)) { title = clean; break }
        }
      }
      if (!title) continue

      // 価格
      const pricePatterns = [
        /"(?:price|currentPrice|bidPrice|lowestPrice)"\s*:\s*([0-9]+)/,
        /(?:¥|￥)\s*([0-9,]+)/,
      ]
      let priceInt: number | null = null
      for (const pp of pricePatterns) {
        const pm = ctx.match(pp)
        if (pm) { priceInt = parseInt(pm[1].replace(/,/g, '')); break }
      }

      // 入札数
      const bidsMatch = ctx.match(/"bids?(?:Count)?"\s*:\s*([0-9]+)/) || ctx.match(/([0-9]+)件/)
      const bids = bidsMatch ? parseInt(bidsMatch[1]) : null

      // 画像
      const imgMatch = ctx.match(/"(?:thumbnail|image|imageUrl|img)"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/)
        || ctx.match(/src="(https?:\/\/(?:auctions|item-shopping)\.c\.yimg\.jp[^"]+)"/i)
      const imageUrl = imgMatch ? imgMatch[1] : ''

      items.push({
        auctionId,
        title,
        price: priceInt ? `¥${priceInt.toLocaleString()}` : '価格不明',
        priceInt,
        bids,
        remaining: null,
        url: `https://page.auctions.yahoo.co.jp/jp/auction/${auctionId}`,
        imageUrl,
        pubDate: new Date().toISOString(),
      })
    }
  }

  return items
}

// ==================== RSS XML フォールバック ====================

function parseRssXml(xml: string): AuctionItem[] {
  const items: AuctionItem[] = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match: RegExpExecArray | null
  while ((match = itemRegex.exec(xml)) !== null) {
    try { const i = parseRssItem(match[1]); if (i) items.push(i) } catch {}
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
  const idMatch = link.match(/auction\/([a-zA-Z][a-zA-Z0-9]+)/)
  if (!idMatch) return null
  const auctionId = idMatch[1]
  const priceMatch = title.match(/([0-9,]+)\s*円/) || title.match(/¥([0-9,]+)/)
  const priceInt = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null
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
  const imgMatch = description.match(/src="([^"]+\.(?:jpg|jpeg|png)[^"]*)"/i)
  return {
    auctionId,
    title: title.replace(/\s*[-–]\s*[¥¥][0-9,]+/g, '').trim(),
    price: priceInt ? `¥${priceInt.toLocaleString()}` : '価格不明',
    priceInt,
    bids,
    remaining,
    url: link,
    imageUrl: imgMatch?.[1] ?? '',
    pubDate,
  }
}

// legacy export alias
export { parseRssXml as parseRss }

// ==================== オークション終了チェック ====================

/**
 * ヤフオクオークションページを取得し、終了済みか判定する
 * - 404 / HTTP エラー → 終了（削除して良い）
 * - __NEXT_DATA__ の status/closed フィールド → 終了
 * - HTML テキストの終了パターン → 終了
 * - 取得エラー → false（保守的に残す）
 */
export async function checkAuctionEnded(auctionId: string): Promise<boolean> {
  try {
    const url = `https://page.auctions.yahoo.co.jp/jp/auction/${auctionId}`
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    })

    // 404 や 410 = 確実に終了
    if (res.status === 404 || res.status === 410) return true
    // その他エラー = 判断不能 → 残す
    if (!res.ok) return false

    const html = await res.text()

    // 1. __NEXT_DATA__ JSON を解析してステータスフィールドを確認
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
    if (nextDataMatch) {
      try {
        const str = JSON.stringify(JSON.parse(nextDataMatch[1]))
        if (
          /"status"\s*:\s*"end"/.test(str) ||
          /"status"\s*:\s*"closed"/.test(str) ||
          /"auctionStatus"\s*:\s*"end"/.test(str) ||
          /"isAuctionEnd"\s*:\s*true/.test(str) ||
          /"isClosed"\s*:\s*true/.test(str) ||
          /"closed"\s*:\s*true/.test(str)
        ) return true
      } catch {}
    }

    // 2. HTML テキストの終了パターン
    if (/このオークションは終了|終了したオークション|落札者が決まりました|入札終了/.test(html)) {
      return true
    }

    return false
  } catch {
    // ネットワークエラー等 → 保守的に残す
    return false
  }
}
