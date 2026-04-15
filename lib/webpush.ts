import webpush from 'web-push'
import { getSupabaseAdmin } from './supabase'
import type { AuctionItem, PushSub } from './types'

// VAPID鍵は URL safe Base64（パディング `=` なし）が必須
const VAPID_PUBLIC_KEY  = (process.env.VAPID_PUBLIC_KEY  ?? '').replace(/=+$/, '')
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY ?? '').replace(/=+$/, '')
const APP_URL           = process.env.NEXT_PUBLIC_APP_URL ?? 'https://yahooauction-watch.vercel.app'

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY
}

async function sendToSub(sub: PushSub, payload: object): Promise<'ok' | 'expired' | 'error'> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return 'error'
  webpush.setVapidDetails(`mailto:admin@${new URL(APP_URL).hostname}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      {
        urgency: 'high', // APNs priority:10 → 画面オフ・スリープ中でも即時配信
        TTL: 86400,      // 24時間以内に届かなければ破棄
        // iOS Web Push: apns-push-type=alert で通知を即時表示（スリープ中も）
        headers: {
          'apns-push-type': 'alert',
          'apns-priority':  '10',
        },
      },
    )
    return 'ok'
  } catch (err: any) {
    if (err?.statusCode === 410 || err?.statusCode === 404) return 'expired'
    console.error('Web Push error:', err?.statusCode, err?.message ?? err)
    return 'error'
  }
}

/** ユーザーの push_sub にWeb Push送信。期限切れなら自動削除 */
export async function sendWebPushToUser(
  userId: string,
  item: AuctionItem,
  supabaseAdmin = getSupabaseAdmin(),
): Promise<number> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('push_sub')
    .eq('id', userId)
    .single()

  const sub = data?.push_sub as PushSub | null
  if (!sub?.endpoint) return 0

  const priceText = (item.price && item.price !== '価格不明') ? item.price : '現在価格なし（入札0）'
  const body = `💰 ${priceText}` +
    (item.bids != null ? `  🔨 ${item.bids}件` : '') +
    (item.remaining ? `  ⏰ ${item.remaining}` : '')

  const result = await sendToSub(sub, {
    title:     item.title.slice(0, 60),
    body,
    url:       APP_URL + '/history',  // 通知タップ時は常にアプリ履歴ページへ（Yahoo直リンクは空白画面の原因になる）
    imageUrl:  item.imageUrl ?? null,
    auctionId: item.auctionId,
    auctionUrl: item.url,             // Yahoo URLはauctionUrlで保持（履歴ページからの遷移用）
  })

  console.log(`  📱 Push [${userId.slice(0,8)}] → ${result} (${sub.endpoint.slice(8,40)}...)`)

  if (result === 'expired') {
    console.log(`  🗑️ 期限切れPush削除: ${userId.slice(0,8)}`)
    await supabaseAdmin.from('users').update({ push_sub: null }).eq('id', userId)
  }

  return result === 'ok' ? 1 : 0
}

/** 手動チェック用サマリープッシュ: N件まとめて1通知 */
export async function sendWebPushSummary(
  userId: string,
  count: number,
  topItem: AuctionItem,
  supabaseAdmin = getSupabaseAdmin(),
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('push_sub')
    .eq('id', userId)
    .single()

  const sub = data?.push_sub as PushSub | null
  if (!sub?.endpoint) return false

  const title = `ヤフオクwatch — 新着${count}件`
  const body = count === 1
    ? topItem.title.slice(0, 80)
    : `${topItem.title.slice(0, 25)}… 他${count - 1}件`

  const result = await sendToSub(sub, {
    title,
    body,
    url: APP_URL + '/history',
    imageUrl: topItem.imageUrl ?? null,
    auctionId: topItem.auctionId,
    auctionUrl: topItem.url,
  })

  console.log(`  📱 SummaryPush [${userId.slice(0, 8)}] ${count}件 → ${result}`)

  if (result === 'expired') {
    await supabaseAdmin.from('users').update({ push_sub: null }).eq('id', userId)
  }

  return result === 'ok'
}
