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
  // 同一デバイスに複数の購読が生まれないよう制御する。
  // ① 本番ユーザーがいれば、トライアルの購読は保存しない（本番優先）
  // ② 再インストール後の旧購読は即クリア（同デバイスの古いユーザーを無効化）
  if (deviceFingerprint) {
    const { data: sameDeviceUsers } = await supabase
      .from('users')
      .select('id, is_trial')
      .eq('device_fingerprint', deviceFingerprint)
      .neq('id', userId)

    if (sameDeviceUsers && sameDeviceUsers.length > 0) {
      // トライアルリクエスト: 本番ユーザーが同デバイスに存在するなら購読をスキップ
      if (isTrial) {
        const prodExists = sameDeviceUsers.some(u => !u.is_trial)
        if (prodExists) {
          console.log('[subscribe] trial skipped — production already active on this device')
          return NextResponse.json({ ok: true, skipped: 'production_exists' })
        }
      }
      // 旧ユーザーの push_sub をクリア（再インストール対応 / 本番が旧トライアルを上書き）
      const oldIds = sameDeviceUsers.map(u => u.id)
      await supabase.from('users').update({ push_sub: null }).in('id', oldIds)
      console.log(`[subscribe] cleared push_sub for ${oldIds.length} old device(s) (fp: ${deviceFingerprint.slice(0, 10)})`)
    }
  }

  // 購読を保存（device_fingerprint・is_trial も更新）
  const { error } = await supabase
    .from('users')
    .upsert({
      id: userId,
      push_sub: { endpoint, p256dh, auth },
      device_fingerprint: deviceFingerprint || null,
      is_trial: isTrial ?? false,
    }, { onConflict: 'id' })

  if (error) {
    console.error('[subscribe] upsert error:', error.message)
    if (error.message.includes('push_sub') || error.message.includes('column') || error.message.includes('is_trial')) {
      return NextResponse.json({ error: 'setup_required', message: error.message }, { status: 503 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log('[subscribe] OK userId:', userId.slice(0, 8), '| trial:', isTrial ?? false)
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
