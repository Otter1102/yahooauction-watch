// GET /api/health — システムヘルスチェックエンドポイント
//
// cron-job.org や外部監視サービスから定期的にポーリングして
// システムが正常に動作しているか確認できます。
//
// レスポンス例（正常時）:
//   { "ok": true, "supabase": "connected", "ts": "2026-04-11T..." }
//
// レスポンス例（異常時）:
//   { "ok": false, "supabase": "error: ...", "ts": "..." }
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ts = new Date().toISOString()
  try {
    // Supabase への接続確認（usersテーブルを1件だけ取得）
    const supabase = getSupabaseAdmin()
    const { error } = await supabase
      .from('users')
      .select('id')
      .limit(1)
      .single()

    // "PGRST116" = 0件ヒット（正常）、それ以外はエラー
    if (error && error.code !== 'PGRST116') {
      return NextResponse.json(
        { ok: false, supabase: `error: ${error.message}`, ts },
        { status: 503 }
      )
    }

    return NextResponse.json({ ok: true, supabase: 'connected', ts })
  } catch (e) {
    return NextResponse.json(
      { ok: false, supabase: `exception: ${String(e)}`, ts },
      { status: 503 }
    )
  }
}
