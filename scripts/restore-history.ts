#!/usr/bin/env tsx
/**
 * 通知履歴復旧スクリプト
 *
 * DBから物理削除済みの notification_history を、現在の登録条件と
 * 直近 notified_items から可能な範囲で再投入する。
 *
 * 実行例:
 *   node --env-file=.env.local -r tsx/cjs scripts/restore-history.ts
 */
import { getAllEnabledConditions, addHistory, updateHistorySnapshot } from '../lib/storage'
import { fetchAuctionRssWithMeta } from '../lib/scraper'
import { selectConditionCandidates } from '../lib/condition-match'
import { getSupabaseAdmin } from '../lib/supabase'
import { AuctionItem, SearchCondition } from '../lib/types'

type RssKey = Pick<SearchCondition, 'keyword' | 'maxPrice' | 'minPrice' | 'minBids' | 'sellerType' | 'itemCondition' | 'sortBy' | 'sortOrder' | 'buyItNow'>
interface ConditionGroup { key: RssKey; conditions: SearchCondition[] }

const supabase = getSupabaseAdmin()
const RESTORE_FETCH_PAGES = Math.max(1, Number.parseInt(process.env.RESTORE_FETCH_PAGES ?? '40', 10) || 40)
const RESTORE_FETCH_CONCURRENCY = Math.max(1, Number.parseInt(process.env.RESTORE_FETCH_CONCURRENCY ?? '3', 10) || 3)
const RESTORE_NOTIFIED_HOURS = Math.max(1, Number.parseInt(process.env.RESTORE_NOTIFIED_HOURS ?? '72', 10) || 72)
const RESTORE_NOTIFIED_CONCURRENCY = Math.max(1, Number.parseInt(process.env.RESTORE_NOTIFIED_CONCURRENCY ?? '8', 10) || 8)
const RESTORE_SKIP_CURRENT = process.env.RESTORE_SKIP_CURRENT === '1'
const RESTORE_SKIP_NOTIFIED = process.env.RESTORE_SKIP_NOTIFIED === '1'
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'
let writeFailures = 0

function groupConditions(conditions: SearchCondition[]): ConditionGroup[] {
  const map = new Map<string, ConditionGroup>()
  for (const cond of conditions) {
    const key: RssKey = {
      keyword: cond.keyword,
      maxPrice: cond.maxPrice,
      minPrice: cond.minPrice,
      minBids: cond.minBids ?? 0,
      sellerType: cond.sellerType ?? 'all',
      itemCondition: cond.itemCondition ?? 'all',
      sortBy: cond.sortBy ?? 'endTime',
      sortOrder: cond.sortOrder ?? 'asc',
      buyItNow: cond.buyItNow,
    }
    const json = JSON.stringify(key)
    if (!map.has(json)) map.set(json, { key, conditions: [] })
    map.get(json)!.conditions.push(cond)
  }
  return Array.from(map.values())
}

function toHistoryRecord(cond: SearchCondition, item: AuctionItem, notifiedAt = new Date().toISOString()) {
  return {
    userId: cond.userId,
    conditionId: cond.id,
    conditionName: cond.name,
    auctionId: item.auctionId,
    title: item.title,
    price: item.price,
    url: item.url,
    imageUrl: item.imageUrl ?? '',
    notifiedAt,
    remaining: item.remaining ?? null,
    endAt: item.endtimeMs ? new Date(item.endtimeMs).toISOString() : null,
  }
}

