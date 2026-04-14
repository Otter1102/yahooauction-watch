// ヤフオクwatch Service Worker
// CACHE_VERSION: メジャー改修時に手動インクリメント（日常デプロイは /api/version 自動管理）
const CACHE_VERSION = 'v14'
const META_CACHE    = `yw-meta-${CACHE_VERSION}`

// ── インストール: 即座に新SWを有効化 ─────────────────────────────────────
self.addEventListener('install', () => self.skipWaiting())

// ── アクティベート: 新デプロイ検出 → 全キャッシュ削除 → クライアントリロード ──
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // まず全クライアントを掌握
    await self.clients.claim()

    // Vercelデプロイごとに変わるバージョンIDを取得
    try {
      const res = await fetch('/api/version', { cache: 'no-store' })
      if (!res.ok) return
      const { v: newVersion } = await res.json()

      // 前回のデプロイIDをキャッシュから読み出す
      const metaCache   = await caches.open(META_CACHE)
      const storedRes   = await metaCache.match('/__deploy_version')
      const storedVersion = storedRes ? await storedRes.text() : null

      // デプロイIDが変わっていたら全キャッシュ削除
      if (storedVersion !== null && storedVersion !== newVersion) {
        const allKeys = await caches.keys()
        await Promise.all(
          allKeys
            .filter((k) => k !== META_CACHE)  // メタキャッシュ自体は残す
            .map((k) => caches.delete(k))
        )

        // 新しいデプロイIDを保存
        await metaCache.put('/__deploy_version', new Response(newVersion))

        // 全オープンタブに「リロードしてください」を送信
        const clients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        })
        for (const client of clients) {
          client.postMessage({ type: 'SW_UPDATED', version: newVersion })
        }
      } else {
        // 初回 or 同バージョン: IDを保存/更新だけ
        await metaCache.put('/__deploy_version', new Response(newVersion))
      }
    } catch {
      // ネットワークエラー等は無視（オフライン起動に対応）
    }
  })())
})

// ── IndexedDB 端末側履歴保存 ──────────────────────────────────────
// 通知受信時に端末のIndexedDBへ保存。Supabase側は24h後に自動削除されるが端末では長期保持。
const HIST_DB    = 'yw-history'
const HIST_VER   = 1
const HIST_STORE = 'notifications'
const HIST_MAX   = 300  // 最大保持件数

function openHistDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HIST_DB, HIST_VER)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(HIST_STORE)) {
        const store = db.createObjectStore(HIST_STORE, { keyPath: 'id' })
        store.createIndex('notifiedAt', 'notifiedAt')
      }
    }
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror   = (e) => reject(e.target.error)
  })
}

async function saveHistItem(data) {
  try {
    const db  = await openHistDB()
    const tx  = db.transaction(HIST_STORE, 'readwrite')
    const st  = tx.objectStore(HIST_STORE)
    st.put({
      id:            (data.auctionId || '') + '_' + Date.now(),
      auctionId:     data.auctionId     || '',
      title:         data.title         || '',
      price:         data.price         || '',
      conditionName: data.conditionName || '',
      url:           data.auctionUrl    || data.url || '',
      imageUrl:      data.imageUrl      || '',
      remaining:     data.remaining     || null,
      notifiedAt:    new Date().toISOString(),
    })
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej })

    // 上限超過分を古い順に削除
    const tx2 = db.transaction(HIST_STORE, 'readwrite')
    const st2 = tx2.objectStore(HIST_STORE)
    const req = st2.index('notifiedAt').getAll()
    const all = await new Promise(res => { req.onsuccess = () => res(req.result) })
    if (all.length > HIST_MAX) {
      const toDelete = all.slice(0, all.length - HIST_MAX)
      for (const item of toDelete) st2.delete(item.id)
      await new Promise((res, rej) => { tx2.oncomplete = res; tx2.onerror = rej })
    }
    db.close()
  } catch {
    // IndexedDB失敗は通知表示に影響しない
  }
}

// ── Push通知受信 ──────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  // push 受信のたびに SW 更新チェック（古い SW が残った場合に自動で新バージョンへ切り替え）
  self.registration.update().catch(() => {})

  let data = {}
  try { data = event.data?.json() ?? {} } catch {}

  const title    = data.title    ?? 'ヤフオクwatch'
  const body     = data.body     ?? '新着商品が見つかりました'
  const url      = data.url      ?? '/'
  const imageUrl = data.imageUrl ?? null

  const options = {
    body,
    // 商品サムネを通知アイコンに表示（imageUrl があればそちら、なければアプリアイコン）
    icon:  imageUrl || '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data:  { url, auctionId: data.auctionId ?? '' },
    vibrate: [200, 100, 200],
    // requireInteraction: false のまま（画面オフ時もスリープ通知が届く）
    requireInteraction: false,
    tag: data.auctionId ?? 'yw-notification',
    renotify: true,
  }
  // Android: 通知に大きい画像を表示
  if (imageUrl) options.image = imageUrl

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      saveHistItem(data),  // 端末IndexedDBへ履歴保存（Supabase不要化）
    ])
  )
})

// ── 通知タップ → ヤフオク商品ページへ直接遷移 ──────────────────────────────────
// ※ iOS PWA (WKWebView) での設計：
//   - auctionIdあり: OPEN_AUCTION postMessage → layout.tsx が window.location.href=/redirect/id を実行
//   - 商品ページを閉じると visibilitychange → ywReturnCheck() → /history へ自動復帰
//   - アプリ未起動時: openWindow('/history?openAuction=id') でアプリ起動後に商品ページを開く
//   - auctionIdなし（旧データ）: 従来通り履歴ページへナビゲーション
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const notifData = event.notification.data || {}
  const auctionId = notifData.auctionId || ''
  const base = self.registration.scope.replace(/\/$/, '')

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

    if (auctionId) {
      // auctionIdあり: ヤフオク商品ページへ直接遷移
      for (const client of clients) {
        if (client.url.startsWith(base)) {
          await client.focus()
          // layout.tsx の OPEN_AUCTION ハンドラが window.location.href=/redirect/auctionId を実行
          client.postMessage({ type: 'OPEN_AUCTION', auctionId })
          return
        }
      }
      // アプリ未起動: クエリパラメータ付きで履歴ページを開く（起動後に商品ページへ遷移）
      return self.clients.openWindow(base + '/history?openAuction=' + auctionId)
    }

    // auctionIdなし（旧データ）: 従来通り履歴ページへ
    for (const client of clients) {
      if (client.url.startsWith(base)) {
        await client.focus()
        client.postMessage({ type: 'NAVIGATE', url: '/history' })
        return
      }
    }
    return self.clients.openWindow(base + '/history')
  })())
})
