'use client'
import { useState } from 'react'
import { SearchCondition } from '@/lib/types'

interface Props {
  condition: SearchCondition
  onChange: () => void
  onEdit: (condition: SearchCondition) => void
}

const SELLER_LABEL: Record<SearchCondition['sellerType'], string>    = { all: '', store: 'ストア', individual: '個人' }
const ITEM_LABEL:   Record<SearchCondition['itemCondition'], string> = { all: '', new: '新品', used: '中古' }
const SORT_LABEL:   Record<SearchCondition['sortBy'], string>        = { endTime: '終了順', bids: '入札数', price: '価格順' }

// Soft pastel backgrounds per condition (no heavy gradients)
const ICON_COLORS = [
  'rgba(255,107,53,0.12)',
  'rgba(94,92,230,0.10)',
  'rgba(48,209,88,0.10)',
  'rgba(255,149,0,0.10)',
  'rgba(100,210,255,0.12)',
]

export default function ConditionCard({ condition, onChange, onEdit }: Props) {
  const [toggling, setToggling]   = useState(false)
  const [deleting, setDeleting]   = useState(false)
  const [showMenu, setShowMenu]   = useState(false)

  const colorIdx  = parseInt(condition.id.replace(/-/g, '').slice(-1), 16) % ICON_COLORS.length
  const iconBg    = ICON_COLORS[colorIdx]

  async function toggleEnabled() {
    setToggling(true)
    await fetch(`/api/conditions/${condition.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !condition.enabled }),
    })
    onChange()
    setToggling(false)
  }

  async function remove() {
    if (!confirm(`「${condition.name}」を削除しますか？`)) return
    setDeleting(true)
    await fetch(`/api/conditions/${condition.id}`, { method: 'DELETE' })
    onChange()
  }

  const lastChecked = condition.lastCheckedAt
    ? new Date(condition.lastCheckedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  const tags: string[] = []
  if (SELLER_LABEL[condition.sellerType]) tags.push(SELLER_LABEL[condition.sellerType])
  if (ITEM_LABEL[condition.itemCondition]) tags.push(ITEM_LABEL[condition.itemCondition])
  if (condition.minBids > 0) tags.push(`入札${condition.minBids}件以上`)
  if (condition.buyItNow) tags.push('即決')
  if (condition.sortBy !== 'endTime' || condition.sortOrder !== 'asc') {
    tags.push(SORT_LABEL[condition.sortBy] + (condition.sortOrder === 'desc' ? '↓' : '↑'))
  }

  return (
    <div style={{
      background: 'var(--card)',
      borderRadius: 13,
      overflow: 'hidden',
      opacity: deleting ? 0.35 : condition.enabled ? 1 : 0.5,
      transition: 'opacity 0.2s',
    }}>
      <div style={{ padding: '13px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>

          {/* Icon cell */}
          <div style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: condition.enabled ? iconBg : 'var(--fill)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, transition: 'background 0.2s',
          }}>
            🏷️
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontWeight: 600, fontSize: 14,
              color: 'var(--text-primary)',
              marginBottom: 1,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {condition.name}
            </p>
            <p style={{
              fontSize: 13, fontWeight: 400,
              color: condition.enabled ? 'var(--accent)' : 'var(--text-tertiary)',
              marginBottom: 3,
            }}>
              {condition.keyword}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 400, fontVariantNumeric: 'tabular-nums' }}>
              {condition.minPrice > 0 ? `¥${condition.minPrice.toLocaleString()} 〜 ¥${condition.maxPrice.toLocaleString()}` : `〜 ¥${condition.maxPrice.toLocaleString()}`}
            </p>

            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {tags.map(t => (
                  <span key={t} style={{
                    fontSize: 10, fontWeight: 400, padding: '2px 7px',
                    background: 'var(--fill)', color: 'var(--text-secondary)',
                    borderRadius: 5,
                  }}>{t}</span>
                ))}
              </div>
            )}

            {lastChecked && (
              <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 5, fontWeight: 400 }}>
                最終チェック {lastChecked}
                {condition.lastFoundCount !== undefined && ` · ${condition.lastFoundCount}件`}
              </p>
            )}
          </div>

          {/* Toggle + menu */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
            <label className="toggle" style={{ opacity: toggling ? 0.5 : 1 }}>
              <input type="checkbox" checked={condition.enabled} onChange={toggleEnabled} />
              <span className="toggle-track" />
              <span className="toggle-thumb" />
            </label>
            <button
              onClick={() => setShowMenu(!showMenu)}
              style={{
                fontSize: 17, color: 'var(--text-tertiary)',
                background: 'none', border: 'none', cursor: 'pointer',
                lineHeight: 1, padding: '2px 4px', letterSpacing: 1,
              }}
            >···</button>
          </div>
        </div>

        {showMenu && (
          <div style={{
            marginTop: 11, paddingTop: 11,
            borderTop: '0.5px solid var(--separator)',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <button
              onClick={() => { setShowMenu(false); onEdit(condition) }}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 10,
                background: 'var(--fill)', color: 'var(--text-primary)',
                fontWeight: 500, fontSize: 13,
                border: 'none', cursor: 'pointer', textAlign: 'left',
              }}
            >✏️　条件を編集</button>
            <button
              onClick={() => { setShowMenu(false); remove() }}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 10,
                background: 'rgba(255,59,48,0.06)', color: 'var(--danger)',
                fontWeight: 500, fontSize: 13,
                border: 'none', cursor: 'pointer', textAlign: 'left',
              }}
            >🗑️　この条件を削除</button>
          </div>
        )}
      </div>
    </div>
  )
}
