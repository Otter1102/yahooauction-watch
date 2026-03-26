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
  if (/iphone|ipad|ipod|mac|android|スマホ|スマートフォン|pc|パソコン|カメラ|テレビ|airpods|イヤホン|スピーカー|家電|ノートパソコン|タブレット/.test(kw)) return '家電・カメラ'
  if (/switch|ps5|ps4|ゲーム|nintendo|任天堂|ソフト|コントローラー|xbox|ゲームボーイ|セガ/.test(kw)) return 'ゲーム'
  if (/バッグ|財布|ウォレット|ポーチ|トートバッグ|ショルダー|リュック/.test(kw)) return 'バッグ・財布'
  if (/シャネル|ルイヴィトン|グッチ|gucci|プラダ|エルメス|バレンシアガ|ブランド/.test(kw)) return 'ブランド品'
  if (/服|シャツ|パンツ|ジャケット|コート|スニーカー|靴|シューズ|アパレル|ウェア/.test(kw)) return 'ファッション'
  if (/ロレックス|時計|ウォッチ|指輪|ネックレス|アクセサリー/.test(kw)) return '時計・アクセサリー'
  if (/車|バイク|タイヤ|ホイール|自動車|カーナビ|パーツ/.test(kw)) return '車・バイク'
  if (/本|漫画|コミック|dvd|ブルーレイ|cd|レコード|アニメ|書籍/.test(kw)) return '本・メディア'
  if (/ゴルフ|テニス|サッカー|野球|スポーツ|釣り|登山|キャンプ/.test(kw)) return 'スポーツ'
  return 'その他'
}

