'use client'
import { useEffect, useState, useCallback } from 'react'

// ─── アプリ内ブラウザ種別 ────────────────────────────────────────────────
type InAppKind =
  | 'line-ios'
  | 'line-android'
  | 'sns-ios'       // Instagram / X / Facebook on iOS
  | 'sns-android'   // Instagram / X / Facebook on Android
  | null

function detectInApp(ua: string): InAppKind {
  const isIOS     = /iPhone|iPad|iPod/.test(ua)
  const isAndroid = /Android/.test(ua)
  const isLine    = /Line\//.test(ua)
  const isSNS     = /FBAN|FBAV|Instagram|Twitter/.test(ua)

  if (isLine && isIOS)     return 'line-ios'
  if (isLine && isAndroid) return 'line-android'
  if (isSNS  && isIOS)     return 'sns-ios'
  if (isSNS  && isAndroid) return 'sns-android'
  return null
}

function getSNSName(ua: string): string {
  if (/Instagram/.test(ua)) return 'Instagram'
  if (/Twitter/.test(ua))   return 'X（Twitter）'
  if (/FBAN|FBAV/.test(ua)) return 'Facebook'
  return 'SNSアプリ'
}

// ─── コンポーネント ───────────────────────────────────────────────────────
export default function InAppBrowserWarning() {
  const [kind, setKind]       = useState<InAppKind>(null)
  const [snsName, setSnsName] = useState('')
  const [copied, setCopied]   = useState(false)

  useEffect(() => {
    const ua = navigator.userAgent
    const k  = detectInApp(ua)
    setKind(k)
    if (k === 'sns-ios' || k === 'sns-android') setSnsName(getSNSName(ua))
  }, [])

  const copyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // clipboard API unavailable — show prompt as fallback
      window.prompt('このURLをコピーしてSafariで開いてください', window.location.href)
    }
  }, [])

  if (!kind) return null

  const isIOS     = kind === 'line-ios'  || kind === 'sns-ios'
  const isLine    = kind === 'line-ios'  || kind === 'line-android'
  const appLabel  = isLine ? 'LINE' : snsName

  // ── ステップ定義 ──────────────────────────────────────────────────────
  const steps: { icon: string; text: React.ReactNode }[] = isLine && isIOS
    ? [
        { icon: '1', text: <span>画面<b>右下の「•••」</b>をタップ</span> },
        { icon: '2', text: <span><b>「Safariで開く」</b>を選ぶ</span> },
        { icon: '3', text: <span>Safariが開いたら<b>「ホーム画面に追加」</b>できます</span> },
      ]
    : isLine && !isIOS
    ? [
        { icon: '1', text: <span>画面<b>右上の「⋮」</b>をタップ</span> },
        { icon: '2', text: <span><b>「ブラウザで開く」</b>を選ぶ</span> },
        { icon: '3', text: <span>Chromeが開いたら<b>「ホーム画面に追加」</b>できます</span> },
      ]
    : isIOS
    ? [
        { icon: '1', text: <span>画面<b>右下の「•••」または共有ボタン</b>をタップ</span> },
        { icon: '2', text: <span><b>「Safariで開く」</b>を選ぶ</span> },
        { icon: '3', text: <span>Safariで<b>ホーム画面に追加</b>すると通知が届きます</span> },
      ]
    : [
        { icon: '1', text: <span>画面<b>右上の「⋮」</b>をタップ</span> },
        { icon: '2', text: <span><b>「ブラウザで開く」または「Chromeで開く」</b>を選ぶ</span> },
        { icon: '3', text: <span>Chromeで<b>ホーム画面に追加</b>すると通知が届きます</span> },
      ]

  return (
    <>
      {/* ── フルスクリーンオーバーレイ ── */}
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

          {/* アプリアイコン + タイトル */}
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
              {appLabel}のブラウザでは<br />インストールできません
            </h1>
            <p style={{
              fontSize: 13, color: 'rgba(255,255,255,0.6)',
              marginTop: 8, lineHeight: 1.6,
            }}>
              Safari（iPhone）または Chrome（Android）で<br />開いてください
            </p>
          </div>

          {/* 手順カード */}
          <div style={{
            background: 'rgba(255,255,255,0.07)',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            borderRadius: 20,
            border: '1px solid rgba(255,255,255,0.12)',
            padding: '20px 20px',
            marginBottom: 16,
          }}>
            <p style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '1.5px',
              color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase',
              marginBottom: 14,
            }}>開き方</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {steps.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <span style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    background: 'linear-gradient(135deg, #27B5D4, #1A6AC9)',
                    color: 'white', fontSize: 11, fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 2px 8px rgba(0,153,226,0.4)',
                  }}>{s.icon}</span>
                  <p style={{
                    fontSize: 14, color: 'rgba(255,255,255,0.9)',
                    lineHeight: 1.55, paddingTop: 3,
                  }}>{s.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* アニメーション矢印 */}
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(0,153,226,0.15)',
              border: '1px solid rgba(0,153,226,0.3)',
              borderRadius: 100, padding: '7px 16px',
            }}>
              <span style={{
                fontSize: 14,
                animation: 'yw-point 1.4s ease-in-out infinite',
                display: 'inline-block',
              }}>
                {(isLine && isIOS) || (!isLine && isIOS)
                  ? '↘'   // iOSは右下（共有ボタン位置）
                  : '↗'   // Androidは右上
                }
              </span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>
                {(isLine && isIOS) || (!isLine && isIOS)
                  ? '画面右下のボタンをタップ'
                  : '画面右上のボタンをタップ'
                }
              </span>
            </div>
          </div>

          {/* URLコピーボタン（フォールバック） */}
          <button
            onClick={copyUrl}
            style={{
              width: '100%', height: 48, borderRadius: 14,
              background: copied
                ? 'rgba(39,181,212,0.2)'
                : 'rgba(255,255,255,0.08)',
              border: `1px solid ${copied ? 'rgba(39,181,212,0.5)' : 'rgba(255,255,255,0.15)'}`,
              color: copied ? '#27B5D4' : 'rgba(255,255,255,0.5)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit', letterSpacing: '0.2px',
              transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {copied
              ? <><span>✓</span><span>URLをコピーしました</span></>
              : <><span>🔗</span><span>URLをコピーして自分で開く</span></>
            }
          </button>

          <p style={{
            textAlign: 'center', fontSize: 11,
            color: 'rgba(255,255,255,0.25)',
            marginTop: 12, lineHeight: 1.5,
          }}>
            コピー後、Safari / Chrome のアドレスバーに貼り付けて開いてください
          </p>
        </div>
      </div>

      <style>{`
        @keyframes yw-point {
          0%, 100% { transform: translate(0, 0); }
          50%       { transform: translate(3px, 3px); }
        }
      `}</style>
    </>
  )
}
