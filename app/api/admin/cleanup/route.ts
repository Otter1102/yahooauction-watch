/**
 * ゴーストユーザー一括クリーンアップ API
 * POST /api/admin/cleanup?secret=<TRIAL_ADMIN_KEY>
 *
 * 実行内容:
 *   1. ゴーストユーザー（条件なし・push_subなし・24h超）を削除
 *   2. 重複 push endpoint を持つユーザーの古い方をクリア
 *   3. 現在の正確なユーザー数を報告
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.TRIAL_ADMIN_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  const results: string[] = []

  // ── 1. 全ユーザー数（作業前） ──────────────────────────────────
  const { count: beforeCount } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
  results.push(`📊 クリーンアップ前ユーザー数: ${beforeCount}件`)

  // ── 2. ゴーストユーザーを削除 ─────────────────────────────────
  // 条件: conditions を1件も持たない AND push_sub が null AND 作成24h超
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: activeUsers } = await supabase.from('conditions').select('user_id')
  const activeSet = new Set((activeUsers ?? []).map(r => r.user_id as string))

  const { data: candidates } = await supabase
    .from('users')
    .select('id, created_at')
    .is('push_sub', null)
    .lt('created_at', cutoff24h)

  const ghostIds = (candidates ?? [])
    .map(r => r.id as string)
    .filter(id => !activeSet.has(id))

  let ghostDeleted = 0
  for (let i = 0; i < ghostIds.length; i += 50) {
    const batch = ghostIds.slice(i, i + 50)
    const { count } = await supabase
      .from('users')
      .delete({ count: 'exact' })
      .in('id', batch)
    ghostDeleted += count ?? 0
  }
  results.push(`🗑️ ゴーストユーザー削除: ${ghostDeleted}件`)

  // ── 3. 重複 push endpoint の古い方をクリア ─────────────────────
  const { data: pushUsers } = await supabase
    .from('users')
    .select('id, push_sub, created_at')
    .not('push_sub', 'is', null)
    .order('created_at', { ascending: true })

  const endpointMap = new Map<string, string[]>()
  for (const u of pushUsers ?? []) {
    const ep = (u.push_sub as any)?.endpoint
    if (!ep) continue
    if (!endpointMap.has(ep)) endpointMap.set(ep, [])
    endpointMap.get(ep)!.push(u.id as string)
  }

  let dupCleared = 0
  for (const [, ids] of endpointMap) {
    if (ids.length <= 1) continue
    const toNull = ids.slice(0, -1)  // 最新（末尾）を残し古い方をクリア
    await supabase.from('users').update({ push_sub: null }).in('id', toNull)
    dupCleared += toNull.length
  }
  results.push(`🔄 重複push endpoint クリア: ${dupCleared}件`)

  // ── 4. クリーンアップ後のユーザー数 ──────────────────────────
  const { count: afterCount } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
  results.push(`✅ クリーンアップ後ユーザー数: ${afterCount}件`)
  results.push(`📉 削減: ${(beforeCount ?? 0) - (afterCount ?? 0)}件`)

  // ── 5. アクティブユーザー内訳 ────────────────────────────────
  const { count: withConditions } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
  const { count: withPush } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .not('push_sub', 'is', null)
  results.push(`  - push_sub あり: ${withPush}件`)
  results.push(`  - 全ユーザー: ${afterCount}件`)

  return NextResponse.json({ ok: true, results })
}
