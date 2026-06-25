import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rateLimiter'
import webpush from 'web-push'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { userId, delayMs } = await req.json().catch(() => ({}))
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

  if (!checkRateLimit(`push-test:${userId}`, 20, 60_000)) {
    return NextResponse.json({ ok: false, debug: 'Too many requests' }, { status: 429 })
  }

  const VAPID_PUBLIC_KEY  = (process.env.VAPID_PUBLIC_KEY  ?? '').replace(/=+$/, '').trim()
  const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY ?? '').replace(/=+$/, '').trim()
  const APP_URL           = process.env.NEXT_PUBLIC_APP_URL ?? 'https://yahooauction-watch.vercel.app'

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return NextResponse.json({ ok: false, debug: 'VAPID keys not set' })
  }

  const supabase = getSupabaseAdmin()
  const { data, error: dbError } = await supabase
    .from('users')
    .select('push_sub')
    .eq('id', userId)
    .single()

  if (dbError) {
    return NextResponse.json({ ok: false, debug: `DB error: ${dbError.message}` })
  }

  const sub = data?.push_sub as { endpoint: string; p256dh: string; auth: string } | null
  if (!sub?.endpoint) {
    return NextResponse.json({ ok: false, debug: 'No subscription found. 設定ページで通知を再設定してください。' })
  }
  const endpointHost = (() => {
    try { return new URL(sub.endpoint).hostname } catch { return 'invalid-endpoint' }
  })()

  try {
    const safeDelayMs = Math.max(0, Math.min(Number(delayMs || 0), 5000))
    if (safeDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, safeDelayMs))
    }
    const testId = `test-${Date.now()}`
    const timeLabel = new Date().toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Asia/Tokyo',
    })
    webpush.setVapidDetails(`mailto:admin@${new URL(APP_URL).hostname}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    const sendResult = await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({
        title:     `テスト通知 ✓ ${timeLabel}`,
        body:      'ヤフオクwatchが正常に動作しています',
        url:       '/',
        auctionId: testId,
      }),
      {
        urgency: 'high',
        TTL: 60,
        headers: {
          'apns-push-type': 'alert',
          'apns-priority':  '10',
        },
      },
    )
    const statusCode = sendResult?.statusCode ?? 0
    console.log('[push/test] accepted:', {
      statusCode,
      endpointHost,
      testId,
      userId: userId.slice(0, 8),
    })
    return NextResponse.json({
      ok: true,
      accepted: statusCode >= 200 && statusCode < 300,
      statusCode,
      endpointHost,
      testId,
      debug: `Pushサービス受理: status=${statusCode || 'unknown'} host=${endpointHost} id=${testId}`,
    })
  } catch (err: any) {
    const status = err?.statusCode
    const body   = JSON.stringify(err?.body ?? err?.message)
    console.error('[push/test] Send error:', status, body)

    // 410/404: 購読期限切れ → DBをクリアして再設定を促す
    if (status === 410 || status === 404) {
      await supabase.from('users').update({ push_sub: null }).eq('id', userId)
      return NextResponse.json({
        ok: false,
        debug: `通知の登録が期限切れです。endpoint=${endpointHost}`,
        expired: true,
      })
    }

    return NextResponse.json({
      ok: false,
      debug: `Push error: status=${status} endpoint=${endpointHost} body=${body}`,
      statusCode: status ?? null,
      endpointHost,
    })
  }
}
