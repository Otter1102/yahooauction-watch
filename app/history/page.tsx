'use client'
import { useEffect, useState } from 'react'
import { NotificationRecord } from '@/lib/types'

function getUserId() {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('yahoowatch_user_id') ?? ''
}

function groupByDate(records: NotificationRecord[]): { label: string; items: NotificationRecord[] }[] {
  const today     = new Date().toDateString()
  const yesterday = new Date(Date.now() - 86400000).toDateString()
  const map = new Map<string, NotificationRecord[]>()

  for (const r of records) {
    const d = new Date(r.notifiedAt)
    let label: string
    if (d.toDateString() === today)     label = '今日'
    else if (d.toDateString() === yesterday) label = '昨日'
    else label = d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) + '日'
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(r)
  }

  return Array.from(map.entries()).map(([label, items]) => ({ label, items }))
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

  const groups = groupByDate(history)

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--bg)',
      paddingBottom: 'calc(var(--nav-height) + env(safe-area-inset-bottom, 0px))',
    }}>

      {/* ─── Navigation bar (Apple Large Title style) ─── */}
      <div style={{
        background: 'rgba(242,242,247,0.88)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        borderBottom: '0.5px solid rgba(60,60,67,0.2)',
        padding: 'calc(env(safe-area-inset-top, 0px) + 16px) 20px 12px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <h1 style={{
            fontWeight: 700, fontSize: 28, color: 'var(--text-primary)',
            letterSpacing: '-0.6px', lineHeight: 1.1,
          }}>
            通知履歴
          </h1>
          {!loading && (
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 3, fontWeight: 400 }}>
              {history.length > 0 ? `${history.length}件` : '通知なし'}
            </p>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 16 }}>

        {/* ─── Loading spinner ─── */}
        {loading && (
          <div style={{ padding: '80px 20px', textAlign: 'center' }}>
            <div style={{
              width: 22, height: 22,
              border: '2px solid var(--separator)',
              borderTopColor: 'var(--accent)',
              borderRadius: '50%',
              margin: '0 auto',
              animation: 'spin 0.7s linear infinite',
            }} />
          </div>
        )}

        {/* ─── Empty state ─── */}
        {!loading && history.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 32px 40px', animation: 'fadeIn 0.3s ease' }}>
            <div style={{
              fontSize: 48, marginBottom: 16, opacity: 0.25,
              filter: 'grayscale(1)',
            }}>🔔</div>
            <p style={{
              fontWeight: 600, fontSize: 17,
              color: 'var(--text-primary)', marginBottom: 8,
            }}>まだ通知はありません</p>
            <p style={{ fontSize: 14, color: 'var(--text-tertiary)', lineHeight: 1.65 }}>
              検索条件を追加してヤフオクを監視すると<br />新着商品を自動で通知します
            </p>
          </div>
        )}

        {/* ─── Grouped list ─── */}
        {groups.map(({ label, items }) => (
          <div key={label} style={{ padding: '20px 16px 0' }}>

            {/* Section header */}
            <p style={{
              fontSize: 13, fontWeight: 600,
              color: 'var(--text-secondary)',
              paddingLeft: 4, marginBottom: 6,
            }}>{label}</p>

            {/* Grouped card */}
            <div style={{
              borderRadius: 13,
              overflow: 'hidden',
              background: 'var(--card)',
              boxShadow: '0 1px 0 rgba(60,60,67,0.1)',
            }}>
              {items.map((r, idx) => (
                <a
                  key={r.id}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: 'none', display: 'block' }}
                >
                  <div style={{
                    padding: '12px 16px',
                    borderTop: idx > 0 ? '0.5px solid var(--separator)' : 'none',
                    marginLeft: idx > 0 ? 16 : 0,
                    position: 'relative',
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'rgba(0,0,0,0.04)',
                  }}>

                    {/* Row 1: condition name + time */}
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between', marginBottom: 5,
                    }}>
                      <span style={{
                        fontSize: 11, fontWeight: 500,
                        color: 'var(--accent)',
                        letterSpacing: 0.3,
                        textTransform: 'uppercase',
                      }}>{r.conditionName}</span>
                      <time style={{
                        fontSize: 11, color: 'var(--text-tertiary)',
                        fontWeight: 400, fontVariantNumeric: 'tabular-nums',
                      }}>
                        {new Date(r.notifiedAt).toLocaleTimeString('ja-JP', {
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </time>
                    </div>

                    {/* Row 2: title */}
                    <p style={{
                      fontSize: 14, fontWeight: 400,
                      color: 'var(--text-primary)',
                      lineHeight: 1.45, marginBottom: 8,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}>{r.title}</p>

                    {/* Row 3: price + chevron */}
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between',
                    }}>
                      <span style={{
                        fontSize: 15, fontWeight: 600,
                        color: (r.price && r.price !== '価格不明')
                          ? 'var(--accent)'
                          : 'var(--text-tertiary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {(r.price && r.price !== '価格不明') ? r.price : '—'}
                      </span>
                      <span style={{
                        fontSize: 18,
                        color: 'var(--text-tertiary)',
                        fontWeight: 300,
                        lineHeight: 1,
                      }}>›</span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        ))}

        {/* ─── Footer note ─── */}
        {history.length > 0 && !loading && (
          <p style={{
            textAlign: 'center', fontSize: 12,
            color: 'var(--text-tertiary)', fontWeight: 400,
            padding: '20px 16px 4px',
          }}>
            終了したオークションは自動的に削除されます
          </p>
        )}
      </div>
    </div>
  )
}
