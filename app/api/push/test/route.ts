import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rateLimiter'
import webpush from 'web-push'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { userId } = await req.json().catch(() => ({}))
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

  // レート制限: 1分に3回まで（通知スパム防止）
  if (!checkRateLimit(`push-test:${userId}`, 3, 60_000)) {
    return NextResponse.json({ ok: false, debug: 'Too many requests' }, { status: 429 })
  }

  // パディング `=` を除去（web-push は URL safe Base64 無パディング必須）
  const VAPID_PUBLIC_KEY  = (process.env.VAPID_PUBLIC_KEY  ?? '').replace(/=+$/, '').trim()
  const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY ?? '').replace(/=+$/, '').trim()
  const APP_URL           = process.env.NEXT_PUBLIC_APP_URL ?? 'https://yahooauction-watch.vercel.app'

  // 1. VAPID チェック
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error('[push/test] VAPID keys missing')
    return NextResponse.json({ ok: false, debug: 'VAPID keys not set' })
  }

  // 2. users テーブルから push_sub 取得
  const { data, error: dbError } = await getSupabaseAdmin()
    .from('users')
    .select('push_sub')
    .eq('id', userId)
    .single()

  if (dbError) {
    console.error('[push/test] DB error:', dbError.message)
    return NextResponse.json({ ok: false, debug: `DB error: ${dbError.message}` })
  }

  const sub = data?.push_sub as { endpoint: string; p256dh: string; auth: string } | null
  if (!sub?.endpoint) {
    console.error('[push/test] No push_sub for userId:', userId)
    return NextResponse.json({ ok: false, debug: 'No subscription found for this userId' })
  }

  console.log('[push/test] Sending to endpoint:', sub.endpoint.slice(0, 60) + '...')

  // 3. 送信
  try {
    webpush.setVapidDetails(`mailto:admin@${new URL(APP_URL).hostname}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({
        title:     'テスト通知 ✓',
        body:      'ヤフオクwatchが正常に動作しています',
        url:       '/',
        auctionId: 'test',
      }),
    )
    console.log('[push/test] Sent OK')
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[push/test] Send error:', err?.statusCode, err?.body ?? err?.message)
    return NextResponse.json({
      ok: false,
      debug: `Push error: status=${err?.statusCode} body=${JSON.stringify(err?.body ?? err?.message)}`,
    })
  }
}
