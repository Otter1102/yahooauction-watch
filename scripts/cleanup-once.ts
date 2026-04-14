#!/usr/bin/env tsx
/**
 * ゴーストユーザー一括クリーンアップ（ワンタイム実行用）
 * 実行: npx tsx scripts/cleanup-once.ts
 * 環境変数: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey  = process.env.SUPABASE_SERVICE_KEY!

if (!supabaseUrl || !serviceKey) {
  console.error('[ERROR] NEXT_PUBLIC_SUPABASE_URL または SUPABASE_SERVICE_KEY が未設定')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey)

async function main() {
  console.log('\n=== ゴーストユーザークリーンアップ ===\n')

  // ── 1. 事前調査 ──────────────────────────────────────────────
  const { count: totalBefore } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
  console.log(`📊 クリーンアップ前 総ユーザー数: ${totalBefore} 件`)

  const { count: withPushBefore } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .not('push_sub', 'is', null)
  console.log(`   - push_sub あり（実際に通知設定済み）: ${withPushBefore} 件`)

  const { count: withConditions } = await supabase
    .from('conditions')
    .select('user_id', { count: 'exact', head: true })
  console.log(`   - 検索条件あり: ${withConditions} 件`)

  // ── 2. ゴーストユーザーを特定 ────────────────────────────────
  // 条件: conditions を持たない AND push_sub が null AND 作成24h超
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: activeUserRows } = await supabase.from('conditions').select('user_id')
  const activeSet = new Set((activeUserRows ?? []).map(r => r.user_id as string))

  const { data: candidates } = await supabase
    .from('users')
    .select('id, created_at, push_sub')
    .is('push_sub', null)
    .lt('created_at', cutoff)

  const ghostIds = (candidates ?? [])
    .map(r => r.id as string)
    .filter(id => !activeSet.has(id))

  console.log(`\n🔍 ゴーストユーザー候補: ${ghostIds.length} 件（条件なし・push_subなし・24h超）`)

  // ── 3. 重複 push endpoint を特定 ─────────────────────────────
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
  const dupGroups = [...endpointMap.values()].filter(ids => ids.length > 1)
  console.log(`🔍 重複 push endpoint グループ: ${dupGroups.length} グループ`)

  // ── 4. 実行確認メッセージ ────────────────────────────────────
  console.log('\n--- 削除実行 ---')

  // 4a. ゴーストユーザー削除
  let ghostDeleted = 0
  for (let i = 0; i < ghostIds.length; i += 50) {
    const batch = ghostIds.slice(i, i + 50)
    const { count } = await supabase
      .from('users')
      .delete({ count: 'exact' })
      .in('id', batch)
    ghostDeleted += count ?? 0
  }
  console.log(`🗑️  ゴーストユーザー削除: ${ghostDeleted} 件`)

  // 4b. 重複 push endpoint の古い方をクリア
  let dupCleared = 0
  for (const ids of dupGroups) {
    const toNull = ids.slice(0, -1)  // 最新を残す
    await supabase.from('users').update({ push_sub: null }).in('id', toNull)
    dupCleared += toNull.length
  }
  if (dupCleared > 0) console.log(`🔄 重複push endpoint クリア: ${dupCleared} 件`)

  // ── 5. 事後報告 ───────────────────────────────────────────────
  const { count: totalAfter } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })

  const { count: withPushAfter } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .not('push_sub', 'is', null)

  console.log(`\n📊 クリーンアップ後 総ユーザー数: ${totalAfter} 件`)
  console.log(`   - push通知設定済み（実アクティブユーザー）: ${withPushAfter} 件`)
  console.log(`📉 削減: ${(totalBefore ?? 0) - (totalAfter ?? 0)} 件\n`)

  // ── 6. 残存ユーザーの一部表示（確認用・IDを伏せ字） ───────────
  const { data: remaining } = await supabase
    .from('users')
    .select('id, created_at, push_sub')
    .order('created_at', { ascending: false })
    .limit(20)

  console.log('=== 残存ユーザー一覧（最新20件・ID伏せ字）===')
  for (const u of remaining ?? []) {
    const id = u.id as string
    const hasPush = !!(u.push_sub as any)?.endpoint
    const createdAt = new Date(u.created_at as string).toLocaleString('ja-JP')
    console.log(`  ${id.slice(0,8)}...${id.slice(-4)}  push=${hasPush ? '✅' : '❌'}  created=${createdAt}`)
  }

  console.log(`\n✅ 完了: ゴーストユーザーの削除を完了し、現在は実数 ${totalAfter} 名でクリーンに運用されています`)
}

main().catch(err => {
  console.error('[FATAL]', err.message)
  process.exit(1)
})
