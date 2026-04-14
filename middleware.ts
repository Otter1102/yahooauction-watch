import { NextRequest, NextResponse } from 'next/server'

// CSRFチェックをスキップするAPIプレフィックス
// - cron: サーバー間通信（CRON_SECRET で別途認証）
// - auth: ログイン処理（accessToken でSupabase検証済み）
// - vapid-key / version: GETのみ・機密情報なし
const CSRF_SKIP_PREFIXES = [
  '/api/cron/',
  '/api/auth/',
  '/api/push/vapid-key',
  '/api/version',
]

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname
  const method = req.method

  // ── CSRF保護: 変更系API（POST/PUT/DELETE/PATCH）のOriginを検証 ──
  // ブラウザは cross-origin リクエスト時に必ず Origin を付与する仕様。
  // Origin が存在して host と一致しない場合は第三者サイトからのリクエストなので拒否。
  // Origin が null = 同一オリジンfetch / Service Worker → 許可（正規クライアント）
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) && path.startsWith('/api/')) {
    const skip = CSRF_SKIP_PREFIXES.some(p => path.startsWith(p))
    if (!skip) {
      const origin = req.headers.get('origin')
      const host   = req.headers.get('host') ?? ''
      if (origin) {
        let originHost = ''
        try { originHost = new URL(origin).host } catch { /* invalid origin */ }
        if (originHost !== host) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      }
    }
  }

  return withSecurity(NextResponse.next())
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
