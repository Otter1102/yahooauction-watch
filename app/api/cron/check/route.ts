// GET /api/cron/check — 旧設定からの後方互換ルート（コーディネーター委譲）
//
// 【変更】全Supabase直接クエリを廃止。コーディネーターに委譲することで
// Supabase接続を1本に集中させる。cron-job.orgの設定変更なしで動作する。
//
// shard=0（デフォルト）: コーディネーターを起動して全ユーザーを処理
// shard=1+: no-op（コーディネーターが担当するためスキップ）
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://yahooauction-watch.vercel.app'

export async function GET(req: NextRequest) {
  const auth        = req.headers.get('authorization')
  const querySecret = req.nextUrl.searchParams.get('secret')
  const secret      = process.env.CRON_SECRET?.trim()
  if (secret && auth !== `Bearer ${secret}` && querySecret !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params     = req.nextUrl.searchParams
  const shard      = Math.max(0, parseInt(params.get('shard') ?? '0'))
  const cronSecret = (process.env.CRON_SECRET ?? '').trim()

  if (shard === 0) {
    waitUntil(triggerCoordinatorFromCheck(cronSecret))
    return NextResponse.json({ ok: true, shard: 0, mode: 'coordinator-triggered' })
  }

  // shard1+: no-op（コーディネーターが担当するためスキップ）
  console.log(`[cron/check] shard=${shard} GET受信 → コーディネーター担当のためスキップ`)
  return NextResponse.json({ ok: true, shard, mode: 'skipped-by-coordinator' })
}

async function triggerCoordinatorFromCheck(cronSecret: string): Promise<void> {
  try {
    const res = await fetch(`${APP_URL}/api/cron/coordinator?secret=${encodeURIComponent(cronSecret)}`, {
      signal: AbortSignal.timeout(55_000),
    })
    console.log(`[cron/check] コーディネーター起動: ${res.status}`)
  } catch (e) {
    // アラートは送らない（次のcronで自動リトライ）
    console.error('[cron/check] コーディネーター起動失敗:', String(e))
  }
}
