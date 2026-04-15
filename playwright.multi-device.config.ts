/**
 * マルチデバイス E2E テスト設定
 * iPhone 20台 + Android 20台 の計40デバイスでテスト
 *
 * 実行方法:
 *   BASE_URL=https://yahooauction-watch.vercel.app \
 *   npx playwright test --config playwright.multi-device.config.ts
 */
import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.BASE_URL ?? 'https://yahooauction-watch.vercel.app'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/multi-device.spec.ts',
  fullyParallel: true,
  retries: 1,
  workers: 8,
  reporter: [['html', { open: 'never', outputFolder: 'playwright-report-multi' }], ['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },

  projects: [
    // ═══════════════════════════════════════════
    // iPhone 20台
    // ═══════════════════════════════════════════
    {
      name: 'iPhone SE',
      use: { ...devices['iPhone SE'] },
    },
    {
      name: 'iPhone X',
      use: { ...devices['iPhone X'] },
    },
    {
      name: 'iPhone XR',
      use: { ...devices['iPhone XR'] },
    },
    {
      name: 'iPhone 11',
      use: { ...devices['iPhone 11'] },
    },
    {
      name: 'iPhone 11 Pro',
      use: { ...devices['iPhone 11 Pro'] },
    },
    {
      name: 'iPhone 12',
      use: { ...devices['iPhone 12'] },
    },
    {
      name: 'iPhone 12 Mini',
      use: { ...devices['iPhone 12 Mini'] },
    },
    {
      name: 'iPhone 12 Pro',
      use: { ...devices['iPhone 12 Pro'] },
    },
    {
      name: 'iPhone 12 Pro Max',
      use: { ...devices['iPhone 12 Pro Max'] },
    },
    {
      name: 'iPhone 13',
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'iPhone 13 Mini',
      use: { ...devices['iPhone 13 Mini'] },
    },
    {
      name: 'iPhone 13 Pro',
      use: { ...devices['iPhone 13 Pro'] },
    },
    {
      name: 'iPhone 13 Pro Max',
      use: { ...devices['iPhone 13 Pro Max'] },
    },
    {
      name: 'iPhone 14',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'iPhone 14 Plus',
      use: { ...devices['iPhone 14 Plus'] },
    },
    {
      name: 'iPhone 14 Pro',
      use: { ...devices['iPhone 14 Pro'] },
    },
    {
      name: 'iPhone 14 Pro Max',
      use: { ...devices['iPhone 14 Pro Max'] },
    },
    {
      name: 'iPhone 15',
      use: { ...devices['iPhone 15'] },
    },
    {
      name: 'iPhone 15 Pro',
      use: { ...devices['iPhone 15 Pro'] },
    },
    {
      name: 'iPhone 15 Pro Max',
      use: { ...devices['iPhone 15 Pro Max'] },
    },

    // ═══════════════════════════════════════════
    // Android 20台
    // ═══════════════════════════════════════════
    {
      name: 'Pixel 2',
      use: { ...devices['Pixel 2'] },
    },
    {
      name: 'Pixel 2 XL',
      use: { ...devices['Pixel 2 XL'] },
    },
    {
      name: 'Pixel 3',
      use: { ...devices['Pixel 3'] },
    },
    {
      name: 'Pixel 3 XL',
      use: { ...devices['Pixel 3 XL'] },
    },
    {
      name: 'Pixel 3a',
      use: { ...devices['Pixel 3a'] },
    },
    {
      name: 'Pixel 4',
      use: { ...devices['Pixel 4'] },
    },
    {
      name: 'Pixel 4 XL',
      use: { ...devices['Pixel 4 XL'] },
    },
    {
      name: 'Pixel 4a (5G)',
      use: { ...devices['Pixel 4a (5G)'] },
    },
    {
      name: 'Pixel 5',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Pixel 6',
      use: { ...devices['Pixel 6'] },
    },
    {
      name: 'Pixel 7',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'Galaxy S III',
      use: { ...devices['Galaxy S III'] },
    },
    {
      name: 'Galaxy S5',
      use: { ...devices['Galaxy S5'] },
    },
    {
      name: 'Galaxy S8',
      use: { ...devices['Galaxy S8'] },
    },
    {
      name: 'Galaxy S9+',
      use: { ...devices['Galaxy S9+'] },
    },
    {
      name: 'Moto G4',
      use: { ...devices['Moto G4'] },
    },
    {
      name: 'Nexus 5',
      use: { ...devices['Nexus 5'] },
    },
    {
      name: 'Nexus 6',
      use: { ...devices['Nexus 6'] },
    },
    {
      name: 'Nexus 6P',
      use: { ...devices['Nexus 6P'] },
    },
    {
      name: 'Nexus 7',
      use: { ...devices['Nexus 7'] },
    },
  ],
})
