/**
 * GET /open?url=<encoded>  ── 通知タップ中継ルート
 *
 * 優先順位:
 *   1. yahuoku:// URLスキームでアプリ直起動（iOS/Android共通）
 *   2. IDが取れなければそのままブラウザ版へ302リダイレクト
 *
 * iOS PWA (WKWebView):
 *   - JS自動遷移はブロックされるため、大きなボタンをメインに配置
 *   - href に yahuoku:// をセット → ユーザーのタップで起動
 *
 * Android:
 *   - JS で yahuoku:// を自動発火 → 2.5秒後にフォールバックボタン表示
 */
import { NextRequest, NextResponse } from 'next/server'

/** HTML属性（href）に安全に埋め込めるようエスケープ */
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * ヤフオクURLからオークションIDを抽出してURLスキームに変換
 *
 * 対応URL例:
 *   https://page.auctions.yahoo.co.jp/jp/auction/v1234567890
 *   https://auctions.yahoo.co.jp/auction/v1234567890
 *   https://page.auctions.yahoo.co.jp/jp/auction/v1234567890?...
 *
 * → yahuoku://jp.yahoo.auctions.item/v1/auction?id=v1234567890
 *
 * ヤフオクIDは英小文字+数字のみ（例: v1234567890, x987654321）
 * new URL() でパスのみ取得してからマッチするため、クエリ文字列混入なし
 */
function toYahuokuScheme(url: string): string | null {
  try {
    // どちらのドメインでも pathname は /jp/auction/{id} または /auction/{id}
    const { pathname } = new URL(url)
    const match = pathname.match(/\/auction\/([a-z][a-z0-9]*)/)
    if (!match || !match[1]) return null
    return `yahuoku://jp.yahoo.auctions.item/v1/auction?id=${match[1]}`
  } catch {
    return null
  }
}

/** Yahoo auction URL を page. → auctions. に正規化 */
function normalizeYahooUrl(url: string): string {
  return url.replace('//page.auctions.yahoo.co.jp', '//auctions.yahoo.co.jp')
}

