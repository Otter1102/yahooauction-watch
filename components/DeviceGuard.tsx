'use client'
import { useEffect, useState } from 'react'

type State = 'pending' | 'allow' | 'desktop' | 'ios-browser' | 'android-browser'

/**
 * デバイス制限ガード
 * - デスクトップ/PC → 「スマートフォン専用」全画面ブロック
 * - スマホ/タブレットのブラウザ（非PWA）→ インストール誘導壁
 * - PWA（standalone）→ 通過
 * - LINE/SNS内ブラウザ → InAppBrowserWarning に委任（returnしてallowにしない）
 */
export default function DeviceGuard() {
  const [state, setState] = useState<State>('pending')

  useEffect(() => {
    const ua = navigator.userAgent
    // in-app ブラウザは InAppBrowserWarning が担当（干渉しない）
    if (/Line\/|FBAN|FBAV|Instagram|Twitter/.test(ua)) {
      setState('allow')
      return
    }
    const isIOS     = /iPhone|iPad|iPod/.test(ua)
    const isAndroid = /Android/.test(ua)
    const isMobile  = isIOS || isAndroid
    const isStandalone =
      ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true) ||
      window.matchMedia('(display-mode: standalone)').matches

    if (!isMobile) {
      setState('desktop')
    } else if (!isStandalone) {
      setState(isIOS ? 'ios-browser' : 'android-browser')
    } else {
      setState('allow')
    }
  }, [])

  if (state === 'pending' || state === 'allow') return null

  // ── デスクトップ ──────────────────────────────────────────────────────────
  if (state === 'desktop') {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'linear-gradient(160deg, #0d1b2a 0%, #0a2540 60%, #0f3460 100%)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '24px 20px',
      }}>
        <div style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20, margin: '0 auto 20px',
            background: 'linear-gradient(135deg, #27B5D4, #1A6AC9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 36,
            boxShadow: '0 8px 32px rgba(0,153,226,0.4)',
          }}>📱</div>
          <h1 style={{
            fontSize: 22, fontWeight: 800, color: 'white',
            lineHeight: 1.3, marginBottom: 12,
          }}>
            スマートフォン専用アプリです
          </h1>
          <p style={{
            fontSize: 14, color: 'rgba(255,255,255,0.6)',
            lineHeight: 1.8, marginBottom: 24,
          }}>
            iPhone または Android スマートフォンから<br />
            アクセスし、ホーム画面にインストールして<br />
            ご利用ください
          </p>
          <div style={{
            background: 'rgba(255,255,255,0.07)',
            borderRadius: 16, border: '1px solid rgba(255,255,255,0.12)',
            padding: '14px 16px',
          }}>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>
              PCブラウザには対応していません
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── スマホブラウザ（iOS / Android）─────────────────────────────────────────
  const isIOS = state === 'ios-browser'

  const steps = isIOS
    ? [
        { n: '1', text: <span>画面下の <b>共有ボタン ↑</b> をタップ</span> },
        { n: '2', text: <span><b>「ホーム画面に追加」</b> を選ぶ</span> },
        { n: '3', text: <span><b>「追加」</b> をタップして完了</span> },
      ]
    : [
        { n: '1', text: <span>画面右上の <b>「⋮」</b> をタップ</span> },
        { n: '2', text: <span><b>「ホーム画面に追加」</b> または<br /><b>「アプリをインストール」</b> を選ぶ</span> },
        { n: '3', text: <span><b>「インストール」</b> をタップして完了</span> },
      ]

  return (
    <>
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'linear-gradient(160deg, #0d1b2a 0%, #0a2540 60%, #0f3460 100%)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '24px 20px',
        overflowY: 'auto',
      }}>
        {/* 背景グロウ */}
        <div style={{
          position: 'absolute', top: '15%', left: '50%', transform: 'translateX(-50%)',
          width: 320, height: 320,
          background: 'radial-gradient(circle, rgba(0,153,226,0.18) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{ maxWidth: 400, width: '100%', position: 'relative' }}>
          {/* タイトル */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{
              width: 64, height: 64, borderRadius: 18, margin: '0 auto 14px',
              background: 'linear-gradient(135deg, #27B5D4, #1A6AC9)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 30,
              boxShadow: '0 8px 32px rgba(0,153,226,0.4)',
            }}>🔍</div>
            <h1 style={{
              fontSize: 20, fontWeight: 800, color: 'white',
              lineHeight: 1.3, letterSpacing: '-0.3px',
            }}>
              ホーム画面にインストールして<br />ご利用ください
            </h1>
            <p style={{
              fontSize: 13, color: 'rgba(255,255,255,0.6)',
              marginTop: 8, lineHeight: 1.6,
            }}>
              プッシュ通知はインストール後のみ受け取れます
            </p>
          </div>

          {/* 手順カード */}
          <div style={{
            background: 'rgba(255,255,255,0.07)',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            borderRadius: 20,
            border: '1px solid rgba(255,255,255,0.12)',
            padding: '20px',
            marginBottom: 16,
          }}>
            <p style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '1.5px',
              color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase',
              marginBottom: 14,
            }}>インストール方法</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {steps.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <span style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    background: 'linear-gradient(135deg, #27B5D4, #1A6AC9)',
                    color: 'white', fontSize: 11, fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 2px 8px rgba(0,153,226,0.4)',
                  }}>{s.n}</span>
                  <p style={{
                    fontSize: 14, color: 'rgba(255,255,255,0.9)',
                    lineHeight: 1.55, paddingTop: 3,
                  }}>{s.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 矢印ヒント */}
          <div style={{ textAlign: 'center' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(0,153,226,0.15)',
              border: '1px solid rgba(0,153,226,0.3)',
              borderRadius: 100, padding: '7px 16px',
            }}>
              <span style={{
                fontSize: 14,
                animation: 'dg-point 1.4s ease-in-out infinite',
                display: 'inline-block',
              }}>
                {isIOS ? '↓' : '↗'}
              </span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>
                {isIOS ? '画面下のボタンをタップ' : '画面右上のボタンをタップ'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes dg-point {
          0%, 100% { transform: translate(0, 0); }
          50%       { transform: translate(${isIOS ? '0, 3px' : '3px, -3px'}); }
        }
      `}</style>
    </>
  )
}
