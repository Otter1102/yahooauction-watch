import { AuctionItem, User } from './types'

// ── 内部ヘルパー ─────────────────────────────────────────────────

async function postNtfy(
  topic: string,
  title: string,
  body: string,
  opts?: { click?: string; attach?: string },
): Promise<boolean> {
  if (!topic) return false
  const url = new URL(`https://ntfy.sh/${encodeURIComponent(topic)}`)
  url.searchParams.set('title', title)
  if (opts?.click)  url.searchParams.set('click',  opts.click)
  if (opts?.attach) url.searchParams.set('attach', opts.attach)
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body,
      signal: AbortSignal.timeout(10000),
    })
    return res.ok
  } catch { return false }
}

async function postDiscord(webhookUrl: string, embed: object): Promise<boolean> {
  if (!webhookUrl) return false
  try {
    const host = new URL(webhookUrl).hostname
    if (host !== 'discord.com' && host !== 'discordapp.com') return false
  } catch { return false }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ヤフオクwatch', embeds: [embed] }),
      signal: AbortSignal.timeout(10000),
    })
    return res.status === 204
  } catch { return false }
}

// ── 個別商品通知 ─────────────────────────────────────────────────

export async function sendNtfy(item: AuctionItem, topic: string): Promise<boolean> {
  const priceText = (item.price && item.price !== '価格不明') ? item.price : '現在価格なし（入札0）'
  const body =
    `💰 ${priceText}` +
    (item.bids != null ? `  🔨 ${item.bids}件` : '') +
    (item.remaining ? `  ⏰ ${item.remaining}` : '') +
    `\n${item.url}`
  return postNtfy(topic, item.title.slice(0, 60), body, {
    click:  item.url,
    attach: item.imageUrl || undefined,
  })
}

export async function sendDiscord(item: AuctionItem, webhookUrl: string): Promise<boolean> {
  return postDiscord(webhookUrl, {
    title: `🔔 ${item.title.slice(0, 256)}`,
    url:   item.url,
    color: 0xff6600,
    fields: [
      { name: '💰 現在価格', value: `**${item.price}**`, inline: true },
      ...(item.bids != null
        ? [{ name: '🔨 入札件数', value: `${item.bids}件`, inline: true }]
        : []),
      ...(item.remaining
        ? [{ name: '⏰ 残り時間', value: item.remaining, inline: true }]
        : []),
    ],
    footer: { text: `ID: ${item.auctionId}` },
    ...(item.imageUrl ? { thumbnail: { url: item.imageUrl } } : {}),
  })
}

export async function notifyUser(item: AuctionItem, user: User): Promise<boolean> {
  const ch = user.notificationChannel
  const results = await Promise.all([
    (ch === 'ntfy'    || ch === 'both') ? sendNtfy(item, user.ntfyTopic)          : false,
    (ch === 'discord' || ch === 'both') ? sendDiscord(item, user.discordWebhook)  : false,
  ])
  return results.some(Boolean)
}

// ── サマリー通知（複数件まとめて） ──────────────────────────────

export async function notifyUserSummary(count: number, user: User): Promise<boolean> {
  return postNtfy(
    user.ntfyTopic,
    `ヤフオクwatch 新着${count}件`,
    `${count}件の新着商品が見つかりました → アプリで確認`,
  )
}

// ── テスト通知 ───────────────────────────────────────────────────

const TEST_ITEM: AuctionItem = {
  auctionId: 'test',
  title:     'テスト通知 — ヤフオクwatchが正常に動作しています',
  price:     '¥1,000',
  priceInt:  1000,
  bids:      3,
  isBuyItNow: false,
  remaining: '残り2時間',
  endtimeMs: null,
  url:       'https://auctions.yahoo.co.jp/',
  imageUrl:  '',
  pubDate:   new Date().toISOString(),
}

export async function sendTestNtfy(topic: string): Promise<boolean> {
  return sendNtfy(TEST_ITEM, topic)
}

export async function sendTestDiscord(webhookUrl: string): Promise<boolean> {
  return sendDiscord(TEST_ITEM, webhookUrl)
}
