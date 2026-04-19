'use client'
import { useEffect, useState } from 'react'
import { User } from '@/lib/types'
import { getDeviceFingerprint, IS_TRIAL as TRIAL_MODE } from '@/lib/fingerprint'

function getUserId() {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('yahoowatch_user_id')
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('yahoowatch_user_id', id) }
  return id
}

function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr.buffer
}

type PushState = 'loading' | 'unsupported' | 'ios-pwa-required' | 'denied' | 'subscribed' | 'idle'

/** push_sub が切れていた場合に許可済みなら自動再購読（設定ページ用） */
async function tryAutoResubscribeSettings(
  userId: string,
  existingReg?: ServiceWorkerRegistration,
): Promise<boolean> {
  try {
    if (!userId || !('PushManager' in window)) return false
    const { publicKey } = await fetch('/api/push/vapid-key').then(r => r.json())
    if (!publicKey) return false
    const reg = existingReg ?? await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready
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
    console.log('[push] 自動再購読完了')
    return true
  } catch {
    return false
  }
}

export default function SettingsPage() {
  const [userId, setUserId]       = useState('')
  const [user, setUser]           = useState<User | null>(null)
  const [testState, setTestState] = useState<'idle' | 'loading' | 'ok' | 'fail'>('idle')
  const [testDebug, setTestDebug] = useState('')
  const [pushState, setPushState] = useState<PushState>('loading')
  const [pushLoading, setPushLoading] = useState(false)
  const [hasPushDB, setHasPushDB] = useState(false)   // DB側にpush_subが存在するか
  const [isStandalone, setIsStandalone] = useState(true)
  const [isIOS, setIsIOS] = useState(false)
  const [showIosInstallGuide, setShowIosInstallGuide] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailSaved, setEmailSaved] = useState(false)

  // ── インストール状態検出 ─────────────────────────────────────────
  useEffect(() => {
    const standalone = ('standalone' in navigator && (navigator as any).standalone === true)
                    || window.matchMedia('(display-mode: standalone)').matches
    setIsStandalone(standalone)
    setIsIOS(/iPhone|iPad|iPod/.test(navigator.userAgent))
  }, [])

  async function handleInstall() {
    const prompt = (window as any).__pwaPrompt
    if (prompt) {
      await prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'accepted') setIsStandalone(true)
    } else {
      setShowIosInstallGuide(v => !v)
    }
  }

  // ── 初期化: 設定読込 + Yahoo状態 ────────────────────────────────
  useEffect(() => {
    const id = getUserId()
    setUserId(id)

    fetch(`/api/settings?userId=${id}`)
      .then(r => r.json())
      .then(data => {
        setUser(data)
        setHasPushDB(data.hasPush === true)
        setEmailInput(data.email ?? '')
      })

  }, [])

  // ── Push: ブラウザのSW購読状態を確認 ────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    const isIOS        = /iPhone|iPad|iPod/.test(navigator.userAgent)
    const isStandalone = (navigator as any).standalone === true
                       || window.matchMedia('(display-mode: standalone)').matches

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushState(isIOS && !isStandalone ? 'ios-pwa-required' : 'unsupported')
      return
    }
    if (Notification.permission === 'denied') { setPushState('denied'); return }

    navigator.serviceWorker.getRegistration('/sw.js').then(async reg => {
      if (!reg) {
        // 許可済みなら自動再購読（push_subがnullになってcronから除外されるのを防ぐ）
        if (Notification.permission === 'granted') {
          const id = getUserId()
          const recovered = await tryAutoResubscribeSettings(id)
          if (recovered) { setPushState('subscribed'); setHasPushDB(true); return }
        }
        setPushState('idle'); return
      }
      const sub = await reg.pushManager.getSubscription()
      if (!sub) {
        // 購読が切れていたら自動再購読
        if (Notification.permission === 'granted') {
          const id = getUserId()
          const recovered = await tryAutoResubscribeSettings(id, reg)
          if (recovered) { setPushState('subscribed'); setHasPushDB(true); return }
        }
        setPushState('idle'); return
      }
      setPushState('subscribed')
      // DBと自動同期（別タブ・再インストール・SW更新後のズレを解消）
      const j = sub.toJSON()
      fetch('/api/push/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: getUserId(), endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, deviceFingerprint: getDeviceFingerprint(), isTrial: TRIAL_MODE }),
      }).then(r => r.json()).then(d => {
        if (d.ok) console.log('[push] 購読をDBと同期しました')
      }).catch(() => {})
    }).catch(() => setPushState('idle'))
  }, [])

  // ── Push有効化 ───────────────────────────────────────────────────
  async function enablePush() {
    if (!userId) return
    setPushLoading(true)
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      await navigator.serviceWorker.ready
      const { publicKey } = await fetch('/api/push/vapid-key').then(r => r.json())
      if (!publicKey) { alert('通知サーバーが設定されていません'); setPushLoading(false); return }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setPushState('denied'); setPushLoading(false); return }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      const j = sub.toJSON()
      const saveRes = await fetch('/api/push/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, deviceFingerprint: getDeviceFingerprint(), isTrial: TRIAL_MODE }),
      })
      if (!saveRes.ok) {
        const e = await saveRes.json().catch(() => ({}))
        alert(`保存失敗: ${e.error ?? saveRes.status}`)
        setPushLoading(false); return
      }
      if (user && user.notificationChannel !== 'webpush') {
        const updated = { ...user, notificationChannel: 'webpush' as const }
        setUser(updated)
        fetch('/api/settings', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, ...updated }),
        })
      }
      setPushState('subscribed')
      setHasPushDB(true)
    } catch (err) {
      alert(`通知の設定に失敗しました: ${err}`)
    }
    setPushLoading(false)
  }

  // ── Push解除 ─────────────────────────────────────────────────────
  async function disablePush() {
    setPushLoading(true)
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      if (reg) {
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          await fetch('/api/push/subscribe', {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId }),
          })
          await sub.unsubscribe()
        }
      }
      setPushState('idle')
      setHasPushDB(false)
    } catch {}
    setPushLoading(false)
  }

  // ── テスト送信 ───────────────────────────────────────────────────
  async function testPush() {
    if (!userId) return
    setTestState('loading')
    setTestDebug('')
    const res  = await fetch('/api/push/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    const data = await res.json()
    if (!data.ok && data.debug) setTestDebug(data.debug)
    setTestState(data.ok ? 'ok' : 'fail')
    if (data.ok) setTimeout(() => setTestState('idle'), 5000)
  }

  // ── メールアドレス保存 ────────────────────────────────────────────
  async function saveEmail() {
    if (!userId) return
    setEmailSaving(true)
    const email = emailInput.trim()
    await fetch('/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, email }),
    })
    setEmailSaving(false)
    setEmailSaved(true)
    setTimeout(() => setEmailSaved(false), 3000)
  }

  if (!user) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
      <div style={{ width: 20, height: 20, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
    </div>
  )

  const canTest = pushState === 'subscribed' || hasPushDB

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingBottom: 'calc(var(--nav-height) + env(safe-area-inset-bottom, 0px))' }}>

      {/* ─── Header ─── */}
      <div style={{
        background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--border)',
        padding: 'calc(env(safe-area-inset-top, 0px) + 14px) 20px 14px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <h1 style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.3px', background: 'var(--grad-primary)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>設定</h1>
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>通知・連携の設定</p>
        </div>
      </div>

      <div style={{ padding: '20px 16px 0', maxWidth: 480, margin: '0 auto' }}>

        {/* ━━━ ホーム画面に追加（未インストール時のみ） ━━━━━━━━━━━━━━━ */}
        {!isStandalone && (
          <>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', paddingLeft: 4, marginBottom: 6, letterSpacing: '0.8px', textTransform: 'uppercase' }}>アプリ</p>
            <div style={{ background: 'var(--card)', borderRadius: 12, marginBottom: 24, overflow: 'hidden', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border)' }}>
              <div style={{ padding: '14px 16px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: 'linear-gradient(135deg,#0099e2,#1a6ac9)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>📲</div>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', margin: 0 }}>ホーム画面に追加</p>
                    <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>アプリとしてすぐに起動できます</p>
                  </div>
                </div>
                <button onClick={handleInstall} style={{
                  width: '100%', height: 44,
                  background: 'var(--grad-primary)', border: 'none',
                  borderRadius: 22, fontSize: 14, fontWeight: 700,
                  color: 'white', cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  {isIOS ? 'ホーム画面への追加手順を見る' : 'ホーム画面に追加する'}
                </button>
                {showIosInstallGuide && (
                  <div style={{ marginTop: 12, background: 'rgba(0,153,226,0.06)', borderRadius: 10, padding: '12px 14px', border: '1px solid rgba(0,153,226,0.15)' }}>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.9, margin: 0 }}>
                      ① 画面下の <strong>共有ボタン</strong>（□↑）をタップ<br/>
                      ② 「<strong>ホーム画面に追加</strong>」を選ぶ<br/>
                      ③「追加」をタップして完了
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ━━━ テスト通知（目立つ位置に固定） ━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {canTest && (
          <>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', paddingLeft: 4, marginBottom: 6, letterSpacing: '0.8px', textTransform: 'uppercase' }}>通知テスト</p>
            <div style={{ background: 'var(--card)', borderRadius: 12, marginBottom: 24, overflow: 'hidden', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border)' }}>
              <div style={{ padding: '14px 16px' }}>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
                  テスト通知を送信します。届いたら通知タップでヤフオクアプリが開くか確認できます。
                </p>
                <button onClick={testPush} disabled={testState === 'loading'}
                  style={{
                    width: '100%', height: 44,
                    background: 'var(--grad-primary)', border: 'none',
                    borderRadius: 22, fontSize: 14, fontWeight: 700,
                    color: 'white', cursor: testState === 'loading' ? 'wait' : 'pointer',
                    fontFamily: 'inherit', opacity: testState === 'loading' ? 0.6 : 1,
                  }}>
                  {testState === 'loading' ? '⏳ 送信中...' : '🔔 テスト通知を送る'}
                </button>
                {testState === 'ok' && (
                  <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(52,199,89,0.08)', borderRadius: 8, fontSize: 13, color: '#1a7a3a', fontWeight: 600, border: '1px solid rgba(52,199,89,0.2)' }}>
                    ✓ 通知を送信しました。スマホに届いたか確認してください
                  </div>
                )}
                {testState === 'fail' && (
                  <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(246,104,138,0.07)', borderRadius: 8, fontSize: 12, color: 'var(--danger)', fontWeight: 500, border: '1px solid rgba(246,104,138,0.2)' }}>
                    届きませんでした
                    {testDebug && <div style={{ marginTop: 4, fontSize: 11, fontWeight: 400, wordBreak: 'break-all', opacity: 0.8 }}>{testDebug}</div>}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ━━━ ブラウザ通知設定 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', paddingLeft: 4, marginBottom: 6, letterSpacing: '0.8px', textTransform: 'uppercase' }}>ブラウザ通知</p>
        <div style={{ background: 'var(--card)', borderRadius: 12, marginBottom: 24, overflow: 'hidden', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border)' }}>
          <div style={{ padding: '16px 16px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <div style={{
                width: 10, height: 10, borderRadius: 5, flexShrink: 0,
                background: pushState === 'subscribed' ? 'var(--success)' : pushState === 'denied' ? 'var(--danger)' : pushState === 'ios-pwa-required' ? 'var(--accent)' : pushState === 'loading' ? 'var(--text-tertiary)' : 'var(--warning)',
                boxShadow: pushState === 'subscribed' ? '0 0 6px rgba(52,199,89,0.5)' : 'none',
              }} />
              <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                {pushState === 'subscribed' ? '通知ON — このブラウザで受信中'
                 : pushState === 'denied'   ? '通知がブロックされています'
                 : pushState === 'ios-pwa-required' ? 'ホーム画面への追加が必要です'
                 : pushState === 'unsupported' ? '非対応ブラウザ'
                 : pushState === 'loading'  ? '確認中...' : '通知OFF'}
              </span>
            </div>

            {pushState === 'ios-pwa-required' && (
              <div style={{ marginLeft: 22, marginTop: 8 }}>
                <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.7, marginBottom: 10, fontWeight: 500 }}>iPhoneで通知を受け取るには、まずホーム画面に追加してください。</p>
                <div style={{ background: 'rgba(0,153,226,0.06)', borderRadius: 10, padding: '10px 12px', border: '1px solid rgba(0,153,226,0.15)' }}>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                    ① 下部の <strong>共有ボタン</strong>（□↑）をタップ<br/>
                    ② 「<strong>ホーム画面に追加</strong>」をタップ<br/>
                    ③ 追加後、ホーム画面のアイコンから開いて設定
                  </p>
                </div>
              </div>
            )}
            {pushState === 'denied' && <p style={{ fontSize: 12, color: 'var(--danger)', lineHeight: 1.6, marginLeft: 22 }}>ブラウザの設定から通知を許可してください</p>}
            {pushState === 'unsupported' && <p style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6, marginLeft: 22 }}>Chrome または Safari 16.4以降でご利用ください</p>}
            {pushState === 'subscribed' && <p style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6, marginLeft: 22 }}>新着商品が見つかると、このブラウザに通知が届きます</p>}
            {pushState === 'idle' && <p style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6, marginLeft: 22 }}>下のボタンで通知を有効にしてください</p>}
          </div>

          {(pushState === 'idle' || pushState === 'unsupported' || pushState === 'denied') && (
            <div style={{ padding: '0 16px 16px' }}>
              <button onClick={enablePush}
                disabled={pushLoading || pushState === 'unsupported' || pushState === 'denied'}
                style={{
                  width: '100%', height: 44,
                  background: (pushState === 'unsupported' || pushState === 'denied') ? 'var(--fill)' : 'var(--grad-primary)',
                  color: (pushState === 'unsupported' || pushState === 'denied') ? 'var(--text-tertiary)' : 'white',
                  border: '1px solid var(--border)', borderRadius: 22, fontSize: 14, fontWeight: 700,
                  cursor: pushLoading ? 'wait' : 'pointer', fontFamily: 'inherit',
                  opacity: pushLoading ? 0.6 : 1,
                }}>
                {pushLoading ? '設定中...' : 'このブラウザで通知を受け取る'}
              </button>
            </div>
          )}
        </div>

        {/* ━━━ メール通知 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', paddingLeft: 4, marginBottom: 6, letterSpacing: '0.8px', textTransform: 'uppercase' }}>メール通知</p>
        <div style={{ background: 'var(--card)', borderRadius: 12, marginBottom: 24, overflow: 'hidden', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border)' }}>
          <div style={{ padding: '16px 16px 12px' }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
              新着商品が見つかったときにメールで通知します。Gmail など任意のアドレスを入力してください。
            </p>
            <input
              type="text"
              value={emailInput}
              onChange={e => setEmailInput(e.target.value)}
              placeholder="例: yourname@gmail.com"
              style={{ marginBottom: 10 }}
            />
            <button
              onClick={saveEmail}
              disabled={emailSaving}
              style={{
                width: '100%', height: 44,
                background: 'var(--grad-primary)', border: 'none',
                borderRadius: 22, fontSize: 14, fontWeight: 700,
                color: 'white', cursor: emailSaving ? 'wait' : 'pointer',
                fontFamily: 'inherit', opacity: emailSaving ? 0.6 : 1,
              }}>
              {emailSaving ? '保存中...' : 'メールアドレスを保存'}
            </button>
            {emailSaved && (
              <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(52,199,89,0.08)', borderRadius: 8, fontSize: 13, color: '#1a7a3a', fontWeight: 600, border: '1px solid rgba(52,199,89,0.2)' }}>
                ✓ 保存しました
              </div>
            )}
            <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 10, lineHeight: 1.6 }}>
              ※ 通知なしの場合はメール送信しません。削除するには空欄にして保存してください。
            </p>
          </div>
        </div>

      </div>
    </div>
  )
}
