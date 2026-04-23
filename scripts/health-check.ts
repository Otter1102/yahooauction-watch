#!/usr/bin/env tsx
/**
 * health-check.ts — Yahoo Auction Watcher 自動点検スクリプト
 * 出力: JSON { healthy, issues[], fixes[], report }
 * exit 0 = 正常 / exit 1 = 異常検出
 */
import { getSupabaseAdmin } from '../lib/supabase'
import { execSync } from 'child_process'

interface HealthReport {
  healthy: boolean
  issues: string[]
  fixes: string[]       // 自動適用可能な修正コマンド
  report: string        // Ollama/Claude に渡すサマリ
  checkedAt: string
}

async function main() {
  const sb = getSupabaseAdmin()
  const issues: string[] = []
  const fixes: string[] = []
  const lines: string[] = []

  // ──────────────────────────────────────────────
  // 1. GitHub Actions: ワークフロー有効 & 最終実行
  // ──────────────────────────────────────────────
  try {
    const workflowsRaw = execSync(
      'gh workflow list --repo Otter1102/yahooauction-watch --all --json id,name,state',
      { encoding: 'utf-8', timeout: 15000 }
    )
    const workflows = JSON.parse(workflowsRaw) as { id: number; name: string; state: string }[]
    const cron = workflows.find(w => w.name.includes('自動チェック'))

    if (!cron) {
      issues.push('WORKFLOW_MISSING: 自動チェックワークフローが見つからない')
    } else if (cron.state !== 'active') {
      issues.push(`WORKFLOW_DISABLED: ワークフロー "${cron.name}" が無効化されている`)
      fixes.push(`gh workflow enable ${cron.id} --repo Otter1102/yahooauction-watch`)
    } else {
      lines.push(`✅ ワークフロー: active (id=${cron.id})`)
    }

    // 最終実行の結果
    const runsRaw = execSync(
      `gh run list --repo Otter1102/yahooauction-watch --workflow=260488766 --limit=3 --json status,conclusion,createdAt`,
      { encoding: 'utf-8', timeout: 15000 }
    )
    const runs = JSON.parse(runsRaw) as { status: string; conclusion: string; createdAt: string }[]
    const lastRun = runs[0]

    if (!lastRun) {
      issues.push('NO_RUNS: 実行履歴が0件')
    } else {
      const hoursAgo = (Date.now() - new Date(lastRun.createdAt).getTime()) / 3_600_000
      lines.push(`📅 最終実行: ${lastRun.conclusion} (${hoursAgo.toFixed(1)}時間前)`)
      if (lastRun.conclusion === 'failure') {
        issues.push(`LAST_RUN_FAILED: 最終実行が失敗 (${lastRun.createdAt})`)
      }
      if (hoursAgo > 3) {
        issues.push(`RUN_STALE: 最終実行から${hoursAgo.toFixed(1)}時間経過 (3時間以上)`)
        fixes.push(`gh workflow run 260488766 --repo Otter1102/yahooauction-watch`)
      }
    }
  } catch (e: any) {
    issues.push(`GITHUB_CHECK_ERROR: ${e.message?.slice(0, 100)}`)
  }

  // ──────────────────────────────────────────────
  // 2. Supabase: push_sub × 条件 の整合性
  // ──────────────────────────────────────────────
  try {
    const { data: users, error: ue } = await sb.from('users').select('id, push_sub')
    if (ue) throw new Error(ue.message)

    const { data: conds, error: ce } = await sb.from('conditions').select('user_id').eq('enabled', true)
    if (ce) throw new Error(ce.message)

    const condUserIds = new Set(conds?.map(c => c.user_id) ?? [])
    const pushUserIds = new Set(
      (users ?? []).filter((u: any) => u.push_sub?.endpoint).map((u: any) => u.id)
    )

    const notifiableCount = [...condUserIds].filter(id => pushUserIds.has(id)).length
    lines.push(`👤 ユーザー: 総${users?.length ?? 0}人 / push_sub有効: ${pushUserIds.size}人 / 条件あり: ${condUserIds.size}人 / 通知可能: ${notifiableCount}人`)

    if (notifiableCount === 0 && condUserIds.size > 0) {
      issues.push('NO_NOTIFIABLE_USERS: 条件を持つユーザーに push_sub がない (DB クエリバグ or push_sub期限切れ)')
    }

    // push_sub を持つユーザーのクエリが正しく動くか確認
    const { data: test, error: te } = await sb
      .from('users')
      .select('id, push_sub')
      .in('id', [...condUserIds].slice(0, 3))
    if (te) {
      issues.push(`SUPABASE_QUERY_ERROR: ${te.message}`)
      fixes.push('NEED_CODE_FIX: run-check.ts の getAllUsers クエリを修正')
    }
  } catch (e: any) {
    issues.push(`SUPABASE_CHECK_ERROR: ${e.message?.slice(0, 100)}`)
  }

  // ──────────────────────────────────────────────
  // 3. notified_items: 異常蓄積チェック
  // ──────────────────────────────────────────────
  try {
    const { count } = await sb
      .from('notified_items')
      .select('*', { count: 'exact', head: true })

    lines.push(`📋 notified_items: ${count ?? '?'}件`)
    if ((count ?? 0) > 200) {
      issues.push(`NOTIFIED_ITEMS_OVERFLOW: notified_items が${count}件溜まっている (上限目安200件)`)
      fixes.push('RUN_RESET: npx tsx scripts/reset-notified.ts')
    }
  } catch (e: any) {
    issues.push(`NOTIFIED_COUNT_ERROR: ${e.message?.slice(0, 100)}`)
  }

  // ──────────────────────────────────────────────
  // 4. 直近24時間の通知履歴（最新1件を確認）
  // ──────────────────────────────────────────────
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { data: hist } = await sb
      .from('notification_history')
      .select('notified_at')
      .gte('notified_at', since)
      .limit(1)

    const hasRecent = (hist?.length ?? 0) > 0
    lines.push(`📬 直近24h通知履歴: ${hasRecent ? 'あり' : 'なし'}`)
    if (!hasRecent) {
      issues.push('NO_NOTIFICATIONS_24H: 直近24時間で通知履歴が0件')
    }
  } catch (e: any) {
    lines.push(`⚠️ 通知履歴取得失敗 (タイムアウト等): スキップ`)
  }

  // ──────────────────────────────────────────────
  // 結果まとめ
  // ──────────────────────────────────────────────
  const healthy = issues.length === 0
  const report: HealthReport = {
    healthy,
    issues,
    fixes,
    report: [
      `=== Yahoo Auction Watcher 健全性レポート ===`,
      `日時: ${new Date().toLocaleString('ja-JP')}`,
      `ステータス: ${healthy ? '✅ 正常' : '🚨 異常検出'}`,
      '',
      '【状態】',
      ...lines,
      '',
      issues.length > 0 ? '【検出された問題】' : '',
      ...issues.map(i => `  ❌ ${i}`),
      '',
      fixes.length > 0 ? '【自動修正可能】' : '',
      ...fixes.map(f => `  🔧 ${f}`),
    ].filter(l => l !== undefined).join('\n'),
    checkedAt: new Date().toISOString(),
  }

  console.log(JSON.stringify(report, null, 2))
  process.exit(healthy ? 0 : 1)
}

main().catch(e => {
  const report = { healthy: false, issues: [`FATAL: ${e.message}`], fixes: [], report: e.message, checkedAt: new Date().toISOString() }
  console.log(JSON.stringify(report, null, 2))
  process.exit(1)
})
