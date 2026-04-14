import type { Metadata, Viewport } from 'next'
import './globals.css'
import BottomNav from '@/components/BottomNav'
import InstallBanner from '@/components/InstallBanner'
import InAppBrowserWarning from '@/components/InAppBrowserWarning'
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
      window.dispatchEvent(new CustomEvent('sw-navigate',{detail:{url:e.data.url}}));
    }
    // 通知タップ → ヤフオク商品ページを直接開く（× で閉じると /history に自動復帰）
    if(e.data.type==='OPEN_AUCTION'&&e.data.auctionId){
      sessionStorage.setItem('yw_return_to','/history');
      window.location.href='/redirect/'+e.data.auctionId;
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
// ── Yahoo/外部ページ × 後のアプリ強制復帰 ──────────────────────────
// openAuction() が sessionStorage に 'yw_return_to' をセット済みの場合:
//   visibilitychange→visible (SFSafariViewController が閉じた) または
//   pageshow persisted=true (bfcache復元) でアプリ内ナビゲーションを強制実行
function ywReturnCheck(){
  var rt=sessionStorage.getItem('yw_return_to');
  if(!rt) return;
  sessionStorage.removeItem('yw_return_to');
  window.dispatchEvent(new CustomEvent('sw-navigate',{detail:{url:rt}}));
}
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState==='visible') ywReturnCheck();
});
window.addEventListener('pageshow',function(e){if(e.persisted) ywReturnCheck();});
// 通知タップ時にアプリが未起動だった場合: openAuctionクエリパラメータを処理
// SW が openWindow('/history?openAuction=xxx') でアプリを起動した直後に実行される
(function(){
  var params=new URLSearchParams(location.search);
  var oa=params.get('openAuction');
  if(!oa) return;
  history.replaceState({},'',location.pathname);
  setTimeout(function(){
    sessionStorage.setItem('yw_return_to','/history');
    window.location.href='/redirect/'+oa;
  },300);
})();
`.trim() }} />
      </head>
      <body style={{ background: 'var(--bg)' }}>
        <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100dvh', position: 'relative' }}>
          {/* SW NAVIGATEメッセージ → Next.js routerでソフトナビゲーション（白画面防止） */}
          <SWNavigationHandler />
          {/* アプリ内ブラウザ検出: LINE/X/Instagram → Safari誘導オーバーレイ（最前面） */}
          <InAppBrowserWarning />
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
