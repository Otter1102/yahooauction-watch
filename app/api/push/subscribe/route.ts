import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { rateGuard } from '@/lib/apiGuard'
import {
  getOrCreateUser,
  updateUser,
  clearPushSub,
  clearPushSubForDuplicateDevice,
  setDeviceFingerprint,
} from '@/lib/storage'
import { isNeonEnabled } from '@/lib/neon'

export const runtime = 'nodejs'

const IS_TRIAL = process.env.NEXT_PUBLIC_TRIAL_MODE === 'true'

export async function POST(req: NextRequest) {
  const { userId, endpoint, p256dh, auth, deviceFingerprint, isTrial } = await req.json().catch(() => ({}))
  if (!userId || !endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  const limited = rateGuard(`push-sub:${userId}`, 10, 60_000)
  if (limited) return limited

  // トライアルアプリ: 期限切れセッションは拒否
  // trial_sessions は Supabase 専用テーブルなので Supabase 経路のときだけ照会。
  if (IS_TRIAL && !isNeonEnabled()) {
    const supabase = getSupabaseAdmin()
    const { data: session } = await supabase
      .from('trial_sessions')
      .select('expires_at')
      .eq('push_endpoint', endpoint)
      .maybeSingle()
    if (session && new Date(session.expires_at) < new Date()) {
      return NextResponse.json({ error: 'trial_expired' }, { status: 403 })
    }
  }

  // ── STEP 1: push_sub を確実に保存（最優先・絶対に失敗させない） ──────
  try {
    await getOrCreateUser(userId)
    await updateUser(userId, { pushSub: { endpoint, p256dh, auth } })
  } catch (e: any) {
    console.error('[subscribe] push_sub 保存エラー:', e?.message ?? e)
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }

  console.log('[subscribe] push_sub saved:', userId.slice(0, 8))

  // ── STEP 2: device_fingerprint / is_trial を更新（オプション・失敗しても続行） ──
  if (deviceFingerprint) {
    // 同デバイスの旧ユーザーをクリア
    void clearPushSubForDuplicateDevice(deviceFingerprint, userId).then((oldIds) => {
      if (oldIds.length > 0) console.log(`[subscribe] cleared ${oldIds.length} old device(s)`)
    }).catch(e => {
      console.log('[subscribe] duplicate device cleanup skipped:', e?.message ?? e)
    })

    // device_fingerprint / is_trial の更新（カラムなければ無視）
    void setDeviceFingerprint(userId, deviceFingerprint, Boolean(isTrial)).catch(e => {
      console.log('[subscribe] optional columns not updated (OK):', (e?.message ?? String(e)).slice(0, 60))
    })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { userId } = await req.json().catch(() => ({}))
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  const limited = rateGuard(`push-unsub:${userId}`, 5, 60_000)
  if (limited) return limited
  await clearPushSub(userId)
  return NextResponse.json({ ok: true })
}
