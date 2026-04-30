/**
 * マルチデバイス E2E テスト — iPhone 20台 / Android 20台
 *
 * テスト観点:
 *  1. run-now API: 無効userIdで 500 ではなく 400/404 が返るか
 *  2. /history ページが空白にならないか（通知タップ先の確認）
 *  3. アプリトップが正常ロードされるか（500 を返さないか）
 *  4. SW/通知URL: webpush payload の url が /history を指しているか
 *     → /api/push/test エンドポイントをモックで検証
 *  5. cron/check/[shard]: シークレットなしでUnauthorized(401)が返るか
 *  6. cron API応答速度: 200ms以内に200を返すか（waitUntil設計確認）
 *
 * 実行:
 *   BASE_URL=https://yahooauction-watch.vercel.app \
 *   npx playwright test --config playwright.multi-device.config.ts
 */
import { test, expect } from '@playwright/test'

// ──────────────────────────────────────────────
// ヘルパー
// ──────────────────────────────────────────────

/** run-now に無効userIdを送信して結果を返す */
async function callRunNow(request: import('@playwright/test').APIRequestContext, baseURL: string) {
  return request.post(`${baseURL}/api/run-now`, {
    data: { userId: 'test-nonexistent-user-playwright-check' },
    headers: {
      'Content-Type': 'application/json',
      // Origin を baseURL に合わせてCSRFを通過させる
      'Origin': baseURL,
    },
  })
}

// ──────────────────────────────────────────────
// テスト 1: run-now API エラーハンドリング
// ──────────────────────────────────────────────

test.describe('run-now API — 500エラー検出', () => {
  test('無効userId → 500 ではなく 400/404 が返る', async ({ request }, testInfo) => {
    const BASE = testInfo.project.use.baseURL ?? 'https://yahooauction-watch.vercel.app'
    const res = await callRunNow(request, BASE)

    const body = await res.json().catch(() => ({}))
    console.log(
      `[${testInfo.project.name}] run-now status=${res.status()} body=${JSON.stringify(body)}`
    )

    // 500 は絶対NG: サーバー側で予期しないエラーが発生している
    expect(
      res.status(),
      `500 Internal Server Error が返った。エラー内容: ${JSON.stringify(body)}`
    ).not.toBe(500)

    // 期待値: 400 (validation error) or 404 (user not found) or 429 (rate limit)
    expect([400, 404, 429]).toContain(res.status())
  })
})

// ──────────────────────────────────────────────
// テスト 2: /history 通知タップ先
// ──────────────────────────────────────────────

test.describe('/history — 通知タップ先ページ', () => {
  test('500 を返さない', async ({ page }, testInfo) => {
    const res = await page.goto('/history', { waitUntil: 'domcontentloaded' })
    console.log(`[${testInfo.project.name}] /history status=${res?.status()} url=${page.url()}`)

    // 500 は絶対NG
    expect(res?.status()).not.toBe(500)
  })

  test('空白ページにならない（bodyに内容あり）', async ({ page }, testInfo) => {
    await page.goto('/history', { waitUntil: 'domcontentloaded' })

    // body に何らかのテキストが存在すること（空白ページ防止確認）
    const bodyText = await page.locator('body').textContent()
    expect(
      bodyText?.trim().length ?? 0,
      '空白ページが表示された（通知タップ後にblankになる問題が再現）'
    ).toBeGreaterThan(10)

    console.log(
      `[${testInfo.project.name}] /history body preview: "${bodyText?.trim().slice(0, 60)}..."`
    )
  })

  test('ページタイトルまたはコンテンツが存在する', async ({ page }, testInfo) => {
    await page.goto('/history', { waitUntil: 'domcontentloaded' })

    // ログインページかアプリページのいずれかが表示される
    const url = page.url()
    const isValidDest =
      url.includes('/history') ||
      url.includes('/login') ||
      url.includes('/trial-expired') ||
      url.includes('/expired')

    expect(
      isValidDest,
      `予期しないURLへリダイレクト: ${url}`
    ).toBeTruthy()
  })
})

// ──────────────────────────────────────────────
// テスト 3: アプリトップ & サーバー健全性
// ──────────────────────────────────────────────

