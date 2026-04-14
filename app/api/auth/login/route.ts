import { NextRequest, NextResponse } from 'next/server'
import { getIp, rateGuard } from '@/lib/apiGuard'

const SESSION_COOKIE = 'yw_session'
const SESSION_MAXAGE = 60 * 60 * 24 * 7 // 7日間

/** ログイン完了後にhttpOnly セッション Cookie を発行する */
export async function POST(req: NextRequest) {
  // ブルートフォース対策: IP単位で5回/分
  const limited = rateGuard(`auth-login:${getIp(req)}`, 5, 60_000)
  if (limited) return limited

  const { accessToken } = await req.json().catch(() => ({}))
  if (!accessToken || typeof accessToken !== 'string') {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  }

  // Supabase でトークンを検証
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    },
    signal: AbortSignal.timeout(4000),
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, accessToken, {
    httpOnly: true,
    secure:   true,
    sameSite: 'lax',
    path:     '/',
    maxAge:   SESSION_MAXAGE,
  })
  return response
}
