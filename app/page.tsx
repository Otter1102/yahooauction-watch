'use client'
import { useEffect, useMemo, useState } from 'react'
import { NotificationRecord, SearchCondition } from '@/lib/types'
import ConditionCard from '@/components/ConditionCard'
import ConditionForm from '@/components/ConditionForm'
import OnboardingGuide from '@/components/OnboardingGuide'
import { ensurePushSubscription } from '@/lib/push-client'

function getUserId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('yahoowatch_user_id')
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('yahoowatch_user_id', id) }
  return id
}

/** push_sub が切れていた場合に通知許可済みなら自動で再購読する（ユーザー操作不要） */
async function tryAutoResubscribe(userId: string): Promise<boolean> {
  const result = await ensurePushSubscription(userId)
  return result.ok
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
const CHECK_DISPLAY_STAMP_KEY = 'yw_last_check_display_stamp'
const PUSH_SETUP_REMINDER_KEY = 'yw_push_setup_reminder_at'
const PUSH_SETUP_REMINDER_INTERVAL_MS = 6 * 60 * 60 * 1000

async function showPushSetupReminder() {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  try {
    const last = Number(localStorage.getItem(PUSH_SETUP_REMINDER_KEY) ?? '0')
    if (Number.isFinite(last) && Date.now() - last < PUSH_SETUP_REMINDER_INTERVAL_MS) return
    localStorage.setItem(PUSH_SETUP_REMINDER_KEY, String(Date.now()))
    const title = 'ヤフオクwatch 通知設定が必要です'
    const options = {
      body: '通知設定を完了しないと、新着オークションを受け取れません。',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      data: { url: '/settings' },
      tag: 'yw-push-setup-required',
      renotify: true,
    }
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    if (reg) await reg.showNotification(title, options)
    else new Notification(title, options)
  } catch { /* ローカル通知の失敗は画面バナーで補う */ }
}

function isCheckRecord(record: NotificationRecord): boolean {
  return record.kind === 'check' || record.auctionId.startsWith('__check_')
}

function auctionOnly(records: unknown): NotificationRecord[] {
  const rows = Array.isArray(records) ? records as NotificationRecord[] : []
  return rows.filter(record => !isCheckRecord(record))
}

export default function Dashboard() {
  const [userId, setUserId]         = useState('')
  const [conditions, setConditions] = useState<SearchCondition[]>([])
  const [history, setHistory] = useState<NotificationRecord[]>([])
  const [displayCheckedAt, setDisplayCheckedAt] = useState<string | null>(null)
  const [showForm, setShowForm]     = useState(false)
  const [editingCondition, setEditingCondition] = useState<SearchCondition | null>(null)
  const [loading, setLoading]       = useState(true)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [notifyReady, setNotifyReady] = useState(false)
  const [pushLost, setPushLost] = useState(false)
  const [dbUnavailable, setDbUnavailable] = useState(false)
  const [duplicatingCondition, setDuplicatingCondition] = useState<SearchCondition | null>(null)
  const [refreshingLatest, setRefreshingLatest] = useState(false)

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

    // 起動した端末側にも確認時刻を残す。DBが一時停止していても再起動後の画面で最終確認が分かる。
    const startupCheckedAt = new Date().toISOString()
    try { localStorage.setItem(CHECK_DISPLAY_STAMP_KEY, startupCheckedAt) } catch {}
    setDisplayCheckedAt(startupCheckedAt)

    // キャッシュがあれば即表示（API待ちなしで高速起動）
    try {
      const cached = localStorage.getItem(CONDS_CACHE)
      if (cached) { setConditions(JSON.parse(cached)); setLoading(false) }
    } catch {}

    if (!localStorage.getItem('yahoowatch_onboarded')) {
      setShowOnboarding(true)
    }

    // 4つのAPIを並列実行。stampは起動確認の証跡で、商品取得や通知送信は行わない。
    const [, settingsRes, conditionsRes, stampRes, historyRes] = await Promise.allSettled([
      fetch('/api/user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: id }) }),
      fetch(`/api/settings?userId=${id}`),
      fetch(`/api/conditions?userId=${id}`),
      fetch('/api/conditions/stamp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id, checkedAt: startupCheckedAt }),
      }),
      fetch(`/api/history?userId=${id}`),
    ])

    if (stampRes.status === 'fulfilled' && stampRes.value.ok) {
      try {
        const stamped = await stampRes.value.json()
        if (stamped.checkedAt) {
          setDisplayCheckedAt(stamped.checkedAt)
          try { localStorage.setItem(CHECK_DISPLAY_STAMP_KEY, stamped.checkedAt) } catch {}
        }
      } catch { /* stampレスポンスのparse失敗は表示用stampを維持 */ }
    }

    // 条件を即表示（最優先）、キャッシュも更新
    try {
      if (conditionsRes.status === 'fulfilled' && conditionsRes.value.ok) {
        const data = await conditionsRes.value.json()
        setConditions(data)
        setDbUnavailable(false)
        try { localStorage.setItem(CONDS_CACHE, JSON.stringify(data)) } catch {}
      } else if (conditionsRes.status === 'fulfilled' && conditionsRes.value.status >= 500) {
        setDbUnavailable(true)
      }
    } catch { /* JSON parseエラーは無視 */ } finally {
      setLoading(false)
    }

    try {
      if (historyRes.status === 'fulfilled' && historyRes.value.ok) {
        const data = await historyRes.value.json()
        if (Array.isArray(data)) setHistory(auctionOnly(data))
      }
    } catch { /* 履歴表示は条件表示を優先する */ }

    // 設定はバックグラウンドで反映
    if (settingsRes.status === 'fulfilled' && settingsRes.value.ok) {
      const user = await settingsRes.value.json()
      setNotifyReady(!!(user.ntfyTopic || user.discordWebhook || user.hasPush))

      // push_sub の状態を自動修復する（2パターン）
      // 1. ブラウザのsubが切れた → DB有り: tryAutoResubscribeで再購読
      // 2. DBのpush_subが失効削除された → ブラウザにsubが残っている: 再登録が必要
      // ※ push_subがnullになるとcronのユーザー取得クエリから除外されて全通知が止まる
      if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
        try {
          const reg = await navigator.serviceWorker.getRegistration('/sw.js')
          const sub = reg ? await reg.pushManager.getSubscription() : null
          const wantsPush = user.hasPush || user.notificationChannel === 'webpush'
          // ブラウザにsubがない or DBにpush_subがない(失効削除) のどちらでも強制再購読
          const needsResubscribe = wantsPush && (!sub || !user.hasPush)
          if (needsResubscribe) {
            const recovered = await tryAutoResubscribe(id)
            if (recovered) {
              setNotifyReady(true)
              setPushLost(false)
            } else {
              setPushLost(true)  // 再購読失敗時のみバナー表示
              await showPushSetupReminder()
            }
          } else if (!user.hasPush && !user.ntfyTopic && !user.discordWebhook) {
            await showPushSetupReminder()
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
        setDbUnavailable(false)
        try { localStorage.setItem(CONDS_CACHE, JSON.stringify(data)) } catch {}
      } else if (res.status >= 500) {
        setDbUnavailable(true)
      }
    } catch { setDbUnavailable(true) }
  }

  async function loadHistory(uid?: string) {
    const id = uid ?? userId
    if (!id) return
    try {
      const res = await fetch(`/api/history?userId=${id}`)
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data)) setHistory(auctionOnly(data))
    } catch { /* 履歴の再取得失敗は画面表示を維持 */ }
  }

  async function refreshLatestItems() {
    if (!userId || refreshingLatest) return
    setRefreshingLatest(true)
    try {
      const res = await fetch('/api/run-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, manual: true }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        window.alert(data.error ?? '最新商品の取得に失敗しました。少し時間をおいて再実行してください。')
        return
      }
      await Promise.all([loadConditions(), loadHistory()])
    } catch {
      window.alert('通信エラーで最新商品を取得できませんでした。接続を確認してください。')
    } finally {
      setRefreshingLatest(false)
    }
  }

  useEffect(() => { init() }, [])

  const activeCount = conditions.filter(c => c.enabled).length
  const historyByCondition = useMemo(() => {
    const map = new Map<string, NotificationRecord[]>()
    for (const item of history) {
      if (!item.conditionId) continue
      if (!map.has(item.conditionId)) map.set(item.conditionId, [])
      map.get(item.conditionId)!.push(item)
    }
    return map
  }, [history])

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
            {/* ─── DB接続障害バナー ─── */}
            {dbUnavailable && (
              <div style={{
                background: 'var(--card)', borderRadius: 12,
                padding: '12px 16px', marginBottom: 12,
                border: '1px solid rgba(225,112,85,0.35)',
                boxShadow: 'var(--shadow-sm)',
              }}>
                <p style={{ fontWeight: 700, fontSize: 13, color: 'var(--danger)' }}>サーバー接続が不安定です</p>
                <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 3, lineHeight: 1.6 }}>
                  条件の保存と新着通知が一時停止しています。復旧後に再読み込みしてください。
                </p>
              </div>
            )}

            {/* ─── 通知未設定バナー ─── */}
            {!notifyReady && (
              <a href="/settings" style={{ display: 'block', marginBottom: 12, textDecoration: 'none' }}>
                <div style={{
                  background: 'var(--card)', borderRadius: 12,
                  padding: '12px 16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  border: '1px solid rgba(246,104,138,0.32)',
                  boxShadow: 'var(--shadow-sm)',
                }}>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: 13, color: 'var(--danger)' }}>通知設定が必要です</p>
                    <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 1, fontWeight: 400 }}>設定しないと新着通知を受け取れません</p>
                  </div>
                  <span style={{
                    height: 32, padding: '0 14px', borderRadius: 16,
                    background: 'var(--grad-primary)', color: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, flexShrink: 0,
                  }}>設定する</span>
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
                    <p style={{ fontWeight: 700, fontSize: 13, color: 'var(--danger)' }}>通知の再設定が必要です</p>
                    <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 1, fontWeight: 400 }}>再登録しないと新着通知が止まります</p>
                  </div>
                  <span style={{
                    height: 32, padding: '0 14px', borderRadius: 16,
                    background: 'var(--grad-primary)', color: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, flexShrink: 0,
                  }}>通知オン</span>
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

            {conditions.length > 0 && (
              <button
                onClick={refreshLatestItems}
                disabled={refreshingLatest || activeCount === 0}
                style={{
                  width: '100%',
                  height: 44,
                  borderRadius: 12,
                  border: '1px solid rgba(0,153,226,0.22)',
                  background: refreshingLatest ? 'var(--fill)' : 'rgba(0,153,226,0.08)',
                  color: refreshingLatest || activeCount === 0 ? 'var(--text-tertiary)' : 'var(--accent)',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: refreshingLatest || activeCount === 0 ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                  marginBottom: 14,
                }}
              >
                {refreshingLatest ? '最新商品を取得中...' : '最新商品を取得'}
              </button>
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
                    recentItems={historyByCondition.get(c.id) ?? []}
                    displayCheckedAt={displayCheckedAt}
                    userId={userId}
                    onChange={() => { void loadConditions(); void loadHistory() }}
                    onEdit={cond => setEditingCondition(cond)}
                    onDuplicate={cond => { window.scrollTo({ top: 0, behavior: 'smooth' }); setDuplicatingCondition(cond) }}
                    onEnable={() => { void loadConditions(); void loadHistory() }}
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
          bottom: 'calc(var(--nav-height) + env(safe-area-inset-bottom, 0px) + 10px)',
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
          onSave={() => { setShowForm(false); void loadConditions(); void loadHistory() }}
          onClose={() => setShowForm(false)}
        />
      )}
      {editingCondition && userId && (
        <ConditionForm
          userId={userId}
          condition={editingCondition}
          onSave={() => { setEditingCondition(null); void loadConditions(); void loadHistory() }}
          onClose={() => setEditingCondition(null)}
        />
      )}
      {duplicatingCondition && userId && (
        <ConditionForm
          userId={userId}
          condition={duplicatingCondition}
          isDuplicate
          existingConditions={conditions}
          onSave={() => { setDuplicatingCondition(null); void loadConditions(); void loadHistory() }}
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
