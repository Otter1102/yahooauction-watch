'use client'
import { useEffect, useState } from 'react'

type Platform = 'ios' | 'android' | null

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY   = 'yw_install_dismissed'
const INSTALLED_KEY = 'yw_pwa_installed'
const DISMISS_DAYS  = 7

export default function InstallBanner() {
  const [platform, setPlatform]             = useState<Platform>(null)
  const [androidPrompt, setAndroidPrompt]   = useState<BeforeInstallPromptEvent | null>(null)
  const [show, setShow]                     = useState(false)
  const [alreadyInstalled, setAlreadyInstalled] = useState(false)

  useEffect(() => {
    // PWA起動中 — 一切表示しない
    const isStandalone =
      ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true) ||
      window.matchMedia('(display-mode: standalone)').matches
    if (isStandalone) return

    const ua = navigator.userAgent
    // アプリ内ブラウザは InAppBrowserWarning が担当するためスキップ
    if (/Line\/|FBAN|FBAV|Instagram|Twitter/.test(ua)) return

    // インストール済みユーザーがブラウザで開いた場合
    if (localStorage.getItem(INSTALLED_KEY) === '1') {
      setAlreadyInstalled(true)
      setShow(true)
      return
    }

    // 最近閉じた
    const dismissedAt = localStorage.getItem(DISMISS_KEY)
    if (dismissedAt && Date.now() - Number(dismissedAt) < DISMISS_DAYS * 86400_000) return

    const isIOS     = /iPhone|iPad|iPod/.test(ua)
    const isAndroid = /Android/.test(ua)

    if (isIOS) {
      setPlatform('ios')
      setShow(true)
    }

    // Android: wait for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault()
      setAndroidPrompt(e as BeforeInstallPromptEvent)
      if (isAndroid) {
        setPlatform('android')
        setShow(true)
      }
    }
    // インストール完了 → インストール済みフラグを保存
    const onInstalled = () => {
      localStorage.setItem(INSTALLED_KEY, '1')
      setShow(false)
    }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
    setShow(false)
  }

  const installAndroid = async () => {
    if (!androidPrompt) return
    await androidPrompt.prompt()
    const { outcome } = await androidPrompt.userChoice
    if (outcome === 'accepted') setShow(false)
    setAndroidPrompt(null)
  }

  // ── すでにインストール済みのユーザーがブラウザで開いた時 ──────────────
  if (show && alreadyInstalled) {
    return (
      <div style={{
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 64px)',
        left: 0, right: 0, zIndex: 200,
        display: 'flex', justifyContent: 'center', padding: '0 12px',
        pointerEvents: 'none',
      }}>
        <div style={{
          background: 'rgba(255,255,255,0.97)',
          backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
          borderRadius: 18, padding: '13px 16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,153,226,0.12)',
          maxWidth: 448, width: '100%',
          pointerEvents: 'auto',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 11, flexShrink: 0,
            background: 'linear-gradient(135deg,#0099e2,#1a6ac9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19,
          }}>📲</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 700, fontSize: 13, color: '#1a1a1a' }}>
              アプリを持っています
            </p>
            <p style={{ fontSize: 11, color: '#888', marginTop: 2, lineHeight: 1.4 }}>
              ホーム画面のアプリから起動すると快適です
            </p>
          </div>
          <button onClick={() => setShow(false)} aria-label="閉じる" style={{
            background: 'rgba(0,0,0,0.06)', border: 'none',
            width: 24, height: 24, borderRadius: '50%',
            fontSize: 14, color: '#888', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, fontFamily: 'inherit',
          }}>×</button>
        </div>
      </div>
    )
  }

  if (!show || !platform) return null

  const bannerBase: React.CSSProperties = {
    position: 'fixed',
    bottom: 'calc(env(safe-area-inset-bottom, 0px) + 64px)',
    left: 0, right: 0, zIndex: 200,
    display: 'flex', justifyContent: 'center', padding: '0 12px',
    pointerEvents: 'none',
  }
  const card: React.CSSProperties = {
    background: 'rgba(255,255,255,0.97)',
    backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
    borderRadius: 18, padding: '14px 16px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,153,226,0.12)',
    maxWidth: 448, width: '100%',
    pointerEvents: 'auto',
  }

  if (platform === 'ios') {
    return (
      <div style={bannerBase}>
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            {/* アイコン */}
            <div style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              background: 'linear-gradient(135deg,#0099e2,#1a6ac9)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
            }}>🔍</div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontWeight: 700, fontSize: 13, color: '#1a1a1a', marginBottom: 8 }}>
                ホーム画面に追加する
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {[
                  { n: '1', content: <span>画面下の <ShareIcon /> をタップ</span> },
                  { n: '2', content: <span>「<b>ホーム画面に追加</b>」を選ぶ</span> },
                  { n: '3', content: <span>「追加」をタップして完了</span> },
                ].map(({ n, content }) => (
                  <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      background: 'linear-gradient(135deg,#0099e2,#1a6ac9)',
                      color: 'white', fontSize: 10, fontWeight: 800,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{n}</span>
                    <span style={{ fontSize: 12, color: '#444', lineHeight: 1.4 }}>{content}</span>
                  </div>
                ))}
              </div>
            </div>

            <button onClick={dismiss} aria-label="閉じる" style={{
              background: 'rgba(0,0,0,0.06)', border: 'none',
              width: 24, height: 24, borderRadius: '50%',
              fontSize: 14, color: '#888', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, lineHeight: 1, fontFamily: 'inherit',
            }}>×</button>
          </div>

          {/* 下矢印アニメーション（共有ボタンを指す） */}
          <div style={{
            textAlign: 'center', marginTop: 10,
            animation: 'yw-bounce 1.4s ease-in-out infinite',
            fontSize: 16, color: '#0099e2',
          }}>↓</div>
        </div>
        <style>{`
          @keyframes yw-bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(4px); }
          }
        `}</style>
      </div>
    )
  }

  // Android
  return (
    <div style={bannerBase}>
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: 'linear-gradient(135deg,#0099e2,#1a6ac9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
        }}>🔍</div>
        <div style={{ flex: 1 }}>
          <p style={{ fontWeight: 700, fontSize: 13, color: '#1a1a1a' }}>ホーム画面に追加</p>
          <p style={{ fontSize: 11, color: '#888', marginTop: 2 }}>アプリとしてインストールできます</p>
        </div>
        <button onClick={installAndroid} style={{
          background: 'linear-gradient(135deg,#0099e2,#1a6ac9)',
          color: 'white', border: 'none', borderRadius: 20,
          padding: '8px 16px', fontSize: 13, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
          whiteSpace: 'nowrap',
        }}>追加</button>
        <button onClick={dismiss} aria-label="閉じる" style={{
          background: 'rgba(0,0,0,0.06)', border: 'none',
          width: 24, height: 24, borderRadius: '50%',
          fontSize: 14, color: '#888', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, fontFamily: 'inherit',
        }}>×</button>
      </div>
    </div>
  )
}

function ShareIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24"
      style={{ display: 'inline', verticalAlign: 'middle', marginBottom: 1 }}
      fill="none" stroke="#0099e2" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  )
}