function logWriteFailure(action: string, auctionId: string, err: unknown) {
  writeFailures++
  if (writeFailures <= 20 || writeFailures % 50 === 0) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[restore] ${action} failed auction=${auctionId}: ${message}`)
  }
}

async function tryAddHistory(record: ReturnType<typeof toHistoryRecord>): Promise<boolean> {
  try {
    await addHistory(record)
    return true
  } catch (err) {
    logWriteFailure('addHistory', record.auctionId, err)
    return false
  }
}

async function restoreCurrentMatches(): Promise<number> {
  if (RESTORE_SKIP_CURRENT) {
    console.log('[restore] current matches skipped')
    return 0
  }
  const conditions = (await getAllEnabledConditions()).filter(c => c.enabled)
  const groups = groupConditions(conditions)
  console.log(`[restore] enabled conditions=${conditions.length} unique searches=${groups.length}`)

  let restored = 0
  for (let i = 0; i < groups.length; i += RESTORE_FETCH_CONCURRENCY) {
    const batch = groups.slice(i, i + RESTORE_FETCH_CONCURRENCY)
    await Promise.all(batch.map(async (group) => {
      const meta = await fetchAuctionRssWithMeta(group.key, RESTORE_FETCH_PAGES)
      let groupRestored = 0
      for (const cond of group.conditions) {
        const selection = selectConditionCandidates(cond, meta.items)
        const matched = selection.items
        for (const item of matched) {
          if (await tryAddHistory(toHistoryRecord(cond, item))) groupRestored++
        }
      }
      restored += groupRestored
      console.log(`[restore] ${group.key.keyword}: pages=${meta.pagesFetched} raw=${meta.rawCount} 48h=${meta.items.length} restored=${groupRestored}`)
    }))
    if (i + RESTORE_FETCH_CONCURRENCY < groups.length) await new Promise(r => setTimeout(r, 1000))
  }
  return restored
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

async function fetchAuctionSnapshot(auctionId: string): Promise<AuctionItem | null> {
  const url = `https://page.auctions.yahoo.co.jp/jp/auction/${encodeURIComponent(auctionId)}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'ja,ja-JP;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
  })
  if (!res.ok) return null
  const html = await res.text()
  const title =
    html.match(/data-auction-title=["']([^"']+)["']/)?.[1] ??
    html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/ - Yahoo!オークション.*$/u, '') ??
    auctionId
  const priceRaw = html.match(/data-auction-price=["'](\d+)["']/)?.[1]
  const imageUrl = html.match(/data-auction-img=["']([^"']+)["']/)?.[1] ?? ''
  const endRaw = html.match(/data-auction-endtime=["'](\d+)["']/)?.[1]
  const priceInt = priceRaw ? Number.parseInt(priceRaw, 10) : null
  const endtimeMs = endRaw ? Number.parseInt(endRaw, 10) * 1000 : null
  return {
    auctionId,
    title: decodeHtml(title.trim()),
    price: priceInt ? `¥${priceInt.toLocaleString('ja-JP')}` : '価格不明',
    priceInt,
    bids: null,
    isBuyItNow: false,
    remaining: endtimeMs && endtimeMs > Date.now() ? '開催中' : '終了済み',
    endtimeMs,
    url,
    imageUrl,
    pubDate: new Date().toISOString(),
  }
}

async function restoreFromNotifiedItems(): Promise<number> {
  if (RESTORE_SKIP_NOTIFIED) {
    console.log('[restore] notified_items skipped')
    return 0
  }
  const cutoff = new Date(Date.now() - RESTORE_NOTIFIED_HOURS * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('notified_items')
    .select('user_id, auction_id, notified_at')
    .gte('notified_at', cutoff)
    .not('auction_id', 'like', '__check_%')
    .order('notified_at', { ascending: false })
    .limit(2000)
  if (error) throw error

  const rows = data ?? []
  console.log(`[restore] notified_items candidates=${rows.length}`)
  let restored = 0
  let processed = 0
  const snapshotCache = new Map<string, AuctionItem | null>()

  async function restoreRow(row: { user_id: unknown; auction_id: unknown; notified_at: unknown }): Promise<number> {
    const auctionId = String(row.auction_id)
    let item = snapshotCache.get(auctionId)
    if (item === undefined) {
      try {
        item = await fetchAuctionSnapshot(auctionId)
      } catch {
        item = null
      }
      snapshotCache.set(auctionId, item)
    }
    if (!item) return 0
    try {
      await updateHistorySnapshot({
        userId: String(row.user_id),
        conditionId: ZERO_UUID,
        conditionName: '復旧履歴',
        auctionId,
        title: item.title,
        price: item.price,
        url: item.url,
        imageUrl: item.imageUrl ?? '',
        notifiedAt: String(row.notified_at),
        remaining: item.remaining,
        endAt: item.endtimeMs ? new Date(item.endtimeMs).toISOString() : null,
      } as any)
      return 1
    } catch (err) {
      logWriteFailure('updateHistorySnapshot', auctionId, err)
      return 0
    }
  }

  for (let i = 0; i < rows.length; i += RESTORE_NOTIFIED_CONCURRENCY) {
    const batch = rows.slice(i, i + RESTORE_NOTIFIED_CONCURRENCY)
    const counts = await Promise.all(batch.map(row => restoreRow(row as any)))
    restored += counts.reduce((sum, n) => sum + n, 0)
    processed += batch.length
    if (processed % 50 === 0 || processed >= rows.length) {
      console.log(`[restore] notified progress=${processed}/${rows.length} restored=${restored}`)
    }
  }
  return restored
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_KEY が必要です')
  }
  console.log('[restore] start')
  const current = await restoreCurrentMatches()
  const notified = await restoreFromNotifiedItems()
  console.log(`[restore] done current=${current} notified=${notified} total=${current + notified} writeFailures=${writeFailures}`)
}

main().catch(err => {
  console.error('[restore] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
