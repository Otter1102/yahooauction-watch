import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimiter'
import { getPushSub, clearPushSub, getAllPushEnabledUserIds } from '@/lib/storage'
import webpush from 'web-push'

export const runtime = 'nodejs'

// POST /api/push/test
// body 例: { userId: "abc-123" } … 特定ユーザーへテスト送信
//          { userId: "*all*" }   … 登録済み全ユーザーへブロードキャスト
//          { userId: "*first*", limit?: number } … 先頭 N ユーザーへ（default limit=1）
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const userIdInput = String(body.userId ?? '')
  const delayMs = Number(body.delayMs ?? 0)
  const limitInput = Number(body.limit ?? 1)

  if (!userIdInput) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

  const VAPID_PUBLIC_KEY  = (process.env.VAPID_PUBLIC_KEY  ?? '').replace(/=+$/, '').trim()
  const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY ?? '').replace(/=+$/, '').trim()
  const APP_URL           = process.env.NEXT_PUBLIC_APP_URL ?? 'https://yahooauction-watch.vercel.app'

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return NextResponse.json({ ok: false, debug: 'VAPID keys not set' })
  }
  webpush.setVapidDetails(`mailto:admin@${new URL(APP_URL).hostname}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

  // ── ブロードキャスト用の管理経路 ──────────────────────────────────
  if (userIdInput === '*all*' || userIdInput === '*first*') {
    const adminSecret = (process.env.CRON_SECRET ?? '').trim()
    const supplied = req.headers.get('x-admin-secret') ?? ''
    if (!adminSecret || supplied !== adminSecret) {
      return NextResponse.json({ ok: false, debug: 'Admin secret required' }, { status: 401 })
    }
    const limit = userIdInput === '*first*' ? Math.max(1, Math.min(1000, Number.isFinite(limitInput) ? limitInput : 1)) : Number.MAX_SAFE_INTEGER
    const ids = await getAllPushEnabledUserIds()
    const targets = ids.slice(0, limit)
    const results: Array<{ userId: string; ok: boolean; statusCode?: number; debug?: string }> = []
    for (const uid of targets) {
      const r = await sendTestTo(uid, delayMs)
      results.push({ userId: uid.slice(0, 8) + '...', ...r })
    }
    return NextResponse.json({ ok: true, sent: results.length, results })
  }

  // ── 通常経路: userId 指定 ─────────────────────────────────────────
  const userId = userIdInput
  if (!checkRateLimit(`push-test:${userId}`, 20, 60_000)) {
    return NextResponse.json({ ok: false, debug: 'Too many requests' }, { status: 429 })
  }
  const result = await sendTestTo(userId, delayMs)
  return NextResponse.json(result)
}

async function sendTestTo(userId: string, delayMs: number) {
  const sub = await getPushSub(userId)
  if (!sub?.endpoint) {
    return {
      ok: false,
      debug: 'No subscription found. 設定ページで通知を再設定してください。',
    }
  }
  const endpointHost = (() => {
    try { return new URL(sub.endpoint).hostname } catch { return 'invalid-endpoint' }
  })()

  const safeDelayMs = Math.max(0, Math.min(Number(delayMs || 0), 5000))
  if (safeDelayMs > 0) await new Promise(resolve => setTimeout(resolve, safeDelayMs))

  const testId = `test-${Date.now()}`
  const timeLabel = new Date().toLocaleTimeString('ja-JP', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Tokyo',
  })

  try {
    const sendResult = await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({
        title:     `テスト通知 ✓ ${timeLabel}`,
        body:      'ヤフオクwatch(Neon 版)が正常に動作しています',
        url:       '/',
        auctionId: testId,
      }),
      {
        urgency: 'high',
        TTL: 60,
        headers: { 'apns-push-type': 'alert', 'apns-priority': '10' },
      },
    )
    const statusCode = sendResult?.statusCode ?? 0
    console.log('[push/test] accepted:', { statusCode, endpointHost, testId, userId: userId.slice(0, 8) })
    return {
      ok: true,
      accepted: statusCode >= 200 && statusCode < 300,
      statusCode,
      endpointHost,
      testId,
      debug: `Pushサービス受理: status=${statusCode || 'unknown'} host=${endpointHost} id=${testId}`,
    }
  } catch (err: any) {
    const status = err?.statusCode
    const bodyText = JSON.stringify(err?.body ?? err?.message)
    console.error('[push/test] Send error:', status, bodyText)
    if (status === 410 || status === 404) {
      await clearPushSub(userId).catch(() => {})
      return {
        ok: false,
        debug: `通知の登録が期限切れです。endpoint=${endpointHost}`,
        expired: true,
      }
    }
    return {
      ok: false,
      debug: `Push error: status=${status} endpoint=${endpointHost} body=${bodyText}`,
      statusCode: status ?? null,
      endpointHost,
    }
  }
}