export default function Dashboard() {
  const [userId, setUserId]         = useState('')
  const [conditions, setConditions] = useState<SearchCondition[]>([])
  const [showForm, setShowForm]     = useState(false)
  const [editingCondition, setEditingCondition] = useState<SearchCondition | null>(null)
  const [loading, setLoading]       = useState(true)
  const [notifyReady, setNotifyReady] = useState(false)
  const [runState, setRunState]     = useState<'idle' | 'running' | 'done'>('idle')
  type RunResultRow = {
    name: string; fetched: number; rawCount: number; newItems: number; notified: number
    priceWarning?: boolean; simpleCount?: number; rssUrl?: string; httpStatus?: number
  }
  const [runResult, setRunResult] = useState<{ notified: number; checked: number; results?: RunResultRow[] } | null>(null)
  const [resetting, setResetting]   = useState(false)
  const [activeTab, setActiveTab]   = useState('すべて')

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

      {/* ─── Header ─── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--border)',
          padding: 'calc(env(safe-area-inset-top, 0px) + 14px) 20px 12px',
        }}>
          <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h1 style={{
                fontWeight: 700, fontSize: 20, letterSpacing: '-0.3px',
                background: 'var(--grad-primary)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                lineHeight: 1.2,
              }}>
                ヤフオクwatch
              </h1>
              {!loading && (
                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2, fontWeight: 400 }}>
                  {activeCount > 0 ? `${activeCount}件稼働中 · ${conditions.length}件登録` : `${conditions.length}件登録`}
                </p>
              )}
            </div>
            <button onClick={() => loadConditions()} style={{
              background: 'var(--fill)', border: '1px solid var(--border)', borderRadius: 20,
              width: 32, height: 32, fontSize: 14, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-secondary)',
            }}>↻</button>
          </div>
        </div>

        {/* Category tabs */}
        {tabs.length > 0 && (
          <div style={{
            background: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderBottom: '1px solid var(--border)',
          }}>
            <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 16px' }}>
              <div style={{ display: 'flex', gap: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
                {tabs.map(tab => (
                  <button key={tab} onClick={() => setActiveTab(tab)} style={{
                    flexShrink: 0, padding: '9px 13px',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: activeTab === tab ? 700 : 400,
                    color: activeTab === tab ? 'var(--accent)' : 'var(--text-tertiary)',
                    borderBottom: `2px solid ${activeTab === tab ? 'var(--accent)' : 'transparent'}`,
                    transition: 'all 0.15s', whiteSpace: 'nowrap', fontFamily: 'inherit',
                  }}>
                    {tab}
                    {tab !== 'すべて' && (
                      <span style={{ marginLeft: 3, fontSize: 10 }}>{categoryMap.get(tab)?.length}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '14px 16px 0', maxWidth: 480, margin: '0 auto' }}>

        {/* ─── 通知未設定バナー ─── */}
        {!notifyReady && !loading && (
          <a href="/settings" style={{ display: 'block', marginBottom: 12, textDecoration: 'none' }}>
            <div style={{
              background: 'var(--card)', borderRadius: 12,
              padding: '12px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              border: '1px solid rgba(255,149,0,0.25)',
              boxShadow: 'var(--shadow-sm)',
            }}>
              <div>
                <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--warning)' }}>通知先が未設定です</p>
                <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 1, fontWeight: 400 }}>タップして設定する</p>
              </div>
              <span style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>›</span>
            </div>
          </a>
        )}

        {/* ─── Stats row ─── */}
        {conditions.length > 0 && !loading && (
          <div style={{
            background: 'var(--card)', borderRadius: 12,
            padding: '14px 0', marginBottom: 14,
            display: 'flex', justifyContent: 'space-around', alignItems: 'center',
            boxShadow: 'var(--shadow-sm)',
          }}>
            {[
              { val: String(activeCount), label: '稼働中', highlight: activeCount > 0 },
              { val: String(conditions.length), label: '登録条件', highlight: false },
              { val: '10分', label: '更新間隔', highlight: false },
            ].map((item, i) => (
              <div key={i} style={{
                textAlign: 'center', flex: 1,
                borderLeft: i > 0 ? '1px solid var(--border)' : 'none',
              }}>
                <p style={{
                  fontSize: 20, fontWeight: 700, lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                  color: item.highlight ? 'var(--accent)' : 'var(--text-primary)',
                }}>{item.val}</p>
                <p style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, fontWeight: 400, letterSpacing: '0.5px' }}>
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
              width: 72, height: 72, borderRadius: 18, margin: '0 auto 18px',
              background: 'linear-gradient(135deg, rgba(39,181,212,0.12) 0%, rgba(26,106,201,0.12) 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 32,
            }}>🔍</div>
            <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', marginBottom: 8 }}>
              ウォッチリストが空です
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 28, lineHeight: 1.7 }}>
              監視したいキーワードと価格を設定すると<br />新着商品を自動で通知します
            </p>
            <button onClick={() => setShowForm(true)} className="btn-primary"
              style={{ display: 'inline-block', width: 'auto', padding: '0 32px', height: 46, lineHeight: '46px', fontSize: 14 }}>
              最初の条件を追加する
            </button>
          </div>
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
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>
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
                  flex: 1, height: 44,
                  background: notifyReady ? 'var(--grad-primary)' : 'var(--fill)',
                  border: notifyReady ? 'none' : '1px solid var(--border)',
                  borderRadius: 22,
                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  color: notifyReady ? 'white' : 'var(--text-tertiary)',
                  fontFamily: 'inherit', letterSpacing: '0.5px',
                  opacity: (runState === 'running' || resetting) ? 0.5 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                {runState === 'running' ? 'チェック中...' : '今すぐチェック'}
              </button>
              <button
                onClick={resetAndRun}
                disabled={runState === 'running' || resetting || !notifyReady}
                title="通知済み履歴を消去して最初から（テスト用）"
                style={{
                  width: 80, height: 44,
                  background: 'var(--card)', border: '1px solid var(--border)',
                  borderRadius: 22, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  color: 'var(--text-secondary)', fontFamily: 'inherit',
                  opacity: (!notifyReady || runState === 'running' || resetting) ? 0.4 : 1,
                }}
              >
                {resetting ? '...' : 'リセット'}
              </button>
            </div>

            {/* Run result */}
            {runState === 'done' && runResult && (
              <div style={{
                padding: '13px 14px', borderRadius: 12,
                background: 'var(--card)', border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-sm)',
                animation: 'fadeIn 0.2s ease',
              }}>
                <p style={{
                  fontWeight: 700, fontSize: 13,
                  color: runResult.notified > 0 ? 'var(--accent)' : 'var(--text-secondary)',
                  marginBottom: runResult.results?.length ? 8 : 0,
                }}>
                  {runResult.notified > 0 ? `${runResult.notified}件を通知送信しました` : '新着なし'}
                </p>
                {runResult.results?.map((r, i) => (
                  <div key={i} style={{
                    paddingTop: i > 0 ? 7 : 0, marginTop: i > 0 ? 7 : 0,
                    borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                  }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{r.name}</p>
                    {r.priceWarning ? (
                      <p style={{ fontSize: 11, color: 'var(--danger)' }}>価格下限 ≥ 上限 — 条件を編集してください</p>
                    ) : r.rawCount === 0 ? (
                      <>
                        <p style={{ fontSize: 11, color: 'var(--danger)', marginBottom: 2 }}>取得0件（HTTP {r.httpStatus}）</p>
                        {r.simpleCount !== undefined && r.simpleCount > 0 && (
                          <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>フィルターなし: {r.simpleCount}件 → フィルター設定を確認</p>
                        )}
                        {r.rssUrl && (
                          <a href={r.rssUrl} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: 10, color: 'var(--accent)', display: 'block', wordBreak: 'break-all', marginTop: 3 }}>
                            検索URLを確認 →
                          </a>
                        )}
                      </>
                    ) : r.newItems === 0 ? (
                      <p style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        {r.fetched}件取得 · 全件通知済み
                      </p>
                    ) : (
                      <p style={{ fontSize: 11, color: 'var(--accent)' }}>
                        {r.fetched}件取得 · {r.newItems}件新着 → {r.notified}件通知
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{
              padding: '10px 14px', borderRadius: 22,
              background: 'var(--card)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 400, letterSpacing: '0.3px' }}>
                10分ごとに自動チェック · 新着のみ通知
              </span>
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
          width: 52, height: 52,
          background: 'var(--grad-primary)',
          color: 'white', border: 'none', borderRadius: 26,
          fontSize: 24, fontWeight: 300,
          boxShadow: '0 4px 16px rgba(0,153,226,0.4)',
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
