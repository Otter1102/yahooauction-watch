// GET /api/cron/check — 全ユーザー自動チェック（シャードなし・後方互換）
// GET /api/cron/check/[0-3] — シャード専用エンドポイント（推奨）
//
// ── cron-job.org 推奨設定（4シャード・100人対応）──
//   通知間隔: 1時間に1回（毎正時）
//   job0: /api/cron/check/0?secret=xxx  毎時 :00
//   job1: /api/cron/check/1?secret=xxx  毎時 :02
//   job2: /api/cron/check/2?secret=xxx  毎時 :05
//   job3: /api/cron/check/3?secret=xxx  毎時 :07
//
// ── 監視設定（.env に追加）──
//   DISCORD_ADMIN_WEBHOOK  = Discord webhook URL（エラー時にアラート）
//   HEALTHCHECK_PING_URL   = healthchecks.io の ping URL（成功時にping）
//
// ── スケーリング設計 ──
//   CONCURRENCY=25, USER_TIMEOUT_MS=20s
//   1シャード = 最大50ユーザー → 2バッチ×20s = 40s < 60s制限
//   4シャード合計 = 最大200ユーザー対応
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getSupabaseAdmin } from '@/lib/supabase'
import { cleanupOldNotified, cleanupOldHistory, resetStalledNotified } from '@/lib/storage'
import { checkAuctionEnded } from '@/lib/scraper'

const APP_URL         = process.env.NEXT_PUBLIC_APP_URL ?? 'https://yahooauction-watch.vercel.app'
const CONCURRENCY     = 25   // 25ユーザーを1バッチで並列処理
const USER_TIMEOUT_MS = 30_000  // 30条件×並列フェッチ=12s + 通知 < 30s

function getUserShard(userId: string, totalShards: number): number {
  const hex = userId.replace(/-/g, '').slice(-4)
  return parseInt(hex, 16) % totalShards
}

// ── 管理者Discord通知 ───────────────────────────────────────────────────────
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

// ── healthchecks.io ping（成功時に呼ぶ）─────────────────────────────────────
async function pingHealthcheck(): Promise<void> {
  const url = process.env.HEALTHCHECK_PING_URL
  if (!url) return
  try {
    await fetch(url, { signal: AbortSignal.timeout(5_000) })
  } catch { /* ping失敗は無視 */ }
}

// ── メインハンドラ ────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth        = req.headers.get('authorization')
  const querySecret = req.nextUrl.searchParams.get('secret')
  const secret      = process.env.CRON_SECRET?.trim()
  if (secret && auth !== `Bearer ${secret}` && querySecret !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params      = req.nextUrl.searchParams
  const shard       = Math.max(0, parseInt(params.get('shard')        ?? '0'))
  const totalShards = Math.max(1, parseInt(params.get('total_shards') ?? '1'))
  const cronSecret  = (process.env.CRON_SECRET ?? '').trim()

  // 認証通過後すぐ200を返し、全処理をバックグラウンドで実行
  waitUntil(runCronJob(shard, totalShards, cronSecret))
  return NextResponse.json({ ok: true, started: true, shard, totalShards })
}

// ── バックグラウンド処理 ──────────────────────────────────────────────────────
async function runCronJob(shard: number, totalShards: number, cronSecret: string): Promise<void> {
  try {
    // シャードの起動タイミングをずらしてSupabase接続負荷を分散
    // 理由: 複数シャードが同時起動するとSupabaseへの同時接続が集中し20秒超えのタイムアウトが多発
    //       shard0: 0ms, shard1: 1000ms, shard2: 2000ms, ..., shard7: 7000ms
    if (shard > 0) await new Promise(r => setTimeout(r, shard * 1000))

    const supabase = getSupabaseAdmin()

    // ユーザー取得: タイムアウト・一時障害時は2回試行（リトライ1回）
    // 理由: 3回試行（20秒×3 + 2秒×2 = 64秒）はmaxDuration(60秒)を超えてwaitUntilが強制終了される
    //       shard×0.6s + 20秒×2 + 3秒 = 最大47.2秒 < 60秒 ✅
    let allUsers: { id: string }[] | null = null
    let lastErrMsg = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await supabase
        .from('users')
        .select('id')
        .not('push_sub', 'is', null)
      if (!error && data) { allUsers = data; break }
      lastErrMsg = error?.message ?? String(error)
      console.warn(`[cron] ユーザー取得失敗 attempt${attempt + 1}/2: ${lastErrMsg}`)
      if (attempt < 1) await new Promise(r => setTimeout(r, 3_000))
    }
    if (!allUsers) {
      console.error('[cron] ユーザー取得エラー（2回試行後）:', lastErrMsg)
      await alertAdmin(`ユーザー取得失敗: ${lastErrMsg}`)
      return
    }
    if (!allUsers.length) {
      console.log('[cron] 処理対象ユーザーなし')
      return
    }

    const users = totalShards === 1
      ? allUsers
      : allUsers.filter(u => getUserShard(u.id, totalShards) === shard)

    const isMainShard = shard === 0
    await processUsers(users, APP_URL, cronSecret, isMainShard)

    // 成功時: healthchecks.io に ping（シャード0のみ・重複ping防止）
    if (isMainShard || totalShards === 1) await pingHealthcheck()

  } catch (e) {
    const msg = String(e)
    console.error('[cron] runCronJob エラー:', msg)
    await alertAdmin(`cron処理で予期しないエラー: ${msg}`)
  }
}

