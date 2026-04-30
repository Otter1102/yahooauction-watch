'use client'
import { useState } from 'react'
import { SearchCondition } from '@/lib/types'

interface Props {
  userId: string
  condition?: SearchCondition   // 渡すと編集モード（or 複製の元データ）
  isDuplicate?: boolean              // true = 複製モード（POST で新規登録）
  existingConditions?: SearchCondition[] // 重複チェック用（複製モード時）
  onSave: () => void
  onClose: () => void
}

type FormState = {
  name: string
  keyword: string
  maxPrice: string
  minPrice: string
  minBids: string
  maxBids: string
  sellerType: SearchCondition['sellerType']
  itemCondition: SearchCondition['itemCondition']
  sortBy: SearchCondition['sortBy']
  sortOrder: SearchCondition['sortOrder']
  buyItNow: boolean | null  // null = 両方, false = オークションのみ, true = 即決のみ
}

const DEFAULTS: FormState = {
  name: '', keyword: '', maxPrice: '', minPrice: '', minBids: '', maxBids: '',
  sellerType: 'all', itemCondition: 'all',
  sortBy: 'endTime', sortOrder: 'asc', buyItNow: null,
}

function conditionToForm(c: SearchCondition): FormState {
  return {
    name: c.name,
    keyword: c.keyword,
    maxPrice: String(c.maxPrice),
    minPrice: c.minPrice > 0 ? String(c.minPrice) : '',
    minBids: c.minBids > 0 ? String(c.minBids) : '',
    maxBids: c.maxBids !== null && c.maxBids > 0 ? String(c.maxBids) : '',
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

export default function ConditionForm({ userId, condition, isDuplicate, existingConditions, onSave, onClose }: Props) {
  const isEdit = !!condition && !isDuplicate
  const initForm = condition
    ? { ...conditionToForm(condition), ...(isDuplicate ? { name: `${condition.name}のコピー` } : {}) }
    : DEFAULTS
  const [form, setForm] = useState<FormState>(initForm)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(isEdit && (
    condition!.sellerType !== 'all' ||
    condition!.itemCondition !== 'all' ||
    condition!.minBids > 0 ||
    condition!.maxBids !== null ||
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
    // 複製モード: キーワード＋価格帯が両方完全一致する場合のみブロック
    if (isDuplicate && existingConditions) {
      const minP = Number(form.minPrice || 0)
      const maxP = Number(form.maxPrice)
      const hasSame = existingConditions.some(
        c => c.keyword === form.keyword && c.minPrice === minP && c.maxPrice === maxP
      )
      if (hasSame) {
        setError('キーワードと価格帯が全く同じ条件が既に登録されています。キーワードか価格を変えてください')
        setLoading(false)
        return
      }
    }
    const payload = {
      name: form.name,
      keyword: form.keyword,
      maxPrice: Number(form.maxPrice),
      minPrice: Number(form.minPrice || 0),
      minBids: Number(form.minBids || 0),
      maxBids: form.maxBids !== '' ? Number(form.maxBids) : null,
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
            body: JSON.stringify({ userId, ...payload }),
          })
        : await fetch('/api/conditions', {   // 新規追加 or 複製（どちらもPOST）
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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

  return (
    <>
      {/* ─── バックドロップ ─── */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.45)',
          zIndex: 199,
          animation: 'fadeIn 0.2s ease',
        }}
      />

      {/* ─── ボトムシート ─── */}
      <div
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: 'var(--card)',
          borderRadius: '20px 20px 0 0',
          zIndex: 200,
          maxHeight: '88dvh',
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideUp 0.28s ease',
          boxShadow: '0 -4px 32px rgba(0,0,0,0.18)',
        }}
      >
        {/* ── 固定ヘッダー ── */}
        <div style={{
          padding: 'calc(env(safe-area-inset-top, 0px) + 16px) 20px 14px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        }}>
          {/* ドラッグハンドル */}
          <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', width: 36, height: 4, borderRadius: 2, background: 'var(--border)' }} />
          <div style={{ marginTop: 4 }}>
            <h2 style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-primary)', margin: 0 }}>
              {isDuplicate ? '条件を複製' : isEdit ? '条件を編集' : '検索条件を追加'}
            </h2>
            {isDuplicate && (
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 3 }}>キーワードか価格を変えて追加できます</p>
            )}
            {isEdit && !isDuplicate && (
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 3 }}>変更後に保存してください</p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'var(--bg)', border: 'none', borderRadius: 20,
              width: 32, height: 32, fontSize: 16, cursor: 'pointer',
              color: 'var(--text-secondary)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >✕</button>
        </div>

        {/* ── スクロール可能なフォーム本体 ── */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px 4px', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
          <form id="condition-form" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* 基本設定 */}
            <div>
              <label style={labelStyle}>条件名（メモ）</label>
              <input placeholder="例: セリーヌ バッグ 激安" value={form.name} onChange={e => set('name', e.target.value)} required />
            </div>

            <div>
              <label style={labelStyle}>検索キーワード</label>
              <input placeholder="例: セリーヌ バッグ" value={form.keyword} onChange={e => set('keyword', e.target.value)} required />
            </div>

            {/* 価格範囲: 左=下限 右=上限 */}
            {(() => {
              const minP = Number(form.minPrice || 0)
              const maxP = Number(form.maxPrice || 0)
              const priceError = minP > 0 && maxP > 0 && minP >= maxP
              return (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'end' }}>
                    <div>
                      <label style={labelStyle}>価格下限（円）</label>
                      <input
                        type="number" min="0" placeholder="0（なし）"
                        value={form.minPrice}
                        onChange={e => set('minPrice', e.target.value)}
                        style={{ borderColor: priceError ? 'var(--danger)' : undefined, boxShadow: priceError ? '0 0 0 3px rgba(225,112,85,0.15)' : undefined }}
                      />
                    </div>
                    <div style={{ paddingBottom: 13, color: 'var(--text-tertiary)', fontWeight: 700, fontSize: 16, textAlign: 'center', userSelect: 'none' }}>〜</div>
                    <div>
                      <label style={labelStyle}>価格上限（円）</label>
                      <input
                        type="number" min="1" placeholder="10000"
                        value={form.maxPrice}
                        onChange={e => set('maxPrice', e.target.value)}
                        required
                        style={{ borderColor: priceError ? 'var(--danger)' : undefined, boxShadow: priceError ? '0 0 0 3px rgba(225,112,85,0.15)' : undefined }}
                      />
                    </div>
                  </div>
                  {priceError && (
                    <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6, fontWeight: 600 }}>
                      ⚠️ 上限（¥{maxP.toLocaleString()}）は下限（¥{minP.toLocaleString()}）より大きくしてください
                    </p>
                  )}
                </div>
              )
            })()}

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

                {/* 入札件数範囲（即決のみの場合は非表示） */}
                {form.buyItNow !== true && (() => {
                  const minB = Number(form.minBids || 0)
                  const maxB = Number(form.maxBids || 0)
                  const bidsError = minB > 0 && maxB > 0 && minB >= maxB
                  return (
                    <div>
                      <label style={labelStyle}>入札件数</label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'end' }}>
                        <div>
                          <input
                            type="number" min="0" placeholder="0（下限なし）"
                            value={form.minBids}
                            onChange={e => set('minBids', e.target.value)}
                            style={{ borderColor: bidsError ? 'var(--danger)' : undefined, boxShadow: bidsError ? '0 0 0 3px rgba(225,112,85,0.15)' : undefined }}
                          />
                        </div>
                        <div style={{ paddingBottom: 13, color: 'var(--text-tertiary)', fontWeight: 700, fontSize: 16, textAlign: 'center', userSelect: 'none' }}>〜</div>
                        <div>
                          <input
                            type="number" min="1" placeholder="上限なし"
                            value={form.maxBids}
                            onChange={e => set('maxBids', e.target.value)}
                            style={{ borderColor: bidsError ? 'var(--danger)' : undefined, boxShadow: bidsError ? '0 0 0 3px rgba(225,112,85,0.15)' : undefined }}
                          />
                        </div>
                      </div>
                      {bidsError && (
                        <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6, fontWeight: 600 }}>
                          ⚠️ 上限（{maxB}件）は下限（{minB}件）より大きくしてください
                        </p>
                      )}
                      <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                        例: 1〜10 = 競争が少ない穴場商品を狙う
                      </p>
                    </div>
                  )
                })()}

                {/* ソート（ヤフオク準拠の名称） */}
                <div>
                  <label style={labelStyle}>並び順</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {([
                      { sortBy: 'endTime', sortOrder: 'asc',  label: '残り時間が短い順（終了間近）', icon: '⏰' },
                      { sortBy: 'endTime', sortOrder: 'desc', label: '残り時間が長い順',               icon: '🕐' },
                      { sortBy: 'price',   sortOrder: 'asc',  label: '現在価格が低い順',               icon: '💰' },
                      { sortBy: 'price',   sortOrder: 'desc', label: '現在価格が高い順',               icon: '💎' },
                      { sortBy: 'bids',    sortOrder: 'desc', label: '入札件数が多い順',               icon: '🔨' },
                    ] as const).filter(opt => !(opt.sortBy === 'bids' && form.buyItNow === true)).map(opt => {
                      const active = form.sortBy === opt.sortBy && form.sortOrder === opt.sortOrder
                      return (
                        <button
                          key={`${opt.sortBy}-${opt.sortOrder}`}
                          type="button"
                          onClick={() => { set('sortBy', opt.sortBy); set('sortOrder', opt.sortOrder) }}
                          style={{
                            width: '100%', padding: '10px 14px',
                            borderRadius: 10, border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                            background: active ? 'rgba(255,107,53,0.06)' : 'var(--bg)',
                            color: active ? 'var(--accent)' : 'var(--text-primary)',
                            fontWeight: active ? 700 : 500, fontSize: 13,
                            cursor: 'pointer', textAlign: 'left',
                            display: 'flex', alignItems: 'center', gap: 8,
                            transition: 'all 0.15s',
                          }}
                        >
                          <span>{opt.icon}</span>
                          <span>{opt.label}</span>
                          {active && <span style={{ marginLeft: 'auto', fontSize: 14 }}>✓</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* 出品形式（両方 / オークション / 即決）*/}
                <div>
                  <label style={labelStyle}>出品形式</label>
                  <div style={{ display: 'flex', gap: 0, background: 'var(--bg)', borderRadius: 10, padding: 3, border: '1px solid var(--border)' }}>
                    {([
                      { v: null  as boolean | null, label: '両方' },
                      { v: false as boolean | null, label: 'オークション' },
                      { v: true  as boolean | null, label: '即決' },
                    ]).map(o => (
                      <button key={String(o.v)} type="button" onClick={() => {
                          set('buyItNow', o.v)
                          if (o.v === true) { set('minBids', ''); set('maxBids', '') }
                        }}
                        style={{
                          flex: 1, padding: '7px 4px', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 600,
                          background: form.buyItNow === o.v ? 'var(--card)' : 'transparent',
                          color: form.buyItNow === o.v ? 'var(--accent)' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          boxShadow: form.buyItNow === o.v ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                          transition: 'all 0.15s',
                        }}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

              </div>
            )}

            {error && (
              <div style={{ background: '#FFF0EE', border: '1px solid #FFCCC7', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--danger)' }}>
                {error}
              </div>
            )}

            {/* フォームの末尾に余白（フッターに隠れないよう） */}
            <div style={{ height: 4 }} />
          </form>
        </div>

        {/* ── 固定フッター（送信ボタン） ── */}
        <div style={{
          padding: '12px 20px calc(env(safe-area-inset-bottom, 0px) + 16px)',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
          background: 'var(--card)',
        }}>
          <button
            form="condition-form"
            type="submit"
            disabled={loading}
            className="btn-primary"
            style={{ opacity: loading ? 0.6 : 1 }}
          >
            {loading ? '保存中...' : isDuplicate ? '+ 複製して追加する' : isEdit ? '✓ 変更を保存する' : '+ 条件を追加する'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)',
  display: 'block', marginBottom: 5, letterSpacing: 0.2,
}
