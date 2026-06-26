import webpush from 'web-push'
import { getSupabaseAdmin } from './supabase'
import type { AuctionItem, PushSub } from './types'

// VAPID鍵は URL safe Base64（パディング `=` なし）が必須
const VAPID_PUBLIC_KEY  = (process.env.VAPID_PUBLIC_KEY  ?? '').trim().replace(/=+$/, '')
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY ?? '').trim().replace(/=+$/, '')
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

function withReceipt(payload: Record<string, unknown>, userId: string, prefix: string): Record<string, unknown> {
  return {
    ...payload,
    notificationId: `${prefix}-${Date.now()}-${userId.slice(0, 8)}`,
    userIdHint: userId.slice(0, 8),
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

  const result = await sendToSub(sub, withReceipt({
    title:     item.title.slice(0, 60),
    body,
    url:       APP_URL + '/history',  // 通知タップ時は常にアプリ履歴ページへ（Yahoo直リンクは空白画面の原因になる）
    imageUrl:  item.imageUrl ?? null,
    auctionId: item.auctionId,
    auctionUrl: item.url,             // Yahoo URLはauctionUrlで保持（履歴ページからの遷移用）
  }, userId, 'item'))

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

  const result = await sendToSub(sub, withReceipt({
    title,
    body,
    url: APP_URL + '/history',
    imageUrl: topItem.imageUrl ?? null,
    auctionId: topItem.auctionId,
    auctionUrl: topItem.url,
  }, userId, 'summary'))

  console.log(`  📱 SummaryPush [${userId.slice(0, 8)}] ${count}件 → ${result}`)

  if (result === 'expired') {
    await supabaseAdmin.from('users').update({ push_sub: null }).eq('id', userId)
  }

  return result === 'ok'
}

/** 条件追加直後の初回取得完了プッシュ */
export async function sendWebPushInitialFetch(
  userId: string,
  count: number,
  conditionName: string,
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

  const title = `ヤフオクwatch — 取得完了しました`
  const body = `${conditionName} の該当オークション${count}件を通知履歴に反映しました`

  const result = await sendToSub(sub, withReceipt({
    title,
    body,
    url: APP_URL + '/history',
    imageUrl: topItem.imageUrl ?? null,
    auctionId: topItem.auctionId,
    auctionUrl: topItem.url,
  }, userId, 'initial'))

  console.log(`  📱 InitialFetchPush [${userId.slice(0, 8)}] ${count}件 → ${result}`)

  if (result === 'expired') {
    await supabaseAdmin.from('users').update({ push_sub: null }).eq('id', userId)
  }

  return result === 'ok'
}

/** 新着なし通知プッシュ */
export async function sendWebPushNoItems(
  userId: string,
  supabaseAdmin = getSupabaseAdmin(),
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('push_sub')
    .eq('id', userId)
    .single()

  const sub = data?.push_sub as PushSub | null
  if (!sub?.endpoint) return false

  const result = await sendToSub(sub, withReceipt({
    title: 'ヤフオクwatch チェック完了',
    body: '新着情報はありませんでした',
    url: APP_URL + '/history',
    imageUrl: null,
    auctionId: `no-items-${Date.now()}`,
    auctionUrl: null,
  }, userId, 'no-items'))

  console.log(`  📱 NoItemsPush [${userId.slice(0, 8)}] → ${result}`)

  if (result === 'expired') {
    await supabaseAdmin.from('users').update({ push_sub: null }).eq('id', userId)
  }

  return result === 'ok'
}

/** 定期チェック完了プッシュ: 新着件数、または取得失敗を知らせる */
export async function sendWebPushCheckComplete(
  userId: string,
  summary: { freshCount: number; noItems: boolean; failed?: boolean; fetchFailedCount?: number },
  supabaseAdmin = getSupabaseAdmin(),
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('push_sub')
    .eq('id', userId)
    .single()

  const sub = data?.push_sub as PushSub | null
  if (!sub?.endpoint) return false

  const now = new Date()
  const checkedAt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now)
  const body = summary.failed
    ? `取得できませんでした（${summary.fetchFailedCount ?? 1}条件 / ${checkedAt}確認）`
    : summary.noItems
      ? `新着はありませんでした（${checkedAt}確認）`
      : `取得完了: 新着${summary.freshCount}件（${checkedAt}確認）`

  const result = await sendToSub(sub, withReceipt({
    title: 'ヤフオクwatch チェック完了',
    body,
    url: APP_URL + '/history',
    imageUrl: null,
    auctionId: `check-complete-${now.getTime()}-${userId.slice(0, 8)}`,
    auctionUrl: null,
  }, userId, 'check-complete'))

  console.log(`  📱 CheckCompletePush [${userId.slice(0, 8)}] → ${result}`)

  if (result === 'expired') {
    await supabaseAdmin.from('users').update({ push_sub: null }).eq('id', userId)
  }

  return result === 'ok'
}
