import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { createTrialCookie, TRIAL_COOKIE, TRIAL_DAYS } from '@/lib/trial'

export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  const token = params.token
  if (!token) return NextResponse.redirect(new URL('/expired', req.url))

  const supabase = getSupabaseAdmin()

  // トークンを DB で検索
  const { data, error } = await supabase
    .from('trial_tokens')
    .select('*')
    .eq('token', token)
    .single()

  if (error || !data) {
    // 存在しないトークン → expired ページ
    return NextResponse.redirect(new URL('/expired', req.url))
  }

  // すでに別デバイスで使用済み → 使用済みページ
  if (data.activated) {
    return NextResponse.redirect(new URL('/expired?reason=used', req.url))
  }

  // 初回アクセス → 開始日時を記録してアクティベート
  const now       = new Date()
  const expiresAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000)

  await supabase
    .from('trial_tokens')
    .update({
      activated:  true,
      started_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      ip_address: req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '',
    })
    .eq('token', token)

  // HMAC 署名済み Cookie をセット（7日間）
  const cookieValue = await createTrialCookie(token, expiresAt)

  const res = NextResponse.redirect(new URL('/', req.url))
  res.cookies.set(TRIAL_COOKIE, cookieValue, {
    httpOnly: false,     // クライアント JS からカウントダウン表示のため
    secure:   true,
    sameSite: 'lax',
    path:     '/',
    maxAge:   TRIAL_DAYS * 24 * 60 * 60,
  })

  return res
}
