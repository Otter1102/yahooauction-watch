'use client'
import { useEffect, useState, useMemo } from 'react'
import { SearchCondition } from '@/lib/types'
import ConditionCard from '@/components/ConditionCard'
import ConditionForm from '@/components/ConditionForm'

function getUserId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('yahoowatch_user_id')
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('yahoowatch_user_id', id) }
  return id
}

function detectCategory(keyword: string): string {
  const kw = keyword.toLowerCase()
  if (/iphone|ipad|ipod|mac|android|スマホ|スマートフォン|pc|パソコン|カメラ|テレビ|airpods|イヤホン|スピーカー|家電|ノートパソコン|タブレット/.test(kw)) return '📱 家電'
  if (/switch|ps5|ps4|ゲーム|nintendo|任天堂|ソフト|コントローラー|xbox|ゲームボーイ|セガ/.test(kw)) return '🎮 ゲーム'
  if (/ブランド|シャネル|ルイヴィトン|グッチ|gucci|バッグ|財布|服|スニーカー|ナイキ|アディダス|ヴィトン|エルメス|ロレックス|時計|アパレル|コート|プラダ/.test(kw)) return '👜 ファッション'
  if (/車|バイク|タイヤ|ホイール|自動車|カーナビ|パーツ/.test(kw)) return '🚗 車・バイク'
  if (/本|漫画|コミック|dvd|ブルーレイ|cd|レコード|アニメ|書籍/.test(kw)) return '📚 本・メディア'
  if (/ゴルフ|テニス|サッカー|野球|フィッシング|スポーツ|釣り|登山|キャンプ/.test(kw)) return '⚽ スポーツ'
  if (/おもちゃ|フィギュア|プラモ|レゴ|ホビー|ガンプラ|模型/.test(kw)) return '🎨 ホビー'
  if (/家具|ソファ|テーブル|椅子|照明|インテリア|収納|ベッド/.test(kw)) return '🏠 インテリア'
  return '📦 その他'
}

