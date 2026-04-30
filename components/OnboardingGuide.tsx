'use client'
import { useState, useEffect } from 'react'
import { getDeviceFingerprint, IS_TRIAL as TRIAL_MODE } from '@/lib/fingerprint'

function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr.buffer
}

interface Props {
  userId: string
  onComplete: () => void
  onOpenConditionForm: () => void
}

type PushStatus = 'idle' | 'ios-required' | 'denied' | 'unsupported' | 'loading' | 'done'
type Platform   = 'ios' | 'android' | 'other'

const STEPS = [
  { icon: '📱', title: 'ホーム画面に追加' },
  { icon: '🔔', title: '通知を受け取る' },
  { icon: '🔍', title: '監視条件を設定する' },
]

export default function OnboardingGuide({ userId, onComplete, onOpenConditionForm }: Props) {
  const [step, setStep]             = useState(-1)  // -1=初期化中
  const [animKey, setAnimKey]       = useState(0)
  const [pushStatus, setPushStatus] = useState<PushStatus>('idle')
  const [platform, setPlatform]     = useState<Platform>('other')
  const [isStandaloneMode, setIsStandaloneMode] = useState(false)

  // install step
  const [installing, setInstalling] = useState(false)
  const [installed, setInstalled]   = useState(false)

  // ── 初期化 ───────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    const ua = navigator.userAgent
    const isIOS      = /iPhone|iPad|iPod/.test(ua)
    const isAndroid  = /Android/.test(ua)
    const isStandalone =
      (navigator as any).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches

    setPlatform(isIOS ? 'ios' : isAndroid ? 'android' : 'other')
    setIsStandaloneMode(isStandalone)

    if (isStandalone) {
      setStep(1)
    } else if (isAndroid && (window as any).__pwaPrompt) {
      setStep(0)
      setTimeout(() => triggerInstallAuto(), 600)
    } else {
      setStep(0)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Androidインストール自動トリガー ─────────────────────────────
  async function triggerInstallAuto() {
    const prompt = (window as any).__pwaPrompt
    if (!prompt) return
    try {
      await prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'accepted') {
        setInstalled(true)
        ;(window as any).__pwaPrompt = null
        setTimeout(() => advance(1), 1000)
      }
    } catch (_) {}
  }

  async function triggerInstall() {
    const prompt = (window as any).__pwaPrompt
    if (!prompt) return
    setInstalling(true)
    try {
      await prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'accepted') {
        setInstalled(true)
        ;(window as any).__pwaPrompt = null
        setTimeout(() => advance(1), 800)
      }
    } catch (_) {}
    setInstalling(false)
  }

  // ── Push状態チェック ─────────────────────────────────────────────
  useEffect(() => {
    if (step !== 1) return
    const isIOS        = /iPhone|iPad|iPod/.test(navigator.userAgent)
    const isStandalone = (navigator as any).standalone === true
                       || window.matchMedia('(display-mode: standalone)').matches

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushStatus(isIOS && !isStandalone ? 'ios-required' : 'unsupported')
      return
    }
    if (Notification.permission === 'denied') { setPushStatus('denied'); return }

    navigator.serviceWorker.getRegistration('/sw.js').then(async reg => {
      if (reg) {
        const sub = await reg.pushManager.getSubscription()
        if (sub) setPushStatus('done')
      }
    }).catch(() => {})
  }, [step])

  // ── Push許可完了 → 1.2秒後に自動遷移 ───────────────────────────
  useEffect(() => {
    if (pushStatus !== 'done' || step !== 1) return
    const t = setTimeout(() => advance(2), 1200)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushStatus, step])

  // ── Push通知有効化 ───────────────────────────────────────────────
  async function enablePush() {
    if (!userId) return
    setPushStatus('loading')
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      await navigator.serviceWorker.ready
      const { publicKey } = await fetch('/api/push/vapid-key').then(r => r.json())
      if (!publicKey) { setPushStatus('idle'); return }
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setPushStatus('denied'); return }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      const j = sub.toJSON()
      const subRes = await fetch('/api/push/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, deviceFingerprint: getDeviceFingerprint(), isTrial: TRIAL_MODE }),
      })
      if (!subRes.ok) {
        const err = await subRes.json().catch(() => ({}))
        console.error('[Onboarding] subscribe failed:', err)
        setPushStatus('idle')
        return
      }
      await fetch('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, notificationChannel: 'webpush' }),
      })
      setPushStatus('done')
    } catch (err) {
      console.error('[Onboarding] Push error:', err)
      setPushStatus('idle')
    }
  }

  // ── ステップ遷移 ─────────────────────────────────────────────────
  function advance(to?: number) {
    const next = to ?? step + 1
    if (next > 2) { onComplete(); return }
    setAnimKey(k => k + 1)
    setStep(next)
  }

  if (step === -1) return null

  const s = STEPS[step]
  // PWA起動済み(standalone)は install step をスキップするので表示ステップ数が変わる
  const totalSteps   = isStandaloneMode ? 2 : 3
  const displayStep  = isStandaloneMode ? step     : step + 1  // 1-indexed
  const adjustedDot  = isStandaloneMode ? step - 1 : step      // 0-indexed within visible dots
  const badge        = `STEP ${displayStep} / ${totalSteps}`

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'linear-gradient(160deg, #071220 0%, #0c2240 55%, #071220 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'space-between',
      padding: 'calc(env(safe-area-inset-top, 0px) + 36px) 28px calc(env(safe-area-inset-bottom, 0px) + 44px)',
      overflowY: 'auto',
    }}>

      {/* ── Progress dots ─── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {Array.from({ length: totalSteps }, (_, idx) => (
          <div key={idx} style={{
            height: 8, borderRadius: 4,
            width: idx === adjustedDot ? 28 : 8,
            background: idx < adjustedDot ? '#34c759' : idx === adjustedDot ? '#27b5d4' : 'rgba(255,255,255,0.18)',
            transition: 'all 0.35s cubic-bezier(.4,0,.2,1)',
          }} />
        ))}
      </div>

      {/* ── Content ─── */}
      <div key={animKey} style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', maxWidth: 340, gap: 20, width: '100%',
        animation: 'obFadeSlide 0.38s cubic-bezier(.4,0,.2,1)',
      }}>

        {/* Icon */}
        <div style={{
          width: 96, height: 96, borderRadius: 28,
          background: 'rgba(39,181,212,0.12)',
          border: '1.5px solid rgba(39,181,212,0.28)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 44, backdropFilter: 'blur(10px)',
          boxShadow: '0 8px 32px rgba(39,181,212,0.15)',
        }}>{s.icon}</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '2px', color: '#27b5d4', textTransform: 'uppercase' }}>
            {badge}
          </span>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: 'white', lineHeight: 1.25, letterSpacing: '-0.4px', margin: 0 }}>
            {s.title}
          </h2>
        </div>

        {/* ━━━ STEP 0: インストール ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {step === 0 && (
          <>
            <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.6)', lineHeight: 1.75, margin: 0 }}>
              ホーム画面に追加すると、通知もアプリとして受け取れます。
            </p>

            {/* Android */}
            {platform === 'android' && !installed && (
              <div style={{
                width: '100%', background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.14)', borderRadius: 20,
                padding: '20px', backdropFilter: 'blur(16px)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
                  <div style={{
                    width: 52, height: 52, borderRadius: 14, flexShrink: 0,
                    background: 'linear-gradient(135deg, #0099e2 0%, #1a6ac9 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
                  }}>🔍</div>
                  <div style={{ textAlign: 'left' }}>
                    <p style={{ color: 'white', fontWeight: 700, fontSize: 15, margin: '0 0 2px' }}>ヤフオクwatch</p>
                    <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, margin: 0 }}>ホーム画面に追加</p>
                  </div>
                </div>
                <button onClick={triggerInstall} disabled={installing}
                  style={{
                    width: '100%', height: 52, borderRadius: 26, border: 'none',
                    background: 'linear-gradient(135deg, #27b5d4 0%, #1a6ac9 100%)',
                    color: 'white', fontWeight: 700, fontSize: 16,
                    cursor: installing ? 'wait' : 'pointer', fontFamily: 'inherit',
                    opacity: installing ? 0.7 : 1,
                    boxShadow: '0 4px 20px rgba(39,181,212,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}>
                  {installing ? '⏳ 追加中...' : '📲 ホーム画面に追加する'}
                </button>
              </div>
            )}

            {platform === 'android' && installed && (
              <SuccessBadge label="インストール完了！ホームを確認してください" />
            )}

            {/* iOS */}
            {platform === 'ios' && (
              <div style={{
                width: '100%', background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.14)', borderRadius: 20,
                padding: '20px', backdropFilter: 'blur(16px)',
              }}>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 16, textAlign: 'left' }}>
                  Safari での追加手順
                </p>
                {[
                  { n: '1', content: <span>画面下の <ShareIconWhite /> をタップ</span> },
                  { n: '2', content: <span>「<b>ホーム画面に追加</b>」を選ぶ</span> },
                  { n: '3', content: <span>「追加」でインストール完了</span> },
                ].map(({ n, content }) => (
                  <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <span style={{
                      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                      background: 'rgba(39,181,212,0.25)', border: '1px solid rgba(39,181,212,0.5)',
                      color: '#27b5d4', fontSize: 12, fontWeight: 800,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{n}</span>
                    <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5, textAlign: 'left' }}>{content}</span>
                  </div>
                ))}
                <div style={{ textAlign: 'center', animation: 'obBounce 1.4s ease-in-out infinite', fontSize: 20, color: '#27b5d4', marginTop: 4 }}>↓</div>
              </div>
            )}
          </>
        )}

        {/* ━━━ STEP 1: 通知設定 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {step === 1 && (
          <>
            {(pushStatus === 'idle' || pushStatus === 'loading') && (
              <button onClick={enablePush} disabled={pushStatus === 'loading'}
                style={{
                  width: '100%', height: 56, borderRadius: 28, border: 'none',
                  background: 'linear-gradient(135deg, #27b5d4 0%, #1a6ac9 100%)',
                  color: 'white', fontWeight: 700, fontSize: 16,
                  cursor: pushStatus === 'loading' ? 'wait' : 'pointer',
                  fontFamily: 'inherit', opacity: pushStatus === 'loading' ? 0.7 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  boxShadow: '0 4px 20px rgba(39,181,212,0.35)', transition: 'opacity 0.2s',
                  animation: pushStatus === 'idle' ? 'obPulseBtn 2s ease-in-out infinite' : 'none',
                }}>
                <span>{pushStatus === 'loading' ? '⏳' : '🔔'}</span>
                {pushStatus === 'loading' ? '設定中...' : '通知を許可する'}
              </button>
            )}
            <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.6)', lineHeight: 1.75, margin: 0 }}>
              条件に合う商品が出品されたら即通知。アプリを開かなくても届きます。
            </p>
            {pushStatus === 'done' && <SuccessBadge label="通知ON — 次のステップへ..." />}
            {pushStatus === 'ios-required' && (
              <div style={{ background: 'rgba(255,149,0,0.1)', border: '1px solid rgba(255,149,0,0.28)', borderRadius: 14, padding: '14px 18px', textAlign: 'left', width: '100%' }}>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.88)', lineHeight: 1.8, margin: 0 }}>
                  <strong style={{ color: '#ff9500' }}>iPhoneで通知を受け取るには</strong><br/>
                  ① Safari の共有ボタン（□↑）をタップ<br/>
                  ② 「ホーム画面に追加」→ ホームから起動
                </p>
              </div>
            )}
            {pushStatus === 'denied' && (
              <div style={{ background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.28)', borderRadius: 14, padding: '14px 18px', textAlign: 'left', width: '100%' }}>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.88)', lineHeight: 1.8, margin: 0 }}>
                  通知がブロックされています。<br/>端末の設定 → ブラウザ → 通知 から許可してください。
                </p>
              </div>
            )}
          </>
        )}

        {/* ━━━ STEP 2: 条件設定 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {step === 2 && (
          <>
            <button onClick={() => { onOpenConditionForm(); onComplete() }}
              style={{
                width: '100%', height: 56, borderRadius: 28, border: 'none',
                background: 'linear-gradient(135deg, #27b5d4 0%, #1a6ac9 100%)',
                color: 'white', fontWeight: 700, fontSize: 16,
                cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                boxShadow: '0 4px 20px rgba(39,181,212,0.35)',
                animation: 'obPulseBtn 2s ease-in-out infinite',
              }}>
              🔍 最初の条件を登録する
            </button>
            <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.6)', lineHeight: 1.75, margin: 0 }}>
              探したいキーワードと予算を設定するだけ。10分おきに自動チェックして新着があれば即通知します。
            </p>
          </>
        )}
      </div>

      {/* ── Buttons ─── */}
      <div style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {!(step === 1 && pushStatus === 'done') && (
          <button onClick={() => advance()}
            style={{
              height: 50, borderRadius: 25,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.07)',
              color: 'rgba(255,255,255,0.7)', fontWeight: 500, fontSize: 15,
              cursor: 'pointer', fontFamily: 'inherit', backdropFilter: 'blur(8px)',
            }}>
            {step === 0
              ? installed ? '次のステップへ →' : (platform === 'ios' ? '追加した →' : 'スキップ →')
              : step === 1
              ? '後で設定する →'
              : 'スキップして完了'}
          </button>
        )}
      </div>

      <style>{`
        @keyframes obFadeSlide {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes obBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(5px); }
        }
        @keyframes obPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
        @keyframes obFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes obPulseBtn {
          0%,100% { box-shadow: 0 4px 20px rgba(39,181,212,0.35); }
          50%     { box-shadow: 0 4px 32px rgba(39,181,212,0.65); }
        }
      `}</style>
    </div>
  )
}

function SuccessBadge({ label }: { label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: 'rgba(52,199,89,0.14)', border: '1px solid rgba(52,199,89,0.32)',
      borderRadius: 14, padding: '12px 20px',
    }}>
      <span style={{ fontSize: 20 }}>✓</span>
      <span style={{ fontSize: 14, color: '#34c759', fontWeight: 700 }}>{label}</span>
    </div>
  )
}

function ShareIconWhite() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24"
      style={{ display: 'inline', verticalAlign: 'middle', marginBottom: 1 }}
      fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
      <polyline points="16 6 12 2 8 6"/>
      <line x1="12" y1="2" x2="12" y2="15"/>
    </svg>
  )
}
