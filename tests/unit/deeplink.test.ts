/**
 * DeepLink ユニットテスト
 * PC / iOS / Android の UA をシミュレーションして全ケースを検証する
 */
import { describe, it, expect } from 'vitest'
import {
  detectPlatform,
  isValidAuctionId,
  toYahuokuScheme,
  toAuctionBrowserUrl,
  resolveDeepLink,
  escHtml,
} from '@/lib/deeplink'

// ── Real-world UA strings ─────────────────────────────────────────────────
const UA = {
  iPhone:  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iPad:    'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  mac:     'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}

const VALID_ID   = 'v1234567890'
const INVALID_IDS = ['', '1novalpha', 'ab', '../etc/passwd', '<script>', 'a'.repeat(25)]

// ── detectPlatform ────────────────────────────────────────────────────────

describe('detectPlatform', () => {
  it('iPhone → ios', () => expect(detectPlatform(UA.iPhone)).toBe('ios'))
  it('iPad → ios',   () => expect(detectPlatform(UA.iPad)).toBe('ios'))
  it('Pixel 7 → android', () => expect(detectPlatform(UA.android)).toBe('android'))
  it('Mac Chrome → desktop', () => expect(detectPlatform(UA.mac)).toBe('desktop'))
  it('Windows → desktop',    () => expect(detectPlatform(UA.windows)).toBe('desktop'))
  it('空文字 → desktop',      () => expect(detectPlatform('')).toBe('desktop'))
})

// ── isValidAuctionId ──────────────────────────────────────────────────────

describe('isValidAuctionId', () => {
  it('正常なID (v1234567890)', () => expect(isValidAuctionId('v1234567890')).toBe(true))
  it('正常なID (x987654321)',  () => expect(isValidAuctionId('x987654321')).toBe(true))
  it('正常なID (abc123)',      () => expect(isValidAuctionId('abc123')).toBe(true))

  for (const id of INVALID_IDS) {
    it(`無効ID: "${id.slice(0, 20)}"`, () => expect(isValidAuctionId(id)).toBe(false))
  }
})

// ── toYahuokuScheme / toAuctionBrowserUrl ─────────────────────────────────

describe('URL生成', () => {
  it('yahuoku:// スキームを正しく生成', () => {
    expect(toYahuokuScheme(VALID_ID))
      .toBe(`yahuoku://jp.yahoo.auctions.item/v1/auction?id=${VALID_ID}`)
  })

  it('ブラウザ版URLを正しく生成', () => {
    expect(toAuctionBrowserUrl(VALID_ID))
      .toBe(`https://auctions.yahoo.co.jp/auction/${VALID_ID}`)
  })
})

// ── resolveDeepLink ───────────────────────────────────────────────────────

describe('resolveDeepLink', () => {
  it('iPhone → type:app, platform:ios', () => {
    const r = resolveDeepLink({ auctionId: VALID_ID, ua: UA.iPhone })
    expect(r.type).toBe('app')
    if (r.type === 'app') {
      expect(r.platform).toBe('ios')
      expect(r.scheme).toContain('yahuoku://')
      expect(r.scheme).toContain(VALID_ID)
      expect(r.fallback).toContain(VALID_ID)
    }
  })

  it('iPad → type:app, platform:ios', () => {
    const r = resolveDeepLink({ auctionId: VALID_ID, ua: UA.iPad })
    expect(r.type).toBe('app')
    if (r.type === 'app') expect(r.platform).toBe('ios')
  })

  it('Android → type:app, platform:android', () => {
    const r = resolveDeepLink({ auctionId: VALID_ID, ua: UA.android })
    expect(r.type).toBe('app')
    if (r.type === 'app') {
      expect(r.platform).toBe('android')
      expect(r.scheme).toContain('yahuoku://')
    }
  })

  it('Mac → type:browser, platform:desktop', () => {
    const r = resolveDeepLink({ auctionId: VALID_ID, ua: UA.mac })
    expect(r.type).toBe('browser')
    if (r.type === 'browser') {
      expect(r.platform).toBe('desktop')
      expect(r.url).toContain(VALID_ID)
    }
  })

  it('Windows → type:browser, platform:desktop', () => {
    const r = resolveDeepLink({ auctionId: VALID_ID, ua: UA.windows })
    expect(r.type).toBe('browser')
  })

  it('空UA → type:browser (desktop フォールバック)', () => {
    const r = resolveDeepLink({ auctionId: VALID_ID, ua: '' })
    expect(r.type).toBe('browser')
  })
})

// ── escHtml ───────────────────────────────────────────────────────────────

describe('escHtml (XSSエスケープ)', () => {
  it('& → &amp;',  () => expect(escHtml('a&b')).toBe('a&amp;b'))
  it('" → &quot;', () => expect(escHtml('"hi"')).toBe('&quot;hi&quot;'))
  it('< → &lt;',   () => expect(escHtml('<script>')).toBe('&lt;script&gt;'))
  it('> → &gt;',   () => expect(escHtml('a>b')).toBe('a&gt;b'))
  it('スキームURLをエスケープしてもIDが含まれる', () => {
    const escaped = escHtml(toYahuokuScheme(VALID_ID))
    expect(escaped).toContain(VALID_ID)
    expect(escaped).not.toContain('"')
  })
})
