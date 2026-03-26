'use client'
import { useState } from 'react'
import { SearchCondition } from '@/lib/types'

interface Props {
  condition: SearchCondition
  onChange: () => void
  onEdit: (condition: SearchCondition) => void
}

const SELLER_LABEL: Record<SearchCondition['sellerType'], string> = { all: '', store: 'ストア', individual: '個人' }
const ITEM_LABEL: Record<SearchCondition['itemCondition'], string> = { all: '', new: '新品', used: '中古' }
const SORT_LABEL: Record<SearchCondition['sortBy'], string> = { endTime: '終了順', bids: '入札数順', price: '価格順' }

const CARD_GRADS = [
  'linear-gradient(135deg, #FF6B35, #FF3366)',
  'linear-gradient(135deg, #667EEA, #764BA2)',
  'linear-gradient(135deg, #11998E, #38EF7D)',
  'linear-gradient(135deg, #F7971E, #FFD200)',
  'linear-gradient(135deg, #2193B0, #6DD5FA)',
]

export default function ConditionCard({ condition, onChange, onEdit }: Props) {
  const [toggling, setToggling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showMenu, setShowMenu] = useState(false)

  const gradIndex = parseInt(condition.id.replace(/-/g, '').slice(-1), 16) % CARD_GRADS.length
  const grad = CARD_GRADS[gradIndex]

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
      borderRadius: 20,
      boxShadow: '0 4px 20px rgba(0,0,0,0.07)',
      overflow: 'hidden',
      opacity: deleting ? 0.4 : condition.enabled ? 1 : 0.55,
      transition: 'opacity 0.2s',
      display: 'flex',
    }}>
      {/* グラデーション左バー */}
      <div style={{ width: 5, background: condition.enabled ? grad : 'var(--border)', flexShrink: 0 }} />

      <div style={{ flex: 1, padding: '14px 14px 14px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>

          {/* アイコン */}
          <div style={{
            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
            background: condition.enabled ? 'rgba(255,107,53,0.1)' : 'var(--bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
          }}>
            🏷️
          </div>

          {/* 情報 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', marginBottom: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {condition.name}
            </p>
            <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 3, color: condition.enabled ? 'var(--accent)' : 'var(--text-tertiary)' }}>
              {condition.keyword}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 400 }}>
              {condition.minPrice > 0 ? `¥${condition.minPrice.toLocaleString()} 〜 ` : '〜 '}
              ¥{condition.maxPrice.toLocaleString()}
            </p>

            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {tags.map(t => (
                  <span key={t} style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 7px',
                    background: 'var(--bg)', color: 'var(--text-secondary)',
                    borderRadius: 6, border: '1px solid var(--border)',
                  }}>{t}</span>
                ))}
              </div>
            )}

            {lastChecked && (
              <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 5 }}>
                最終: {lastChecked}{condition.lastFoundCount !== undefined && ` · ${condition.lastFoundCount}件`}
              </p>
            )}
          </div>

          {/* トグル + メニューボタン */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <label className="toggle" style={{ opacity: toggling ? 0.5 : 1 }}>
              <input type="checkbox" checked={condition.enabled} onChange={toggleEnabled} />
              <span className="toggle-track" />
              <span className="toggle-thumb" />
            </label>
            <button
              onClick={() => setShowMenu(!showMenu)}
              style={{ fontSize: 20, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '2px 4px' }}
            >···</button>
          </div>
        </div>

        {showMenu && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={() => { setShowMenu(false); onEdit(condition) }}
              style={{
                width: '100%', padding: '10px', borderRadius: 10,
                background: 'var(--bg)',
                color: 'var(--text-primary)', fontWeight: 500, fontSize: 13,
                border: '1px solid var(--border)', cursor: 'pointer',
              }}
            >✏️ 条件を編集</button>
            <button
              onClick={() => { setShowMenu(false); remove() }}
              style={{
                width: '100%', padding: '10px', borderRadius: 10,
                background: 'rgba(225,112,85,0.06)',
                color: 'var(--danger)', fontWeight: 500, fontSize: 13,
                border: '1px solid rgba(225,112,85,0.15)', cursor: 'pointer',
              }}
            >🗑️ この条件を削除</button>
          </div>
        )}
      </div>
    </div>
  )
}
