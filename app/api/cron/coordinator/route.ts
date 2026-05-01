// GET /api/cron/coordinator — Supabase接続を1本に削減するコーディネーター
//
// 【2026-04-19 waitUntil 完全廃止】
//   理由: waitUntil() = Vercel Fluid Compute 課金（無料枠 4時間/月）
//         同期処理に変更することで Fluid Compute 課金をゼロに
//
// 【実際の運用】
//   通常: GitHub Actions が scripts/run-check.ts を直接実行（Vercel課金ゼロ）
//   このエンドポイント: 手動テスト・緊急実行用。呼ばれても通常サーバーレス課金のみ。
//
// 【時間計算（同期処理）】
//   Supabase取得: ~2s（通常）
//   シャード処理: 100ユーザー÷8シャード=13人/シャード → 並列30s
//   合計: ~32s < 60s制限 ✅
import { NextRequest, NextResponse } from 'next/server'
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

  // waitUntil 廃止: await で同期処理（通常サーバーレス課金 = GB-hours）
  try {
    await runCoordinator(cronSecret)
  } catch (e) {
    const msg = String(e)
    console.error('[coordinator] エラー:', msg)
    await alertAdmin(`[coordinator] 予期しないエラー: ${msg}`)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }

  return NextResponse.json({ ok: true, mode: 'coordinator' })
}

async function runCoordinator(cronSecret: string): Promise<void> {
  const supabase = getSupabaseAdmin()

  // ユーザーリストを1回だけ取得（Supabase接続 = 1本のみ）
  let allUsers: { id: string }[] | null = null
  let lastErr = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .not('push_sub', 'is', null)
    if (!error && data) { allUsers = data; break }
    lastErr = error?.message ?? String(error)
    console.warn(`[coordinator] ユーザー取得失敗 attempt${attempt + 1}/2: ${lastErr}`)
    if (attempt < 1) await new Promise(r => setTimeout(r, 3_000))
  }

  if (!allUsers) {
    console.error('[coordinator] ユーザー取得失敗（2回試行後）:', lastErr)
    await alertAdmin(`[coordinator] ユーザー取得失敗: ${lastErr}`)
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

  // ユーザーが割り当てられたシャードのみ起動（空シャードはスキップ）
  const activeShards = shardUsers
    .map((ids, shard) => ({ ids, shard }))
    .filter(({ ids }) => ids.length > 0)

  if (activeShards.length === 0) {
    console.log('[coordinator] 全シャードにユーザーなし → スキップ')
    return
  }

  // シャードは同期処理（処理完了後に200を返す）→ 並列実行で最大~30s
  const results = await Promise.allSettled(
    activeShards.map(({ ids, shard }) =>
      fetch(`${APP_URL}/api/cron/check/${shard}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret },
        body:    JSON.stringify({ userIds: ids }),
        signal:  AbortSignal.timeout(50_000),
      })
    )
  )

  const failed = results.filter(r => r.status === 'rejected').length
  if (failed > 0) {
    console.warn(`[coordinator] ${failed}/${activeShards.length} シャードの起動失敗`)
  }
  console.log(`[coordinator] 完了: ${activeShards.length - failed}/${activeShards.length} シャード起動（空シャード${TOTAL_SHARDS - activeShards.length}個スキップ）`)
}
