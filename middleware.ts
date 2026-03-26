import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { verifyTrialCookie, TRIAL_COOKIE } from './lib/trial'

// これらのパスは認証不要
const PUBLIC_PREFIXES = ['/login', '/start/', '/expired', '/api/', '/_next', '/favicon', '/icons', '/manifest']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // 静的アセット・公開パスはそのまま通す
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) {
    return withSecurity(NextResponse.next())
  }

  // ─── トライアル Cookie チェック ───
  const trialVal = req.cookies.get(TRIAL_COOKIE)?.value
  if (trialVal) {
    const data = await verifyTrialCookie(trialVal)
    if (data && new Date(data.exp) > new Date()) {
      // 有効なトライアル
      return withSecurity(NextResponse.next())
    }
    // 期限切れ → 削除して /expired へ
    const res = NextResponse.redirect(new URL('/expired', req.url))
    res.cookies.delete(TRIAL_COOKIE)
    return withSecurity(res)
  }

  // ─── Supabase Auth チェック ───
  const res = NextResponse.next({ request: req })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => list.forEach(({ name, value, options }) => {
          req.cookies.set(name, value)
          res.cookies.set(name, value, options)
        }),
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return withSecurity(res)
}

function withSecurity(res: NextResponse): NextResponse {
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('X-XSS-Protection', '1; mode=block')
  res.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
