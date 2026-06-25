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
  const [testExpired, setTestExpired] = useState(false)
  const [pushState, setPushState] = useState<PushState>('loading')
  const [pushLoading, setPushLoading] = useState(false)
  const [hasPushDB, setHasPushDB] = useState(false)   // DB側にpush_subが存在するか
  const [isStandalone, setIsStandalone] = useState(true)
  const [isIOS, setIsIOS] = useState(false)
  const [showIosInstallGuide, setShowIosInstallGuide] = useState(false)
  const [pushActionNotice, setPushActionNotice] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [resetNotice, setResetNotice] = useState('')
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
      // DBと確実に同期（awaitしてhasPushDBを更新）
      const j = sub.toJSON()
      try {
        const syncRes = await fetch('/api/push/subscribe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: getUserId(), endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, deviceFingerprint: getDeviceFingerprint(), isTrial: TRIAL_MODE }),
        })
        const syncData = await syncRes.json()
        if (syncData.ok) { setHasPushDB(true); console.log('[push] DBと同期完了') }
        else console.warn('[push] DB同期失敗:', syncData)
      } catch (e) { console.warn('[push] DB同期エラー:', e) }
    }).catch(() => setPushState('idle'))
  }, [])

  // ── Push有効化 ───────────────────────────────────────────────────
  async function enablePush(forceRefresh = false) {
    if (!userId) return
    setPushLoading(true)
    setPushActionNotice('')
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      await navigator.serviceWorker.ready
      const { publicKey } = await fetch('/api/push/vapid-key').then(r => r.json())
      if (!publicKey) { alert('通知サーバーが設定されていません'); setPushLoading(false); return }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setPushState('denied'); setPushLoading(false); return }
      const currentSub = await reg.pushManager.getSubscription()
      if (currentSub && forceRefresh) {
        await currentSub.unsubscribe().catch(() => false)
      }
      const reusableSub = forceRefresh ? null : currentSub
      const sub = reusableSub ?? await reg.pushManager.subscribe({
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
      setPushActionNotice(forceRefresh
        ? '通知を再登録しました。テスト通知で届くか確認できます。'
        : '通知ONになりました。テスト通知で届くか確認できます。')
    } catch (err) {
      alert(`通知の設定に失敗しました: ${err}`)
    }
    setPushLoading(false)
  }

  async function retryEnablePushFromBlocked() {
    if (typeof window === 'undefined') return
    setPushActionNotice('')
    if (Notification.permission === 'denied') {
      setPushState('denied')
      setPushActionNotice('まだiPhone側で通知がブロックされています。設定アプリで通知を許可してから、この画面に戻ってください。')
      return
    }
    await enablePush()
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
    setTestExpired(false)
    try {
      // テスト前にブラウザの購読をDBへ同期。既存購読は消さず、iOSで安定していた経路を使う。
      try {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js')
        const sub = reg ? await reg.pushManager.getSubscription() : null
        if (sub) {
          const j = sub.toJSON()
          const syncRes = await fetch('/api/push/subscribe', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, deviceFingerprint: getDeviceFingerprint(), isTrial: TRIAL_MODE }),
          })
          const syncData = await syncRes.json()
          if (syncData.ok) setHasPushDB(true)
        }
      } catch { /* 同期失敗は無視してテストを続行 */ }

      const res = await fetch('/api/push/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const data = await res.json()
      if (!data.ok) {
        setTestDebug(data.debug ?? '不明なエラー')
        if (data.expired) {
          setTestExpired(true)
          setHasPushDB(false)
          setPushState('idle')
          try {
            const reg = await navigator.serviceWorker.getRegistration('/sw.js')
            const sub = reg ? await reg.pushManager.getSubscription() : null
            if (sub) await sub.unsubscribe()
          } catch {}
        }
      }
      setTestState(data.ok ? 'ok' : 'fail')
      if (data.ok) {
        setTestDebug(data.debug ?? 'サーバーPush送信完了。')
      }
      if (data.ok) setTimeout(() => setTestState('idle'), 5000)
    } catch {
      setTestDebug('ネットワークエラー。Wi-Fi/通信を確認してください。')
      setTestState('fail')
    }
  }

  async function resetNotifiedItems() {
    if (!userId || resetLoading) return
    const ok = window.confirm('通知済みログをリセットします。次回チェックで既存商品も再通知される可能性があります。実行しますか？')
    if (!ok) return
    setResetLoading(true)
    setResetNotice('')
    try {
      const res = await fetch('/api/reset-notified', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setResetNotice(data.error ?? 'リセットに失敗しました。時間をおいて再実行してください。')
        return
      }
      setResetNotice('通知済みログをリセットしました。次の自動チェックで再通知されます。')
    } catch {
      setResetNotice('ネットワークエラー。通信状態を確認してください。')
    } finally {
      setResetLoading(false)
    }
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
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>通知の設定</p>
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
                  <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(52,199,89,0.08)', borderRadius: 8, fontSize: 13, color: '#1a7a3a', fontWeight: 600, border: '1px solid rgba(52,199,89,0.2)', lineHeight: 1.6 }}>
                    ✓ 通知を送信しました。スマホに届いたか確認してください
                    {testDebug && (
                      <p style={{ marginTop: 6, fontSize: 12, color: '#1a7a3a', fontWeight: 600 }}>
                        {testDebug}
                      </p>
                    )}
                  </div>
                )}
                {testState === 'fail' && (
                  <div style={{ marginTop: 10, padding: '14px 16px', background: 'rgba(246,104,138,0.07)', borderRadius: 10, border: '1px solid rgba(246,104,138,0.25)' }}>
                    <p style={{ fontSize: 14, color: 'var(--danger)', fontWeight: 700, margin: '0 0 6px' }}>
                      {testExpired ? '🔄 通知の登録が切れています' : '⚠️ 通知の送信に失敗しました'}
                    </p>
                    {testDebug && (
                      <p style={{ fontSize: 12, color: 'var(--text-primary)', background: 'rgba(0,0,0,0.04)', borderRadius: 6, padding: '8px 10px', margin: '0 0 10px', lineHeight: 1.7, wordBreak: 'break-all', fontFamily: 'monospace' }}>
                        {testDebug}
                      </p>
                    )}
                    <button
                      onClick={() => { setTestState('idle'); setTestDebug(''); setTestExpired(false); setPushState('idle'); setHasPushDB(false); enablePush(true) }}
                      style={{
                        width: '100%', height: 42,
                        background: 'var(--grad-primary)', border: 'none',
                        borderRadius: 21, fontSize: 13, fontWeight: 700,
                        color: 'white', cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      🔄 通知を再登録する
                    </button>
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
            {pushState === 'denied' && (
              <div style={{ marginLeft: 22, marginTop: 8 }}>
                <p style={{ fontSize: 13, color: 'var(--danger)', lineHeight: 1.7, marginBottom: 10, fontWeight: 700 }}>
                  通知がブロックされています。先に端末側で通知を許可してください。
                </p>
                <div style={{ background: 'rgba(246,104,138,0.06)', borderRadius: 10, padding: '10px 12px', border: '1px solid rgba(246,104,138,0.18)' }}>
                  {isIOS ? (
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.85, margin: 0 }}>
                      ① iPhoneの「設定」を開く<br/>
                      ② 「通知」→「ヤフオクwatch」を選ぶ<br/>
                      ③ 「通知を許可」をオンにする<br/>
                      ④ この画面に戻って下の「通知オン」を押す
                    </p>
                  ) : (
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.85, margin: 0 }}>
                      ① ブラウザのアドレスバー左の設定アイコンを押す<br/>
                      ② 「通知」を「許可」に変更する<br/>
                      ③ この画面に戻って下の「通知オン」を押す
                    </p>
                  )}
                </div>
              </div>
            )}
            {pushState === 'unsupported' && <p style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6, marginLeft: 22 }}>Chrome または Safari 16.4以降でご利用ください</p>}
            {pushState === 'subscribed' && <p style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6, marginLeft: 22 }}>新着商品が見つかると、このブラウザに通知が届きます</p>}
            {pushState === 'idle' && <p style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6, marginLeft: 22 }}>下のボタンで通知を有効にしてください</p>}
          </div>

          {(pushState === 'idle' || pushState === 'unsupported' || pushState === 'denied') && (
            <div style={{ padding: '0 16px 16px' }}>
              <button onClick={pushState === 'denied' ? retryEnablePushFromBlocked : () => enablePush()}
                disabled={pushLoading || pushState === 'unsupported'}
                style={{
                  width: '100%', height: 44,
                  background: pushState === 'unsupported' ? 'var(--fill)' : 'var(--grad-primary)',
                  color: pushState === 'unsupported' ? 'var(--text-tertiary)' : 'white',
                  border: '1px solid var(--border)', borderRadius: 22, fontSize: 14, fontWeight: 700,
                  cursor: pushLoading ? 'wait' : 'pointer', fontFamily: 'inherit',
                  opacity: pushLoading ? 0.6 : 1,
                }}>
                {pushLoading ? '設定中...' : '通知オン'}
              </button>
              {pushActionNotice && (
                <div style={{
                  marginTop: 10, padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(246,104,138,0.24)',
                  background: 'rgba(246,104,138,0.07)',
                  color: 'var(--danger)',
                  fontSize: 12, fontWeight: 700, lineHeight: 1.65,
                }}>
                  {pushActionNotice}
                </div>
              )}
              {pushState === 'denied' && (
                <p style={{ marginTop: 8, textAlign: 'center', fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
                  端末側で許可に戻したあと、このボタンで再登録します
                </p>
              )}
            </div>
          )}
        </div>

        {/* ━━━ 通知再登録 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {pushState === 'subscribed' && (
          <>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', paddingLeft: 4, marginBottom: 6, letterSpacing: '0.8px', textTransform: 'uppercase' }}>通知再登録</p>
            <div style={{ background: 'var(--card)', borderRadius: 12, marginBottom: 24, overflow: 'hidden', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border)' }}>
              <div style={{ padding: '14px 16px' }}>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
                  通知ONなのに届かない場合、端末の受信先を作り直します。
                </p>
                <button
                  onClick={() => enablePush(true)}
                  disabled={pushLoading}
                  style={{
                    width: '100%', height: 42,
                    background: 'var(--fill)', border: '1px solid var(--border)',
                    borderRadius: 21, fontSize: 13, fontWeight: 700,
                    color: 'var(--text-primary)', cursor: pushLoading ? 'wait' : 'pointer',
                    fontFamily: 'inherit', opacity: pushLoading ? 0.6 : 1,
                  }}
                >
                  {pushLoading ? '再登録中...' : '通知を再登録する'}
                </button>
                {pushActionNotice && (
                  <p style={{
                    marginTop: 10, padding: '10px 12px', borderRadius: 8,
                    background: pushActionNotice.includes('しました') || pushActionNotice.includes('ON') ? 'rgba(52,199,89,0.08)' : 'rgba(246,104,138,0.07)',
                    color: pushActionNotice.includes('しました') || pushActionNotice.includes('ON') ? '#1a7a3a' : 'var(--danger)',
                    fontSize: 12, fontWeight: 700, lineHeight: 1.65,
                  }}>
                    {pushActionNotice}
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        {/* ━━━ 通知復旧 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', paddingLeft: 4, marginBottom: 6, letterSpacing: '0.8px', textTransform: 'uppercase' }}>通知復旧</p>
        <div style={{ background: 'var(--card)', borderRadius: 12, marginBottom: 24, overflow: 'hidden', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border)' }}>
          <div style={{ padding: '14px 16px' }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
              通知が来ない状態が続く場合、通知済みログをリセットして次回チェックで再通知できるようにします。
            </p>
            <button
              onClick={resetNotifiedItems}
              disabled={resetLoading}
              style={{
                width: '100%', height: 42,
                background: 'var(--fill)', border: '1px solid var(--border)',
                borderRadius: 21, fontSize: 13, fontWeight: 700,
                color: 'var(--text-primary)', cursor: resetLoading ? 'wait' : 'pointer',
                fontFamily: 'inherit', opacity: resetLoading ? 0.6 : 1,
              }}
            >
              {resetLoading ? 'リセット中...' : '通知ログをリセットする'}
            </button>
            {resetNotice && (
              <p style={{
                marginTop: 10, padding: '10px 12px', borderRadius: 8,
                background: resetNotice.includes('しました') ? 'rgba(52,199,89,0.08)' : 'rgba(246,104,138,0.07)',
                color: resetNotice.includes('しました') ? '#1a7a3a' : 'var(--danger)',
                fontSize: 12, fontWeight: 700, lineHeight: 1.65,
              }}>
                {resetNotice}
              </p>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
