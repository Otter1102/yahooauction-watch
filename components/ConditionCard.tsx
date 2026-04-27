'use client'
import { useState } from 'react'
import { SearchCondition } from '@/lib/types'

interface Props {
  condition: SearchCondition
  userId: string
  onChange: () => void
  onEdit: (condition: SearchCondition) => void
  onDuplicate: (condition: SearchCondition) => void
  onEnable?: () => void  // オフ→オン時に即時チェックを起動するコールバック
}

const SELLER_LABEL: Record<SearchCondition['sellerType'], string>    = { all: '', store: 'ストア', individual: '個人' }
const ITEM_LABEL:   Record<SearchCondition['itemCondition'], string> = { all: '', new: '新品', used: '中古' }
const SORT_LABEL:   Record<SearchCondition['sortBy'], string>        = { endTime: '終了順', bids: '入札数', price: '価格順' }

export default function ConditionCard({ condition, userId, onChange, onEdit, onDuplicate, onEnable }: Props) {
  const [toggling, setToggling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function toggleEnabled() {
    const turningOn = !condition.enabled  // オン方向のトグルか記録
    setToggling(true)
    try {
      const res = await fetch(`/api/conditions/${condition.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, enabled: !condition.enabled }),
      })
      if (res.ok) {
        onChange()
        // オフ→オンにした時だけ即時チェックを起動（新着を今すぐ取得）
        if (turningOn) onEnable?.()
      }
    } catch {
      // ネットワークエラー等は無視して元の状態を保持
    } finally {
      setToggling(false)
    }
  }

  async function remove() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/conditions/${condition.id}?userId=${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      })
      if (res.ok) onChange()
    } catch {
      setDeleting(false)
    }
  }

  const lastChecked = condition.lastCheckedAt
    ? new Date(condition.lastCheckedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  const tags: string[] = []
  if (SELLER_LABEL[condition.sellerType]) tags.push(SELLER_LABEL[condition.sellerType])
  if (ITEM_LABEL[condition.itemCondition]) tags.push(ITEM_LABEL[condition.itemCondition])
  if (condition.minBids > 0 && condition.maxBids !== null) {
    tags.push(`入札${condition.minBids}〜${condition.maxBids}件`)
  } else if (condition.minBids > 0) {
    tags.push(`入札${condition.minBids}件以上`)
  } else if (condition.maxBids !== null) {
    tags.push(`入札${condition.maxBids}件未満`)
  }
  if (condition.buyItNow) tags.push('即決')
  if (condition.sortBy !== 'endTime' || condition.sortOrder !== 'asc') {
    tags.push(SORT_LABEL[condition.sortBy] + (condition.sortOrder === 'desc' ? '↓' : '↑'))
  }

  return (
    <div style={{
      background: 'var(--card)',
      borderRadius: 12,
      overflow: 'hidden',
      boxShadow: 'var(--shadow-sm)',
      border: '1px solid var(--border)',
      opacity: deleting ? 0.3 : condition.enabled ? 1 : 0.55,
      transition: 'opacity 0.2s',
    }}>
      <div style={{ padding: '13px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>

          {/* Status indicator */}
          <div style={{
            width: 36, height: 36, borderRadius: 8, flexShrink: 0,
            background: condition.enabled
              ? 'linear-gradient(135deg, rgba(39,181,212,0.15) 0%, rgba(26,106,201,0.15) 100%)'
              : 'var(--fill)',
            border: condition.enabled ? '1px solid rgba(0,153,226,0.2)' : '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s',
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: 4,
              background: condition.enabled ? 'var(--accent)' : 'var(--text-tertiary)',
              transition: 'background 0.2s',
            }} />
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontWeight: 700, fontSize: 14,
              color: 'var(--text-primary)',
              marginBottom: 2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {condition.name}
            </p>
            <p style={{
              fontSize: 13, fontWeight: 500,
              color: condition.enabled ? 'var(--accent)' : 'var(--text-tertiary)',
              marginBottom: 3, letterSpacing: '0.2px',
            }}>
              {condition.keyword}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 400, fontVariantNumeric: 'tabular-nums' }}>
              {condition.minPrice > 0
                ? `¥${condition.minPrice.toLocaleString()} 〜 ¥${condition.maxPrice.toLocaleString()}`
                : `〜 ¥${condition.maxPrice.toLocaleString()}`}
            </p>

            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {tags.map(t => (
                  <span key={t} style={{
                    fontSize: 10, fontWeight: 500, padding: '2px 7px',
                    background: 'rgba(0,153,226,0.08)',
                    color: 'var(--accent)',
                    borderRadius: 4,
                    letterSpacing: '0.3px',
                  }}>{t}</span>
                ))}
              </div>
            )}

            {lastChecked && (
              <p style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 5, fontWeight: 400, letterSpacing: '0.2px' }}>
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
                fontSize: 16, color: 'var(--text-tertiary)',
                background: 'none', border: 'none', cursor: 'pointer',
                lineHeight: 1, padding: '2px 4px', letterSpacing: 2,
              }}
            >···</button>
          </div>
        </div>

        {showMenu && !confirmDelete && (
          <div style={{
            marginTop: 11, paddingTop: 11,
            borderTop: '1px solid var(--border)',
            display: 'flex', gap: 8,
          }}>
            <button
              onClick={() => { setShowMenu(false); onEdit(condition) }}
              style={{
                flex: 1, padding: '10px', borderRadius: 8,
                background: 'rgba(0,153,226,0.08)',
                color: 'var(--accent)',
                fontWeight: 600, fontSize: 13,
                border: '1px solid rgba(0,153,226,0.2)', cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >編集</button>
            <button
              onClick={() => { setShowMenu(false); onDuplicate(condition) }}
              style={{
                flex: 1, padding: '10px', borderRadius: 8,
                background: 'rgba(100,180,100,0.08)',
                color: '#3a9a3a',
                fontWeight: 600, fontSize: 13,
                border: '1px solid rgba(100,180,100,0.25)', cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >複製</button>
            <button
              onClick={() => { setConfirmDelete(true) }}
              style={{
                flex: 1, padding: '10px', borderRadius: 8,
                background: 'rgba(246,104,138,0.07)',
                color: 'var(--danger)',
                fontWeight: 600, fontSize: 13,
                border: '1px solid rgba(246,104,138,0.2)', cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >削除</button>
          </div>
        )}

        {confirmDelete && (
          <div style={{
            marginTop: 11, paddingTop: 11,
            borderTop: '1px solid var(--border)',
          }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              「{condition.name}」を削除しますか？
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { setConfirmDelete(false); setShowMenu(false) }}
                style={{
                  flex: 1, padding: '10px', borderRadius: 8,
                  background: 'var(--fill)', border: '1px solid var(--border)',
                  fontWeight: 600, fontSize: 13, color: 'var(--text-secondary)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >キャンセル</button>
              <button
                onClick={() => { setConfirmDelete(false); setShowMenu(false); remove() }}
                style={{
                  flex: 1, padding: '10px', borderRadius: 8,
                  background: 'var(--danger)', border: 'none',
                  fontWeight: 700, fontSize: 13, color: 'white',
                  cursor: 'pointer', fontFamily: 'inherit',
                  opacity: deleting ? 0.6 : 1,
                }}
              >削除する</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
