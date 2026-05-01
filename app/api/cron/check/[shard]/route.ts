// POST /api/cron/check/[shard] — coordinator から呼ばれるシャードワーカー
// GET  /api/cron/check/[shard] — フォールバック（直接呼び出し時）
//
// 【2026-04-19 waitUntil 廃止】
//   理由: waitUntil() = Vercel Fluid Compute 課金（無料枠 4時間/月）
//         同期処理に変更することで通常のサーバーレス（100 GB-hours/月無料）へ移行
//
// 【スケーリング計算（100ユーザー対応）】
//   TOTAL_SHARDS=8: 100ユーザー ÷ 8 = 13ユーザー/シャード
//   CONCURRENCY=25: 13ユーザーが1バッチで並列処理 → 処理時間 ≒ 1ユーザー分
//   USER_TIMEOUT_MS=30s: 1バッチ × 30s = 30s << Vercel 60s制限 ✅
//   run-now側: CONDITION_CONCURRENCY=5 × FETCH_PAGES=3 → ~5-10s << 30s ✅
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { cleanupOldNotified, cleanupOldHistory, resetStalledNotified } from '@/lib/storage'
import { checkAuctionEnded } from '@/lib/scraper'

const APP_URL         = process.env.NEXT_PUBLIC_APP_URL ?? 'https://yahooauction-watch.vercel.app'
const CONCURRENCY     = 25
const USER_TIMEOUT_MS = 30_000
const TOTAL_SHARDS    = 8

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
  if (shard !== 0) return
  const url = process.env.HEALTHCHECK_PING_URL
  if (!url) return
  try {
    await fetch(url, { signal: AbortSignal.timeout(5_000) })
    console.log('[cron] healthchecks.io ping 送信')
  } catch { /* ping失敗は無視 */ }
}

// ── POST: coordinator から呼ばれる（メインパス）───────────────────────────────
// waitUntil 廃止: 同期処理で通常サーバーレス課金（GB-hours）に移行
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

  // waitUntil 廃止: await で同期処理（通常サーバーレス課金）
  try {
    await runShardWithUsers(shard, userIds, envSecret)
  } catch (e) {
    const msg = String(e)
    console.error(`[cron/shard${shard}] エラー:`, msg)
    await alertAdmin(`[shard${shard}] 予期しないエラー: ${msg}`)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }

  return NextResponse.json({ ok: true, shard, userCount: userIds.length })
}

async function runShardWithUsers(shard: number, userIds: string[], cronSecret: string): Promise<void> {
  console.log(`[cron/shard${shard}] コーディネーターから${userIds.length}人受信`)
  const users = userIds.map(id => ({ id }))
  await processUsers(users, shard, cronSecret)
  await pingHealthcheck(shard)
}

// ── GET: フォールバック（直接呼び出し・手動テスト用）──────────────────────────
// waitUntil 廃止: 同期処理。100ユーザー以内であれば60s以内に完了する。
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

  const cronSecret = (process.env.CRON_SECRET ?? '').trim()

  try {
    // Supabase からユーザー取得（1回のみ・スタガーなし）
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .not('push_sub', 'is', null)
    if (error || !data) {
      const msg = error?.message ?? 'ユーザー取得失敗'
      console.error(`[cron/shard${shard}] ${msg}`)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
    const users = data.filter(u => getUserShard(u.id, TOTAL_SHARDS) === shard)
    console.log(`[cron/shard${shard}] 担当ユーザー数: ${users.length}/${data.length}`)
    await processUsers(users, shard, cronSecret)
    await pingHealthcheck(shard)
  } catch (e) {
    const msg = String(e)
    console.error(`[cron/shard${shard}] エラー:`, msg)
    await alertAdmin(`[shard${shard}] 予期しないエラー: ${msg}`)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }

  return NextResponse.json({ ok: true, shard, totalShards: TOTAL_SHARDS })
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
  await cleanupOldHistory()
  await cleanupEndedAuctionsFromHistory()

  try {
    const stalled = await resetStalledNotified()
    if (stalled.length > 0) console.log(`[cron/shard0] 自己修復: ${stalled.length}ユーザーをリセット`)
  } catch (e) {
    console.error('[cron/shard0] 自己修復エラー（無視）:', String(e))
  }
}

async function cleanupEndedAuctionsFromHistory(): Promise<void> {
  // end_at なし旧レコードのみYahoo確認して削除（安全網）
  // end_at ありレコードは cleanupOldHistory() で処理済みのためここでは扱わない
  const supabase = getSupabaseAdmin()
  const softCutoff = new Date(Date.now() - 60 * 1000).toISOString()

  const { data: items } = await supabase
    .from('notification_history')
    .select('id, auction_id, user_id')
    .is('end_at', null)
    .lt('notified_at', softCutoff)
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
  console.log(`[cron/shard0] 終了オークション(旧レコード) ${toDeleteIds.length}件を削除`)
}
