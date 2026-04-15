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
import { cleanupOldNotified, cleanupOldHistory, resetStalledNotified } from '@/lib/storage'
import { checkAuctionEnded } from '@/lib/scraper'

const APP_URL         = process.env.NEXT_PUBLIC_APP_URL ?? 'https://yahooauction-watch.vercel.app'
const CONCURRENCY     = 25   // 25ユーザーを1バッチで並列処理
const USER_TIMEOUT_MS = 30_000  // 30条件×並列フェッチ=12s + 通知 < 30s
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

// ── GET: cron-job.org から直接呼ばれる場合のフォールバック ──────────────────
// コーディネーターへ移行済みなら通常はここに来ない。
// 旧設定や手動テスト用として残す（各シャードが自分でSupabaseを叩く旧動作）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ shard: string }> }
) {
  // ── 認証 ────────────────────────────────────────────────────────────────
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

  const cronSecret = (process.env.CRON_SECRET ?? '').trim()

  // 認証通過後すぐ200を返し、全処理をバックグラウンドで実行
  waitUntil(runShardJob(shard, cronSecret))
  return NextResponse.json({ ok: true, started: true, shard, totalShards: TOTAL_SHARDS })
}

async function runShardJob(shard: number, cronSecret: string): Promise<void> {
  try {
    // シャードの起動タイミングをずらしてSupabase接続負荷を分散
    // 理由: 8シャードが同時起動するとSupabaseへの同時接続が集中し20秒超えのタイムアウトが多発
    //       shard0: 0ms, shard1: 1000ms, ..., shard7: 7000ms
    //       shard7 worst case: 7s + 20s×2 + 3s = 50s < 60s ✅
    if (shard > 0) await new Promise(r => setTimeout(r, shard * 1000))

    const supabase = getSupabaseAdmin()

    // ユーザー取得: タイムアウト・一時障害時は2回試行（リトライ1回）
    // 理由: 3回試行（20秒×3 + 2秒×2 = 64秒）はmaxDuration(60秒)を超えてwaitUntilが強制終了される
    //       shard7: 4.2秒待機 + 20秒×2 + 2秒 = 46.2秒 < 60秒 ✅
    let allUsers: { id: string }[] | null = null
    let lastErrMsg = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await supabase
        .from('users')
        .select('id')
        .or('push_sub.not.is.null,ntfy_topic.neq.,discord_webhook.neq.')
      if (!error && data) { allUsers = data; break }
      lastErrMsg = error?.message ?? String(error)
      console.warn(`[cron/shard${shard}] ユーザー取得失敗 attempt${attempt + 1}/2: ${lastErrMsg}`)
      if (attempt < 1) await new Promise(r => setTimeout(r, 3_000))
    }
    if (!allUsers) {
      console.error(`[cron/shard${shard}] ユーザー取得エラー（2回試行後）:`, lastErrMsg)
      await alertAdmin(`[shard${shard}] ユーザー取得失敗: ${lastErrMsg}`)
      return
    }
    if (!allUsers.length) return

    const users = allUsers.filter(u => getUserShard(u.id, TOTAL_SHARDS) === shard)
    console.log(`[cron/shard${shard}] 担当ユーザー数: ${users.length}/${allUsers.length}`)

    await processUsers(users, shard, cronSecret)
    await pingHealthcheck(shard)

  } catch (e) {
    const msg = String(e)
    console.error(`[cron/shard${shard}] エラー:`, msg)
    await alertAdmin(`[shard${shard}] 予期しないエラー: ${msg}`)
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

  await cleanupOldNotified()
  await cleanupOldHistory(72)
  await cleanupEndedAuctionsFromHistory()

  try {
    const stalled = await resetStalledNotified()
    if (stalled.length > 0) console.log(`[cron/shard0] 自己修復: ${stalled.length}ユーザーをリセット`)
  } catch (e) {
    console.error('[cron/shard0] 自己修復エラー（無視）:', String(e))
  }
}

async function cleanupEndedAuctionsFromHistory(): Promise<void> {
  const supabase = getSupabaseAdmin()
  const now = Date.now()
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

  const toDeleteIds: string[] = []
  const toDeletePairs: Array<{ userId: string; auctionId: string }> = []
  const BATCH = 5
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH)
    const results = await Promise.allSettled(
      chunk.map(item => checkAuctionEnded(item.auction_id as string))
    )
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled' && r.value) {
        toDeleteIds.push(chunk[idx].id as string)
        toDeletePairs.push({ userId: chunk[idx].user_id as string, auctionId: chunk[idx].auction_id as string })
      }
    })
  }
  if (!toDeleteIds.length) return

  await supabase.from('notification_history').delete().in('id', toDeleteIds)
  for (const { userId, auctionId } of toDeletePairs) {
    await supabase.from('notified_items').delete().eq('user_id', userId).eq('auction_id', auctionId)
  }
  console.log(`[cron/shard0] 終了オークション ${toDeleteIds.length}件を削除`)
}
