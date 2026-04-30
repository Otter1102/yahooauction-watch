import type { Metadata, Viewport } from 'next'
import './globals.css'
import BottomNav from '@/components/BottomNav'
import InstallBanner from '@/components/InstallBanner'
import InAppBrowserWarning from '@/components/InAppBrowserWarning'
import DeviceGuard from '@/components/DeviceGuard'
import TrialBanner from '@/components/TrialBanner'
import SWNavigationHandler from '@/components/SWNavigationHandler'

const isTrial = process.env.NEXT_PUBLIC_TRIAL_MODE === 'true'

export const metadata: Metadata = {
  title: isTrial ? '🆓 TRIAL | ヤフオクwatch' : 'ヤフオクwatch',
  description: 'キーワード登録するだけ。新着が出たら即プッシュ通知。ヤフオク自動検索・リアルタイム通知アプリ。',
  manifest: isTrial ? '/manifest-trial.json' : '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: isTrial ? 'black-translucent' : 'default',
    title: isTrial ? 'ヤフオクwatch🆓' : 'ヤフオクwatch',
  },
  openGraph: {
    title: 'ヤフオクwatch — リアルタイム通知アプリ',
    description: 'キーワード登録するだけ。新着が出たら即プッシュ通知。ヤフオク自動検索・リアルタイム通知アプリ。',
    type: 'website',
    siteName: 'ヤフオクwatch',
    url: 'https://yahooauction-watch.vercel.app',
    images: [{ url: 'https://yahooauction-watch.vercel.app/icons/icon-512.png', width: 512, height: 512 }],
  },
  twitter: {
    card: 'summary',
    title: 'ヤフオクwatch — リアルタイム通知アプリ',
    description: 'キーワード登録するだけ。新着が出たら即プッシュ通知。',
  },
  icons: {
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0099E2',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        {/* Supabase auth セッション強制クリア（メール/パスワードログイン廃止） */}
        <script dangerouslySetInnerHTML={{ __html: `
(function(){try{var k=Object.keys(localStorage);for(var i=0;i<k.length;i++){if(/^sb-.+-auth-token/.test(k[i])||k[i]==='supabase.auth.token'){localStorage.removeItem(k[i]);}}}catch(e){}})();
`.trim() }} />
        {/* beforeinstallprompt キャプチャ + SW postMessage リスナー（Reactより先に実行） */}
        <script dangerouslySetInnerHTML={{ __html: `
window.__pwaPrompt=null;
window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__pwaPrompt=e;});
if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('message',function(e){
    if(!e.data) return;
    // 通知タップ → ソフトナビゲーション（白画面なし）
    // SWNavigationHandler.tsx が 'sw-navigate' を受け取り router.push() に変換
    if(e.data.type==='NAVIGATE'&&e.data.url){
      // sessionStorage に保存（Reactマウント前に届いた場合のフォールバック）
      try{sessionStorage.setItem('sw-pending-navigate',e.data.url);}catch{}
      window.dispatchEvent(new CustomEvent('sw-navigate',{detail:{url:e.data.url}}));
    }
    // 新デプロイ検出 → キャッシュを全削除してリロード
    if(e.data.type==='SW_UPDATED'){
      if('caches' in window){
        caches.keys().then(function(keys){
          return Promise.all(keys.map(function(k){return caches.delete(k);}));
        }).then(function(){window.location.reload();});
      } else {
        window.location.reload();
      }
    }
  });
  // ページロードのたびに SW 更新チェック（古いSWが残っている場合に強制更新）
  navigator.serviceWorker.getRegistration().then(function(r){if(r) r.update();});
}
`.trim() }} />
      </head>
      <body style={{ background: 'var(--bg)' }}>
        <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100dvh', position: 'relative' }}>
          {/* SW NAVIGATEメッセージ → Next.js routerでソフトナビゲーション（白画面防止） */}
          <SWNavigationHandler />
          {/* アプリ内ブラウザ検出: LINE/X/Instagram → Safari誘導オーバーレイ（最前面） */}
          <InAppBrowserWarning />
          {/* デバイス制限: PC→ブロック、スマホブラウザ→インストール誘導、PWAのみ通過 */}
          <DeviceGuard />
          {/* トライアルバナー（NEXT_PUBLIC_TRIAL_MODE=true の場合のみ表示） */}
          {isTrial && <TrialBanner />}
          <main style={{ paddingBottom: 80, paddingTop: isTrial ? 36 : 0 }}>
            {children}
          </main>
          <BottomNav />
          <InstallBanner />
        </div>
      </body>
    </html>
  )
}