export default function Dashboard() {
  const [userId, setUserId]       = useState('')
  const [conditions, setConditions] = useState<SearchCondition[]>([])
  const [showForm, setShowForm]   = useState(false)
  const [editingCondition, setEditingCondition] = useState<SearchCondition | null>(null)
  const [loading, setLoading]     = useState(true)
  const [notifyReady, setNotifyReady] = useState(false)
  const [runState, setRunState]   = useState<'idle' | 'running' | 'done'>('idle')
  type RunResultRow = {
    name: string; fetched: number; rawCount: number; newItems: number; notified: number
    priceWarning?: boolean; simpleCount?: number; rssUrl?: string; httpStatus?: number; xmlPreview?: string
  }
  const [runResult, setRunResult] = useState<{ notified: number; checked: number; results?: RunResultRow[] } | null>(null)
  const [resetting, setResetting] = useState(false)
  const [activeTab, setActiveTab] = useState('すべて')

  async function init() {
    const id = getUserId()
    if (!id) return
    setUserId(id)
    try {
      await fetch('/api/user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: id }) })
      const res = await fetch(`/api/settings?userId=${id}`)
      if (res.ok) {
        const user = await res.json()
        setNotifyReady(!!(user.ntfyTopic || user.discordWebhook))
      }
    } catch {}
    await loadConditions(id)
  }

  async function loadConditions(uid?: string) {
    setLoading(true)
    const id = uid ?? userId
    if (!id) return
    const res = await fetch(`/api/conditions?userId=${id}`)
    setConditions(await res.json())
    setLoading(false)
  }

  async function resetAndRun() {
    if (!userId || resetting) return
    setResetting(true); setRunResult(null)
    await fetch('/api/reset-notified', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) })
    setResetting(false)
    await runNow()
  }

  async function runNow() {
    if (!userId || runState === 'running') return
    setRunState('running'); setRunResult(null)
    const res = await fetch('/api/run-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) })
    setRunResult(await res.json())
    setRunState('done')
    await loadConditions(userId)
    setTimeout(() => setRunState('idle'), 15000)
  }

  useEffect(() => { init() }, [])

  const activeCount = conditions.filter(c => c.enabled).length

  const categoryMap = useMemo(() => {
    const map = new Map<string, SearchCondition[]>()
    for (const c of conditions) {
      const cat = detectCategory(c.keyword)
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(c)
    }
    return map
  }, [conditions])

  const tabs = useMemo(() => {
    const cats = Array.from(categoryMap.keys())
    if (cats.length <= 1) return []
    return ['すべて', ...cats]
  }, [categoryMap])

  const displayedConditions = useMemo(() => {
    if (activeTab === 'すべて' || tabs.length === 0) return conditions
    return categoryMap.get(activeTab) ?? []
  }, [conditions, categoryMap, activeTab, tabs])

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--bg)',
      paddingBottom: 'calc(var(--nav-height) + env(safe-area-inset-bottom, 0px))',
    }}>

      {/* ─── Header: Apple NavigationBar + brand gradient strip ─── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50 }}>

        {/* Brand gradient bar */}
        <div style={{
          background: 'var(--grad-primary)',
          padding: 'calc(env(safe-area-inset-top, 0px) + 14px) 20px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 480, margin: '0 auto' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1 }}>
                <span style={{ fontSize: 17 }}>⚡</span>
                <h1 style={{ fontWeight: 700, fontSize: 19, color: 'white', letterSpacing: '-0.4px' }}>
                  ヤフオク<span style={{ fontWeight: 400, opacity: 0.88, fontStyle: 'italic' }}>watch</span>
                </h1>
              </div>
              {!loading && (
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.72)', marginLeft: 23, fontWeight: 400 }}>
                  {conditions.length}件の監視条件
                  {activeCount > 0 && (
                    <span style={{ marginLeft: 6, color: 'rgba(255,255,255,0.92)' }}>
                      · {activeCount}件稼働中
                    </span>
                  )}
                </p>
              )}
            </div>
            <button
              onClick={() => loadConditions()}
              style={{
                background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 18,
                width: 34, height: 34, fontSize: 15, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white',
              }}
            >
              {loading ? '⟳' : '↻'}
            </button>
          </div>
        </div>

        {/* Category tabs (only when 2+ categories) */}
        {tabs.length > 0 && (
          <div style={{
            background: 'rgba(255,255,255,0.85)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderBottom: '1px solid var(--border)',
            padding: '0 16px',
            maxWidth: 480, margin: '0 auto',
          }}>
            <div style={{ display: 'flex', gap: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
              {tabs.map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    flexShrink: 0, padding: '10px 14px',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 13, fontWeight: activeTab === tab ? 600 : 400,
                    color: activeTab === tab ? 'var(--accent)' : 'var(--text-tertiary)',
                    borderBottom: `2px solid ${activeTab === tab ? 'var(--accent)' : 'transparent'}`,
                    transition: 'all 0.15s',
                  }}
                >
                  {tab}{tab !== 'すべて' && <span style={{ marginLeft: 4, fontSize: 10 }}>{categoryMap.get(tab)?.length}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '14px 16px 0', maxWidth: 480, margin: '0 auto' }}>

        {/* ─── 通知未設定バナー ─── */}
        {!notifyReady && !loading && (
          <a href="/settings" style={{ display: 'block', marginBottom: 12, textDecoration: 'none' }}>
            <div style={{
              background: 'var(--card)',
              borderRadius: 13,
              padding: '12px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              border: '1px solid rgba(255,149,0,0.3)',
            }}>
              <div>
                <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--warning)' }}>通知先が未設定です</p>
                <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 1, fontWeight: 400 }}>タップして設定する</p>
              </div>
              <span style={{ fontSize: 16, color: 'var(--text-tertiary)' }}>›</span>
            </div>
          </a>
        )}

        {/* ─── Stats row ─── */}
        {conditions.length > 0 && !loading && (
          <div style={{
            background: 'var(--card)', borderRadius: 13,
            padding: '12px 0', marginBottom: 14,
            display: 'flex', justifyContent: 'space-around', alignItems: 'center',
          }}>
            {[
              { val: String(activeCount), label: '稼働中',     color: activeCount > 0 ? 'var(--accent)' : 'var(--text-tertiary)' },
              { val: String(conditions.length), label: '総条件数', color: 'var(--text-primary)' },
              { val: '10分',           label: 'チェック間隔', color: 'var(--text-secondary)' },
            ].map((item, i) => (
              <div key={i} style={{
                textAlign: 'center', flex: 1,
                borderLeft: i > 0 ? '0.5px solid var(--separator)' : 'none',
              }}>
                <p style={{ fontSize: 22, fontWeight: 700, color: item.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {item.val}
                </p>
                <p style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 3, fontWeight: 400 }}>
                  {item.label}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* ─── Empty state ─── */}
        {!loading && conditions.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 64, paddingBottom: 40 }}>
            <div style={{
              width: 84, height: 84, borderRadius: 22, margin: '0 auto 18px',
              background: 'var(--accent-light)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40,
            }}>🔍</div>
            <p style={{ fontWeight: 600, fontSize: 17, color: 'var(--text-primary)', marginBottom: 8 }}>
              ウォッチリストが空です
            </p>
            <p style={{ fontSize: 14, color: 'var(--text-tertiary)', marginBottom: 28, lineHeight: 1.65 }}>
              監視したいキーワードと価格を設定すると<br />新着商品を自動で通知します
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="btn-primary"
              style={{ display: 'inline-block', width: 'auto', padding: '13px 28px' }}
            >
              最初の条件を追加する
            </button>
          </div>
        )}

        {/* ─── Category label ─── */}
        {tabs.length > 0 && activeTab !== 'すべて' && displayedConditions.length > 0 && (
          <p className="section-title" style={{ marginBottom: 8, paddingLeft: 4 }}>
            {activeTab} · {displayedConditions.length}件
          </p>
        )}

        {/* ─── Condition list ─── */}
        {displayedConditions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {displayedConditions.map(c => (
              <ConditionCard
                key={c.id}
                condition={c}
                onChange={() => loadConditions()}
                onEdit={cond => setEditingCondition(cond)}
              />
            ))}
          </div>
        )}

        {tabs.length > 0 && activeTab !== 'すべて' && displayedConditions.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)', fontSize: 14 }}>
            このカテゴリの条件はありません
          </div>
        )}

        {/* ─── Run now buttons ─── */}
        {conditions.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={runNow}
                disabled={runState === 'running' || resetting || !notifyReady}
                style={{
                  flex: 1, padding: '12px 16px',
                  background: 'var(--card)',
                  border: '0.5px solid var(--border)', borderRadius: 12,
                  fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  color: 'var(--text-primary)', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  opacity: (!notifyReady || runState === 'running' || resetting) ? 0.4 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                {runState === 'running' ? '🔄 チェック中...' : '▶ 今すぐチェック'}
              </button>
              <button
                onClick={resetAndRun}
                disabled={runState === 'running' || resetting || !notifyReady}
                title="通知済み履歴を消去して最初から（テスト用）"
                style={{
                  padding: '12px 14px',
                  background: 'var(--card)', border: '0.5px solid var(--border)', borderRadius: 12,
                  fontSize: 12, fontWeight: 400, cursor: 'pointer',
                  color: 'var(--text-secondary)', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 4,
                  opacity: (!notifyReady || runState === 'running' || resetting) ? 0.4 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {resetting ? '🔄' : '↺ リセット'}
              </button>
            </div>

            {/* Run result */}
            {runState === 'done' && runResult && (
              <div style={{
                padding: '13px 14px', borderRadius: 12,
                background: 'var(--card)', border: '0.5px solid var(--border)',
                animation: 'fadeIn 0.2s ease',
              }}>
                <p style={{
                  fontWeight: 600, fontSize: 13,
                  color: runResult.notified > 0 ? 'var(--success)' : 'var(--text-secondary)',
                  marginBottom: runResult.results?.length ? 8 : 0,
                }}>
                  {runResult.notified > 0 ? `✅ ${runResult.notified}件を通知送信！` : '📭 新着なし'}
                </p>
                {runResult.results?.map((r, i) => (
                  <div key={i} style={{
                    paddingTop: i > 0 ? 7 : 0, marginTop: i > 0 ? 7 : 0,
                    borderTop: i > 0 ? '0.5px solid var(--separator)' : 'none',
                  }}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{r.name}</p>
                    {r.priceWarning ? (
                      <p style={{ fontSize: 11, color: 'var(--danger)' }}>⚠️ 価格下限 ≥ 上限 — 条件を編集してください</p>
                    ) : r.rawCount === 0 ? (
                      <>
                        <p style={{ fontSize: 11, color: 'var(--danger)', marginBottom: 2 }}>⚠️ 取得0件（HTTP {r.httpStatus}）</p>
                        {r.simpleCount !== undefined && r.simpleCount > 0 && (
                          <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>
                            💡 フィルターなし: {r.simpleCount}件 → フィルター設定を確認
                          </p>
                        )}
                        {r.simpleCount === 0 && (
                          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 2 }}>
                            該当商品なし（キーワードか価格帯を変更してください）
                          </p>
                        )}
                        {r.rssUrl && (
                          <a href={r.rssUrl} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: 10, color: 'var(--accent)', display: 'block', wordBreak: 'break-all', marginTop: 3 }}>
                            🔗 検索URLを確認
                          </a>
                        )}
                      </>
                    ) : r.fetched === 0 ? (
                      <p style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        {r.rawCount}件取得・解析後0件
                      </p>
                    ) : r.newItems === 0 ? (
                      <p style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        {r.fetched}件取得 · 全件通知済み
                      </p>
                    ) : (
                      <p style={{ fontSize: 11, color: 'var(--success)' }}>
                        {r.fetched}件取得 · {r.newItems}件新着 → {r.notified}件通知
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{
              padding: '10px 14px', borderRadius: 12,
              background: 'var(--fill)', border: '0.5px solid var(--separator)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 13, opacity: 0.6 }}>⚡</span>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 400 }}>10分ごとに自動チェック · 新着のみ通知</span>
            </div>
          </div>
        )}
      </div>

      {/* ─── FAB ─── */}
      <button
        onClick={() => setShowForm(true)}
        style={{
          position: 'fixed',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 68px)',
          right: 'max(16px, calc(50% - 240px + 16px))',
          width: 56, height: 56,
          background: 'var(--accent)',
          color: 'white', border: 'none', borderRadius: 28,
          fontSize: 26, fontWeight: 300,
          boxShadow: '0 4px 16px rgba(255,107,53,0.4)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 90, transition: 'transform 0.15s, box-shadow 0.15s',
        }}
      >+</button>

      {/* ─── Modals ─── */}
      {showForm && userId && (
        <ConditionForm
          userId={userId}
          onSave={() => { setShowForm(false); loadConditions() }}
          onClose={() => setShowForm(false)}
        />
      )}
      {editingCondition && userId && (
        <ConditionForm
          userId={userId}
          condition={editingCondition}
          onSave={() => { setEditingCondition(null); loadConditions() }}
          onClose={() => setEditingCondition(null)}
        />
      )}
    </div>
  )
}
