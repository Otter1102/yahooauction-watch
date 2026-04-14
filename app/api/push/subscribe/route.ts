import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { rateGuard } from '@/lib/apiGuard'

export const runtime = 'nodejs'

const IS_TRIAL = process.env.NEXT_PUBLIC_TRIAL_MODE === 'true'

export async function POST(req: NextRequest) {
  const { userId, endpoint, p256dh, auth, deviceFingerprint, deviceType } = await req.json().catch(() => ({}))
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

  // ── フィンガープリントによる既存ユーザー統合 ──────────────────
  // 再インストール時: 新しい UUID が来ても同一端末の既存ユーザーを検出して統合する
  // これにより「再インストール = 新規ユーザー増殖」問題を解決する
  if (deviceFingerprint) {
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('device_fingerprint', deviceFingerprint)
      .neq('id', userId)  // 自分自身は除外
      .maybeSingle()

    if (existingUser) {
      const canonicalId = existingUser.id
      // 既存ユーザーの push_sub を最新トークンで上書き（古いトークン自動置換）
      const mergeData: Record<string, unknown> = {
        push_sub: { endpoint, p256dh, auth },
        device_fingerprint: deviceFingerprint,
      }
      if (deviceType) mergeData.device_type = deviceType

      let { error: mergeErr } = await supabase.from('users').update(mergeData).eq('id', canonicalId)
      // migration_009 未実行時: device_type カラムなしで再試行
      if (mergeErr?.message?.includes('device_type')) {
        delete mergeData.device_type
        const retry = await supabase.from('users').update(mergeData).eq('id', canonicalId)
        mergeErr = retry.error
      }
      if (mergeErr) console.error('[subscribe] merge error:', mergeErr.message)

      // 新しい UUID 側に conditions があれば canonical に移行（再インストール後に条件登録した場合）
      await supabase
        .from('conditions')
        .update({ user_id: canonicalId })
        .eq('user_id', userId)

      // 新しい UUID 側のゴーストレコードを削除（conditions移行済みなので安全）
      await supabase.from('users').delete().eq('id', userId)

      console.log(`[subscribe] 既存ユーザーに統合: ${userId.slice(0,8)} → ${canonicalId.slice(0,8)} deviceType=${deviceType ?? 'unknown'}`)
      // canonicalUserId をクライアントに返す → localStorage を更新させる
      return NextResponse.json({ ok: true, canonicalUserId: canonicalId })
    }
  }

  // ── 通常 upsert（新規 or 同一 UUID の再登録）──────────────────
  const upsertData: Record<string, unknown> = { id: userId, push_sub: { endpoint, p256dh, auth } }
  if (deviceFingerprint) upsertData.device_fingerprint = deviceFingerprint
  if (deviceType) upsertData.device_type = deviceType

  let { error } = await supabase.from('users').upsert(upsertData, { onConflict: 'id' })

  // migration_009 未実行時: device_type カラムなしで自動リトライ（機能縮退で継続）
  if (error?.message?.includes('device_type')) {
    delete upsertData.device_type
    const retry = await supabase.from('users').upsert(upsertData, { onConflict: 'id' })
    error = retry.error
  }

  if (error) {
    console.error('[subscribe] upsert error:', error.message)
    if (error.message.includes('push_sub') || error.message.includes('column')) {
      return NextResponse.json({ error: 'setup_required', message: error.message }, { status: 503 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log(`[subscribe] upsert OK userId:${userId.slice(0, 8)} deviceType=${deviceType ?? 'unknown'} fp=${deviceFingerprint ? deviceFingerprint.slice(0, 10) : 'none'}`)
  return NextResponse.json({ ok: true, canonicalUserId: userId })
}

export async function DELETE(req: NextRequest) {
  const { userId } = await req.json().catch(() => ({}))
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  const limited = rateGuard(`push-unsub:${userId}`, 5, 60_000)
  if (limited) return limited
  await getSupabaseAdmin().from('users').update({ push_sub: null }).eq('id', userId)
  return NextResponse.json({ ok: true })
}
