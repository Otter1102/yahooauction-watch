'use client'
import { useState, useEffect, useRef } from 'react'
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

export default function OnboardingGuide({ userId, onComplete, onOpenConditionForm }: Props) {
  const [step, setStep]             = useState(-1)  // -1=初期化中
  const [animKey, setAnimKey]       = useState(0)
  const [pushStatus, setPushStatus] = useState<PushStatus>('idle')
  const [platform, setPlatform]     = useState<Platform>('other')

  // install step
  const [installing, setInstalling] = useState(false)
  const [installed, setInstalled]   = useState(false)

  // yahoo step
  const [yahooOpened, setYahooOpened] = useState(false)
  const [yahooConnected, setYahooConnected] = useState(false)
  const [showSuccessPopup, setShowSuccessPopup] = useState(false)
  const yahooOpenedRef  = useRef(false)          // visibilitychange 用（closure 回避）
  const yahooAdvancedRef = useRef(false)         // 二重 advance 防止
  const yahooWinRef = useRef<Window | null>(null) // Safari タブ参照（自動クローズ用）
  const yahooOpenedAtRef = useRef(0)             // 開いた時刻（ミリ秒）- 即時誤発火防止

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

    if (isStandalone) {
      // PWA起動済み → installをスキップ
      setStep(1)
    } else if (isAndroid && (window as any).__pwaPrompt) {
      // Androidでinstallプロンプト準備済み → 即座にインストールダイアログを表示
      setStep(0)
      // 少し待ってから自動でトリガー
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

  // ── Yahoo連携 ────────────────────────────────────────────────────
  function openYahooApp() {
    const ua = navigator.userAgent
    const isAndroid = /Android/i.test(ua)
    yahooOpenedRef.current = true
    yahooOpenedAtRef.current = Date.now()
    setYahooOpened(true)
    // 連携ボタンを押した時点でオンボーディング完了扱い（アプリ再起動後も設定画面に戻らない）
    localStorage.setItem('yahoowatch_onboarded', '1')

    if (isAndroid) {
      // Android: ヤフオクブラウザを開く（未インストールならブラウザフォールバック）
      window.location.href =
        'intent://auctions.yahoo.co.jp/#Intent;scheme=https;package=jp.co.yahoo.android.yauction;S.browser_fallback_url=https%3A%2F%2Fauctions.yahoo.co.jp%2F;end'
    } else {
      // iOS: Yahooログイン後にコールバックページへリダイレクトさせる
      // returl パラメータでログイン完了後の遷移先を指定 → 自動でアプリに戻る
      const callbackUrl = window.location.origin + '/yahoo-callback'
      const loginUrl = 'https://login.yahoo.co.jp/config/login?returl=' + encodeURIComponent(callbackUrl)
      yahooWinRef.current = window.open(loginUrl, '_blank')
    }

    // visibilitychange: アプリに戻ったら自動進行（コールバックページ経由でも手動×閉じでも対応）
  }

  // ── 連携完了ポップアップを表示して2秒後にSTEP2へ ────────────────
  function triggerYahooSuccess() {
    setYahooConnected(true)
    setShowSuccessPopup(true)
    setTimeout(() => {
      setShowSuccessPopup(false)
      advance(2)
    }, 2000)
  }

  // ── 手動「ログインした」ボタン ─────────────────────────────────
  function handleYahooDone() {
    if (yahooAdvancedRef.current) return
    yahooAdvancedRef.current = true
    try { yahooWinRef.current?.close() } catch {}
    triggerYahooSuccess()
  }

  // ── アプリに戻ったら自動連携完了（visibilitychange / pageshow）──
  // ※ focus イベントは使わない: ボタンタップ時にも発火して即時スキップしてしまう
  // ※ Yahooを開いてから3秒以内は誤発火防止でガードする
  useEffect(() => {
    if (step !== 1) return
    const GUARD_MS = 3000  // Safari が開く前の誤発火を防ぐ最低待機時間
    const tryAdvance = () => {
      if (!yahooOpenedRef.current) return
      if (!yahooAdvancedRef.current && Date.now() - yahooOpenedAtRef.current >= GUARD_MS) {
        yahooAdvancedRef.current = true
        try { yahooWinRef.current?.close() } catch {}
        triggerYahooSuccess()
      }
    }
    const onVisibility = () => { if (document.visibilityState === 'visible') tryAdvance() }
    const onPageshow   = (e: PageTransitionEvent) => { if (e.persisted) tryAdvance() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageshow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageshow)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // ── Push状態チェック ─────────────────────────────────────────────
  useEffect(() => {
    if (step !== 2) return
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
    if (pushStatus !== 'done' || step !== 2) return
    const t = setTimeout(() => advance(3), 1200)
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
      await fetch('/api/push/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, deviceFingerprint: getDeviceFingerprint(), isTrial: TRIAL_MODE }),
      })
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
    let next = to ?? step + 1
    // トライアルモード: ヤフオク連携（step 1）をスキップ
    if (TRIAL_MODE && next === 1) next = 2
    if (next > 3) { onComplete(); return }
    setAnimKey(k => k + 1)
    setStep(next)
  }

  if (step === -1) return null

  const STEPS = TRIAL_MODE ? [
    { icon: '📱', badge: 'STEP 1 / 3', title: 'ホーム画面に追加' },
    { icon: '🔑', badge: '',           title: '' },  // スキップ（advance で飛ばされる）
    { icon: '🔔', badge: 'STEP 2 / 3', title: '通知を受け取る' },
    { icon: '🔍', badge: 'STEP 3 / 3', title: '監視条件を設定する' },
  ] : [
    { icon: '📱', badge: 'STEP 1 / 4', title: 'ホーム画面に追加' },
    { icon: '🔑', badge: 'STEP 2 / 4', title: 'ヤフオクと連携する' },
    { icon: '🔔', badge: 'STEP 3 / 4', title: '通知を受け取る' },
    { icon: '🔍', badge: 'STEP 4 / 4', title: '監視条件を設定する' },
  ]
  const s = STEPS[step]

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
        {STEPS.filter((_, i) => !(TRIAL_MODE && i === 1)).map((_, idx) => {
          const realIdx = TRIAL_MODE && idx >= 1 ? idx + 1 : idx
          return (
            <div key={idx} style={{
              height: 8, borderRadius: 4,
              width: realIdx === step ? 28 : 8,
              background: realIdx < step ? '#34c759' : realIdx === step ? '#27b5d4' : 'rgba(255,255,255,0.18)',
              transition: 'all 0.35s cubic-bezier(.4,0,.2,1)',
            }} />
          )
        })}
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
            {s.badge}
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

        {/* ━━━ STEP 1: Yahoo連携（ブラウザログイン） ━━━━━━━━━━━━━━━ */}
        {step === 1 && (
          <>
            {!yahooConnected ? (
              <>
                <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.6)', lineHeight: 1.75, margin: 0 }}>
                  {platform === 'ios'
                    ? <>Safariで Yahoo にログインしてください。<br/><strong style={{ color: 'white' }}>ログイン後にこのアプリへ戻る</strong>と自動で次へ進みます。</>
                    : <>ヤフオクアプリ or ブラウザでログインしてください。<br/><strong style={{ color: 'white' }}>確認後にこのアプリへ戻る</strong>と自動で次へ進みます。</>
                  }
                </p>

                <div style={{
                  width: '100%', background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.14)', borderRadius: 20,
                  overflow: 'hidden', backdropFilter: 'blur(16px)',
                }}>
                  {/* ヘッダー */}
                  <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: 14, flexShrink: 0,
                      background: 'linear-gradient(135deg, #7B0099 0%, #FF0033 100%)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 4px 12px rgba(123,0,153,0.4)',
                    }}>
                      <span style={{ color: 'white', fontWeight: 900, fontSize: 20, fontFamily: 'Georgia, serif' }}>Y!</span>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <p style={{ color: 'white', fontWeight: 700, fontSize: 15, margin: '0 0 2px' }}>Yahoo!オークション</p>
                      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, margin: 0 }}>
                        {platform === 'android' ? 'アプリを直接起動します' : 'Safariでログイン（アプリ不要）'}
                      </p>
                    </div>
                  </div>

                  <div style={{ padding: '16px 18px' }}>
                    <button
                      onClick={openYahooApp}
                      style={{
                        width: '100%', height: 52, borderRadius: 26, border: 'none',
                        background: 'linear-gradient(135deg, #7B0099 0%, #ff0033 100%)',
                        color: 'white', fontWeight: 700, fontSize: 15,
                        cursor: 'pointer', fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                        boxShadow: '0 4px 16px rgba(255,0,51,0.4)',
                      }}
                    >
                      <span style={{ fontFamily: 'Georgia, serif', fontWeight: 900, fontSize: 18 }}>Y!</span>
                      {platform === 'android' ? 'ヤフオクアプリで連携する' : 'Safari で Yahoo! を開く'}
                    </button>

                    {yahooOpened && !yahooConnected && (
                      <div style={{ marginTop: 12 }}>
                        <button
                          onClick={handleYahooDone}
                          style={{
                            width: '100%', height: 48, borderRadius: 24,
                            background: 'rgba(52,199,89,0.18)',
                            border: '1px solid rgba(52,199,89,0.4)',
                            color: '#34c759', fontWeight: 700, fontSize: 15,
                            cursor: 'pointer', fontFamily: 'inherit',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                          }}>
                          ✓ ログインした → 次へ進む
                        </button>
                        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginTop: 8, lineHeight: 1.5 }}>
                          アプリへ戻ると自動で進みます
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.6)', lineHeight: 1.75, margin: 0 }}>
                  連携完了！通知をタップすると<br/>ヤフオクページに直接移動します。
                </p>
                <SuccessBadge label="Yahoo!オークション 連携済み" />
              </>
            )}
          </>
        )}

        {/* ━━━ STEP 2: 通知設定 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {step === 2 && (
          <>
            {/* 通知許可ボタンをコンテンツ上部に配置 */}
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

        {/* ━━━ STEP 3: 条件設定 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {step === 3 && (
          <>
            {/* 条件追加ボタンをコンテンツ上部に配置 */}
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

        {/* 次へ / スキップ */}
        {!(step === 2 && pushStatus === 'done') && (
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
              ? yahooConnected ? '次のステップへ →' : 'スキップ →'
              : step === 2
              ? '後で設定する →'
              : 'スキップして完了'}
          </button>
        )}
      </div>

      {/* ── 連携完了ポップアップ ─── */}
      {showSuccessPopup && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.55)',
          animation: 'obFadeIn 0.25s ease',
        }}>
          <div style={{
            background: 'white', borderRadius: 28, padding: '40px 44px',
            textAlign: 'center', maxWidth: 280, width: '80%',
            animation: 'obPopBounce 0.5s cubic-bezier(.17,.67,.33,1.27)',
            boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
          }}>
            {/* チェックマーク円 */}
            <div style={{
              width: 80, height: 80, borderRadius: '50%',
              background: 'linear-gradient(135deg, #34c759 0%, #1a9e3f 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px',
              animation: 'obCheckScale 0.55s cubic-bezier(.17,.67,.33,1.27) 0.15s both',
              boxShadow: '0 8px 24px rgba(52,199,89,0.45)',
            }}>
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <p style={{ fontSize: 22, fontWeight: 800, color: '#111', margin: '0 0 8px', letterSpacing: '-0.3px' }}>連携完了！</p>
            <p style={{ fontSize: 14, color: '#888', margin: 0, lineHeight: 1.5 }}>次は通知を設定します</p>
            {/* プログレスバー */}
            <div style={{ marginTop: 20, height: 3, background: '#eee', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', background: 'linear-gradient(90deg, #34c759, #1a9e3f)',
                borderRadius: 2,
                animation: 'obProgressBar 2s linear forwards',
              }} />
            </div>
          </div>
        </div>
      )}

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
        @keyframes obPopBounce {
          from { opacity: 0; transform: scale(0.75); }
          60%  { transform: scale(1.06); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes obCheckScale {
          from { transform: scale(0); }
          60%  { transform: scale(1.2); }
          to   { transform: scale(1); }
        }
        @keyframes obProgressBar {
          from { width: 0%; }
          to   { width: 100%; }
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
