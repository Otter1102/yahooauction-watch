// GET /api/cron/check/[shard] — シャード番号をURLパスで指定する便利エンドポイント
//
// cron-job.org 設定（8シャード・200人対応）:
//   job0: /api/cron/check/0?secret=xxx  毎10分 :00
//   job1: /api/cron/check/1?secret=xxx  毎10分 :01
//   job2: /api/cron/check/2?secret=xxx  毎10分 :02
//   job3: /api/cron/check/3?secret=xxx  毎10分 :03
//   job4: /api/cron/check/4?secret=xxx  毎10分 :04
//   job5: /api/cron/check/5?secret=xxx  毎10分 :05
//   job6: /api/cron/check/6?secret=xxx  毎10分 :06
//   job7: /api/cron/check/7?secret=xxx  毎10分 :07
//
// スケーリング計算:
//   TOTAL_SHARDS=8: 200ユーザー ÷ 8 = 25ユーザー/シャード
//   CONCURRENCY=25: 25ユーザーを1バッチで並列処理 → バッチ数=1
//   USER_TIMEOUT_MS=30s: 1バッチ × 30s = 30s << Vercel 60s制限
//   run-now側: CONDITION_CONCURRENCY=5 → 30条件 ÷ 5 = 6バッチ × 2s = 12s << 30s
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getSupabaseAdmin } from '@/lib/supabase'
import { resetStalledNotified } from '@/lib/storage'
import { checkAuctionEnded } from '@/lib/scraper'

const APP_URL         = process.env.NEXT_PUBLIC_APP_URL ?? 'https://yahooauction-watch.vercel.app'
const CONCURRENCY     = 25   // 25ユーザーを1バッチで並列処理
const USER_TIMEOUT_MS = 50_000  // 30条件÷5並列=6バッチ×8s(FETCH_TIMEOUT)=48s < 50s。cron simpleCount除外で実現
const TOTAL_SHARDS    = 8   // 200ユーザー ÷ 8 = 25ユーザー/シャード

