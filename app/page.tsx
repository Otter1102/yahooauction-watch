'use client'
import { useEffect, useState } from 'react'
import { SearchCondition } from '@/lib/types'
import ConditionCard from '@/components/ConditionCard'
import ConditionForm from '@/components/ConditionForm'

function getUserId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('yahoowatch_user_id')
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('yahoowatch_user_id', id) }
  return id
}

export default function Dashboard() {
  const [userId, setUserId] = useState('')
  const [conditions, setConditions] = useState<SearchCondition[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notifyReady, setNotifyReady] = useState(false)
  const [runState, setRunState] = useState<'idle' | 'running' | 'done'>('idle')
  const [runResult, setRunResult] = useState<{ notified: number; checked: number; results?: { name: string; found: number; notified: number }[] } | null>(null)

  async function init() {
    const id = getUserId()
    if (!id) return
    setUserId(id)
    try {
      await fetch('/api/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id }),
      })
      const res = await fetch(`/api/settings?userId=${id}`)
      if (res.ok) {
        const user = await res.json()
        setNotifyReady(!!(user.ntfyTopic || user.discordWebhook))
      }
    } catch {}
    await loadConditions(id)
  }

  async function loadConditions(uid?: string) {
    setLoading(true)
    const id = uid ?? userId
    if (!id) return
    const res = await fetch(`/api/conditions?userId=${id}`)
    setConditions(await res.json())
    setLoading(false)
  }

  async function runNow() {
    if (!userId || runState === 'running') return
    setRunState('running')
    setRunResult(null)
    const res = await fetch('/api/run-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    const data = await res.json()
    setRunResult(data)
    setRunState('done')
    await loadConditions(userId)
    setTimeout(() => setRunState('idle'), 15000)
  }

  useEffect(() => { init() }, [])

  const activeCount = conditions.filter(c => c.enabled).length

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingBottom: 'calc(var(--nav-height) + env(safe-area-inset-bottom,0px))' }}>

      {/* グラデーションヘッダー */}
      <div style={{
        background: 'var(--grad-primary)',
        padding: '20px 20px 18px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 480, margin: '0 auto' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 24 }}>⚡</span>
              <h1 style={{ fontWeight: 900, fontSize: 24, color: 'white', letterSpacing: '-0.5px' }}>
                ヤフオク<span style={{ fontStyle: 'italic' }}>watch</span>
              </h1>
            </div>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.80)', marginLeft: 32 }}>
              {loading ? '読み込み中...' : `${conditions.length}件の監視条件`}
              {activeCount > 0 && !loading && (
                <span style={{ marginLeft: 8, color: '#FFE066', fontWeight: 700 }}>
                  ● {activeCount}件稼働中
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => loadConditions()}
            style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 22, width: 40, height: 40, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}
          >
            {loading ? '⟳' : '↻'}
          </button>
        </div>
      </div>

      <div style={{ padding: '16px', maxWidth: 480, margin: '0 auto' }}>

        {/* 通知未設定バナー */}
        {!notifyReady && !loading && (
          <a href="/settings" style={{
            display: 'block', marginBottom: 14,
            borderRadius: 16, textDecoration: 'none', overflow: 'hidden',
          }}>
            <div style={{
              background: 'var(--grad-warm)',
              padding: '14px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: 14, color: 'white' }}>⚠️ 通知がまだ設定されていません</p>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>タップして通知先を設定 →</p>
              </div>
            </div>
          </a>
        )}

        {/* 稼働中ステータスカード */}
        {conditions.length > 0 && !loading && (
          <div style={{
            borderRadius: 20, overflow: 'hidden',
            background: 'var(--grad-cool)',
            padding: '18px 20px', marginBottom: 16,
            boxShadow: '0 8px 32px rgba(102,126,234,0.3)',
            display: 'flex', justifyContent: 'space-around', alignItems: 'center',
          }}>
            {[
              { val: activeCount, label: '稼働中' },
              { val: conditions.length, label: '総条件数' },
              { val: '10分', label: 'チェック間隔' },
            ].map((item, i) => (
              <div key={i} style={{ textAlign: 'center', flex: 1 }}>
                {i > 0 && <div style={{ position: 'absolute' }} />}
                <p style={{ fontSize: 26, fontWeight: 900, color: 'white', lineHeight: 1 }}>{item.val}</p>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 4, fontWeight: 600 }}>{item.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* 空状態 */}
        {!loading && conditions.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 60, paddingBottom: 40 }}>
            <div style={{
              width: 100, height: 100, borderRadius: 30, margin: '0 auto 20px',
              background: 'var(--grad-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 48, boxShadow: '0 12px 40px rgba(255,107,53,0.35)',
            }}>🔍</div>
            <p style={{ fontWeight: 800, fontSize: 20, color: 'var(--text-primary)', marginBottom: 10 }}>
              ウォッチリストが空です
            </p>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 32, lineHeight: 1.7 }}>
              監視したいキーワードと価格を設定すると<br />新着商品を自動で通知します
            </p>
            <button onClick={() => setShowForm(true)} className="btn-primary" style={{ display: 'inline-block', width: 'auto', padding: '14px 32px' }}>
              最初の条件を追加する
            </button>
          </div>
        )}

        {/* 条件リスト */}
        {conditions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {conditions.map(c => (
              <ConditionCard key={c.id} condition={c} onChange={() => loadConditions()} />
            ))}
          </div>
        )}

        {conditions.length > 0 && (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              onClick={runNow}
              disabled={runState === 'running' || !notifyReady}
              style={{
                width: '100%', padding: '14px 16px',
                background: runState === 'running' ? 'var(--bg)' : 'var(--card)',
                border: '1.5px solid var(--border)', borderRadius: 16,
                fontSize: 14, fontWeight: 700, cursor: runState === 'running' ? 'default' : 'pointer',
                color: 'var(--text-primary)', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                opacity: !notifyReady ? 0.5 : 1,
              }}
            >
              {runState === 'running' ? '🔄 チェック中...' : '▶ 今すぐチェック実行'}
            </button>

            {runState === 'done' && runResult && (
              <div style={{
                padding: '14px 16px', borderRadius: 14,
                background: runResult.notified > 0 ? 'rgba(0,184,148,0.1)' : 'rgba(178,190,195,0.12)',
                border: `1px solid ${runResult.notified > 0 ? 'rgba(0,184,148,0.3)' : 'var(--border)'}`,
              }}>
                <p style={{ fontWeight: 700, fontSize: 14, color: runResult.notified > 0 ? 'var(--success)' : 'var(--text-secondary)', marginBottom: 6 }}>
                  {runResult.notified > 0 ? `✅ ${runResult.notified}件通知送信！` : '📭 新着なし（全件通知済み）'}
                </p>
                {runResult.results?.map((r, i) => (
                  <p key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {r.name}: {r.found}件取得 → {r.notified}件通知
                  </p>
                ))}
              </div>
            )}

            <div style={{
              padding: '12px 16px',
              background: 'var(--card)', borderRadius: 14,
              fontSize: 12, color: 'var(--text-tertiary)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 14 }}>⚡</span>
              <span>10分ごとに自動チェック · 新着のみ通知</span>
            </div>
          </div>
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => setShowForm(true)}
        style={{
          position: 'fixed',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
          right: 'max(16px, calc(50% - 240px + 16px))',
          width: 60, height: 60,
          background: 'var(--grad-primary)',
          color: 'white', border: 'none', borderRadius: 30,
          fontSize: 30, fontWeight: 300,
          boxShadow: '0 8px 28px rgba(255,107,53,0.5)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 90,
          transition: 'transform 0.15s, box-shadow 0.15s',
        }}
      >
        +
      </button>

      {showForm && userId && (
        <ConditionForm
          userId={userId}
          onSave={() => { setShowForm(false); loadConditions() }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  )
}
