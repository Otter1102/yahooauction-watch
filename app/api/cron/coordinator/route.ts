// POST/GET /api/cron/coordinator — Supabase接続を1本に削減するコーディネーター
//
// 【問題の根本原因】
//   cron-job.org が shard0〜7 を同時に発火 → 8接続が Supabase に集中
//   → 無料プランの共有インフラでキューが詰まる → 20秒超でタイムアウト
//
// 【解決策】
//   このエンドポイントを cron-job.org の唯一のジョブにする。
//   ユーザーリストを1回だけ Supabase から取得し、
//   8シャードにユーザーIDを振り分けて /api/cron/check/[shard] を並列起動する。
//   各シャードは Supabase を触らず渡された userIds だけを処理する。
//
// 【cron-job.org 設定変更手順】
//   1. 旧 shard0〜7 の8ジョブを削除（または停止）
//   2. 新しく1ジョブだけ追加:
//        URL: https://yahooauction-watch.vercel.app/api/cron/coordinator?secret=xxx
//        間隔: 毎10分
//
// 【時間計算】
//   ユーザー取得: 20s×2 + 3s = 43s (worst case) < 60s ✅
//   シャード起動: <1s (各シャードは即200返却してwaitUntilで非同期処理)
//   合計: ~44s < 60s ✅
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getSupabaseAdmin } from '@/lib/supabase'

const APP_URL      = process.env.NEXT_PUBLIC_APP_URL ?? 'https://yahooauction-watch.vercel.app'
const TOTAL_SHARDS = 8

function getUserShard(userId: string): number {
  const hex = userId.replace(/-/g, '').slice(-4)
  return parseInt(hex, 16) % TOTAL_SHARDS
}

async function alertAdmin(message: string): Promise<void> {
  const webhook = process.env.DISCORD_ADMIN_WEBHOOK
  if (!webhook) return
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `🚨 **ヤフオクwatch エラー**\n${message}` }),
      signal: AbortSignal.timeout(5_000),
    })
  } catch { /* アラート失敗は無視 */ }
}

export async function GET(req: NextRequest) {
  const auth        = req.headers.get('authorization')
  const querySecret = req.nextUrl.searchParams.get('secret')
  const secret      = process.env.CRON_SECRET?.trim()
  if (secret && auth !== `Bearer ${secret}` && querySecret !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const cronSecret = (process.env.CRON_SECRET ?? '').trim()
  waitUntil(runCoordinator(cronSecret))
  return NextResponse.json({ ok: true, started: true, mode: 'coordinator' })
}

async function runCoordinator(cronSecret: string): Promise<void> {
  const supabase = getSupabaseAdmin()

  // ユーザーリストを1回だけ取得（Supabase接続 = 1本のみ）
  // 競合なしなので通常は即時成功。2回試行で安全性確保
  // フィルターなしで全ユーザーIDを取得（.or()は遅い→削除）
  // run-now側で通知先チェックを行うため全件取得で問題なし
  let allUsers: { id: string }[] | null = null
  let lastErr = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .from('users')
      .select('id')
    if (!error && data) { allUsers = data; break }
    lastErr = error?.message ?? String(error)
    console.warn(`[coordinator] ユーザー取得失敗 attempt${attempt + 1}/3: ${lastErr}`)
    // 指数バックオフ: 3s → 8s
    if (attempt < 2) await new Promise(r => setTimeout(r, attempt === 0 ? 3_000 : 8_000))
  }

  if (!allUsers) {
    // Discordアラートは送らない（次のcronで自動リトライするため・スパム防止）
    console.error('[coordinator] ユーザー取得失敗（3回試行後、次のcronまで待機）:', lastErr)
    return
  }
  if (!allUsers.length) {
    console.log('[coordinator] 処理対象ユーザーなし')
    return
  }

  // ユーザーをシャードごとに振り分け
  const shardUsers: string[][] = Array.from({ length: TOTAL_SHARDS }, () => [])
  for (const user of allUsers) {
    shardUsers[getUserShard(user.id)].push(user.id)
  }
  console.log(`[coordinator] 総ユーザー${allUsers.length}人 → ${TOTAL_SHARDS}シャードに配布:`, shardUsers.map(s => s.length))

  // 全シャードを並列起動（各シャードは渡されたuserIdsを処理するのでSupabase不要）
  // 各シャードは即200を返してwaitUntilで非同期処理するため、ここの待機は短い
  const results = await Promise.allSettled(
    shardUsers.map((ids, shard) =>
      fetch(`${APP_URL}/api/cron/check/${shard}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret },
        body:    JSON.stringify({ userIds: ids }),
        signal:  AbortSignal.timeout(10_000),
      })
    )
  )

  const failed = results.filter(r => r.status === 'rejected').length
  if (failed > 0) {
    console.warn(`[coordinator] ${failed}/${TOTAL_SHARDS} シャードの起動失敗`)
  }
  console.log(`[coordinator] 完了: ${TOTAL_SHARDS - failed}/${TOTAL_SHARDS} シャード起動`)
}
