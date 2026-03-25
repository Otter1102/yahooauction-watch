/**
 * 通知モジュール
 * ntfy.sh + Discord Webhook に対応
 */
import { AuctionItem, User } from './types'

// ==================== ntfy.sh ====================

export async function sendNtfy(item: AuctionItem, topic: string): Promise<boolean> {
  if (!topic) return false
  const body =
    `💰 ${item.price}` +
    (item.bids != null ? `  🔨 ${item.bids}件` : '') +
    (item.remaining ? `  ⏰ ${item.remaining}` : '') +
    `\n${item.url}`
  try {
    const res = await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        Title: encodeURIComponent(item.title.slice(0, 60)),
        Click: item.url,
        ...(item.imageUrl ? { Attach: item.imageUrl } : {}),
      },
      body,
      signal: AbortSignal.timeout(10000),
    })
    return res.ok
  } catch {
    return false
  }
}

// ==================== Discord ====================

export async function sendDiscord(item: AuctionItem, webhookUrl: string): Promise<boolean> {
  if (!webhookUrl) return false
  const embed = {
    title: `🔔 ${item.title.slice(0, 256)}`,
    url: item.url,
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
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ヤフオクwatch', embeds: [embed] }),
      signal: AbortSignal.timeout(10000),
    })
    return res.status === 204
  } catch {
    return false
  }
}

// ==================== 統合送信 ====================

export async function notifyUser(item: AuctionItem, user: User): Promise<boolean> {
  const ch = user.notificationChannel
  const results = await Promise.all([
    (ch === 'ntfy' || ch === 'both') ? sendNtfy(item, user.ntfyTopic) : Promise.resolve(false),
    (ch === 'discord' || ch === 'both') ? sendDiscord(item, user.discordWebhook) : Promise.resolve(false),
  ])
  return results.some(Boolean)
}

// ==================== テスト通知 ====================

export async function sendTestNtfy(topic: string): Promise<boolean> {
  return sendNtfy(
    {
      auctionId: 'test',
      title: 'テスト通知 — ヤフオクwatchが正常に動作しています',
      price: '¥1,000',
      priceInt: 1000,
      bids: 3,
      remaining: '残り2時間',
      url: 'https://auctions.yahoo.co.jp/',
      imageUrl: '',
      pubDate: new Date().toISOString(),
    },
    topic
  )
}

export async function sendTestDiscord(webhookUrl: string): Promise<boolean> {
  return sendDiscord(
    {
      auctionId: 'test',
      title: 'テスト通知 — ヤフオクwatchが正常に動作しています',
      price: '¥1,000',
      priceInt: 1000,
      bids: 3,
      remaining: '残り2時間',
      url: 'https://auctions.yahoo.co.jp/',
      imageUrl: '',
      pubDate: new Date().toISOString(),
    },
    webhookUrl
  )
}
