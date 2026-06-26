/**
 * ヤフオクwatch スクレイパー
 *
 * Yahoo Auctions 検索結果HTML（モバイル版）を取得し、
 * data-auction-* 属性と入札件数テキストをパースして AuctionItem[] を返す。
 *
 * ■ バグ対策メモ（2026-04-09 修正）
 * - price バグ: URLパラメータ "aucmaxprice=3000" と混同しないよう
 *   data-auction-price="数字" に完全マッチする正規表現を使用
 * - bids バグ（2026-04-11 修正）: data-auction-bids 属性は Yahoo HTML から削除済み。
 *   現行HTMLでは class="Item__bid" セクション内の <span class="Item__text">N</span> で取得。
 *   "-" は0件、数字は実入札件数。
 * - スキャンウィンドウ: idPos の前後合計10000文字を使用（狭すぎると bids が null になる）
 */

import { AuctionItem, SearchCondition } from './types'

type RssKey = Pick<
  SearchCondition,
  'keyword' | 'maxPrice' | 'minPrice' | 'minBids' |
  'sellerType' | 'itemCondition' | 'sortBy' | 'sortOrder' | 'buyItNow'
>

// Chrome Desktop UA（2026-04-21 iPhone UA → Chrome UA に変更）
// 理由: Yahoo が iPhone Safari UA をブロックし「ページが表示できません」を返すようになった。
//       Chrome Desktop UA では正常にデスクトップ版 HTML が取得できることを確認済み。
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const FETCH_TIMEOUT = 15_000
const ENDING_SOON_WINDOW_HOURS = 48
const ENDING_SOON_WINDOW_MS = ENDING_SOON_WINDOW_HOURS * 60 * 60 * 1_000

// Yahooリクエスト共通ヘッダー（bot検知回避）
const YAHOO_HEADERS: Record<string, string> = {
  'User-Agent':                UA,
  'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language':           'ja,ja-JP;q=0.9,en;q=0.8',
  'Accept-Encoding':           'gzip, deflate, br',
  'Referer':                   'https://auctions.yahoo.co.jp/',
  'Connection':                'keep-alive',
  'Upgrade-Insecure-Requests': '1',
}

// ============================================================
// URL構築
// ============================================================

/** Yahoo Auctions 検索URLを構築する */
export function buildSearchUrl(key: RssKey, offset: number): string {
  // キーワード正規化:
  //   1. "miu miu"（スペース含む）→ "ミュウミュウ"
  //      理由: Yahoo検索でスペース区切りはOR区切り扱いになり "miu miu" → "miu" のみ検索
  //   2. "バレテンティノ" → "バレンティノ" (VALENTINO のタイポ修正)
  const normalizedKeyword = key.keyword
    .replace(/miu\s+miu/gi, 'ミュウミュウ')
    .replace(/バレテンティノ/g, 'バレンティノ')
  const params: Record<string, string> = {
    p:           normalizedKeyword,
    aucmaxprice: String(key.maxPrice),
    b:           String(offset),
    n:           '50',
  }
  if (key.minPrice > 0) params.aucminprice = String(key.minPrice)

  // ソート順
  if (key.sortBy === 'endTime') {
    params.s1 = 'end';  params.o1 = key.sortOrder === 'desc' ? 'd' : 'a'
  } else if (key.sortBy === 'price') {
    params.s1 = 'cbids'; params.o1 = key.sortOrder === 'desc' ? 'd' : 'a'
  } else if (key.sortBy === 'bids') {
    params.s1 = 'bids';  params.o1 = 'd'
  }

  // 出品者タイプ
  // 2026-06-24確認: Yahoo検索画面の現行リンクは
  //   ストア: abatch=1 / 個人: abatch=2,3
  // 旧 seller/auctype パラメータは検索結果に反映されない。
  if (key.sellerType === 'store') params.abatch = '1'
  else if (key.sellerType === 'individual') params.abatch = '2,3'

  // 商品状態
  if (key.itemCondition === 'new')  params.istatus = '1'
  else if (key.itemCondition === 'used') params.istatus = '2'

  // 出品形式（即決のみ / オークションのみ / 両方）
  if (key.buyItNow === true)       params.abuynow = '1'
  else if (key.buyItNow === false) params.abuynow = '2'

  return `https://auctions.yahoo.co.jp/search/search?${new URLSearchParams(params)}`
}