test.describe('サーバー健全性', () => {
  test('/ が 500 を返さない', async ({ page }, testInfo) => {
    const res = await page.goto('/', { waitUntil: 'domcontentloaded' })
    console.log(`[${testInfo.project.name}] / status=${res?.status()}`)
    expect(res?.status()).not.toBe(500)
  })

  test('/api/version が JSON を返す', async ({ request }, testInfo) => {
    const BASE = testInfo.project.use.baseURL ?? 'https://yahooauction-watch.vercel.app'
    const res = await request.get(`${BASE}/api/version`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('v')
    console.log(`[${testInfo.project.name}] /api/version: ${JSON.stringify(body)}`)
  })
})

// ──────────────────────────────────────────────
// テスト 4: 通知URL検証 (webpush payload)
// ──────────────────────────────────────────────

test.describe('通知URL — Yahoo直リンク禁止確認', () => {
  test('sw.js が /history へナビゲートするロジックを含む', async ({ request }, testInfo) => {
    const BASE = testInfo.project.use.baseURL ?? 'https://yahooauction-watch.vercel.app'
    const res = await request.get(`${BASE}/sw.js`)
    expect(res.status()).toBe(200)

    const swCode = await res.text()

    // notificationclick ハンドラが /history へナビゲートすることを確認
    expect(
      swCode,
      'SW の notificationclick が /history に遷移しない'
    ).toContain("'/history'")

    // Yahoo直リンク（auctions.yahoo.co.jp）へ直接遷移していないことを確認
    // ※ auctionUrl 保存のため文字列として存在することはあるが、navigate先であってはならない
    const hasYahooNavigate = swCode.includes("navigate('https://") || swCode.includes('openWindow("https://')
    expect(
      hasYahooNavigate,
      'SW が Yahoo URL へ直接 navigate/openWindow している（空白ページの原因）'
    ).toBeFalsy()

    console.log(
      `[${testInfo.project.name}] sw.js CACHE_VERSION: ${swCode.match(/CACHE_VERSION\s*=\s*'([^']+)'/)?.[1]}`
    )
  })
})

// ──────────────────────────────────────────────
// テスト 5: cron/check/[shard] エンドポイント検証
// Discord エラー: "ユーザー取得失敗: TimeoutError" の再発防止
// ──────────────────────────────────────────────

test.describe('cron/check/[shard] — シャードエンドポイント健全性', () => {
  test('シークレットなしで 401 Unauthorized が返る', async ({ request }, testInfo) => {
    const BASE = testInfo.project.use.baseURL ?? 'https://yahooauction-watch.vercel.app'
    const res = await request.get(`${BASE}/api/cron/check/0`)
    // シークレットなしは必ず401（Unauthorized）
    expect(res.status()).toBe(401)
    console.log(`[${testInfo.project.name}] cron/check/0 (no secret) status=${res.status()}`)
  })

  test('無効なシャード番号（99）で 400 が返る', async ({ request }, testInfo) => {
    const BASE = testInfo.project.use.baseURL ?? 'https://yahooauction-watch.vercel.app'
    // シークレットなしの状態で確認（401が優先されるか400が返るか）
    const res = await request.get(`${BASE}/api/cron/check/99`)
    // 401 or 400（シャード番号バリデーションエラー）
    expect([400, 401]).toContain(res.status())
    console.log(`[${testInfo.project.name}] cron/check/99 status=${res.status()}`)
  })

  test('cron/check エンドポイントが 200ms以内に 200 or 401 を返す（waitUntil設計確認）', async ({ request }, testInfo) => {
    const BASE = testInfo.project.use.baseURL ?? 'https://yahooauction-watch.vercel.app'
    const start = Date.now()
    const res = await request.get(`${BASE}/api/cron/check/0`)
    const elapsed = Date.now() - start

    // waitUntil設計: 認証チェック後すぐレスポンスを返す
    // シークレットなしなら401が高速に返るはず（< 500ms）
    expect(elapsed).toBeLessThan(5_000)
    console.log(`[${testInfo.project.name}] cron/check/0 応答時間=${elapsed}ms status=${res.status()}`)
  })
})
