'use client'
import { useState } from 'react'
import { SearchCondition } from '@/lib/types'

interface Props {
  userId: string
  condition?: SearchCondition
  isDuplicate?: boolean
  existingConditions?: SearchCondition[]
  onSave: () => void
  onClose: () => void
}

type FormState = {
  name: string
  keyword: string
  maxPrice: string
  minPrice: string
  minBids: string
  itemCondition: SearchCondition['itemCondition']
  buyItNow: boolean | null
  sortBy: SearchCondition['sortBy']
  sortOrder: SearchCondition['sortOrder']
}

const DEFAULTS: FormState = {
  name: '', keyword: '', maxPrice: '', minPrice: '', minBids: '',
  itemCondition: 'all', buyItNow: null,
  sortBy: 'endTime', sortOrder: 'asc',
}

function conditionToForm(c: SearchCondition): FormState {
  return {
    name: c.name,
    keyword: c.keyword,
    maxPrice: String(c.maxPrice),
    minPrice: c.minPrice > 0 ? String(c.minPrice) : '',
    minBids: c.minBids > 0 ? String(c.minBids) : '',
    itemCondition: c.itemCondition,
    buyItNow: c.buyItNow,
    sortBy: c.sortBy,
    sortOrder: c.sortOrder,
  }
}

