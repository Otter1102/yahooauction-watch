/**
 * /redirect/[id] E2E テスト
 *
 * Playwright のデバイスエミュレーションで PC / iPhone / Android の挙動を確認する。
 * `npx playwright test --ui` で UI Mode（仮想スマホ画面）が起動する。
 */
import { test, expect } from '@playwright/test'

const VALID_ID   = 'v1234567890'
const INVALID_ID = '../etc/passwd'

// ── Desktop ───────────────────────────────────────────────────────────────

test.describe('Desktop Chrome', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36' })

  test('有効IDで auctions.yahoo.co.jp へリダイレクト', async ({ page }) => {
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().includes('auctions.yahoo.co.jp'), { timeout: 8000 }).catch(() => null),
      page.goto(`/redirect/${VALID_ID}`, { waitUntil: 'commit' }),
    ])
    // リダイレクト先がYahooドメインであること
    expect(page.url()).toContain('auctions.yahoo.co.jp')
  })

  test('無効IDは / にリダイレクト', async ({ page }) => {
    await page.goto(`/redirect/${encodeURIComponent(INVALID_ID)}`, { waitUntil: 'domcontentloaded' })
    expect(page.url()).not.toContain(INVALID_ID)
  })
})

// ── iPhone 15 ─────────────────────────────────────────────────────────────

test.describe('iPhone 15', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' })

  test('「アプリを起動する」ボタンが表示される', async ({ page }) => {
    await page.goto(`/redirect/${VALID_ID}`, { waitUntil: 'domcontentloaded' })

    // iOS ページが表示されることを確認
    const btn = page.locator('a.btn-main')
    await expect(btn).toBeVisible()
    await expect(btn).toContainText('アプリを起動する')
  })

  test('アプリボタンのhrefが yahuoku:// スキームで IDを含む', async ({ page }) => {
    await page.goto(`/redirect/${VALID_ID}`, { waitUntil: 'domcontentloaded' })
    const href = await page.locator('a.btn-main').getAttribute('href')
    expect(href).toMatch(/^yahuoku:\/\//)
    expect(href).toContain(VALID_ID)
  })

  test('「ブラウザ版」リンクが Yahoo URL を指している', async ({ page }) => {
    await page.goto(`/redirect/${VALID_ID}`, { waitUntil: 'domcontentloaded' })
    const href = await page.locator('a.btn-sub').getAttribute('href')
    expect(href).toContain('auctions.yahoo.co.jp')
    expect(href).toContain(VALID_ID)
  })

  test('スクリーンショット: iOSのDeepLink画面', async ({ page }) => {
    await page.goto(`/redirect/${VALID_ID}`, { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveScreenshot('ios-deeplink.png', { fullPage: true })
  })
})

// ── Android (Pixel 7) ─────────────────────────────────────────────────────

test.describe('Android Pixel 7', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36' })

  // yahuoku:// 自動起動スクリプトをレスポンスから除去してナビゲーションタイムアウトを防ぐ
  async function blockYahuokuScheme(page: import('@playwright/test').Page) {
    await page.route('**/redirect/**', async (route) => {
      const response = await route.fetch()
      const body = await response.text()
      // window.location.href = "yahuoku://..." を void(0) に置換
      const patched = body.replace(
        /window\.location\.href\s*=\s*["']yahuoku:\/\/[^"']*["'];?/g,
        'void(0);'
      )
      await route.fulfill({ response, body: patched, contentType: 'text/html; charset=utf-8' })
    })
  }

  test('スピナーが最初に表示される（自動起動中）', async ({ page }) => {
    await blockYahuokuScheme(page)
    await page.goto(`/redirect/${VALID_ID}`, { waitUntil: 'domcontentloaded' })
    // ローディングスピナー
    await expect(page.locator('.s')).toBeVisible({ timeout: 5000 })
  })

  test('2.5秒後にフォールバックボタンが表示される', async ({ page }) => {
    await blockYahuokuScheme(page)
    await page.goto(`/redirect/${VALID_ID}`, { waitUntil: 'commit' })
    // フォールバックブロックは最初は display:none
    await expect(page.locator('#fb')).toBeHidden({ timeout: 3000 })
    // 2.5秒待機（JS タイマーで表示）
    await page.waitForTimeout(2600)
    await expect(page.locator('#fb')).toBeVisible({ timeout: 3000 })
  })

  test('フォールバックボタンのhrefが yahuoku:// スキームを含む', async ({ page }) => {
    await blockYahuokuScheme(page)
    await page.goto(`/redirect/${VALID_ID}`, { waitUntil: 'commit' })
    await page.waitForTimeout(2600)
    const href = await page.locator('#fb a.btn-main').getAttribute('href', { timeout: 3000 })
    expect(href).toMatch(/^yahuoku:\/\//)
    expect(href).toContain(VALID_ID)
  })

  test('スクリーンショット: Android フォールバック画面', async ({ page }) => {
    await blockYahuokuScheme(page)
    await page.goto(`/redirect/${VALID_ID}`, { waitUntil: 'commit' })
    await page.waitForTimeout(2600)
    await expect(page).toHaveScreenshot('android-deeplink-fallback.png', { fullPage: true })
  })
})

// ── セキュリティ: ID バリデーション ──────────────────────────────────────

test.describe('セキュリティ: Open Redirect 防止', () => {
  const attackIds = ['../etc/passwd', '<script>alert(1)</script>', 'a'.repeat(30)]

  for (const id of attackIds) {
    test(`攻撃ID "${id.slice(0, 20)}" は / にリダイレクト`, async ({ page }) => {
      await page.goto(`/redirect/${encodeURIComponent(id)}`, { waitUntil: 'domcontentloaded' })
      // 攻撃IDがURLに残っていないこと
      expect(page.url()).not.toContain(encodeURIComponent(id).slice(0, 10))
    })
  }
})
