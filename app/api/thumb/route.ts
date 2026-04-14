import { NextRequest, NextResponse } from 'next/server'
import { getIp, rateGuard } from '@/lib/apiGuard'

// SSRF対策: サムネイル取得を許可するホスト名を厳格に限定
const ALLOWED_THUMB_HOSTNAMES = new Set([
  'page.auctions.yahoo.co.jp',
  'auctions.yahoo.co.jp',
])

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'ja-JP,ja;q=0.9',
  'Referer': 'https://auctions.yahoo.co.jp/',
}

/**
 * Yahoo Auction 個別ページから og:image（出品1枚目の画像）を取得するプロキシ
 * クライアントから直接 Yahoo に fetch するとCORSで弾かれるため、
 * このサーバーサイドエンドポイント経由で取得する。
 * Vercel Edge Cache が効くので同一オークションへの重複アクセスを防ぐ。
 */
export const revalidate = 3600 // 1時間キャッシュ

export async function GET(req: NextRequest) {
  // レート制限: IP単位で30回/分
  const limited = rateGuard(`thumb:${getIp(req)}`, 30, 60_000)
  if (limited) return limited

  const auctionUrl = req.nextUrl.searchParams.get('url')
  if (!auctionUrl) return NextResponse.json({ imageUrl: '' })

  // SSRF対策: 許可ホスト名のみ（.includes('yahoo') は迂回可能なため厳格化）
  let parsedUrl: URL
  try { parsedUrl = new URL(auctionUrl) } catch { return NextResponse.json({ imageUrl: '' }) }
  if (!ALLOWED_THUMB_HOSTNAMES.has(parsedUrl.hostname)) {
    return NextResponse.json({ imageUrl: '' }, { status: 400 })
  }

  try {
    const res = await fetch(auctionUrl, {
      headers: HEADERS,
      signal: AbortSignal.timeout(6000),
    })

    if (!res.ok) {
      return NextResponse.json({ imageUrl: '' }, {
        headers: { 'Cache-Control': 'public, max-age=60' },
      })
    }

    const html = await res.text()

    // ─── 1. og:image が最も確実（出品者がアップした1枚目の画像） ───
    const ogMatch =
      html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/) ??
      html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/)

    if (ogMatch?.[1] && /yimg\.jp/.test(ogMatch[1])) {
      return NextResponse.json({ imageUrl: ogMatch[1] }, {
        headers: { 'Cache-Control': 'public, max-age=7200, s-maxage=7200' },
      })
    }

    // ─── 2. __NEXT_DATA__ 内の画像URLを探す ───
    const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
    if (ndMatch) {
      // Unicode エスケープ (\u002F = /) と \\/ の両パターンに対応
      const imgPatterns = [
        /https:\\u002F\\u002Fauctions\.c\.yimg\.jp[^"\\]+\.(?:jpg|jpeg|webp)/i,
        /https:\/\/auctions\.c\.yimg\.jp[^"\\]+\.(?:jpg|jpeg|webp)/i,
        /https:\\\/\\\/auctions\.c\.yimg\.jp[^"]+\.(?:jpg|jpeg|webp)/i,
      ]
      for (const pat of imgPatterns) {
        const m = ndMatch[1].match(pat)
        if (m) {
          const imgUrl = m[0]
            .replace(/\\u002F/g, '/')
            .replace(/\\\//g, '/')
          return NextResponse.json({ imageUrl: imgUrl }, {
            headers: { 'Cache-Control': 'public, max-age=7200, s-maxage=7200' },
          })
        }
      }
    }

    // ─── 3. 生HTML内の yimg.jp 画像 ───
    const rawMatch = html.match(/https:\/\/auctions\.c\.yimg\.jp\/[^\s"']+\.(?:jpg|jpeg|webp)/i)
    if (rawMatch) {
      return NextResponse.json({ imageUrl: rawMatch[0] }, {
        headers: { 'Cache-Control': 'public, max-age=7200, s-maxage=7200' },
      })
    }

    return NextResponse.json({ imageUrl: '' }, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    })
  } catch {
    return NextResponse.json({ imageUrl: '' })
  }
}
