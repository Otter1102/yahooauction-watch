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

  useEffect(() => { init() }, [])

  const activeCount = conditions.filter(c => c.enabled).length

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      {/* ヘッダー */}
      <div style={{
        background: 'var(--card)',
        borderBottom: '1px solid var(--border)',
        padding: '16px 20px 14px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-0.5px', color: 'var(--text-primary)' }}>
              ヤフオク<span style={{ color: 'var(--accent)' }}>watch</span>
            </h1>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>
              {loading ? '読み込み中...' : `${conditions.length}件の条件`}
              {activeCount > 0 && !loading && (
                <span style={{ marginLeft: 8, color: 'var(--success)', fontWeight: 600 }}>
                  ● {activeCount}件稼働中
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => loadConditions()}
            style={{ background: 'var(--bg)', border: 'none', borderRadius: 20, width: 36, height: 36, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {loading ? '⟳' : '↻'}
          </button>
        </div>
      </div>

      <div style={{ padding: '16px 16px 0' }}>
        {/* 通知未設定バナー */}
        {!notifyReady && !loading && (
          <a href="/settings" style={{
            display: 'block', marginBottom: 14, padding: '14px 16px',
            background: '#FFF8E6', border: '1px solid #FFDD80',
            borderRadius: 14, textDecoration: 'none',
          }}>
            <p style={{ fontWeight: 700, fontSize: 14, color: '#9A6900' }}>⚠️ 通知がまだ設定されていません</p>
            <p style={{ fontSize: 12, color: '#B8860B', marginTop: 2 }}>タップして通知先を設定 →</p>
          </a>
        )}

        {/* 空状態 */}
        {!loading && conditions.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 60, paddingBottom: 40 }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>🔍</div>
            <p style={{ fontWeight: 700, fontSize: 18, color: 'var(--text-primary)', marginBottom: 8 }}>
              ウォッチリストが空です
            </p>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 28, lineHeight: 1.6 }}>
              監視したいキーワードと価格を設定すると<br />新着商品を自動で通知します
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="btn-primary"
              style={{ display: 'inline-block' }}
            >
              最初の条件を追加する
            </button>
          </div>
        )}

        {/* 条件リスト */}
        {conditions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {conditions.map(c => (
              <ConditionCard key={c.id} condition={c} onChange={() => loadConditions()} />
            ))}
          </div>
        )}

        {conditions.length > 0 && (
          <div style={{
            marginTop: 16, marginBottom: 8, padding: '12px 14px',
            background: 'var(--card)', borderRadius: 12,
            fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.7,
          }}>
            <span>⚡ 30分ごとに自動チェック · 新着のみ通知</span>
          </div>
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => setShowForm(true)}
        style={{
          position: 'fixed',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 86px)',
          right: 'max(16px, calc(50% - 240px + 16px))',
          width: 56, height: 56,
          background: 'var(--accent)',
          color: 'white',
          border: 'none', borderRadius: 28,
          fontSize: 28, fontWeight: 300,
          boxShadow: '0 4px 14px rgba(255,102,0,0.4)',
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
