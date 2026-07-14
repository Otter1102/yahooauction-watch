// GET /api/health — システムヘルスチェックエンドポイント
//
// cron-job.org や外部監視サービスから定期的にポーリングして
// システムが正常に動作しているか確認できます。
//
// レスポンス例（Neon primary で正常時）:
//   { "ok": true, "history": "neon: pong", "notifiedItems": "upstash: PONG",
//     "supabase": "skipped(neon primary)", "ts": "..." }
//
// Neon 未設定時は Supabase をチェックし、繋がらなければ 503 を返す。
import { NextResponse } from 'next/server'
import { describeSupabaseError, getSupabaseAdmin } from '@/lib/supabase'
import { isUpstashNotifiedEnabled, notifiedItemsStoreName, upstashPing } from '@/lib/notified-store'
import { describeNeonError, historyStoreBackend, isNeonEnabled, neonPing } from '@/lib/neon'

export const dynamic = 'force-dynamic'

async function checkSupabase(): Promise<{ text: string; ok: boolean }> {
  try {
    const supabase = getSupabaseAdmin()
    const { error } = await supabase
      .from('users')
      .select('id')
      .limit(1)
      .single()
    if (error && error.code !== 'PGRST116') {
      return { text: `error: ${describeSupabaseError(error)}`, ok: false }
    }
    return { text: 'connected', ok: true }
  } catch (e) {
    return { text: `exception: ${describeSupabaseError(e)}`, ok: false }
  }
}

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

  // Neon が primary のとき Supabase は完全にスキップして良い。
  // notification_history / users / conditions すべて Neon に載っているため、
  // Supabase が dead (egress quota / paused) でも通知は流れ続ける。
  if (isNeonEnabled()) {
    const payload = {
      ok: historyOk,
      history,
      notifiedItems,
      supabase: 'skipped(neon primary)',
      ts,
    }
    return NextResponse.json(payload, { status: historyOk ? 200 : 503 })
  }

  const supa = await checkSupabase()
  const payload = {
    ok: supa.ok,
    supabase: supa.text,
    history,
    notifiedItems,
    ts,
  }
  return NextResponse.json(payload, { status: supa.ok ? 200 : 503 })
}
