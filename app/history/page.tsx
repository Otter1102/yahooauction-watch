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
    <div style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      {/* ヘッダー */}
      <div style={{
        background: 'var(--card)', borderBottom: '1px solid var(--border)',
        padding: '16px 20px 14px', position: 'sticky', top: 0, zIndex: 50,
      }}>
        <h1 style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-0.5px' }}>通知履歴</h1>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>
          {loading ? '読み込み中...' : `${history.length}件`}
        </p>
      </div>

      <div style={{ padding: '12px 16px' }}>
        {loading && (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <p style={{ color: 'var(--text-tertiary)' }}>読み込み中...</p>
          </div>
        )}

        {!loading && history.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <div style={{ fontSize: 56, marginBottom: 14 }}>📭</div>
            <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', marginBottom: 6 }}>
              まだ通知はありません
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              検索条件を追加して<br />ヤフオクを監視しましょう
            </p>
          </div>
        )}

        {history.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.map(r => (
              <a
                key={r.id}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  background: 'var(--card)',
                  borderRadius: 14,
                  padding: '14px 16px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  textDecoration: 'none',
                  display: 'block',
                  transition: 'transform 0.1s',
                }}
              >
                {/* 条件名 + 時刻 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span className="badge badge-orange">{r.conditionName}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {new Date(r.notifiedAt).toLocaleString('ja-JP', {
                      month: 'numeric', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>

                {/* タイトル */}
                <p style={{
                  fontWeight: 600, fontSize: 14, color: 'var(--text-primary)',
                  lineHeight: 1.4, marginBottom: 6,
                  display: '-webkit-box', WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {r.title}
                </p>

                {/* 価格 + 矢印 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--accent)' }}>
                    {r.price}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>ヤフオクで見る →</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
