import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on',       // Trace Viewer 用: 全テストでトレース記録
    screenshot: 'on',  // 失敗時にスクショ保存
  },
  projects: [
    // ── デスクトップ ──────────────────────────────────────────────
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    // ── iOS (iPhone 15) ──────────────────────────────────────────
    {
      name: 'iPhone 15',
      use: { ...devices['iPhone 15'] },
    },
    // ── Android (Pixel 7) ────────────────────────────────────────
    {
      name: 'Pixel 7',
      use: { ...devices['Pixel 7'] },
    },
    // ── iOS (iPhone 15 Pro) ──────────────────────────────────────
    {
      name: 'iPhone 15 Pro',
      use: { ...devices['iPhone 15 Pro'] },
    },
  ],
  // テスト前に Next.js dev server を自動起動
  webServer: {
    command: 'npm run dev',
    url: process.env.BASE_URL ?? 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 30000,
  },
})
