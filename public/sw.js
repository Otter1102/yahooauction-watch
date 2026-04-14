// ヤフオクwatch Service Worker
// CACHE_VERSION: メジャー改修時に手動インクリメント（日常デプロイは /api/version 自動管理）
const CACHE_VERSION = 'v13'
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
    self.registration.showNotification(title, options)
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
