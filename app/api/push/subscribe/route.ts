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
  const limited = rateGuard(`push-sub:${userId}`, 10, 60_000)
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

  // ── STEP 1: push_sub を確実に保存（最優先・絶対に失敗させない） ──────
  // update のみ使用（upsert は NOT NULL カラムの INSERT 失敗リスクあり）
  // getOrCreateUser でユーザーは必ず作成済みなので update で十分
  const { data: updated, error: updateErr } = await supabase
    .from('users')
    .update({ push_sub: { endpoint, p256dh, auth } })
    .eq('id', userId)
    .select('id')

  if (updateErr) {
    console.error('[subscribe] push_sub update error:', updateErr.message)
    // push_sub カラム自体が存在しない場合のみ 503
    if (updateErr.message.toLowerCase().includes('push_sub')) {
      return NextResponse.json({ error: 'setup_required', message: updateErr.message }, { status: 503 })
    }
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // ユーザーが存在しない場合: 作成してから再更新
  if (!updated || updated.length === 0) {
    console.log('[subscribe] user not found, creating:', userId.slice(0, 8))
    await supabase.from('users').insert({ id: userId }).select().maybeSingle()
    await supabase.from('users').update({ push_sub: { endpoint, p256dh, auth } }).eq('id', userId)
  }

  console.log('[subscribe] push_sub saved:', userId.slice(0, 8))

  // ── STEP 2: device_fingerprint / is_trial を更新（オプション・失敗しても続行） ──
  if (deviceFingerprint) {
    // 同デバイスの旧ユーザーをクリア（エラーは無視）
    supabase
      .from('users')
      .select('id')
      .eq('device_fingerprint', deviceFingerprint)
      .neq('id', userId)
      .then(({ data: oldUsers }) => {
        if (oldUsers && oldUsers.length > 0) {
          const oldIds = oldUsers.map(u => u.id)
          void supabase.from('users').update({ push_sub: null }).in('id', oldIds).then(() => {
            console.log(`[subscribe] cleared ${oldIds.length} old device(s)`)
          })
        }
      })

    // device_fingerprint / is_trial の更新（カラムなければ無視）
    void supabase
      .from('users')
      .update({ device_fingerprint: deviceFingerprint, is_trial: isTrial ?? false })
      .eq('id', userId)
      .then(({ error: e }) => {
        if (e) console.log('[subscribe] optional columns not updated (OK):', e.message.slice(0, 60))
      })
  }

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
