'use client'
import { useState } from 'react'
import { SearchCondition } from '@/lib/types'

interface Props { condition: SearchCondition; onChange: () => void }

const SELLER_LABEL: Record<SearchCondition['sellerType'], string> = {
  all: '', store: 'ストア', individual: '個人',
}
const ITEM_LABEL: Record<SearchCondition['itemCondition'], string> = {
  all: '', new: '新品', used: '中古',
}
const SORT_LABEL: Record<SearchCondition['sortBy'], string> = {
  endTime: '終了順', bids: '入札数順', price: '価格順',
}

export default function ConditionCard({ condition, onChange }: Props) {
  const [toggling, setToggling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showMenu, setShowMenu] = useState(false)

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
    ? new Date(condition.lastCheckedAt).toLocaleString('ja-JP', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : null

  // フィルタータグを組み立て
  const tags: string[] = []
  if (SELLER_LABEL[condition.sellerType]) tags.push(SELLER_LABEL[condition.sellerType])
  if (ITEM_LABEL[condition.itemCondition]) tags.push(ITEM_LABEL[condition.itemCondition])
  if (condition.minBids > 0) tags.push(`入札${condition.minBids}件以上`)
  if (condition.buyItNow) tags.push('即決')
  const sortLabel = SORT_LABEL[condition.sortBy] + (condition.sortOrder === 'desc' ? '↓' : '↑')
  if (condition.sortBy !== 'endTime' || condition.sortOrder !== 'asc') tags.push(sortLabel)

  return (
    <div style={{
      background: 'var(--card)',
      borderRadius: 16,
      boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
      padding: '16px',
      opacity: deleting ? 0.4 : condition.enabled ? 1 : 0.55,
      transition: 'opacity 0.2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* アイコン */}
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: condition.enabled ? 'var(--accent-light)' : 'var(--bg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20,
        }}>
          🏷️
        </div>

        {/* 情報 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', marginBottom: 2 }}>
            {condition.name}
          </p>
          <p style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, marginBottom: 4 }}>
            {condition.keyword}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {condition.minPrice > 0 ? `¥${condition.minPrice.toLocaleString()} 〜 ` : ''}
            上限 ¥{condition.maxPrice.toLocaleString()}
          </p>

          {/* フィルタータグ */}
          {tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
              {tags.map(t => (
                <span key={t} style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 7px',
                  background: 'var(--bg)', color: 'var(--text-secondary)',
                  borderRadius: 6, border: '1px solid var(--border)',
                }}>
                  {t}
                </span>
              ))}
            </div>
          )}

          {lastChecked && (
            <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
              最終: {lastChecked}
              {condition.lastFoundCount !== undefined && ` · ${condition.lastFoundCount}件`}
            </p>
          )}
        </div>

        {/* トグル + メニュー */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <label className="toggle" style={{ opacity: toggling ? 0.5 : 1 }}>
            <input type="checkbox" checked={condition.enabled} onChange={toggleEnabled} />
            <span className="toggle-track" />
            <span className="toggle-thumb" />
          </label>
          <button
            onClick={() => setShowMenu(!showMenu)}
            style={{ fontSize: 18, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}
          >
            ···
          </button>
        </div>
      </div>

      {/* メニュー */}
      {showMenu && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => { setShowMenu(false); remove() }}
            style={{
              width: '100%', padding: '10px', borderRadius: 10,
              background: '#FFF0EE', color: 'var(--danger)',
              fontWeight: 600, fontSize: 14, border: 'none', cursor: 'pointer',
            }}
          >
            🗑️ この条件を削除
          </button>
        </div>
      )}
    </div>
  )
}
