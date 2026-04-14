/**
 * GET /redirect/[id]  ── オークション直接遷移
 *
 * UA判定により最適な遷移先へ302リダイレクト:
 *   iOS     → ブラウザURL（WKWebView内で表示。設定画面でYahooログインしておけばログイン済み状態）
 *   Android → intent URL（ヤフオクアプリあれば起動、なければブラウザ）
 *   Desktop → ブラウザURL
 *
 * ※ iOS で yahuoku:// を使うと「ページを開けません」が出るため使用しない
 */
import { NextRequest, NextResponse } from 'next/server'
import { isValidAuctionId, toAuctionBrowserUrl, toAndroidIntentUrl, detectPlatform } from '@/lib/deeplink'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = params.id ?? ''

  if (!isValidAuctionId(id)) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  const ua = req.headers.get('user-agent') ?? ''
  const platform = detectPlatform(ua)

  if (platform === 'android') {
    // Android: intent URL → ヤフオクアプリ起動 or ブラウザフォールバック
    return NextResponse.redirect(toAndroidIntentUrl(id), { status: 302 })
  }

  // iOS / Desktop: ブラウザURL（WKWebView内 or Safari。事前ログイン済みであれば認証不要）
  return NextResponse.redirect(toAuctionBrowserUrl(id), { status: 302 })
}
