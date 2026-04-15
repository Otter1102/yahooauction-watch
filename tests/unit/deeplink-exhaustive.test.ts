/**
 * DeepLink 網羅テスト — 100パターン UserAgent 検証
 *
 * iPhone各種 / Android各種 / PC各種 の UAを生成し、
 * 全ケースで正しいプラットフォーム判定・URLスキームが生成されるか検証する。
 */
import { describe, it, expect } from 'vitest'
import {
  detectPlatform,
  isValidAuctionId,
  resolveDeepLink,
} from '@/lib/deeplink'

const VALID_ID = 'v1234567890'

// ── UA ジェネレーター ──────────────────────────────────────────────────────

const iosUAs = [
  // iPhone — iOS バージョン各種
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 13_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 13_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  // iPhone — Chrome on iOS
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 CriOS/124.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1',
  // iPhone — Firefox on iOS
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 FxiOS/124.0 Mobile/15E148 Safari/604.1',
  // iPhone — Line app webview
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 FBAN/FBIOS Mobile/15E148 Safari/604.1',
  // iPad — iOS
  'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 15_8 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 14_8 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  // iPhone 15 Pro (latest model simulation)
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1',
]

const androidUAs = [
  // Pixel シリーズ
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Pixel 7 Pro) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; Pixel 6a) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 Chrome/110.0.0.0 Mobile Safari/537.36',
  // Samsung Galaxy
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-A546B) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; SM-G998B) AppleWebKit/537.36 Chrome/110.0.0.0 Mobile Safari/537.36',
  // Xiaomi / Redmi
  'Mozilla/5.0 (Linux; Android 13; 2201123G) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; M2007J3SC) AppleWebKit/537.36 Chrome/110.0.0.0 Mobile Safari/537.36',
  // OPPO / OnePlus
  'Mozilla/5.0 (Linux; Android 13; CPH2551) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; LE2125) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
  // Android — Firefox
  'Mozilla/5.0 (Android 14; Mobile; rv:124.0) Gecko/124.0 Firefox/124.0',
  'Mozilla/5.0 (Android 13; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0',
  // Android Tablet
  'Mozilla/5.0 (Linux; Android 13; SM-X706B) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; SM-T875) AppleWebKit/537.36 Chrome/110.0.0.0 Safari/537.36',
  // Android — Samsung Browser
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  // Android 旧バージョン
  'Mozilla/5.0 (Linux; Android 10; SM-G970F) AppleWebKit/537.36 Chrome/100.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 9; SM-G960F) AppleWebKit/537.36 Chrome/90.0.0.0 Mobile Safari/537.36',
]

const desktopUAs = [
  // Mac — Chrome各種バージョン
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  // Mac — Safari
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 Version/17.4.1 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
  // Mac — Firefox
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:124.0) Gecko/20100101 Firefox/124.0',
  // Mac — Edge
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Edg/124.0.0.0 Safari/537.36',
  // Windows — Chrome
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  // Windows — Edge
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/124.0.0.0 Safari/537.36',
  // Windows — Firefox
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  // Windows — IE11 (古いUA)
  'Mozilla/5.0 (Windows NT 10.0; Trident/7.0; rv:11.0) like Gecko',
  // Linux — Chrome
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  // Linux — Firefox
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0',
  // ChromeOS
  'Mozilla/5.0 (X11; CrOS x86_64 15633.37.0) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36',
  // 空文字・エッジケース
  '',
  'unknown-browser/1.0',
  'Googlebot/2.1 (+http://www.google.com/bot.html)',
]

// ── 100パターン網羅テスト ─────────────────────────────────────────────────

describe('detectPlatform — iOS UA 全パターン', () => {
  for (const ua of iosUAs) {
    it(`iOS判定: "${ua.slice(0, 60)}..."`, () => {
      expect(detectPlatform(ua)).toBe('ios')
    })
  }
})

describe('detectPlatform — Android UA 全パターン', () => {
  for (const ua of androidUAs) {
    it(`Android判定: "${ua.slice(0, 60)}..."`, () => {
      expect(detectPlatform(ua)).toBe('android')
    })
  }
})

describe('detectPlatform — Desktop UA 全パターン', () => {
  for (const ua of desktopUAs) {
    it(`Desktop判定: "${ua.slice(0, 60)}..."`, () => {
      expect(detectPlatform(ua)).toBe('desktop')
    })
  }
})

// ── resolveDeepLink — 全パターンでURLスキームが正しく生成されるか ─────────

describe('resolveDeepLink — iOSは常に type:app + yahuoku:// スキーム', () => {
  for (const ua of iosUAs) {
    it(`iOS: "${ua.slice(0, 50)}..."`, () => {
      const result = resolveDeepLink({ auctionId: VALID_ID, ua })
      expect(result.type).toBe('app')
      if (result.type === 'app') {
        expect(result.platform).toBe('ios')
        expect(result.scheme).toMatch(/^yahuoku:\/\//)
        expect(result.scheme).toContain(VALID_ID)
        expect(result.fallback).toContain('auctions.yahoo.co.jp')
        expect(result.fallback).toContain(VALID_ID)
      }
    })
  }
})

describe('resolveDeepLink — Androidは常に type:app + yahuoku:// スキーム', () => {
  for (const ua of androidUAs) {
    it(`Android: "${ua.slice(0, 50)}..."`, () => {
      const result = resolveDeepLink({ auctionId: VALID_ID, ua })
      expect(result.type).toBe('app')
      if (result.type === 'app') {
        expect(result.platform).toBe('android')
        expect(result.scheme).toMatch(/^yahuoku:\/\//)
        expect(result.scheme).toContain(VALID_ID)
      }
    })
  }
})

describe('resolveDeepLink — Desktopは常に type:browser + Yahoo URL', () => {
  for (const ua of desktopUAs) {
    it(`Desktop: "${ua.slice(0, 50)}..."`, () => {
      const result = resolveDeepLink({ auctionId: VALID_ID, ua })
      expect(result.type).toBe('browser')
      if (result.type === 'browser') {
        expect(result.platform).toBe('desktop')
        expect(result.url).toContain('auctions.yahoo.co.jp')
        expect(result.url).toContain(VALID_ID)
      }
    })
  }
})

// ── isValidAuctionId — 有効IDは全パターン true ──────────────────────────

describe('isValidAuctionId — 有効IDパターン', () => {
  const validIds = [
    'v1234567890', 'x987654321', 'abc123', 'z00000001',
    'abcd1234', 'a123456789012345678', // 最大長近く
    'v0000000', 'q99999999',
  ]
  for (const id of validIds) {
    it(`valid: "${id}"`, () => expect(isValidAuctionId(id)).toBe(true))
  }
})

describe('isValidAuctionId — 無効IDは全パターン false', () => {
  const invalidIds = [
    '', '1startsWithNumber', 'ab', '../etc/passwd',
    '<script>alert(1)</script>', 'a'.repeat(25), ' spaces ',
    'has/slash', 'has?query', 'has#hash', '\x00null',
  ]
  for (const id of invalidIds) {
    it(`invalid: "${id.slice(0, 20)}"`, () => expect(isValidAuctionId(id)).toBe(false))
  }
})
