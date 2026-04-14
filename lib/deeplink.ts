/**
 * DeepLinkSkill — PWA向けディープリンク自動判定ユーティリティ
 *
 * 「アプリがあればアプリ、なければブラウザ、PCならブラウザ」を実装する
 * ヤフオクPWA専用だが、他アプリへの応用を想定して関数分離している。
 *
 * 使い方:
 *   import { resolveDeepLink } from '@/packages/skills-templates/pwa/deeplink'
 *   const result = resolveDeepLink({ auctionId: 'v1234567890', ua: req.headers.get('user-agent') ?? '' })
 */

export type Platform = 'ios' | 'android' | 'desktop'
export type DeepLinkResult =
  | { type: 'app'; scheme: string; intentUrl?: string; fallback: string; platform: 'ios' | 'android' }
  | { type: 'browser'; url: string; platform: Platform }

/** User-Agent文字列からプラットフォームを判定 */
export function detectPlatform(ua: string): Platform {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

/**
 * オークションIDが有効な形式か検証
 * ヤフオクID: 先頭英字 + 英数字3〜20文字
 */
export function isValidAuctionId(id: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9]{3,20}$/.test(id)
}

/**
 * オークションIDからヤフオクURLスキームを生成
 * → yahuoku://item?id={id}
 * バンドルID: jp.co.yahoo.ios.yahuoku
 * ※ host-path形式（jp.yahoo.auctions.item/v1/...）は未登録のため使用しない
 */
export function toYahuokuScheme(auctionId: string): string {
  return `yahuoku://item?id=${auctionId}`
}

/**
 * オークションIDからブラウザ用URLを生成
 * ※ auctions.yahoo.co.jp/auction/{id} は404になるため page.auctions.yahoo.co.jp を使用
 * ※ #safari フラグメントを付与することで iOS AASA パスマッチングを回避
 *    → Universal Links 不発火 → Safari で開く（Yahoo Auction アプリが起動しない）
 *    iOS の AASA paths マッチはフラグメント（#）を含まないため、この挙動は仕様どおり
 */
export function toAuctionBrowserUrl(auctionId: string): string {
  return `https://page.auctions.yahoo.co.jp/jp/auction/${auctionId}#safari`
}

/**
 * Android Intent URL を生成
 * jp.co.yahoo.android.yauction パッケージが入っていれば直接アプリが開く
 * 未インストールの場合はブラウザ版へフォールバック
 */
export function toAndroidIntentUrl(auctionId: string): string {
  const fallbackEncoded = encodeURIComponent(`https://page.auctions.yahoo.co.jp/jp/auction/${auctionId}`)
  return `intent://page.auctions.yahoo.co.jp/jp/auction/${auctionId}#Intent;scheme=https;package=jp.co.yahoo.android.yauction;S.browser_fallback_url=${fallbackEncoded};end`
}

/**
 * メイン関数: auctionId + UA → どこへ飛ぶかを返す
 *
 * @returns
 *   { type: 'app', scheme, fallback, platform }  iOS/Android でアプリが存在する可能性
 *   { type: 'browser', url, platform }            PC or フォールバック
 */
export function resolveDeepLink(params: {
  auctionId: string
  ua: string
}): DeepLinkResult {
  const { auctionId, ua } = params
  const platform = detectPlatform(ua)
  const browserUrl = toAuctionBrowserUrl(auctionId)

  if (platform === 'desktop') {
    return { type: 'browser', url: browserUrl, platform }
  }

  return {
    type: 'app',
    scheme: toYahuokuScheme(auctionId),
    intentUrl: platform === 'android' ? toAndroidIntentUrl(auctionId) : undefined,
    fallback: browserUrl,
    platform,
  }
}

/** HTML属性に安全に埋め込めるようエスケープ */
export function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
