'use client'
import { useState } from 'react'
import { SearchCondition } from '@/lib/types'

interface Props {
  userId: string
  condition?: SearchCondition   // 渡すと編集モード
  onSave: () => void
  onClose: () => void
}

type FormState = {
  name: string
  keyword: string
  maxPrice: string
  minPrice: string
  minBids: string
  sellerType: SearchCondition['sellerType']
  itemCondition: SearchCondition['itemCondition']
  sortBy: SearchCondition['sortBy']
  sortOrder: SearchCondition['sortOrder']
  buyItNow: boolean
}

const DEFAULTS: FormState = {
  name: '', keyword: '', maxPrice: '', minPrice: '', minBids: '',
  sellerType: 'all', itemCondition: 'all',
  sortBy: 'endTime', sortOrder: 'asc', buyItNow: false,
}

function conditionToForm(c: SearchCondition): FormState {
  return {
    name: c.name,
    keyword: c.keyword,
    maxPrice: String(c.maxPrice),
    minPrice: c.minPrice > 0 ? String(c.minPrice) : '',
    minBids: c.minBids > 0 ? String(c.minBids) : '',
    sellerType: c.sellerType,
    itemCondition: c.itemCondition,
    sortBy: c.sortBy,
    sortOrder: c.sortOrder,
    buyItNow: c.buyItNow,
  }
}

function SegmentControl<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 0, background: 'var(--bg)', borderRadius: 10, padding: 3, border: '1px solid var(--border)' }}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          style={{
            flex: 1, padding: '7px 4px', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: value === o.value ? 'var(--card)' : 'transparent',
            color: value === o.value ? 'var(--accent)' : 'var(--text-secondary)',
            cursor: 'pointer',
            boxShadow: value === o.value ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            transition: 'all 0.15s',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default function ConditionForm({ userId, condition, onSave, onClose }: Props) {
  const isEdit = !!condition
  const [form, setForm] = useState<FormState>(isEdit ? conditionToForm(condition!) : DEFAULTS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(isEdit && (
    condition!.sellerType !== 'all' ||
    condition!.itemCondition !== 'all' ||
    condition!.minBids > 0 ||
    condition!.buyItNow ||
    condition!.sortBy !== 'endTime' ||
    condition!.sortOrder !== 'asc'
  ))

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const payload = {
      name: form.name,
      keyword: form.keyword,
      maxPrice: Number(form.maxPrice),
      minPrice: Number(form.minPrice || 0),
      minBids: Number(form.minBids || 0),
      sellerType: form.sellerType,
      itemCondition: form.itemCondition,
      sortBy: form.sortBy,
      sortOrder: form.sortOrder,
      buyItNow: form.buyItNow,
    }
    try {
      const res = isEdit
        ? await fetch(`/api/conditions/${condition!.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/conditions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, ...payload }),
          })
      if (!res.ok) throw new Error((await res.json()).error)
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        zIndex: 200, backdropFilter: 'blur(4px)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--card)', borderRadius: '20px 20px 0 0',
        width: '100%', maxWidth: 480,
        maxHeight: '92dvh', overflowY: 'auto',
        padding: '20px 20px 40px',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.12)',
        animation: 'slideUp 0.25s ease',
      }}>
        {/* ハンドル */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 16px' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <h2 style={{ fontWeight: 700, fontSize: 18 }}>
              {isEdit ? '✏️ 条件を編集' : '検索条件を追加'}
            </h2>
            {isEdit && (
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>変更後に保存してください</p>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'var(--bg)', border: 'none', borderRadius: 20, width: 32, height: 32, fontSize: 16, cursor: 'pointer', color: 'var(--text-secondary)' }}>✕</button>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* 基本設定 */}
          <div>
            <label style={labelStyle}>条件名（メモ）</label>
            <input placeholder="例: セリーヌ バッグ 激安" value={form.name} onChange={e => set('name', e.target.value)} required />
          </div>

          <div>
            <label style={labelStyle}>検索キーワード</label>
            <input placeholder="例: セリーヌ バッグ" value={form.keyword} onChange={e => set('keyword', e.target.value)} required />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>価格上限（円）</label>
              <input type="number" min="1" placeholder="10000" value={form.maxPrice} onChange={e => set('maxPrice', e.target.value)} required />
            </div>
            <div>
              <label style={labelStyle}>価格下限（円）</label>
              <input type="number" min="0" placeholder="0（なし）" value={form.minPrice} onChange={e => set('minPrice', e.target.value)} />
            </div>
          </div>

          {/* 詳細設定トグル */}
          <button
            type="button"
            onClick={() => setShowAdvanced(v => !v)}
            style={{
              width: '100%', padding: '10px 14px', background: 'var(--bg)',
              border: '1px solid var(--border)', borderRadius: 10,
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}
          >
            <span>⚙️ 詳細フィルター</span>
            <span style={{ fontSize: 11, transition: 'transform 0.2s', transform: showAdvanced ? 'rotate(180deg)' : 'none' }}>▼</span>
          </button>

          {showAdvanced && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>

              {/* 出品者種別 */}
              <div>
                <label style={labelStyle}>出品者</label>
                <SegmentControl
                  options={[
                    { value: 'all', label: 'すべて' },
                    { value: 'store', label: 'ストア' },
                    { value: 'individual', label: '個人' },
                  ]}
                  value={form.sellerType}
                  onChange={v => set('sellerType', v)}
                />
              </div>

              {/* 商品状態 */}
              <div>
                <label style={labelStyle}>商品状態</label>
                <SegmentControl
                  options={[
                    { value: 'all', label: 'すべて' },
                    { value: 'new', label: '新品' },
                    { value: 'used', label: '中古' },
                  ]}
                  value={form.itemCondition}
                  onChange={v => set('itemCondition', v)}
                />
              </div>

              {/* 入札件数下限 */}
              <div>
                <label style={labelStyle}>入札件数（〇件以上）</label>
                <input
                  type="number" min="0" placeholder="0（指定なし）"
                  value={form.minBids}
                  onChange={e => set('minBids', e.target.value)}
                />
              </div>

              {/* ソート */}
              <div>
                <label style={labelStyle}>並び順</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <SegmentControl
                    options={[
                      { value: 'endTime', label: '終了時間順' },
                      { value: 'bids', label: '入札数順' },
                      { value: 'price', label: '価格順' },
                    ]}
                    value={form.sortBy}
                    onChange={v => set('sortBy', v)}
                  />
                  <SegmentControl
                    options={[
                      { value: 'asc', label: '昇順（小→大）' },
                      { value: 'desc', label: '降順（大→小）' },
                    ]}
                    value={form.sortOrder}
                    onChange={v => set('sortOrder', v)}
                  />
                </div>
              </div>

              {/* 即決のみ */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>即決のみ</p>
                  <p style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>即決価格が設定された商品のみ</p>
                </div>
                <label className="toggle">
                  <input type="checkbox" checked={form.buyItNow} onChange={e => set('buyItNow', e.target.checked)} />
                  <span className="toggle-track" />
                  <span className="toggle-thumb" />
                </label>
              </div>

            </div>
          )}

          {error && (
            <div style={{ background: '#FFF0EE', border: '1px solid #FFCCC7', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--danger)' }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary" style={{ marginTop: 4 }}>
            {loading ? '保存中...' : isEdit ? '✓ 変更を保存する' : '+ 条件を追加する'}
          </button>
        </form>
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6,
}