async function processUsers(
  users: { id: string }[],
  appUrl: string,
  cronSecret: string,
  runCleanup: boolean,
): Promise<void> {
  let totalNotified = 0
  let totalErrors   = 0

  for (let i = 0; i < users.length; i += CONCURRENCY) {
    const batch = users.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(async (user) => {
        try {
          const res = await fetch(`${appUrl}/api/run-now`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret },
            body:    JSON.stringify({ userId: user.id }),
            signal:  AbortSignal.timeout(USER_TIMEOUT_MS),
          })
          if (!res.ok) return 0
          const data = await res.json()
          return (data.notified as number) ?? 0
        } catch {
          return -1  // -1 = エラーのマーカー
        }
      })
    )
    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value < 0) totalErrors++
        else totalNotified += r.value
      }
    }
  }

  console.log(`[cron] checked ${users.length} users, notified ${totalNotified}, errors ${totalErrors}`)

  // エラー率が50%超でアラート
  if (users.length > 0 && totalErrors / users.length > 0.5) {
    await alertAdmin(`通知処理エラー多発: ${totalErrors}/${users.length} ユーザーで失敗`)
  }

  if (!runCleanup) {
    console.log('[cron] クリーンアップはメインシャードに委譲')
    return
  }

  await cleanupOldNotified()
  console.log('[cron] cleanupOldNotified 完了')
  await cleanupOldHistory()
  console.log('[cron] cleanupOldHistory 完了')
  await cleanupEndedAuctionsFromHistory()
  console.log('[cron] cleanupEndedAuctions 完了')

  try {
    const stalledUsers = await resetStalledNotified()
    if (stalledUsers.length > 0) {
      console.log(`[cron] 自己修復: ${stalledUsers.length}ユーザーの通知ログをリセット`)
    }
  } catch (e) {
    console.error('[cron] 自己修復エラー（無視）:', String(e))
  }
}

async function cleanupEndedAuctionsFromHistory(): Promise<void> {
  const supabase = getSupabaseAdmin()
  const now = Date.now()

  // ハードカットオフ: 25時間超は Yahoo確認なしで即削除（確実に終了済み）
  const hardCutoff = new Date(now - 25 * 60 * 60 * 1000).toISOString()
  await supabase.from('notification_history').delete().lt('notified_at', hardCutoff)
  await supabase.from('notified_items').delete().lt('notified_at', hardCutoff)

  const softCutoff = new Date(now - 60 * 1000).toISOString()
  const { data: items } = await supabase
    .from('notification_history')
    .select('id, auction_id, user_id')
    .lt('notified_at', softCutoff)
    .gte('notified_at', hardCutoff)
    .limit(20)

  if (!items?.length) return

  const toDeleteHistoryIds: string[] = []
  const toDeleteNotified: Array<{ userId: string; auctionId: string }> = []
  const BATCH = 5
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH)
    const results = await Promise.allSettled(
      chunk.map(item => checkAuctionEnded(item.auction_id as string))
    )
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled' && r.value) {
        toDeleteHistoryIds.push(chunk[idx].id as string)
        toDeleteNotified.push({ userId: chunk[idx].user_id as string, auctionId: chunk[idx].auction_id as string })
      }
    })
  }

  if (toDeleteHistoryIds.length === 0) return
  await supabase.from('notification_history').delete().in('id', toDeleteHistoryIds)
  for (const { userId, auctionId } of toDeleteNotified) {
    await supabase.from('notified_items').delete()
      .eq('user_id', userId).eq('auction_id', auctionId)
  }
  console.log(`[cron] 終了オークション ${toDeleteHistoryIds.length}件を削除`)
}
