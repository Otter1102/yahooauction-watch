import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { rateGuard } from '@/lib/apiGuard'

export const runtime = 'nodejs'

const IS_TRIAL = process.env.NEXT_PUBLIC_TRIAL_MODE === 'true'

export async function POST(req: NextRequest) {
  const { userId, endpoint, p256dh, auth, deviceFingerprint, isTrial } = await req.json().catch(() => ({}))
  if (!userId || !endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  const limited = rateGuard(`push-sub:${userId}`, 5, 60_000)
  if (limited) return limited

  const supabase = getSupabaseAdmin()

  // トライアルアプリ: 期限切れセッションは拒否
  if (IS_TRIAL) {
    const { data: session } = await supabase
      .from('trial_sessions')
      .select('expires_at')
      .eq('push_endpoint', endpoint)
      .maybeSingle()
    if (session && new Date(session.expires_at) < new Date()) {
      return NextResponse.json({ error: 'trial_expired' }, { status: 403 })
    }
  }

  // ── デバイスフィンガープリント重複排除 ──────────────────────────────
  // カラムが存在しない場合はエラーを無視して続行
  if (deviceFingerprint) {
    const { data: sameDeviceUsers, error: fpError } = await supabase
      .from('users')
      .select('id, is_trial')
      .eq('device_fingerprint', deviceFingerprint)
      .neq('id', userId)

    if (!fpError && sameDeviceUsers && sameDeviceUsers.length > 0) {
      if (isTrial) {
        const prodExists = sameDeviceUsers.some(u => !u.is_trial)
        if (prodExists) {
          console.log('[subscribe] trial skipped — production already active on this device')
          return NextResponse.json({ ok: true, skipped: 'production_exists' })
        }
      }
      const oldIds = sameDeviceUsers.map(u => u.id)
      await supabase.from('users').update({ push_sub: null }).in('id', oldIds)
      console.log(`[subscribe] cleared push_sub for ${oldIds.length} old device(s)`)
    }
  }

  // ── push_sub を保存（フォールバック付き） ───────────────────────────
  // まず全カラムでupsert。device_fingerprint / is_trial カラムが未作成の場合は
  // push_sub のみの最小upsertにフォールバックして確実に保存する。
  const { error } = await supabase
    .from('users')
    .upsert({
      id: userId,
      push_sub: { endpoint, p256dh, auth },
      device_fingerprint: deviceFingerprint || null,
      is_trial: isTrial ?? false,
    }, { onConflict: 'id' })

  if (error) {
    const msg = error.message
    console.error('[subscribe] upsert error:', msg)

    // push_sub カラム自体がない場合は DB 設定が必須（フォールバック不可）
    if (msg.toLowerCase().includes('push_sub')) {
      return NextResponse.json({ error: 'setup_required', message: msg }, { status: 503 })
    }

    // device_fingerprint / is_trial カラムがない場合: push_sub のみで再試行
    if (msg.includes('column') || msg.includes('device_fingerprint') || msg.includes('is_trial')) {
      console.log('[subscribe] fallback: push_sub のみで再試行中...')
      const { error: e2 } = await supabase
        .from('users')
        .upsert({ id: userId, push_sub: { endpoint, p256dh, auth } }, { onConflict: 'id' })
      if (e2) {
        console.error('[subscribe] fallback upsert error:', e2.message)
        return NextResponse.json({ error: e2.message }, { status: 500 })
      }
      console.log('[subscribe] fallback OK userId:', userId.slice(0, 8))
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: msg }, { status: 500 })
  }

  console.log('[subscribe] OK userId:', userId.slice(0, 8))
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { userId } = await req.json().catch(() => ({}))
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  const limited = rateGuard(`push-unsub:${userId}`, 5, 60_000)
  if (limited) return limited
  await getSupabaseAdmin().from('users').update({ push_sub: null }).eq('id', userId)
  return NextResponse.json({ ok: true })
}