// ============================================================
// パーシングヘルパー
// ============================================================

/** HTMLエンティティをデコード */
function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
}

/** Unix秒 → 残り時間文字列 */
function calcRemaining(endUnix: number): string | null {
  const diffMs = endUnix * 1_000 - Date.now()
  if (diffMs <= 0) return null
  const h = Math.floor(diffMs / 3_600_000)
  const m = Math.floor((diffMs % 3_600_000) / 60_000)
  if (h >= 24) return `残り${Math.floor(h / 24)}日`
  if (h >= 1)  return `残り${h}時間${m}分`
  return `残り${m}分`
}

/**
 * HTML全体から auctionId → startPrice のマップを事前構築
 *
 * data-auction-startprice はアイテムの詳細ブロックにのみ存在し、
 * 最初の出現（カードブロック）とは別の場所にある。
 * 全HTML走査で確実に取得し、parseItem から参照できるようにする。
 */
function buildStartPriceMap(html: string): Map<string, number> {
  const map = new Map<string, number>()
  let pos = 0
  while (true) {
    const spPos = html.indexOf('data-auction-startprice=', pos)
    if (spPos === -1) break
    pos = spPos + 1

    const spM = html.slice(spPos, spPos + 60).match(/data-auction-startprice=["'](\d+)["']/)
    if (!spM) continue
    const startPrice = parseInt(spM[1], 10)

    // 前後2000文字以内の data-auction-id を探してマップに登録
    // ※商品ブロックは約7500文字間隔なのでIDとstartpriceは常に2000文字以内に同居する
    const searchStart = Math.max(0, spPos - 2000)
    const nearChunk   = html.slice(searchStart, spPos + 2000)
    const idM         = nearChunk.match(/data-auction-id=["']([A-Za-z0-9]+)["']/)
    if (idM) map.set(idM[1], startPrice)
  }
  return map
}

/**
 * HTML内の1商品ブロックをパース → AuctionItem
 *
 * idPos: HTML内で "data-auction-id=" が見つかった位置
 * ウィンドウ: idPos - 500 〜 idPos + 9500（合計10000文字）
 *   → 前後を広くとることで、属性の前後順序に依存しない
 */
function parseItem(html: string, idPos: number, startPriceMap: Map<string, number>): AuctionItem | null {
  const winStart = Math.max(0, idPos - 500)
  const chunk    = html.slice(winStart, idPos + 9_500)

  // ── オークションID（必須） ────────────────────────────────────
  const idM = chunk.match(/data-auction-id=["']([A-Za-z0-9]+)["']/)
  if (!idM) return null
  const auctionId = idM[1]

  // ── 現在価格 ──────────────────────────────────────────────────
  const priceM   = chunk.match(/data-auction-price=["'](\d+)["']/)
  const priceInt = priceM ? parseInt(priceM[1], 10) : null
  const price    = (priceInt !== null && priceInt > 0)
    ? `¥${priceInt.toLocaleString('ja-JP')}`
    : '価格不明'

  // ── ショッピング商品フラグ ────────────────────────────────────
  // data-auction-isshoppingitem="1" = Yahoo Shoppingの固定価格商品（入札不可）
  // → startprice は仕入れ値/原価を示すため price > startprice でも入札とは無関係
  const isShoppingM   = chunk.match(/data-auction-isshoppingitem=["'](\d*)["']/)
  const isShoppingItem = isShoppingM ? isShoppingM[1] === '1' : false

  // ── 即決価格（0 = オークションのみ） ─────────────────────────
  // isBuyItNow の判定:
  //   isShoppingItem = true → 固定価格商品なので買い切り扱い（isBuyItNow=true, bids=0）
  //   buynow > 0 かつ priceInt >= buynow → 純即決（currentPrice = buynowPrice）
  //   buynow > 0 かつ priceInt < buynow  → オークション+即決オプション付き（入札可能）
  //   buynow = 0                          → 純オークション
  const buynowM    = chunk.match(/data-auction-buynowprice=["'](\d+)["']/)
  const buynow     = buynowM ? parseInt(buynowM[1], 10) : 0
  const isBuyItNow = isShoppingItem || (buynow > 0 && priceInt !== null && priceInt >= buynow)

  // ── タイトル ─────────────────────────────────────────────────
  const titleM = chunk.match(/data-auction-title=["']([^"']*?)["']/)
  const title  = titleM ? decodeHtml(titleM[1]) : ''

  // ── サムネイル ────────────────────────────────────────────────
  const imgM     = chunk.match(/data-auction-img=["']([^"']*?)["']/)
  const imageUrl = imgM ? imgM[1] : ''

  // ── 終了時刻 → 残り時間 ──────────────────────────────────────
  const endM      = chunk.match(/data-auction-endtime=["'](\d+)["']/)
  const endtime   = endM ? parseInt(endM[1], 10) : null
  const remaining = endtime ? calcRemaining(endtime) : null

  // ── 入札件数 ──────────────────────────────────────────────────
  // 検出優先順位（確実な順）:
  //   ① isShoppingItem=true → 固定価格商品 = 入札不可 → bids=0 確定
  //   ② class="Product__bidWrap" テキスト解析（デスクトップ版 Chrome HTML 2026-04-21〜）
  //      <div class="Product__bidWrap">
  //        <dt class="Product__label"><img alt="入札"></dt>
  //        <dd class="Product__bid">5</dd>   ← 数字（0件は "0"）
  //      </div>
  //      ※ IDから約7400文字先 → ウィンドウ(9500文字)内に収まる
  //   ③ class="Item__bid" テキスト解析（旧モバイル版 HTML フォールバック）
  //   ④ data-auction-bids 属性（旧HTML構造フォールバック）
  //   ⑤ startPrice vs currentPrice 比較（旧フォールバック）
  //      price > startPrice → 入札あり確定 → bids=1（実件数不明のため最低値をセット）
  //      price == startPrice → 入札なし → bids=0
  //   ⑥ どれも取得できない場合: bids=null（本当に不明）
  //
  // フィルター側では:
  //   bids=0     → minBids>0 なら除外（入札なし確定）
  //   bids>=1    → minBids フィルターに従い通過/除外
  //   bids=null  → minBids=0 なら通す / minBids>0 なら除外（保守的: 0入札の可能性）
  let bids: number | null = null

  if (isShoppingItem) {
    // ① ショッピング商品: 入札不可なので必ず0
    bids = 0
  } else {
    // ② class="Product__bidWrap" テキスト解析（デスクトップ版 Chrome HTML）
    const bidWrapIdx = chunk.indexOf('class="Product__bidWrap"')
    if (bidWrapIdx !== -1) {
      const bidSection = chunk.slice(bidWrapIdx, bidWrapIdx + 300)
      const bidTextM = bidSection.match(/class="Product__bid"[^>]*>(\d+)<\/dd>/)
      if (bidTextM) {
        bids = parseInt(bidTextM[1], 10)
      }
    }

    if (bids === null) {
      // ③ class="Item__bid" テキスト解析（旧モバイル版 HTML フォールバック）
      const bidSectionIdx = chunk.indexOf('class="Item__bid"')
      if (bidSectionIdx !== -1) {
        const bidSection = chunk.slice(bidSectionIdx, bidSectionIdx + 500)
        const bidTextM = bidSection.match(/class="Item__text"[^>]*>(\d+|-)<\/span>/)
        if (bidTextM) {
          bids = bidTextM[1] === '-' ? 0 : parseInt(bidTextM[1], 10)
        }
      }
    }

    if (bids === null) {
      // ④ data-auction-bids 属性（旧HTML構造フォールバック）
      const bidsAttrM = chunk.match(/data-auction-bids=["'](\d+)["']/)
      if (bidsAttrM) {
        bids = parseInt(bidsAttrM[1], 10)
      } else {
        // ⑤ startPrice vs currentPrice 比較（フォールバック）
        const startPrice = startPriceMap.get(auctionId)
        if (startPrice !== undefined && priceInt !== null) {
          // price > startPrice → 入札あり確定（件数不明のため 1 = 最低値をセット）
          // price == startPrice → 入札なし（0）
          bids = priceInt > startPrice ? 1 : 0
        }
        // どれも取得できない場合: bids = null（本当に不明）
      }
    }
  }

  return {
    auctionId,
    title,
    price,
    priceInt,
    bids,
    isBuyItNow,
    remaining,
    endtimeMs: endtime ? endtime * 1_000 : null,
    url:      `https://page.auctions.yahoo.co.jp/jp/auction/${auctionId}`,
    imageUrl,
    pubDate:  new Date().toISOString(),
  }
}

// ============================================================
// フェッチ
// ============================================================

/** Yahoo Auctions HTML を1ページ取得してパース */
async function fetchPage(url: string): Promise<{
  items:      AuctionItem[]
  httpStatus: number
  rawHtml:    string
}> {
  try {
    const res = await fetch(url, {
      headers: YAHOO_HEADERS,
      cache:  'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
    const html  = await res.text()
    const items: AuctionItem[] = []
    const seen  = new Set<string>()

    // startPriceMap を事前構築（入札0件の判定に使用）
    const startPriceMap = buildStartPriceMap(html)

    // "data-auction-id=" の出現位置を全て走査（1ページ最大50件）
    let from = 0
    while (true) {
      const pos = html.indexOf('data-auction-id=', from)
      if (pos === -1) break
      from = pos + 1

      const item = parseItem(html, pos, startPriceMap)
      if (item && !seen.has(item.auctionId)) {
        seen.add(item.auctionId)
        items.push(item)
      }
    }

    return { items, httpStatus: res.status, rawHtml: html.slice(0, 2_000) }
  } catch (e) {
    return { items: [], httpStatus: 0, rawHtml: String(e) }
  }
}

// ============================================================
// Public API（run-now/route.ts と scripts/run-check.ts から使用）
// ============================================================

// 1ページあたり50件。Yahoo検索結果をページングし、短いページ/空ページで終端判定する。
const PAGE_SIZE = 50

// Vercel API Routes 用の安全上限。条件作成直後/手動チェックでも、従来の3ページ固定ではなく
// 最大120ページ(6000件)まで終端探索する。
// 実測: Coach/2万円以下/終了48h以内は深いページに入札あり商品が埋もれるため、40ページでは取りこぼす。
const API_FETCH_MAX_PAGES = 120
const PAGE_BATCH_SIZE = 3

function isLastSearchPage(itemsOnPage: number): boolean {
  return itemsOnPage < PAGE_SIZE
}

function effectiveFetchKey(key: RssKey): RssKey {
  // 入札件数条件がある場合、終了順の深いページに入札あり商品が埋もれる。
  // 取得時だけ「入札数が多い順」に寄せることで、条件一致候補を浅いページで網羅しやすくする。
  if ((key.minBids ?? 0) > 0 && key.sortBy !== 'bids') {
    return { ...key, sortBy: 'bids', sortOrder: 'desc' }
  }
  return key
}

function shouldStopBidSortedPage(key: RssKey, items: AuctionItem[]): boolean {
  const minBids = key.minBids ?? 0
  if (minBids <= 0 || key.sortBy !== 'bids' || items.length === 0) return false
  // 入札数降順なので、このページに minBids 以上の商品が無ければ以降のページも条件外。
  return !items.some(item => (item.bids ?? 0) >= minBids)
}

function shouldStopEndTimePage(key: RssKey, items: AuctionItem[], now: number): boolean {
  if (key.sortBy !== 'endTime' || key.sortOrder !== 'asc' || items.length === 0) return false
  // 終了時刻の昇順なので、ページ全体が48時間より先なら以降のページも通知対象外。
  return items.every(item => item.endtimeMs !== null && item.endtimeMs - now > ENDING_SOON_WINDOW_MS)
}

async function fetchAuctionPages(
  key: RssKey,
  startOffset: number,
  maxPages: number,
): Promise<{
  items: AuctionItem[]
  urls: string[]
  pages: Awaited<ReturnType<typeof fetchPage>>[]
  pagesFetched: number
  exhausted: boolean
}> {
  const seen = new Set<string>()
  const items: AuctionItem[] = []
  const urls: string[] = []
  const pages: Awaited<ReturnType<typeof fetchPage>>[] = []
  let exhausted = false
  const searchKey = effectiveFetchKey(key)
  const now = Date.now()

  for (let pageStart = 0; pageStart < maxPages; pageStart += PAGE_BATCH_SIZE) {
    const batchSize = Math.min(PAGE_BATCH_SIZE, maxPages - pageStart)
    const batchUrls = Array.from({ length: batchSize }, (_, i) =>
      buildSearchUrl(searchKey, startOffset + (pageStart + i) * PAGE_SIZE)
    )
    const batchPages = await Promise.all(batchUrls.map(url => fetchPage(url)))
    urls.push(...batchUrls)
    pages.push(...batchPages)

    for (const page of batchPages) {
      for (const item of page.items) {
        if (!seen.has(item.auctionId)) {
          seen.add(item.auctionId)
          items.push(item)
        }
      }
    }

    if (
      batchPages.some(page => page.httpStatus === 200 && isLastSearchPage(page.items.length)) ||
      batchPages.some(page => page.httpStatus === 200 && shouldStopBidSortedPage(searchKey, page.items)) ||
      batchPages.some(page => page.httpStatus === 200 && shouldStopEndTimePage(searchKey, page.items, now))
    ) {
      exhausted = true
      break
    }
  }

  return { items, urls, pages, pagesFetched: pages.length, exhausted }
}

/**
 * Vercel API Routes 用: 最大120ページまで終端探索 + メタデータ付き
 * b=1〜 をページングし、Yahoo側の検索結果が尽きるまで取得する（安全上限6000件）。
 */
export async function fetchAuctionRssWithMeta(key: RssKey, maxPages = API_FETCH_MAX_PAGES): Promise<{
  items:      AuctionItem[]
  url:        string
  httpStatus: number
  rawCount:   number
  xmlPreview: string
  pagesFetched: number
  exhausted: boolean
  truncated: boolean
}> {
  const { items: allRaw, urls, pages, pagesFetched, exhausted } =
    await fetchAuctionPages(key, 1, maxPages)

  // 開催中 + 48時間以内フィルター:
  //   終了済み、即決売切れ等で終了しているものは除外。
  //   2日より先は早すぎるため除外。
  //   endtimeMs=null は開催中判定ができないため除外する。
  const now = Date.now()
  const items = allRaw.filter(item =>
    item.endtimeMs !== null &&
    item.endtimeMs > now &&
    item.endtimeMs - now <= ENDING_SOON_WINDOW_MS
  )

  return {
    items,
    url:        urls[0],
    httpStatus: pages[0]?.httpStatus ?? 0,
    rawCount:   allRaw.length,
    xmlPreview: pages[0]?.rawHtml.slice(0, 500) ?? '',
    pagesFetched,
    exhausted,
    truncated: !exhausted && pagesFetched >= maxPages,
  }
}

/**
 * 診断用: フィルターなし（キーワード+価格のみ）で件数を返す
 * 0件取得時のデバッグに使用
 */
export async function fetchAuctionRssSimple(
  keyword: string, maxPrice: number, minPrice: number,
): Promise<number> {
  const url = `https://auctions.yahoo.co.jp/search/search?${new URLSearchParams({
    p:           keyword,
    aucmaxprice: String(maxPrice),
    ...(minPrice > 0 ? { aucminprice: String(minPrice) } : {}),
    b: '1', n: '50',
  })}`
  const { items } = await fetchPage(url)
  return items.length
}

/**
 * GitHub Actions スクリプト用: AuctionItem[] を直接返す
 * maxPages を指定可能（デフォルト=API_FETCH_MAX_PAGES=120）
 * GitHub Actions でも同じ終端探索を使う
 */
export async function fetchAuctionRss(key: RssKey, startOffset = 1, maxPages = API_FETCH_MAX_PAGES): Promise<AuctionItem[]> {
  const { items } = await fetchAuctionPages(key, startOffset, maxPages)
  return items
}

/**
 * オークション終了確認（cleanupEndedAuctions 用）
 * 302リダイレクト / 404 / 終了マーカーテキストで判定
 */
export async function checkAuctionEnded(auctionId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://page.auctions.yahoo.co.jp/jp/auction/${auctionId}`,
      {
        headers:  { 'User-Agent': UA, 'Accept-Language': 'ja,ja-JP;q=0.9' },
        redirect: 'manual',
        signal:   AbortSignal.timeout(8_000),
      },
    )
    if (res.status === 302 || res.status === 404) return true
    if (res.status === 200) {
      const html = await res.text()
      return (
        html.includes('このオークションは終了しました') ||
        html.includes('オークション終了') ||
        html.includes('auc-end') ||
        html.includes('auction-end')
      )
    }
    return false
  } catch {
    return false
  }
}
