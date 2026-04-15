# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: multi-device.spec.ts >> run-now API — 500エラー検出 >> 無効userId → 500 ではなく 400/404 が返る
- Location: tests/e2e/multi-device.spec.ts:40:7

# Error details

```
TimeoutError: apiRequestContext.post: Timeout 15000ms exceeded.
Call log:
  - → POST https://yahooauction-watch-trial.vercel.app/api/run-now
    - user-agent: Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Mobile/15E148 Safari/604.1
    - accept: */*
    - accept-encoding: gzip,deflate,br
    - Content-Type: application/json
    - Origin: https://yahooauction-watch-trial.vercel.app
    - content-length: 51

```

# Test source

```ts
  1   | /**
  2   |  * マルチデバイス E2E テスト — iPhone 20台 / Android 20台
  3   |  *
  4   |  * テスト観点:
  5   |  *  1. run-now API: 無効userIdで 500 ではなく 400/404 が返るか
  6   |  *  2. /history ページが空白にならないか（通知タップ先の確認）
  7   |  *  3. アプリトップが正常ロードされるか（500 を返さないか）
  8   |  *  4. SW/通知URL: webpush payload の url が /history を指しているか
  9   |  *     → /api/push/test エンドポイントをモックで検証
  10  |  *  5. cron/check/[shard]: シークレットなしでUnauthorized(401)が返るか
  11  |  *  6. cron API応答速度: 200ms以内に200を返すか（waitUntil設計確認）
  12  |  *
  13  |  * 実行:
  14  |  *   BASE_URL=https://yahooauction-watch.vercel.app \
  15  |  *   npx playwright test --config playwright.multi-device.config.ts
  16  |  */
  17  | import { test, expect } from '@playwright/test'
  18  | 
  19  | // ──────────────────────────────────────────────
  20  | // ヘルパー
  21  | // ──────────────────────────────────────────────
  22  | 
  23  | /** run-now に無効userIdを送信して結果を返す */
  24  | async function callRunNow(request: import('@playwright/test').APIRequestContext, baseURL: string) {
> 25  |   return request.post(`${baseURL}/api/run-now`, {
      |                  ^ TimeoutError: apiRequestContext.post: Timeout 15000ms exceeded.
  26  |     data: { userId: 'test-nonexistent-user-playwright-check' },
  27  |     headers: {
  28  |       'Content-Type': 'application/json',
  29  |       // Origin を baseURL に合わせてCSRFを通過させる
  30  |       'Origin': baseURL,
  31  |     },
  32  |   })
  33  | }
  34  | 
  35  | // ──────────────────────────────────────────────
  36  | // テスト 1: run-now API エラーハンドリング
  37  | // ──────────────────────────────────────────────
  38  | 
  39  | test.describe('run-now API — 500エラー検出', () => {
  40  |   test('無効userId → 500 ではなく 400/404 が返る', async ({ request }, testInfo) => {
  41  |     const BASE = testInfo.project.use.baseURL ?? 'https://yahooauction-watch.vercel.app'
  42  |     const res = await callRunNow(request, BASE)
  43  | 
  44  |     const body = await res.json().catch(() => ({}))
  45  |     console.log(
  46  |       `[${testInfo.project.name}] run-now status=${res.status()} body=${JSON.stringify(body)}`
  47  |     )
  48  | 
  49  |     // 500 は絶対NG: サーバー側で予期しないエラーが発生している
  50  |     expect(
  51  |       res.status(),
  52  |       `500 Internal Server Error が返った。エラー内容: ${JSON.stringify(body)}`
  53  |     ).not.toBe(500)
  54  | 
  55  |     // 期待値: 400 (validation error) or 404 (user not found) or 429 (rate limit)
  56  |     expect([400, 404, 429]).toContain(res.status())
  57  |   })
  58  | })
  59  | 
  60  | // ──────────────────────────────────────────────
  61  | // テスト 2: /history 通知タップ先
  62  | // ──────────────────────────────────────────────
  63  | 
  64  | test.describe('/history — 通知タップ先ページ', () => {
  65  |   test('500 を返さない', async ({ page }, testInfo) => {
  66  |     const res = await page.goto('/history', { waitUntil: 'domcontentloaded' })
  67  |     console.log(`[${testInfo.project.name}] /history status=${res?.status()} url=${page.url()}`)
  68  | 
  69  |     // 500 は絶対NG
  70  |     expect(res?.status()).not.toBe(500)
  71  |   })
  72  | 
  73  |   test('空白ページにならない（bodyに内容あり）', async ({ page }, testInfo) => {
  74  |     await page.goto('/history', { waitUntil: 'domcontentloaded' })
  75  | 
  76  |     // body に何らかのテキストが存在すること（空白ページ防止確認）
  77  |     const bodyText = await page.locator('body').textContent()
  78  |     expect(
  79  |       bodyText?.trim().length ?? 0,
  80  |       '空白ページが表示された（通知タップ後にblankになる問題が再現）'
  81  |     ).toBeGreaterThan(10)
  82  | 
  83  |     console.log(
  84  |       `[${testInfo.project.name}] /history body preview: "${bodyText?.trim().slice(0, 60)}..."`
  85  |     )
  86  |   })
  87  | 
  88  |   test('ページタイトルまたはコンテンツが存在する', async ({ page }, testInfo) => {
  89  |     await page.goto('/history', { waitUntil: 'domcontentloaded' })
  90  | 
  91  |     // ログインページかアプリページのいずれかが表示される
  92  |     const url = page.url()
  93  |     const isValidDest =
  94  |       url.includes('/history') ||
  95  |       url.includes('/login') ||
  96  |       url.includes('/yahoo-callback') ||
  97  |       url.includes('/trial-expired') ||
  98  |       url.includes('/expired')
  99  | 
  100 |     expect(
  101 |       isValidDest,
  102 |       `予期しないURLへリダイレクト: ${url}`
  103 |     ).toBeTruthy()
  104 |   })
  105 | })
  106 | 
  107 | // ──────────────────────────────────────────────
  108 | // テスト 3: アプリトップ & サーバー健全性
  109 | // ──────────────────────────────────────────────
  110 | 
  111 | test.describe('サーバー健全性', () => {
  112 |   test('/ が 500 を返さない', async ({ page }, testInfo) => {
  113 |     const res = await page.goto('/', { waitUntil: 'domcontentloaded' })
  114 |     console.log(`[${testInfo.project.name}] / status=${res?.status()}`)
  115 |     expect(res?.status()).not.toBe(500)
  116 |   })
  117 | 
  118 |   test('/api/version が JSON を返す', async ({ request }, testInfo) => {
  119 |     const BASE = testInfo.project.use.baseURL ?? 'https://yahooauction-watch.vercel.app'
  120 |     const res = await request.get(`${BASE}/api/version`)
  121 |     expect(res.status()).toBe(200)
  122 |     const body = await res.json()
  123 |     expect(body).toHaveProperty('v')
  124 |     console.log(`[${testInfo.project.name}] /api/version: ${JSON.stringify(body)}`)
  125 |   })
```