export default function ConditionForm({ userId, condition, isDuplicate, existingConditions, onSave, onClose }: Props) {
  const isEdit = !!condition && !isDuplicate
  const initForm = condition
    ? { ...conditionToForm(condition), ...(isDuplicate ? { name: `${condition.name}のコピー` } : {}) }
    : DEFAULTS
  const [form, setForm] = useState<FormState>(initForm)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(isEdit && (
    condition!.itemCondition !== 'all' ||
    condition!.minBids > 0 ||
    condition!.buyItNow !== null ||
    condition!.sortBy !== 'endTime' ||
    condition!.sortOrder !== 'asc'
  ))

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const maxP = Number(form.maxPrice)
    const minP = Number(form.minPrice || 0)
    if (minP > 0 && minP >= maxP) {
      setError(`価格下限（¥${minP.toLocaleString()}）は上限（¥${maxP.toLocaleString()}）より小さくしてください`)
      setLoading(false)
      return
    }
    if (isDuplicate && existingConditions) {
      const hasSame = existingConditions.some(
        c => c.keyword === form.keyword && c.minPrice === minP && c.maxPrice === maxP
      )
      if (hasSame) {
        setError('同じキーワードと価格帯の条件が既にあります。キーワードか価格を変えてください')
        setLoading(false)
        return
      }
    }
    const payload = {
      name: form.name || form.keyword,
      keyword: form.keyword,
      maxPrice: maxP,
      minPrice: minP,
      minBids: Number(form.minBids || 0),
      maxBids: null,
      sellerType: 'all',
      itemCondition: form.itemCondition,
      sortBy: form.sortBy,
      sortOrder: form.sortOrder,
      buyItNow: form.buyItNow,
    }
    try {
      const res = isEdit
        ? await fetch(`/api/conditions/${condition!.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, ...payload }),
          })
        : await fetch('/api/conditions', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, ...payload }),
          })
      if (!res.ok) {
        let msg = 'エラーが発生しました'
        try { msg = (await res.json()).error ?? msg } catch {}
        throw new Error(msg)
      }
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  const minP = Number(form.minPrice || 0)
  const maxP = Number(form.maxPrice || 0)
  const priceError = minP > 0 && maxP > 0 && minP >= maxP

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 199 }} />

      {/* 全画面モーダル */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'var(--bg)',
        display: 'flex', flexDirection: 'column',
        animation: 'cfSlide 0.22s cubic-bezier(.4,0,.2,1)',
      }}>

        {/* ─── ヘッダー ─── */}
        <div style={{
          padding: 'calc(env(safe-area-inset-top, 0px) + 14px) 16px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--card)',
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        }}>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', padding: '4px 2px',
              fontSize: 16, color: 'var(--accent)', cursor: 'pointer',
              fontWeight: 700, fontFamily: 'inherit', flexShrink: 0,
            }}
          >
            ✕
          </button>
          <h2 style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-primary)', margin: 0, flex: 1 }}>
            {isDuplicate ? '条件を複製' : isEdit ? '条件を編集' : '条件を追加'}
          </h2>
        </div>

        {/* ─── スクロール可能なフォーム ─── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 8px' }}>
          <form id="cf" onSubmit={submit}>

            {/* キーワード */}
            <div style={fieldWrap}>
              <label style={labelStyle}>
                キーワード <span style={{ color: 'var(--accent)' }}>*</span>
              </label>
              <input
                style={inputStyle}
                placeholder="例: セリーヌ バッグ"
                value={form.keyword}
                onChange={e => set('keyword', e.target.value)}
                required
                autoFocus={!isEdit}
              />
              <p style={hintStyle}>スペース区切りでAND検索。（）でOR検索</p>
            </div>

            {/* 価格 */}
            <div style={fieldWrap}>
              <label style={labelStyle}>
                価格（円） <span style={{ color: 'var(--accent)' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  style={{ ...inputStyle, flex: 1, borderColor: priceError ? 'var(--danger)' : undefined }}
                  type="number" min="0" placeholder="下限（任意）"
                  value={form.minPrice}
                  onChange={e => set('minPrice', e.target.value)}
                />
                <span style={{ color: 'var(--text-tertiary)', fontWeight: 700, flexShrink: 0 }}>〜</span>
                <input
                  style={{ ...inputStyle, flex: 1, borderColor: priceError ? 'var(--danger)' : undefined }}
                  type="number" min="1" placeholder="上限"
                  value={form.maxPrice}
                  onChange={e => set('maxPrice', e.target.value)}
                  required
                />
              </div>
              {priceError && (
                <p style={{ ...hintStyle, color: 'var(--danger)', marginTop: 6 }}>
                  ⚠ 上限は下限より大きい金額にしてください
                </p>
              )}
            </div>

            {/* メモ（任意） */}
            <div style={fieldWrap}>
              <label style={labelStyle}>メモ（省略可）</label>
              <input
                style={inputStyle}
                placeholder={form.keyword || '例: セリーヌ 狙い目'}
                value={form.name}
                onChange={e => set('name', e.target.value)}
              />
            </div>

            {/* ─── 詳細フィルター ─── */}
            <button
              type="button"
              onClick={() => setShowAdvanced(v => !v)}
              style={{
                width: '100%', padding: '11px 14px',
                background: showAdvanced ? 'rgba(0,153,226,0.06)' : 'var(--card)',
                border: `1px solid ${showAdvanced ? 'rgba(0,153,226,0.25)' : 'var(--border)'}`,
                borderRadius: 12, fontSize: 13, fontWeight: 600,
                color: showAdvanced ? 'var(--accent)' : 'var(--text-secondary)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: showAdvanced ? 16 : 0,
                transition: 'all 0.15s',
              }}
            >
              <span>フィルター{showAdvanced ? '（設定中）' : '（任意）'}</span>
              <span style={{ fontSize: 10, transform: showAdvanced ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
            </button>

            {showAdvanced && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* 出品形式 */}
                <div style={fieldWrap}>
                  <label style={labelStyle}>出品形式</label>
                  <div style={segWrap}>
                    {([
                      { v: null as boolean | null,  label: '両方' },
                      { v: false as boolean | null, label: 'オークション' },
                      { v: true as boolean | null,  label: '即決' },
                    ]).map(o => (
                      <button
                        key={String(o.v)} type="button"
                        onClick={() => { set('buyItNow', o.v); if (o.v === true) set('minBids', '') }}
                        style={segBtn(form.buyItNow === o.v)}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 最低入札数（即決のみ以外） */}
                {form.buyItNow !== true && (
                  <div style={fieldWrap}>
                    <label style={labelStyle}>最低入札数</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input
                        style={{ ...inputStyle, width: 100 }}
                        type="number" min="0" placeholder="0"
                        value={form.minBids}
                        onChange={e => set('minBids', e.target.value)}
                      />
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>件以上</span>
                    </div>
                    <p style={hintStyle}>1以上で「入札ゼロの商品」を除外</p>
                  </div>
                )}

                {/* 商品状態 */}
                <div style={fieldWrap}>
                  <label style={labelStyle}>商品状態</label>
                  <div style={segWrap}>
                    {([
                      { value: 'all',  label: 'すべて' },
                      { value: 'new',  label: '新品' },
                      { value: 'used', label: '中古' },
                    ] as const).map(o => (
                      <button
                        key={o.value} type="button"
                        onClick={() => set('itemCondition', o.value)}
                        style={segBtn(form.itemCondition === o.value)}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 並び順 */}
                <div style={{ ...fieldWrap, marginBottom: 0 }}>
                  <label style={labelStyle}>並び順</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {([
                      { sortBy: 'endTime', sortOrder: 'asc',  label: '残り時間が短い順（終了間近）' },
                      { sortBy: 'endTime', sortOrder: 'desc', label: '残り時間が長い順' },
                      { sortBy: 'price',   sortOrder: 'asc',  label: '現在価格が低い順' },
                      { sortBy: 'price',   sortOrder: 'desc', label: '現在価格が高い順' },
                      { sortBy: 'bids',    sortOrder: 'desc', label: '入札件数が多い順' },
                    ] as const)
                      .filter(opt => !(opt.sortBy === 'bids' && form.buyItNow === true))
                      .map(opt => {
                        const active = form.sortBy === opt.sortBy && form.sortOrder === opt.sortOrder
                        return (
                          <button
                            key={`${opt.sortBy}-${opt.sortOrder}`}
                            type="button"
                            onClick={() => { set('sortBy', opt.sortBy); set('sortOrder', opt.sortOrder) }}
                            style={{
                              width: '100%', padding: '10px 14px',
                              borderRadius: 10,
                              border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                              background: active ? 'rgba(0,153,226,0.06)' : 'var(--card)',
                              color: active ? 'var(--accent)' : 'var(--text-primary)',
                              fontWeight: active ? 700 : 400,
                              fontSize: 13, cursor: 'pointer', textAlign: 'left',
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              transition: 'all 0.12s',
                            }}
                          >
                            {opt.label}
                            {active && <span style={{ fontSize: 13 }}>✓</span>}
                          </button>
                        )
                      })}
                  </div>
                </div>

              </div>
            )}

            {error && (
              <div style={{ marginTop: 16, padding: '11px 14px', background: '#FFF0EE', border: '1px solid #FFCCC7', borderRadius: 10, fontSize: 13, color: 'var(--danger)' }}>
                {error}
              </div>
            )}

            {/* フッター分の余白 */}
            <div style={{ height: 12 }} />
          </form>
        </div>

        {/* ─── 固定フッター ─── */}
        <div style={{
          padding: '12px 16px calc(env(safe-area-inset-bottom, 0px) + 16px)',
          borderTop: '1px solid var(--border)',
          background: 'var(--card)',
          flexShrink: 0,
        }}>
          <button
            form="cf" type="submit" disabled={loading}
            className="btn-primary"
            style={{ opacity: loading ? 0.6 : 1 }}
          >
            {loading ? '保存中...' : isDuplicate ? '複製して追加する' : isEdit ? '変更を保存する' : '条件を追加する'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes cfSlide {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  )
}

const fieldWrap: React.CSSProperties = { marginBottom: 20 }

const labelStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
  display: 'block', marginBottom: 8,
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 46,
  background: 'var(--card)', border: '1.5px solid var(--border)',
  borderRadius: 12, padding: '0 14px',
  fontSize: 15, color: 'var(--text-primary)',
  outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit',
}

const hintStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-tertiary)', marginTop: 5,
}

const segWrap: React.CSSProperties = {
  display: 'flex', background: 'var(--bg)',
  borderRadius: 12, padding: 3, border: '1px solid var(--border)',
  gap: 2,
}

const segBtn = (active: boolean): React.CSSProperties => ({
  flex: 1, padding: '9px 4px', border: 'none', borderRadius: 9,
  fontSize: 13, fontWeight: active ? 700 : 500,
  background: active ? 'var(--card)' : 'transparent',
  color: active ? 'var(--accent)' : 'var(--text-secondary)',
  cursor: 'pointer', transition: 'all 0.12s',
  boxShadow: active ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
})
