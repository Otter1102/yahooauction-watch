'use client'
import { useEffect, useState } from 'react'
import { NotificationRecord } from '@/lib/types'

function getUserId() {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('yahoowatch_user_id') ?? ''
}

export default function HistoryPage() {
  const [history, setHistory] = useState<NotificationRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const id = getUserId()
    if (!id) { setLoading(false); return }
    fetch(`/api/history?userId=${id}`)
      .then(r => r.json())
      .then(d => { setHistory(d); setLoading(false) })
  }, [])

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingBottom: 'calc(var(--nav-height) + env(safe-area-inset-bottom,0px))' }}>

      {/* ティールグラデーションヘッダー */}
      <div style={{ background: 'var(--grad-teal)', padding: '20px 20px 18px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: 22 }}>🔔</span>
            <h1 style={{ fontWeight: 900, fontSize: 24, color: 'white', letterSpacing: '-0.5px' }}>通知履歴</h1>
          </div>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', marginLeft: 30 }}>
            {loading ? '読み込み中...' : `${history.length}件の通知`}
          </p>
        </div>
      </div>

      <div style={{ padding: '12px 16px', maxWidth: 480, margin: '0 auto' }}>
        {loading && (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <p style={{ color: 'var(--text-tertiary)' }}>読み込み中...</p>
          </div>
        )}

        {!loading && history.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <div style={{
              width: 100, height: 100, borderRadius: 30, margin: '0 auto 20px',
              background: 'var(--grad-teal)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 48, boxShadow: '0 12px 40px rgba(17,153,142,0.35)',
            }}>📭</div>
            <p style={{ fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', marginBottom: 8 }}>まだ通知はありません</p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              検索条件を追加して<br />ヤフオクを監視しましょう
            </p>
          </div>
        )}

        {history.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {history.map((r, i) => (
              <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer"
                style={{ textDecoration: 'none', display: 'block' }}>
                <div style={{
                  background: 'var(--card)', borderRadius: 20,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
                  overflow: 'hidden', display: 'flex',
                }}>
                  {/* 左カラーバー（グラデーション循環） */}
                  <div style={{
                    width: 5, flexShrink: 0,
                    background: [
                      'linear-gradient(180deg,#FF6B35,#FF3366)',
                      'linear-gradient(180deg,#667EEA,#764BA2)',
                      'linear-gradient(180deg,#11998E,#38EF7D)',
                      'linear-gradient(180deg,#F7971E,#FFD200)',
                      'linear-gradient(180deg,#2193B0,#6DD5FA)',
                    ][i % 5],
                  }} />
                  <div style={{ flex: 1, padding: '14px 14px 14px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span className="badge badge-orange">{r.conditionName}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        {new Date(r.notifiedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p style={{
                      fontWeight: 600, fontSize: 14, color: 'var(--text-primary)',
                      lineHeight: 1.4, marginBottom: 8,
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>{r.title}</p>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{
                        fontWeight: 900, fontSize: 18,
                        background: 'var(--grad-primary)',
                        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                      }}>{r.price}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600 }}>ヤフオクで見る →</span>
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
