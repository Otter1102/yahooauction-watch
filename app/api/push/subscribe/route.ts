import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { rateGuard } from '@/lib/apiGuard'

export const runtime = 'nodejs'

const IS_TRIAL = process.env.NEXT_PUBLIC_TRIAL_MODE === 'true'

export async function POST(req: NextRequest) {
  const { userId, endpoint, p256dh, auth } = await req.json().catch(() => ({}))
  if (!userId || !endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  const limited = rateGuard(`push-sub:${userId}`, 5, 60_000)
  if (limited) return limited

  const supabase = getSupabaseAdmin()

  // トライアルアプリ: push endpoint が期限切れトライアルセッションに紐づく場合は拒否
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

  // upsert: レース条件なし・1往復で完結（旧: read→insert/update 3往復）
  const { error } = await supabase
    .from('users')
    .upsert({ id: userId, push_sub: { endpoint, p256dh, auth } }, { onConflict: 'id' })

  if (error) {
    console.error('[subscribe] upsert error:', error.message)
    if (error.message.includes('push_sub') || error.message.includes('column')) {
      return NextResponse.json({ error: 'setup_required', message: error.message }, { status: 503 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log('[subscribe] upsert OK userId:', userId.slice(0, 8))
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
