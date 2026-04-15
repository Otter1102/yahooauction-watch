// ヤフオクwatch Service Worker
// CACHE_VERSION: メジャー改修時に手動インクリメント（日常デプロイは /api/version 自動管理）
const CACHE_VERSION = 'v12'
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

// ── 通知タップ → 通知履歴ページへ遷移 ──────────────────────────────────
// ※ iOS PWA (WKWebView) での白画面問題を回避するための設計：
//   - client.navigate() は iOS で動作しないケースがあるため postMessage を使用
//   - 既存ウィンドウがある場合: focus() + postMessage(NAVIGATE) でアプリ内ナビゲーション
//   - 既存ウィンドウがない場合: openWindow('/history') でアプリを起動して直接遷移
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const base = self.registration.scope.replace(/\/$/, '')
  const targetUrl = base + '/history'

  event.waitUntil((async () => {
    // 既存のPWAウィンドウを探してフォーカス（新規タブを作らない）
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients) {
      if (client.url.startsWith(base)) {
        await client.focus()
        // client.navigate() は iOS PWA で動作しないため postMessage でナビゲーション
        client.postMessage({ type: 'NAVIGATE', url: '/history' })
        return
      }
    }
    // 既存ウィンドウがなければ新規で開く（アプリ未起動時はここに来る）
    return self.clients.openWindow(targetUrl)
  })())
})
