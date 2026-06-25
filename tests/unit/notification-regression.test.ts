import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')

function readSource(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

describe('通知送信の回帰防止', () => {
  it('/api/run-now は送信成功後だけ notified_items に保存する', () => {
    const source = readSource('app/api/run-now/route.ts')
    const deliveryCheck = source.indexOf('if (delivered) {')
    const markNotified = source.indexOf('await markNotified(userId, item.auctionId)')
    const retryWarning = source.indexOf('notified_items に記録せず次回再試行')

    expect(deliveryCheck).toBeGreaterThan(-1)
    expect(markNotified).toBeGreaterThan(deliveryCheck)
    expect(retryWarning).toBeGreaterThan(-1)
  })

  it('GitHub Actions run-check もPush成功後だけ notified_items に保存する', () => {
    const source = readSource('scripts/run-check.ts')
    const deliveryCheck = source.indexOf('if (!delivered) {')
    const addHistory = source.indexOf('await addHistory(toHistoryRecord(cond, item))')
    const markNotified = source.indexOf('await markNotified(userId, item.auctionId)')
    const retryWarning = source.indexOf('通知済みにせず次回再試行')
    const recordRetryWarning = source.indexOf('未記録分は次回再試行')

    expect(deliveryCheck).toBeGreaterThan(-1)
    expect(markNotified).toBeGreaterThan(deliveryCheck)
    expect(addHistory).toBeGreaterThan(deliveryCheck)
    expect(markNotified).toBeGreaterThan(addHistory)
    expect(retryWarning).toBeGreaterThan(-1)
    expect(recordRetryWarning).toBeGreaterThan(-1)
  })

  it('GitHub Actions run-check は自己修復を通知判定前に実行する', () => {
    const source = readSource('scripts/run-check.ts')
    const reset = source.indexOf('await resetStalledNotified()')
    const cache = source.indexOf('await getAllNotifiedIds(activeUserIds)')
    const summary = source.indexOf('await sendWebPushSummary')

    expect(reset).toBeGreaterThan(-1)
    expect(cache).toBeGreaterThan(reset)
    expect(summary).toBeGreaterThan(cache)
  })

  it('ストレージ層は通知履歴と通知済み保存のSupabaseエラーを握りつぶさない', () => {
    const source = readSource('lib/storage.ts')

    expect(source).toContain('function throwOnError')
    expect(source).toContain("throwOnError(insertErr, 'notification_history保存エラー')")
    expect(source).toContain("throwOnError(error, 'notified_items保存エラー')")
  })

  it('条件保存後に全条件run-nowを重ねて起動しない', () => {
    const source = readSource('app/page.tsx')

    expect(source).not.toContain("fetch('/api/run-now'")
    expect(source).not.toContain('runNow()')
  })

  it('定期チェック完了通知を環境変数で有効化できる', () => {
    const runCheck = readSource('scripts/run-check.ts')
    const runNow = readSource('app/api/run-now/route.ts')
    const workflow = readSource('.github/workflows/cron.yml')
    const webpush = readSource('lib/webpush.ts')

    expect(runCheck).toContain('SEND_NO_ITEMS_PUSH')
    expect(runCheck).toContain('FORCE_CHECK_COMPLETE_PUSH')
    expect(runCheck).toContain('await sendWebPushCheckComplete(userId')
    expect(runCheck).toContain('failedFetchByUser')
    expect(runNow).toContain('SEND_NO_ITEMS_PUSH')
    expect(runNow).toContain('await sendWebPushCheckComplete(userId')
    expect(runNow).toContain('fetchFailedCount')
    expect(workflow).toContain("SEND_NO_ITEMS_PUSH: 'true'")
    expect(workflow).toContain('force_check_complete')
    expect(workflow).toContain("cron: '7,22,37,52 * * * *'")
    expect(runCheck).toContain('canSendCheckCompleteThisHour')
    expect(runCheck).toContain('チェック完了Pushは50分以内に送信済み')
    expect(runCheck).toContain('GH_FETCH_PAGES = 120')
    expect(runCheck).toContain('CHECK_SHARD_TOTAL')
    expect(runCheck).toContain('stringShard')
    expect(runCheck).toContain('検索グループ単位')
    expect(runCheck).toContain('上限到達')
    expect(webpush).toContain('取得完了: 新着')
    expect(webpush).toContain('取得できませんでした')
  })

  it('端末側のPush受信ACKと強制再登録が実装されている', () => {
    const sw = readSource('public/sw.js')
    const receipt = readSource('app/api/push/receipt/route.ts')
    const pushClient = readSource('lib/push-client.ts')
    const settings = readSource('app/settings/page.tsx')

    expect(sw).toContain("CACHE_VERSION = 'v13'")
    expect(sw).toContain('/api/push/receipt')
    expect(receipt).toContain('[push/receipt] service-worker-received')
    expect(pushClient).toContain('options.forceRefresh')
    expect(settings).toContain('enablePush(true)')
    expect(settings).toContain('通知を再登録する')
  })

  it('通知履歴は終了済みオークションを返却前に削除する', () => {
    const historyRoute = readSource('app/api/history/route.ts')
    const storage = readSource('lib/storage.ts')
    const runCheck = readSource('scripts/run-check.ts')
    const cronRoute = readSource('app/api/cron/check/route.ts')
    const cronShardRoute = readSource('app/api/cron/check/[shard]/route.ts')

    expect(historyRoute).toContain('cleanupEndedHistoryForUser(userId)')
    expect(storage).toContain('cleanupEndedHistoryForUser')
    expect(storage).toContain(".lte('end_at', nowIso)")
    expect(runCheck).toContain('終了時刻超過オークション')
    expect(cronRoute).toContain('終了時刻超過オークション')
    expect(cronRoute).toContain(".lte('end_at', nowIso)")
    expect(cronShardRoute).toContain('終了時刻超過オークション')
    expect(cronShardRoute).toContain(".lte('end_at', nowIso)")
  })

  it('巡回成功時は件数変化がなくても最終チェック時刻を更新する', () => {
    const runCheck = readSource('scripts/run-check.ts')
    const runNow = readSource('app/api/run-now/route.ts')

    expect(runCheck).toContain('巡回成功の証跡として必ず更新')
    expect(runCheck).toContain('await updateCondition(cond.id, {')
    expect(runCheck).not.toContain('変化があった時のみ更新')
    expect(runNow).toContain('await updateCondition(cond.id, {')
    expect(runNow).not.toContain('items.length !== (cond.lastFoundCount ?? -1)')
  })

  it('GitHub schedule抜け対策としてバックアップworkflowも定期実行する', () => {
    const backupWorkflow = readSource('.github/workflows/cron-backup.yml')
    const workflow = readSource('.github/workflows/cron.yml')

    expect(backupWorkflow).toContain("cron: '2,17,32,47 * * * *'")
    expect(backupWorkflow).toContain('yahoo-auction-watch-check')
    expect(backupWorkflow).toContain("SEND_NO_ITEMS_PUSH: 'true'")
    expect(backupWorkflow).toContain('CHECK_SHARD_INDEX')
    expect(workflow).toContain('shard: [0, 1, 2, 3]')
    expect(workflow).toContain('CHECK_SHARD_TOTAL')
  })

  it('商品がなくても条件チェック履歴を残す', () => {
    const storage = readSource('lib/storage.ts')
    const runCheck = readSource('scripts/run-check.ts')
    const runNow = readSource('app/api/run-now/route.ts')
    const historyPage = readSource('app/history/page.tsx')
    const webpush = readSource('lib/webpush.ts')

    expect(storage).toContain('addConditionCheckHistory')
    expect(storage).toContain('条件チェック: 新着はありませんでした')
    expect(storage).toContain('__check_')
    expect(runCheck).toContain('addConditionCheckHistory(cond')
    expect(runNow).toContain('addConditionCheckHistory(cond')
    expect(historyPage).toContain('条件チェック')
    expect(webpush).toContain('新着はありませんでした')
  })
})
