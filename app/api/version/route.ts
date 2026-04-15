/**
 * GET /api/version
 *
 * Vercelデプロイのたびに変わるIDを返す。
 * Service Worker がこれを取得して「前回と違う → 新デプロイ」を検出し、
 * 全キャッシュ削除 + クライアントリロードをトリガーする。
 */
export const dynamic = 'force-dynamic'

export function GET() {
  // ?? でなく || を使う: 空文字列("")もフォールバック対象にする
  const deployId =
    process.env.VERCEL_GIT_COMMIT_SHA ||      // Vercel本番: コミットSHA
    process.env.VERCEL_DEPLOYMENT_ID ||        // Vercel: デプロイID
    process.env.NEXT_DEPLOYMENT_ID ||          // Next.js内部ID
    String(Date.now())                         // ローカル開発: タイムスタンプ

  return Response.json(
    { v: deployId },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
