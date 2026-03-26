import { NextRequest, NextResponse } from 'next/server'
import { verifyTrialCookie, TRIAL_COOKIE } from './lib/trial'

const PUBLIC_PREFIXES = ['/login', '/start/', '/expired', '/api/', '/_next', '/favicon', '/icons', '/manifest']
const SESSION_COOKIE  = 'yw_session'

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) {
    return withSecurity(NextResponse.next())
  }

  // ─── トライアル Cookie チェック ───
  const trialVal = req.cookies.get(TRIAL_COOKIE)?.value
  if (trialVal) {
    const data = await verifyTrialCookie(trialVal)
    if (data && new Date(data.exp) > new Date()) {
      return withSecurity(NextResponse.next())
    }
    const res = NextResponse.redirect(new URL('/expired', req.url))
    res.cookies.delete(TRIAL_COOKIE)
    return withSecurity(res)
  }

  // ─── 本番セッション Cookie チェック ───
  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value
  if (sessionToken) {
    // Supabase access_token をサーバーサイドで検証
    const ok = await verifySupabaseToken(sessionToken)
    if (ok) return withSecurity(NextResponse.next())
  }

  return NextResponse.redirect(new URL('/login', req.url))
}

async function verifySupabaseToken(token: string): Promise<boolean> {
  try {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      },
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

function withSecurity(res: NextResponse): NextResponse {
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
