#!/usr/bin/env tsx
/**
 * 全ユーザーの notified_items を強制リセット
 * RESET_NOTIFICATION_HISTORY=true で notification_history も全削除する。
 *
 * 実行:
 *   set -a && source .env.local && set +a && npx tsx scripts/reset-notified.ts
 *   RESET_NOTIFICATION_HISTORY=true npx tsx scripts/reset-notified.ts
 */
import { getSupabaseAdmin } from '../lib/supabase'

async function main() {
  const supabase = getSupabaseAdmin()
  console.log('=== notified_items リセット ===')
  const resetHistory = process.env.RESET_NOTIFICATION_HISTORY === 'true'

  const { count: before } = await supabase
    .from('notified_items')
    .select('*', { count: 'exact', head: true })
  console.log(`削除前: ${before ?? '?'} 件`)

  const { error } = await supabase
    .from('notified_items')
    .delete()
    .gte('notified_at', '2000-01-01')

  if (error) { console.error('[エラー]', error.message); process.exit(1) }

  const { count: after } = await supabase
    .from('notified_items')
    .select('*', { count: 'exact', head: true })
  console.log(`削除後: ${after ?? 0} 件`)

  if (resetHistory) {
    console.log('\n=== notification_history 全削除 ===')
    const { count: historyBefore } = await supabase
      .from('notification_history')
      .select('*', { count: 'exact', head: true })
    console.log(`履歴削除前: ${historyBefore ?? '?'} 件`)

    const { error: historyError } = await supabase
      .from('notification_history')
      .delete()
      .gte('notified_at', '2000-01-01')
    if (historyError) { console.error('[履歴削除エラー]', historyError.message); process.exit(1) }

    const { count: historyAfter } = await supabase
      .from('notification_history')
      .select('*', { count: 'exact', head: true })
    console.log(`履歴削除後: ${historyAfter ?? 0} 件`)
  }

  console.log('✅ 完了。次回 GitHub Actions 実行で全件を新着として再取得します。')

  const { data: users } = await supabase
    .from('users')
    .select('id, push_sub')
  if (users) {
    const withPush = users.filter(u => (u.push_sub as any)?.endpoint).length
    console.log(`\npush_sub 有効: ${withPush}人 / 総ユーザー: ${users.length}人`)
    if (users.length - withPush > 0)
      console.log(`⚠️  ${users.length - withPush}人は通知再許可が必要`)
  }
}

main().catch(e => { console.error(e.message); process.exit(1) })
