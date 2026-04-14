'use client'
/**
 * トライアルトークン マルチストレージ永続化
 * localStorage + IndexedDB + CacheStorage の3箇所に保存。
 * 1つでも残っていれば既存セッションとして認識できる。
 *
 * httpOnly Cookie（サーバー発行）と合わせて計4層の保護になる。
 * ユーザーが「Cookie を削除」しても localStorage/IDB/Cache が残るため
 * 再トライアル取得をブロックできる。
 */

const STORAGE_KEY  = '_ytrial_token'
const IDB_DB_NAME  = 'ytw-trial'
const IDB_STORE    = 'session'
const CACHE_NAME   = 'ytw-trial-v1'

// ────────────────────────────────────────────────────────────
// 読み込み: 3箇所を順番に確認し最初に見つかった値を返す
// ────────────────────────────────────────────────────────────
export async function getStoredToken(): Promise<string | null> {
  // 1. localStorage（最速）
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v) return v
  } catch { /* プライベートモード等でブロックされる場合はスキップ */ }

  // 2. IndexedDB（Cookie 削除後も残る）
  try {
    const v = await idbGet()
    if (v) return v
  } catch { /* IDB 未対応環境はスキップ */ }

  // 3. CacheStorage（最も永続性が高い）
  try {
    const v = await cacheGet()
    if (v) return v
  } catch { /* ServiceWorker 未対応はスキップ */ }

  return null
}

// ────────────────────────────────────────────────────────────
// 書き込み: 3箇所すべてに保存（失敗しても続行）
// ────────────────────────────────────────────────────────────
export async function setStoredToken(token: string): Promise<void> {
  try { localStorage.setItem(STORAGE_KEY, token) } catch { /* ignore */ }
  try { await idbSet(token) } catch { /* ignore */ }
  try { await cacheSet(token) } catch { /* ignore */ }
}

// ────────────────────────────────────────────────────────────
// IndexedDB ヘルパー
// ────────────────────────────────────────────────────────────
function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

async function idbGet(): Promise<string | null> {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readonly')
      .objectStore(IDB_STORE)
      .get(STORAGE_KEY)
    req.onsuccess = () => resolve((req.result as string) ?? null)
    req.onerror   = () => reject(req.error)
  })
}

async function idbSet(value: string): Promise<void> {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(value, STORAGE_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

// ────────────────────────────────────────────────────────────
// CacheStorage ヘルパー
// ────────────────────────────────────────────────────────────
async function cacheGet(): Promise<string | null> {
  if (typeof caches === 'undefined') return null
  const cache = await caches.open(CACHE_NAME)
  const res   = await cache.match(STORAGE_KEY)
  if (!res) return null
  return res.text()
}

async function cacheSet(value: string): Promise<void> {
  if (typeof caches === 'undefined') return
  const cache = await caches.open(CACHE_NAME)
  await cache.put(STORAGE_KEY, new Response(value, { status: 200 }))
}
