'use client'
import { useEffect, useState } from 'react'
import { SearchCondition } from '@/lib/types'
import { getDeviceFingerprint, IS_TRIAL } from '@/lib/fingerprint'
import ConditionCard from '@/components/ConditionCard'
import ConditionForm from '@/components/ConditionForm'
import OnboardingGuide from '@/components/OnboardingGuide'

function getUserId(): string {
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

/** push_sub が切れていた場合に通知許可済みなら自動で再購読する（ユーザー操作不要） */
async function tryAutoResubscribe(userId: string): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
    if (Notification.permission !== 'granted') return false
    const { publicKey } = await fetch('/api/push/vapid-key').then(r => r.json())
    if (!publicKey) return false
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
    const j = sub.toJSON()
    await fetch('/api/push/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, deviceFingerprint: getDeviceFingerprint(), isTrial: IS_TRIAL }),
    })
    await fetch('/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, notificationChannel: 'webpush' }),
    })
    return true
  } catch {
    return false
  }
}


function SkeletonCard() {
  return (
    <div style={{
      background: 'var(--card)', borderRadius: 16,
      padding: '16px', boxShadow: 'var(--shadow-sm)',
      animation: 'pulse 1.4s ease-in-out infinite',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ width: '45%', height: 14, borderRadius: 6, background: 'var(--fill)' }} />
        <div style={{ width: 40, height: 20, borderRadius: 10, background: 'var(--fill)' }} />
      </div>
      <div style={{ width: '70%', height: 11, borderRadius: 5, background: 'var(--fill)', marginBottom: 6 }} />
      <div style={{ width: '50%', height: 11, borderRadius: 5, background: 'var(--fill)' }} />
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}`}</style>
    </div>
  )
}

const CONDS_CACHE = 'yw_conditions_cache'

export default function Dashboard() {
  const [userId, setUserId]         = useState('')
  const [conditions, setConditions] = useState<SearchCondition[]>([])
  const [showForm, setShowForm]     = useState(false)
  const [editingCondition, setEditingCondition] = useState<SearchCondition | null>(null)
  const [loading, setLoading]       = useState(true)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [notifyReady, setNotifyReady] = useState(false)
  const [pushLost, setPushLost] = useState(false)
  const [duplicatingCondition, setDuplicatingCondition] = useState<SearchCondition | null>(null)

  function completeOnboarding() {
    localStorage.setItem('yahoowatch_onboarded', '1')
    setShowOnboarding(false)
  }

  // フォームを開く時は必ずトップへ戻す（スクロール位置を維持しない）
  function openForm() {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setShowForm(true)
  }

  async function init() {
    const id = getUserId()
    if (!id) return

    // PWA（standalone）以外ではDBユーザーを作成しない（幽霊ユーザー防止）
    // DeviceGuard が非PWAに全画面ブロックを表示するため、ここには実質PWAのみ到達する
    const isStandalone =
      ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true) ||
      window.matchMedia('(display-mode: standalone)').matches
    if (!isStandalone) {
      setLoading(false)
      return
    }

    setUserId(id)

    // キャッシュがあれば即表示（API待ちなしで高速起動）
    try {
      const cached = localStorage.getItem(CONDS_CACHE)
      if (cached) { setConditions(JSON.parse(cached)); setLoading(false) }
    } catch {}

    if (!localStorage.getItem('yahoowatch_onboarded')) {
      setShowOnboarding(true)
    }

    // 3つのAPIを並列実行（直列→並列で約2/3高速化）
    const [, settingsRes, conditionsRes] = await Promise.allSettled([
      fetch('/api/user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: id }) }),
      fetch(`/api/settings?userId=${id}`),
      fetch(`/api/conditions?userId=${id}`),
    ])

    // 条件を即表示（最優先）、キャッシュも更新
    try {
      if (conditionsRes.status === 'fulfilled' && conditionsRes.value.ok) {
        const data = await conditionsRes.value.json()
        setConditions(data)
        try { localStorage.setItem(CONDS_CACHE, JSON.stringify(data)) } catch {}
      }
    } catch { /* JSON parseエラーは無視 */ } finally {
      setLoading(false)
    }

    // 設定はバックグラウンドで反映
    if (settingsRes.status === 'fulfilled' && settingsRes.value.ok) {
      const user = await settingsRes.value.json()
      setNotifyReady(!!(user.ntfyTopic || user.discordWebhook || user.notificationChannel === 'webpush'))

      // push_sub の状態を自動修復する（2パターン）
      // 1. ブラウザのsubが切れた → DB有り: tryAutoResubscribeで再購読
      // 2. DBのpush_subが失効削除された → ブラウザにsubが残っている: 再登録が必要
      // ※ push_subがnullになるとcronのユーザー取得クエリから除外されて全通知が止まる
      if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
        try {
          const reg = await navigator.serviceWorker.getRegistration('/sw.js')
          const sub = reg ? await reg.pushManager.getSubscription() : null
          const wantsPush = user.hasPush || user.notificationChannel === 'webpush'
          // ブラウザにsubがない or DBにpush_subがない(失効削除) のどちらでも再購読
          const needsResubscribe = wantsPush && (!sub || !user.hasPush)
          if (needsResubscribe) {
            const recovered = await tryAutoResubscribe(id)
            if (!recovered) setPushLost(true)  // 再購読失敗時のみバナー表示
          }
        } catch { /* 無視 */ }
      }
    }
  }

  async function loadConditions(uid?: string) {
    const id = uid ?? userId
    if (!id) return
    try {
      const res = await fetch(`/api/conditions?userId=${id}`)
      if (res.ok) {
        const data = await res.json()
        setConditions(data)
        try { localStorage.setItem(CONDS_CACHE, JSON.stringify(data)) } catch {}
      }
    } catch { /* ネットワークエラーは無視 */ }
  }

  // 条件登録・更新・オン復帰時にバックグラウンドで即チェック（合計件数を1通知）
  function runNow() {
    if (!userId) return
    fetch('/api/run-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, manual: true }),
    }).catch(() => {})
  }

  useEffect(() => { init() }, [])

  const activeCount = conditions.filter(c => c.enabled).length

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: 'var(--bg)',
        paddingBottom: 'calc(var(--nav-height) + env(safe-area-inset-bottom, 0px))',
      }}
    >

      {/* ─── Header ─── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--border)',
          padding: 'calc(env(safe-area-inset-top, 0px) + 14px) 20px 12px',
        }}>
          <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h1 style={{
                fontWeight: 700, fontSize: 20, letterSpacing: '-0.3px',
                background: 'var(--grad-primary)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                lineHeight: 1.2,
              }}>
                ヤフオクwatch
              </h1>
              {!loading && (
                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2, fontWeight: 400 }}>
                  {activeCount > 0 ? `${activeCount}件稼働中 · ${conditions.length}件登録` : `${conditions.length}件登録`}
                </p>
              )}
            </div>
          </div>
        </div>

      </div>

      <div style={{ padding: '14px 16px 0', maxWidth: 480, margin: '0 auto' }}>

        {/* ─── スケルトンローディング（条件リスト優先表示） ─── */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {!loading && (
          <>
            {/* ─── 通知未設定バナー ─── */}
            {!notifyReady && (
              <a href="/settings" style={{ display: 'block', marginBottom: 12, textDecoration: 'none' }}>
                <div style={{
                  background: 'var(--card)', borderRadius: 12,
                  padding: '12px 16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  border: '1px solid rgba(255,149,0,0.25)',
                  boxShadow: 'var(--shadow-sm)',
                }}>
                  <div>
                    <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--warning)' }}>通知先が未設定です</p>
                    <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 1, fontWeight: 400 }}>タップして設定する</p>
                  </div>
                  <span style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>›</span>
                </div>
              </a>
            )}

            {/* ─── 通知切れバナー（購読が失われた時） ─── */}
            {notifyReady && pushLost && (
              <a href="/settings" style={{ display: 'block', marginBottom: 12, textDecoration: 'none' }}>
                <div style={{
                  background: 'var(--card)', borderRadius: 12,
                  padding: '12px 16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  border: '1px solid rgba(246,104,138,0.3)',
                  boxShadow: 'var(--shadow-sm)',
                }}>
                  <div>
                    <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--danger)' }}>🔕 通知が途切れています</p>
                    <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 1, fontWeight: 400 }}>タップして通知を再設定する</p>
                  </div>
                  <span style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>›</span>
                </div>
              </a>
            )}

            {/* ─── Stats row ─── */}
            {conditions.length > 0 && (
              <div style={{
                background: 'var(--card)', borderRadius: 12,
                padding: '14px 0', marginBottom: 14,
                display: 'flex', justifyContent: 'space-around', alignItems: 'center',
                boxShadow: 'var(--shadow-sm)',
              }}>
                {[
                  { val: String(activeCount), label: '稼働中', highlight: activeCount > 0 },
                  { val: String(conditions.length), label: '登録条件', highlight: false },
                  { val: '1時間', label: '更新間隔', highlight: false },
                ].map((item, i) => (
                  <div key={i} style={{
                    textAlign: 'center', flex: 1,
                    borderLeft: i > 0 ? '1px solid var(--border)' : 'none',
                  }}>
                    <p style={{
                      fontSize: 20, fontWeight: 700, lineHeight: 1,
                      fontVariantNumeric: 'tabular-nums',
                      color: item.highlight ? 'var(--accent)' : 'var(--text-primary)',
                    }}>{item.val}</p>
                    <p style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, fontWeight: 400, letterSpacing: '0.5px' }}>
                      {item.label}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* ─── Empty state ─── */}
            {conditions.length === 0 && (
              <div style={{ textAlign: 'center', paddingTop: 64, paddingBottom: 40 }}>
                <div style={{
                  width: 72, height: 72, borderRadius: 18, margin: '0 auto 18px',
                  background: 'linear-gradient(135deg, rgba(39,181,212,0.12) 0%, rgba(26,106,201,0.12) 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 32,
                }}>🔍</div>
                <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', marginBottom: 8 }}>
                  ウォッチリストが空です
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 28, lineHeight: 1.7 }}>
                  監視したいキーワードと価格を設定すると<br />新着商品を自動で通知します
                </p>
                <button onClick={() => openForm()} className="btn-primary"
                  style={{ display: 'inline-block', width: 'auto', padding: '0 32px', height: 46, lineHeight: '46px', fontSize: 14 }}>
                  最初の条件を追加する
                </button>
              </div>
            )}

            {/* ─── Condition list ─── */}
            {conditions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {conditions.map(c => (
                  <ConditionCard
                    key={c.id}
                    condition={c}
                    userId={userId}
                    onChange={() => loadConditions()}
                    onEdit={cond => setEditingCondition(cond)}
                    onDuplicate={cond => { window.scrollTo({ top: 0, behavior: 'smooth' }); setDuplicatingCondition(cond) }}
                    onEnable={() => runNow()}
                  />
                ))}
                {/* 条件追加ボタン（条件がある時も常に表示） */}
                <button
                  onClick={() => openForm()}
                  style={{
                    width: '100%', height: 48, borderRadius: 14,
                    border: '1.5px dashed var(--border)',
                    background: 'var(--card)',
                    color: 'var(--accent)', fontWeight: 600, fontSize: 14,
                    cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    transition: 'opacity 0.15s',
                  }}
                >
                  <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> 条件を追加する
                </button>
              </div>
            )}

          </>
        )}
      </div>


      {/* ─── FAB ─── */}
      <button
        onClick={() => openForm()}
        style={{
          position: 'fixed',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 68px)',
          right: 'max(16px, calc(50% - 240px + 16px))',
          width: 52, height: 52,
          background: 'var(--grad-primary)',
          color: 'white', border: 'none', borderRadius: 26,
          fontSize: 24, fontWeight: 300,
          boxShadow: '0 4px 16px rgba(0,153,226,0.4)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 90, transition: 'transform 0.15s, box-shadow 0.15s',
        }}
      >+</button>

      {/* ─── Modals ─── */}
      {showForm && userId && (
        <ConditionForm
          userId={userId}
          onSave={() => { setShowForm(false); loadConditions(); runNow() }}
          onClose={() => setShowForm(false)}
        />
      )}
      {editingCondition && userId && (
        <ConditionForm
          userId={userId}
          condition={editingCondition}
          onSave={() => { setEditingCondition(null); loadConditions(); runNow() }}
          onClose={() => setEditingCondition(null)}
        />
      )}
      {duplicatingCondition && userId && (
        <ConditionForm
          userId={userId}
          condition={duplicatingCondition}
          isDuplicate
          existingConditions={conditions}
          onSave={() => { setDuplicatingCondition(null); loadConditions(); runNow() }}
          onClose={() => setDuplicatingCondition(null)}
        />
      )}

      {/* ─── オンボーディング（初回のみ） ─── */}
      {showOnboarding && userId && (
        <OnboardingGuide
          userId={userId}
          onComplete={completeOnboarding}
          onOpenConditionForm={() => {
            completeOnboarding()
            openForm()
          }}
        />
      )}
    </div>
  )
}
