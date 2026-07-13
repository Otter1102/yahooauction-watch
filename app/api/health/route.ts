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
import { describeSupabaseError, getSupabaseAdmin } from '@/lib/supabase'
import { isUpstashNotifiedEnabled, notifiedItemsStoreName, upstashPing } from '@/lib/notified-store'
import { describeNeonError, historyStoreBackend, isNeonEnabled, neonPing } from '@/lib/neon'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ts = new Date().toISOString()
  const notifiedStore = notifiedItemsStoreName()
  let notifiedItems = notifiedStore === 'upstash' ? 'upstash: configured' : 'supabase'
  if (isUpstashNotifiedEnabled()) {
    try {
      notifiedItems = `upstash: ${await upstashPing()}`
    } catch (e) {
      notifiedItems = `upstash error: ${describeSupabaseError(e)}`
    }
  }

  const historyBackend = historyStoreBackend()
  let history: string = historyBackend
  let historyOk = true
  if (isNeonEnabled()) {
    try {
      history = `neon: ${await neonPing()}`
    } catch (e) {
      history = `neon error: ${describeNeonError(e)}`
      historyOk = false
    }
  }

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
        { ok: false, supabase: `error: ${describeSupabaseError(error)}`, notifiedItems, history, ts },
        { status: 503 }
      )
    }

    if (!historyOk) {
      return NextResponse.json(
        { ok: false, supabase: 'connected', notifiedItems, history, ts },
        { status: 503 }
      )
    }

    return NextResponse.json({ ok: true, supabase: 'connected', notifiedItems, history, ts })
  } catch (e) {
    return NextResponse.json(
      { ok: false, supabase: `exception: ${describeSupabaseError(e)}`, notifiedItems, history, ts },
      { status: 503 }
    )
  }
}