function getUserShard(userId: string, totalShards: number): number {
  const hex = userId.replace(/-/g, '').slice(-4)
  return parseInt(hex, 16) % totalShards
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

async function pingHealthcheck(shard: number): Promise<void> {
  // シャード0のみpingしてhealthchecks.ioの重複カウントを防ぐ
  if (shard !== 0) return
  const url = process.env.HEALTHCHECK_PING_URL
  if (!url) return
  try {
    await fetch(url, { signal: AbortSignal.timeout(5_000) })
    console.log('[cron] healthchecks.io ping 送信')
  } catch { /* ping失敗は無視 */ }
}

// ── POST: コーディネーター(/api/cron/coordinator)から呼ばれる ───────────────
// 事前に振り分けられたuserIdsを受け取り、Supabase接続なしで処理する
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ shard: string }> }
) {
  const headerSecret = req.headers.get('x-cron-secret') ?? ''
  const envSecret    = (process.env.CRON_SECRET ?? '').trim()
  if (envSecret && headerSecret !== envSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { shard: shardParam } = await params
  const shard = parseInt(shardParam ?? '0', 10)
  if (isNaN(shard) || shard < 0 || shard >= TOTAL_SHARDS) {
    return NextResponse.json({ error: `shard は 0〜${TOTAL_SHARDS - 1} で指定` }, { status: 400 })
  }

  const { userIds } = await req.json() as { userIds: string[] }
  const cronSecret  = envSecret

  // Supabase不要: コーディネーターが既に取得・振り分け済み
  waitUntil(runShardWithUsers(shard, userIds, cronSecret))
  return NextResponse.json({ ok: true, started: true, shard, userCount: userIds.length })
}

async function runShardWithUsers(shard: number, userIds: string[], cronSecret: string): Promise<void> {
  try {
    const users = userIds.map(id => ({ id }))
    console.log(`[cron/shard${shard}] コーディネーターから${users.length}人受信`)
    await processUsers(users, shard, cronSecret)
    await pingHealthcheck(shard)
  } catch (e) {
    const msg = String(e)
    console.error(`[cron/shard${shard}] エラー:`, msg)
    await alertAdmin(`[shard${shard}] 予期しないエラー: ${msg}`)
  }
}

// ── GET: cron-job.org の旧設定（shard0〜7 を直接呼ぶ）への対応 ──────────────
//
// 【問題】cron-job.org が shard0〜7 を同時発火 → 8接続がSupabaseに集中 → タイムアウト
// 【解決】shard0 のみコーディネーターを起動し、shard1-7 は即座にno-op で返す。
//         コーディネーターが全ユーザーを1接続で取得し、各シャードにPOSTで配布する。
//         → Supabase接続は常に1本のみ（cron-job.org の設定変更なしで解決）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ shard: string }> }
) {
  const auth        = req.headers.get('authorization')
  const querySecret = req.nextUrl.searchParams.get('secret')
  const secret      = process.env.CRON_SECRET?.trim()
  if (secret && auth !== `Bearer ${secret}` && querySecret !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { shard: shardParam } = await params
  const shard = parseInt(shardParam ?? '0', 10)
  if (isNaN(shard) || shard < 0 || shard >= TOTAL_SHARDS) {
    return NextResponse.json({ error: `shard は 0〜${TOTAL_SHARDS - 1} で指定` }, { status: 400 })
  }

  // shard0 だけコーディネーターを起動して全シャードを処理する
  // shard1-7 は即座にno-op（コーディネーターが担当するため）
  if (shard === 0) {
    const cronSecret = (process.env.CRON_SECRET ?? '').trim()
    waitUntil(triggerCoordinator(cronSecret))
    return NextResponse.json({ ok: true, shard: 0, mode: 'coordinator-triggered' })
  }

  // shard1-7: no-op（コーディネーター経由で処理済み）
  console.log(`[cron/shard${shard}] GET受信 → コーディネーター担当のためスキップ`)
  return NextResponse.json({ ok: true, shard, mode: 'skipped-by-coordinator' })
}

async function triggerCoordinator(cronSecret: string): Promise<void> {
  try {
    const res = await fetch(`${APP_URL}/api/cron/coordinator?secret=${encodeURIComponent(cronSecret)}`, {
      signal: AbortSignal.timeout(55_000),
    })
    console.log(`[shard0/GET] コーディネーター起動: ${res.status}`)
  } catch (e) {
    const msg = String(e)
    console.error('[shard0/GET] コーディネーター起動失敗:', msg)
    await alertAdmin(`[shard0] コーディネーター起動失敗: ${msg}`)
  }
}

async function processUsers(
  users: { id: string }[],
  shard: number,
  cronSecret: string,
): Promise<void> {
  let totalNotified = 0
  let totalErrors   = 0

  for (let i = 0; i < users.length; i += CONCURRENCY) {
    const batch = users.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(async (user) => {
        try {
          const res = await fetch(`${APP_URL}/api/run-now`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret },
            body:    JSON.stringify({ userId: user.id }),
            signal:  AbortSignal.timeout(USER_TIMEOUT_MS),
          })
          if (!res.ok) return 0
          const data = await res.json()
          return (data.notified as number) ?? 0
        } catch {
          return -1
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

  console.log(`[cron/shard${shard}] checked ${users.length} users, notified ${totalNotified}, errors ${totalErrors}`)

  if (users.length > 0 && totalErrors / users.length > 0.5) {
    await alertAdmin(`[shard${shard}] エラー多発: ${totalErrors}/${users.length} ユーザーで失敗`)
  }

  // クリーンアップはshard0のみ
  if (shard !== 0) return

  // cleanupEndedAuctions が 25h ハードカットオフ＋終了確認を一括処理するため
  // 旧 cleanupOldNotified / cleanupOldHistory は呼ばない（重複・矛盾）
  await cleanupEndedAuctions()

  try {
    const stalled = await resetStalledNotified()
    if (stalled.length > 0) console.log(`[cron/shard0] 自己修復: ${stalled.length}ユーザーをリセット`)
  } catch (e) {
    console.error('[cron/shard0] 自己修復エラー（無視）:', String(e))
  }
}

/**
 * 終了オークション一括クリーンアップ（shard0 の毎cron実行）
 *
 * ① ハードカットオフ（25h超）: Yahoo確認なしで即削除（確実に終了済み）
 *    → notification_history と notified_items を並列削除
 * ② ソフトチェック（1分〜25h）: Yahoo確認し終了済みのみ削除
 *    → 50件/cron を 10並列でチェック → 両テーブルを並列削除
 *
 * 設計方針:
 *   - オークション終了・落札確定の瞬間にデータを消す（TTL待ちしない）
 *   - notified_items の残留が「新着が通知されない」バグの根本原因 → 即削除で防止
 *   - cleanupOldNotified / cleanupOldHistory は呼ばない（このロジックで包含済み）
 */
async function cleanupEndedAuctions(): Promise<void> {
  const supabase = getSupabaseAdmin()
  const now = Date.now()
  const hardCutoff = new Date(now - 25 * 60 * 60 * 1000).toISOString()

  // ① 25h超は無条件削除（並列）
  await Promise.all([
    supabase.from('notification_history').delete().lt('notified_at', hardCutoff),
    supabase.from('notified_items').delete().lt('notified_at', hardCutoff),
  ])

  // ② 1分〜25h: Yahoo確認して終了済みのみ削除
  const softCutoff = new Date(now - 60 * 1000).toISOString()
  const { data: items } = await supabase
    .from('notification_history')
    .select('id, auction_id, user_id')
    .lt('notified_at', softCutoff)
    .gte('notified_at', hardCutoff)
    .limit(50)  // 20→50: 1回のcronでより多くのアイテムを処理

  if (!items?.length) return

  const toDeleteHistIds: string[] = []
  const toDeletePairs: Array<{ userId: string; auctionId: string }> = []

  // 10並列でYahoo終了確認（旧5並列→倍速）
  const CHECK_BATCH = 10
  for (let i = 0; i < items.length; i += CHECK_BATCH) {
    const chunk = items.slice(i, i + CHECK_BATCH)
    const results = await Promise.allSettled(
      chunk.map(item => checkAuctionEnded(item.auction_id as string))
    )
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled' && r.value) {
        toDeleteHistIds.push(chunk[idx].id as string)
        toDeletePairs.push({
          userId:    chunk[idx].user_id as string,
          auctionId: chunk[idx].auction_id as string,
        })
      }
    })
  }

  if (!toDeleteHistIds.length) return

  // notification_history と notified_items を並列削除
  await Promise.all([
    supabase.from('notification_history').delete().in('id', toDeleteHistIds),
    // notified_items は (user_id, auction_id) の複合条件なので個別削除を並列実行
    ...toDeletePairs.map(({ userId, auctionId }) =>
      supabase.from('notified_items').delete()
        .eq('user_id', userId).eq('auction_id', auctionId)
    ),
  ])

  console.log(`[cron/shard0] 終了オークション ${toDeleteHistIds.length}件削除 / ${items.length}件チェック`)
}
