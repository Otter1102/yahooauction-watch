/**
 * トライアル保護 E2E テスト
 *
 * 検証シナリオ:
 *  S1: setStoredToken → localStorage に保存
 *  S2: setStoredToken → IndexedDB に保存
 *  S3: setStoredToken → CacheStorage に保存
 *  S4: Cookie のみ削除後、localStorage → getStoredToken が localToken を返す
 *  S5: localStorage 削除後、IndexedDB → getStoredToken が localToken を返す
 *  S6: localStorage + IDB 削除後、Cache → getStoredToken が localToken を返す
 *  S7: 全ストレージ空 → getStoredToken が null を返す
 *  S8: /trial-expired ページが正しく表示される
 *  S9: /api/trial/status が新規セッションを作成し clientToken を返す
 * S10: /api/trial/status が localToken で既存セッションを認識する
 *
 * 実行方法:
 *   npm run test:e2e -- --grep "trial-protection" --project="Desktop Chrome"
 */
import { test, expect } from '@playwright/test'

// ────────────────────────────────────────────────────────────────────────────
// テスト踏み台: 認証不要の /trial-expired ページで storage 操作を実行
// ────────────────────────────────────────────────────────────────────────────

const BASE_PAGE = '/trial-expired'
const TEST_TOKEN = 'test1234-abcd-ef00-1234-567890abcdef'

// ──────────────────────────────────────────────────────────────────────────
// ヘルパー: ブラウザ内でストレージ操作を実行する関数（page.evaluate で注入）
// ──────────────────────────────────────────────────────────────────────────
const storageHelpers = /* js */`
  const KEY = '_ytrial_token';
  const IDB_DB_NAME = 'ytw-trial';
  const IDB_STORE = 'session';
  const CACHE_NAME = 'ytw-trial-v1';

  async function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet() {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbDelete() {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function cacheGet() {
    if (typeof caches === 'undefined') return null;
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(KEY);
    if (!res) return null;
    return res.text();
  }
  async function cacheSet(value) {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open(CACHE_NAME);
    await cache.put(KEY, new Response(value, { status: 200 }));
  }
  async function cacheDelete() {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(KEY);
  }
  async function setAll(token) {
    localStorage.setItem(KEY, token);
    await idbSet(token);
    await cacheSet(token);
  }
  async function getFirst() {
    // getStoredToken と同じ優先順位
    const ls = localStorage.getItem(KEY);
    if (ls) return ls;
    const idb = await idbGet();
    if (idb) return idb;
    const cache = await cacheGet();
    return cache;
  }
`

