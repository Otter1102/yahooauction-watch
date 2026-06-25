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

    expect(deliveryCheck).toBeGreaterThan(-1)
    expect(markNotified).toBeGreaterThan(deliveryCheck)
    expect(addHistory).toBeGreaterThan(deliveryCheck)
    expect(markNotified).toBeGreaterThan(addHistory)
    expect(retryWarning).toBeGreaterThan(-1)
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

  it('テスト期間は新着なし通知を環境変数で有効化できる', () => {
    const runCheck = readSource('scripts/run-check.ts')
    const runNow = readSource('app/api/run-now/route.ts')
    const workflow = readSource('.github/workflows/cron.yml')

    expect(runCheck).toContain('SEND_NO_ITEMS_PUSH')
    expect(runCheck).toContain('await sendWebPushNoItems(userId)')
    expect(runNow).toContain('SEND_NO_ITEMS_PUSH')
    expect(runNow).toContain('await sendWebPushNoItems(userId, getSupabaseAdmin())')
    expect(workflow).toContain("SEND_NO_ITEMS_PUSH: 'true'")
  })
})