export async function GET(req: NextRequest) {
  const rawUrl   = req.nextUrl.searchParams.get('url') ?? ''
  const debugMode = req.nextUrl.searchParams.get('debug')  // '1' | 'json' | null
  const ua       = req.headers.get('user-agent') ?? ''

  const isAndroid = /Android/i.test(ua)
  const isIOS     = /iPhone|iPad|iPod/.test(ua)
  const isYahoo   = /(?:page\.auctions|auctions)\.yahoo\.co\.jp/.test(rawUrl)

  // ── URL バリデーション ────────────────────────────────────────────
  let browserUrl: string
  let urlParseError = ''
  try {
    const parsed = new URL(rawUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol')
    browserUrl = isYahoo ? normalizeYahooUrl(rawUrl) : rawUrl
  } catch (e) {
    urlParseError = String(e)
    browserUrl = ''
  }

  const scheme = rawUrl ? toYahuokuScheme(rawUrl) : null

  // ── ?debug=json → テキストでパース結果を返す（iPhone実機デバッグ用） ──
  if (debugMode === 'json') {
    const info = {
      rawUrl,
      browserUrl,
      scheme,
      isIOS,
      isAndroid,
      isYahoo,
      urlParseError: urlParseError || null,
      ua: ua.slice(0, 120),
    }
    return new NextResponse(JSON.stringify(info, null, 2), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

  // ── バリデーション失敗 ─────────────────────────────────────────────
  if (!browserUrl) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  // ── ヤフオク以外: 許可ドメインのみ302リダイレクト（Open Redirect対策）──
  const ALLOWED_HOSTS = new Set(['auctions.yahoo.co.jp', 'page.auctions.yahoo.co.jp'])
  if (!isYahoo) {
    try {
      const host = new URL(browserUrl).hostname
      if (!ALLOWED_HOSTS.has(host)) return NextResponse.redirect(new URL('/', req.url))
    } catch {
      return NextResponse.redirect(new URL('/', req.url))
    }
    return NextResponse.redirect(browserUrl, { status: 302 })
  }

  // IDが取れなかった → そのままブラウザ版へ（白画面・エラー防止）
  if (!scheme) {
    return NextResponse.redirect(browserUrl, { status: 302 })
  }

  const debug = debugMode === '1'

  const schemeEsc  = escHtml(scheme)        // href 用
  const browserEsc = escHtml(browserUrl)    // href 用
  const jsScheme   = JSON.stringify(scheme) // JS文脈
  const debugBlock = debug
    ? `<div style="background:rgba(255,255,0,.12);border:1px solid rgba(255,255,0,.4);border-radius:10px;padding:12px 14px;word-break:break-all;font-size:11px;color:#ffe066;line-height:1.7;max-width:340px;text-align:left">
        <b>🐛 DEBUG</b><br>
        <b>scheme:</b> ${schemeEsc}<br>
        <b>browser:</b> ${browserEsc}
       </div>`
    : ''

  // ── iOS ──────────────────────────────────────────────────────────
  // Safari（SFSafariViewController）でブラウザページを直接開く。
  // #safari フラグメントを付与することで AASA Universal Links を不発火にし、
  // ヤフオクアプリが起動しないようにする（iOS の仕様どおり動作）。
  if (isIOS) {
    const auctionIdM = rawUrl.match(/\/auction\/([a-zA-Z][a-zA-Z0-9]*)/)
    const safariUrl  = auctionIdM
      ? `https://page.auctions.yahoo.co.jp/jp/auction/${auctionIdM[1]}#safari`
      : browserUrl
    return NextResponse.redirect(safariUrl, { status: 302 })
  }

  // ── Android ───────────────────────────────────────────────────────
  // JS で自動起動 → 2.5秒後にフォールバックボタン表示
  if (isAndroid) {
    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ヤフオクを開く</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  background:#071220;
  min-height:100dvh;
  display:flex;flex-direction:column;
  align-items:center;justify-content:center;
  gap:20px;
  font-family:-apple-system,sans-serif;
  padding:24px 28px;text-align:center;
}
.s{width:44px;height:44px;border:3px solid rgba(255,255,255,.1);border-top-color:#27b5d4;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.sub{color:rgba(255,255,255,.5);font-size:13px}
#fb{display:none;flex-direction:column;align-items:center;gap:12px;width:100%}
.btn-main{
  display:flex;align-items:center;justify-content:center;gap:8px;
  width:100%;max-width:300px;height:56px;
  border-radius:28px;
  background:linear-gradient(135deg,#7B0099,#FF0033);
  color:white;font-weight:800;font-size:17px;text-decoration:none;
}
.btn-sub{color:rgba(255,255,255,.35);font-size:12px;text-decoration:underline}
.btn-back{
  position:fixed;top:16px;left:16px;
  display:flex;align-items:center;gap:6px;
  color:rgba(255,255,255,.6);font-size:14px;font-weight:600;
  background:rgba(255,255,255,.08);border:none;
  border-radius:20px;padding:8px 16px 8px 12px;
  cursor:pointer;-webkit-tap-highlight-color:transparent;
  text-decoration:none;
}
</style>
<script>
var scheme=${jsScheme};
if(location.hostname==='localhost'){alert('[DEBUG] scheme: '+scheme)}
window.location.href=scheme;
setTimeout(function(){document.getElementById('fb').style.display='flex'},2500);
</script>
</head>
<body>
<button class="btn-back" onclick="history.length > 1 ? history.back() : location.href='/history'">‹ 戻る</button>
${debugBlock}
<div class="s"></div>
<p class="sub">ヤフオクアプリを開いています...</p>
<div id="fb">
  <a class="btn-main" href="${schemeEsc}">アプリを起動する</a>
  <a class="btn-sub" href="${browserEsc}" target="_blank" rel="noreferrer">開かない場合はこちら（ブラウザ版）</a>
</div>
</body>
</html>`

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

  // ── その他（デスクトップ等）: ブラウザ版へ302 ─────────────────────
  return NextResponse.redirect(browserUrl, { status: 302 })
}