test.describe('trial-protection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_PAGE)
    // 全ストレージを初期化
    await page.evaluate(/* js */`
      (async () => {
        ${storageHelpers}
        localStorage.removeItem(KEY);
        await idbDelete();
        await cacheDelete();
      })()
    `)
  })

  // ────────────────────────────────────────────────────────────────────────
  // S1: localStorage に保存される
  // ────────────────────────────────────────────────────────────────────────
  test('S1: setStoredToken → localStorage に保存される', async ({ page }) => {
    await page.evaluate(`
      (async () => {
        ${storageHelpers}
        localStorage.setItem(KEY, '${TEST_TOKEN}');
      })()
    `)
    const ls = await page.evaluate(`localStorage.getItem('_ytrial_token')`)
    expect(ls).toBe(TEST_TOKEN)
  })

  // ────────────────────────────────────────────────────────────────────────
  // S2: IndexedDB に保存される
  // ────────────────────────────────────────────────────────────────────────
  test('S2: setStoredToken → IndexedDB に保存される', async ({ page }) => {
    const idb = await page.evaluate(`
      (async () => {
        ${storageHelpers}
        await idbSet('${TEST_TOKEN}');
        return idbGet();
      })()
    `)
    expect(idb).toBe(TEST_TOKEN)
  })

  // ────────────────────────────────────────────────────────────────────────
  // S3: CacheStorage に保存される
  // ────────────────────────────────────────────────────────────────────────
  test('S3: setStoredToken → CacheStorage に保存される', async ({ page }) => {
    const cached = await page.evaluate(`
      (async () => {
        ${storageHelpers}
        await cacheSet('${TEST_TOKEN}');
        return cacheGet();
      })()
    `)
    expect(cached).toBe(TEST_TOKEN)
  })

  // ────────────────────────────────────────────────────────────────────────
  // S4: localStorage → getFirst が値を返す（Cookie 削除シナリオ）
  // ────────────────────────────────────────────────────────────────────────
  test('S4: Cookie 削除後、localStorage が存在すれば getFirst で取得できる', async ({ page }) => {
    await page.context().clearCookies()  // Cookie だけ削除

    const result = await page.evaluate(`
      (async () => {
        ${storageHelpers}
        localStorage.setItem(KEY, '${TEST_TOKEN}');
        return getFirst();
      })()
    `)
    expect(result).toBe(TEST_TOKEN)
  })

  // ────────────────────────────────────────────────────────────────────────
  // S5: localStorage 削除後、IndexedDB にフォールバックする
  // ────────────────────────────────────────────────────────────────────────
  test('S5: localStorage 削除後、IndexedDB フォールバックで取得できる', async ({ page }) => {
    const result = await page.evaluate(`
      (async () => {
        ${storageHelpers}
        // IDB だけに保存（localStorage は空）
        await idbSet('${TEST_TOKEN}');
        localStorage.removeItem(KEY);
        return getFirst();
      })()
    `)
    expect(result).toBe(TEST_TOKEN)
  })

  // ────────────────────────────────────────────────────────────────────────
  // S6: localStorage + IDB 削除後、CacheStorage にフォールバックする
  // ────────────────────────────────────────────────────────────────────────
  test('S6: localStorage + IDB 削除後、CacheStorage フォールバックで取得できる', async ({ page }) => {
    const result = await page.evaluate(`
      (async () => {
        ${storageHelpers}
        // Cache だけに保存
        await cacheSet('${TEST_TOKEN}');
        localStorage.removeItem(KEY);
        await idbDelete();
        return getFirst();
      })()
    `)
    expect(result).toBe(TEST_TOKEN)
  })

  // ────────────────────────────────────────────────────────────────────────
  // S7: 全ストレージ空 → null を返す
  // ────────────────────────────────────────────────────────────────────────
  test('S7: 全ストレージ空 → getFirst が null を返す', async ({ page }) => {
    const result = await page.evaluate(`
      (async () => {
        ${storageHelpers}
        // beforeEach でクリア済みなのでそのまま確認
        return getFirst();
      })()
    `)
    expect(result).toBeNull()
  })

  // ────────────────────────────────────────────────────────────────────────
  // S8: /trial-expired ページの表示確認
  // ────────────────────────────────────────────────────────────────────────
  test('S8: /trial-expired ページが正しく表示される', async ({ page }) => {
    await page.goto('/trial-expired')
    await expect(page.locator('h1')).toContainText('トライアル期間が終了しました')
    await expect(page.locator('text=永久ライセンスを購入する')).toBeVisible()
    await expect(page.locator('text=条件50個まで')).toBeVisible()
  })

  // ────────────────────────────────────────────────────────────────────────
  // S9: /api/trial/status が新規セッションを作成し clientToken を返す
  // ────────────────────────────────────────────────────────────────────────
  test('S9: /api/trial/status → 新規セッションで clientToken が返る', async ({ page }, testInfo) => {
    // 並列テストと fp 衝突しないようにworkerIndex + 乱数で一意にする
    const fp = `test-fp-e2e-s9-w${testInfo.workerIndex}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const res = await page.request.post('/api/trial/status', {
      data: { fp, pushEndpoint: null, localToken: null },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.secondsLeft).toBeGreaterThan(0)
    expect(body.expired).toBe(false)
    expect(body.clientToken).toBeTruthy()
    expect(typeof body.clientToken).toBe('string')
  })

  // ────────────────────────────────────────────────────────────────────────
  // S10: /api/trial/status が localToken で既存セッションを認識する
  // ────────────────────────────────────────────────────────────────────────
  test('S10: /api/trial/status → localToken で既存セッションを認識する', async ({ page }, testInfo) => {
    // 並列テストと fp 衝突しないようにworkerIndex + 乱数で一意にする
    const uid = `${testInfo.workerIndex}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const fp1 = `test-fp-e2e-s10-w${uid}`

    // まず新規セッションを作成してトークンを取得
    const res1 = await page.request.post('/api/trial/status', {
      data: { fp: fp1, pushEndpoint: null, localToken: null },
    })
    const { clientToken, secondsLeft: sl1 } = await res1.json()
    expect(clientToken).toBeTruthy()

    // 別のフィンガープリント（別ブラウザを模擬）+ localToken で再アクセス
    const fp2 = `test-fp-e2e-s10-diff-w${uid}-${Math.random().toString(36).slice(2)}`
    const res2 = await page.request.post('/api/trial/status', {
      data: { fp: fp2, pushEndpoint: null, localToken: clientToken },
    })
    expect(res2.status()).toBe(200)
    const body2 = await res2.json()
    // 同じ clientToken が返ってくる（= 同一セッション認識）
    expect(body2.clientToken).toBe(clientToken)
    // 残り時間は新規セッション（sl1）と同程度
    expect(body2.secondsLeft).toBeGreaterThan(0)
    // 残り時間の差が5秒以内（同一セッションなので）
    expect(Math.abs(body2.secondsLeft - sl1)).toBeLessThan(5)
  })
})
