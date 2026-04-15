'use client'
import { useEffect, useRef, useState } from 'react'
import { SearchCondition } from '@/lib/types'
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
      body: JSON.stringify({ userId, endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth }),
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

export default function Dashboard() {
  const [userId, setUserId]         = useState('')
  const [conditions, setConditions] = useState<SearchCondition[]>([])
  const [showForm, setShowForm]     = useState(false)
  const [editingCondition, setEditingCondition] = useState<SearchCondition | null>(null)
  const [loading, setLoading]       = useState(true)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [notifyReady, setNotifyReady] = useState(false)
  const [pushLost, setPushLost] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [runResult, setRunResult] = useState<{ msg: string; type: 'ok' | 'info' | 'warn' } | null>(null)
  const [running, setRunning] = useState(false)
  const [duplicatingCondition, setDuplicatingCondition] = useState<SearchCondition | null>(null)

  // ─── Pull-to-Refresh ─────────────────────────────────────────
  const [pullY, setPullY] = useState(0)
  const [isPullRefreshing, setIsPullRefreshing] = useState(false)
  const pullStartY = useRef(-1)
  const PULL_THRESHOLD = 40

  const onPullStart = (e: React.TouchEvent) => {
    if (window.scrollY === 0) pullStartY.current = e.touches[0].clientY
  }
  const onPullMove = (e: React.TouchEvent) => {
    if (pullStartY.current < 0) return
    const dy = e.touches[0].clientY - pullStartY.current
    if (dy > 0) setPullY(Math.min(dy * 0.65, 80))
  }
  const onPullEnd = async () => {
    const triggered = pullY >= PULL_THRESHOLD
    setPullY(0)
    pullStartY.current = -1
    if (triggered) {
      setIsPullRefreshing(true)
      await loadConditions()
      setIsPullRefreshing(false)
    }
  }

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
    setUserId(id)

    // Yahoo連携済み or オンボーディング完了済みならホームへ（再表示しない）
    if (localStorage.getItem('yahoowatch_yahoo_connected')) {
      localStorage.setItem('yahoowatch_onboarded', '1')
    }
    if (!localStorage.getItem('yahoowatch_onboarded')) {
      setShowOnboarding(true)
    }

    // 3つのAPIを並列実行（直列→並列で約2/3高速化）
    const [, settingsRes, conditionsRes] = await Promise.allSettled([
      fetch('/api/user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: id }) }),
      fetch(`/api/settings?userId=${id}`),
      fetch(`/api/conditions?userId=${id}`),
    ])

    // 条件を即表示（最優先）
    try {
      if (conditionsRes.status === 'fulfilled' && conditionsRes.value.ok) {
        setConditions(await conditionsRes.value.json())
      }
    } catch { /* JSON parseエラーは無視 */ } finally {
      setLoading(false)
    }

    // 設定はバックグラウンドで反映
    if (settingsRes.status === 'fulfilled' && settingsRes.value.ok) {
      const user = await settingsRes.value.json()
      setNotifyReady(!!(user.ntfyTopic || user.discordWebhook || user.notificationChannel === 'webpush'))

      // DBにpush_subがあるのにブラウザの購読が切れていたら自動再購読を試みる
      // 通知許可済みなら再購読可能（ユーザー操作不要）
      // push_subがnullになるとcronのユーザー取得クエリから除外されて全通知が止まるため重要
      if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
        try {
          const reg = await navigator.serviceWorker.getRegistration('/sw.js')
          const sub = reg ? await reg.pushManager.getSubscription() : null
          const needsResubscribe = !sub && (user.hasPush || user.notificationChannel === 'webpush')
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
    setRefreshing(true)
    try {
      const res = await fetch(`/api/conditions?userId=${id}`)
      if (res.ok) setConditions(await res.json())
    } catch { /* ネットワークエラーは無視 */ } finally {
      setRefreshing(false)
    }
  }

  // 条件登録・更新時にバックグラウンドで即チェック、結果をトーストで表示
  async function runNow(showToast = false) {
    if (!userId || running) return
    if (showToast) {
      setRunning(true)
      // 手動実行時は通知済みログをリセットして全件再チェック
      // （notified_items が残っていると既通知商品が再通知されないため）
      await fetch('/api/reset-notified', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      }).catch(() => {})
    }
    try {
      const res = await fetch('/api/run-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, manual: showToast }),
      })
      await loadConditions(userId)
      if (!showToast) return
      const data = await res.json()
      if (!res.ok) {
        setRunResult({ msg: data.error ?? 'チェックに失敗しました', type: 'warn' })
        setTimeout(() => setRunResult(null), 5000)
        return
      }
      const notified: number = data.notified ?? 0
      type ResultRow = { name: string; fetched: number; rawCount: number; alreadyNotified: number; filteredByBids: number; filteredByFormat: number; newItems: number; notified: number; priceWarning?: boolean; simpleCount?: number }
      const results: ResultRow[] = data.results ?? []
      console.log('[run-now] 診断結果:', JSON.stringify(results, null, 2))
      const totalAlready = results.reduce((s, r) => s + (r.alreadyNotified ?? 0), 0)
      const totalBidsFiltered = results.reduce((s, r) => s + (r.filteredByBids ?? 0), 0)
      const totalFormatFiltered = results.reduce((s, r) => s + (r.filteredByFormat ?? 0), 0)
      const totalFetched = results.reduce((s, r) => s + (r.fetched ?? 0), 0)

      // 問題のある条件を特定して表示
      const issues: string[] = []
      for (const r of results) {
        if (r.notified > 0) continue
        if (r.priceWarning) issues.push(`「${r.name}」最低価格≥最高価格`)
        else if (r.rawCount === 0) issues.push(`「${r.name}」商品なし`)
        else if (r.filteredByBids > 0) issues.push(`「${r.name}」入札数フィルターで除外`)
        else if (r.filteredByFormat > 0) issues.push(`「${r.name}」出品形式フィルターで除外`)
        else if (r.alreadyNotified > 0) issues.push(`「${r.name}」通知済み`)
        else if ((r.newItems ?? 0) > 0) issues.push(`「${r.name}」通知の送信に失敗しました — 設定ページでテスト通知をご確認ください`)
      }

      if (notified > 0) {
        setRunResult({ msg: `✓ ${notified}件通知しました`, type: 'ok' })
      } else if (issues.length > 0) {
        setRunResult({ msg: issues.join('\n'), type: 'info' })
      } else if (totalAlready > 0 && totalFetched > 0) {
        setRunResult({ msg: `${totalAlready}件は通知済み。新着を待っています`, type: 'info' })
      } else if (totalBidsFiltered > 0 || totalFormatFiltered > 0) {
        setRunResult({ msg: `入札数・出品形式フィルターで除外（${totalBidsFiltered + totalFormatFiltered}件）。条件を緩めてみてください`, type: 'info' })
      } else if (totalFetched === 0) {
        setRunResult({ msg: 'ヤフオクで該当商品が見つかりません', type: 'warn' })
      } else {
        setRunResult({ msg: '新着なし', type: 'info' })
      }
      setTimeout(() => setRunResult(null), 8000)
    } catch { /* ignore */ } finally {
      if (showToast) setRunning(false)
    }
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
      onTouchStart={onPullStart}
      onTouchMove={onPullMove}
      onTouchEnd={onPullEnd}
    >
      {/* ─── Pull-to-Refresh インジケーター ─── */}
      {(pullY > 0 || isPullRefreshing) && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
          display: 'flex', justifyContent: 'center', alignItems: 'flex-end',
          height: isPullRefreshing ? 56 : pullY, pointerEvents: 'none',
          paddingBottom: 8,
          transition: isPullRefreshing ? 'height 0.2s ease' : 'none',
        }}>
          <div style={{
            width: 28, height: 28,
            borderRadius: '50%',
            border: '2.5px solid var(--border)',
            borderTopColor: 'var(--accent)',
            animation: (pullY >= PULL_THRESHOLD || isPullRefreshing) ? 'spin 0.6s linear infinite' : 'none',
            transition: 'border-top-color 0.15s',
          }} />
        </div>
      )}

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
            <button
              onClick={() => loadConditions()}
              disabled={refreshing}
              style={{
                background: 'var(--fill)', border: '1px solid var(--border)', borderRadius: 20,
                width: 32, height: 32, cursor: refreshing ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-secondary)', opacity: refreshing ? 0.5 : 1,
              }}
            >
              <span style={{
                fontSize: 15, lineHeight: 1, display: 'inline-block',
                animation: refreshing ? 'spin 0.8s linear infinite' : 'none',
              }}>↻</span>
              <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
            </button>
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
                  { val: '10分', label: '更新間隔', highlight: false },
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

            {/* ─── 今すぐ確認 + 自動チェック表示 ─── */}
            {conditions.length > 0 && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  onClick={() => runNow(true)}
                  disabled={running}
                  style={{
                    width: '100%', height: 44, borderRadius: 14,
                    background: running ? 'var(--fill)' : 'var(--grad-primary)',
                    color: running ? 'var(--text-tertiary)' : 'white',
                    border: 'none', fontWeight: 600, fontSize: 14,
                    cursor: running ? 'default' : 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    transition: 'opacity 0.15s',
                    boxShadow: running ? 'none' : '0 2px 10px rgba(0,153,226,0.25)',
                  }}
                >
                  {running ? (
                    <><span style={{ fontSize: 15, animation: 'spin 0.8s linear infinite', display: 'inline-block' }}>↻</span> チェック中...</>
                  ) : (
                    <><span style={{ fontSize: 16 }}>🔍</span> 今すぐ確認</>
                  )}
                </button>
                <div style={{
                  padding: '10px 14px', borderRadius: 22,
                  background: 'var(--card)', border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 400, letterSpacing: '0.3px' }}>
                    10分ごとに自動チェック · 新着のみ通知
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── 結果トースト ─── */}
      {runResult && (
        <div style={{
          position: 'fixed',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)',
          left: '50%', transform: 'translateX(-50%)',
          maxWidth: 340, width: 'calc(100% - 32px)',
          background: runResult.type === 'ok' ? '#1a8a4a' : runResult.type === 'warn' ? '#b35a00' : '#333',
          color: 'white', borderRadius: 12,
          padding: '12px 16px',
          fontSize: 13, fontWeight: 500, lineHeight: 1.4,
          boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
          zIndex: 200,
          animation: 'fadeInUp 0.2s ease',
          textAlign: 'center',
        }}>
          {runResult.msg.split('\n').map((line, i) => (
            <div key={i} style={{ marginTop: i > 0 ? 4 : 0 }}>{line}</div>
          ))}
        </div>
      )}
      <style>{`@keyframes fadeInUp{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`}</style>

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
