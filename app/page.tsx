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

// キーワードからカテゴリを自動判定
function detectCategory(keyword: string): string {
  const kw = keyword.toLowerCase()
  if (/iphone|ipad|ipod|mac|android|スマホ|スマートフォン|pc|パソコン|カメラ|テレビ|airpods|イヤホン|スピーカー|家電|ノートパソコン|タブレット|プロジェクター|プリンター/.test(kw)) return '📱 家電'
  if (/switch|ps5|ps4|ゲーム|nintendo|任天堂|ソフト|コントローラー|xbox|ゲームボーイ|ゲームキューブ|セガ/.test(kw)) return '🎮 ゲーム'
  if (/ブランド|シャネル|ルイヴィトン|グッチ|バッグ|財布|服|スニーカー|ナイキ|アディダス|ヴィトン|コーチ|エルメス|ロレックス|時計|アパレル|コート|ジャケット|ワンピース|プラダ|バレンシアガ|ディオール/.test(kw)) return '👜 ファッション'
  if (/車|バイク|タイヤ|ホイール|自動車|カーナビ|車両|パーツ|バンパー|エンジン|マフラー/.test(kw)) return '🚗 車・バイク'
  if (/本|漫画|コミック|雑誌|小説|dvd|ブルーレイ|cd|レコード|映画|アニメ|書籍/.test(kw)) return '📚 本・メディア'
  if (/ゴルフ|テニス|サッカー|野球|フィッシング|スポーツ|釣り|登山|アウトドア|キャンプ|スキー|スノーボード/.test(kw)) return '⚽ スポーツ'
  if (/おもちゃ|フィギュア|プラモ|レゴ|ホビー|ガンプラ|鉄道|ミニカー|ドール|模型/.test(kw)) return '🎨 ホビー'
  if (/家具|ソファ|テーブル|椅子|照明|インテリア|収納|棚|ベッド/.test(kw)) return '🏠 インテリア'
  if (/コスメ|化粧品|香水|スキンケア|美容|シャンプー|ヘア/.test(kw)) return '💄 美容'
  return '📦 その他'
}

export default function Dashboard() {
  const [userId, setUserId] = useState('')
  const [conditions, setConditions] = useState<SearchCondition[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingCondition, setEditingCondition] = useState<SearchCondition | null>(null)
  const [loading, setLoading] = useState(true)
  const [notifyReady, setNotifyReady] = useState(false)
  const [runState, setRunState] = useState<'idle' | 'running' | 'done'>('idle')
  type RunResultRow = { name: string; fetched: number; rawCount: number; newItems: number; notified: number; priceWarning?: boolean; simpleCount?: number; rssUrl?: string; httpStatus?: number; xmlPreview?: string }
  const [runResult, setRunResult] = useState<{ notified: number; checked: number; results?: RunResultRow[] } | null>(null)
  const [resetting, setResetting] = useState(false)
  const [activeTab, setActiveTab] = useState('すべて')

  async function init() {
    const id = getUserId()
    if (!id) return
    setUserId(id)
    try {
      await fetch('/api/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id }),
      })
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
    const data = await res.json()
    setConditions(data)
    setLoading(false)
  }

  async function resetAndRun() {
    if (!userId || resetting) return
    setResetting(true)
    setRunResult(null)
    await fetch('/api/reset-notified', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    setResetting(false)
    await runNow()
  }

  async function runNow() {
    if (!userId || runState === 'running') return
    setRunState('running')
    setRunResult(null)
    const res = await fetch('/api/run-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    const data = await res.json()
    setRunResult(data)
    setRunState('done')
    await loadConditions(userId)
    setTimeout(() => setRunState('idle'), 15000)
  }

  useEffect(() => { init() }, [])

  const activeCount = conditions.filter(c => c.enabled).length

  // カテゴリー集計
  const categoryMap = useMemo(() => {
    const map = new Map<string, SearchCondition[]>()
    for (const c of conditions) {
      const cat = detectCategory(c.keyword)
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(c)
    }
    return map
  }, [conditions])

  // タブリスト（「すべて」+ 2件以上または複数カテゴリがある場合のみタブ表示）
  const tabs = useMemo(() => {
    const cats = Array.from(categoryMap.keys())
    if (cats.length <= 1) return [] // 1カテゴリ以下はタブ不要
    return ['すべて', ...cats]
  }, [categoryMap])

  const displayedConditions = useMemo(() => {
    if (activeTab === 'すべて' || tabs.length === 0) return conditions
    return categoryMap.get(activeTab) ?? []
  }, [conditions, categoryMap, activeTab, tabs])

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingBottom: 'calc(var(--nav-height) + env(safe-area-inset-bottom,0px))' }}>

      {/* ヘッダー */}
      <div style={{
        background: 'var(--grad-primary)',
        padding: 'calc(env(safe-area-inset-top, 0px) + 16px) 20px 16px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 480, margin: '0 auto' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 1 }}>
              <span style={{ fontSize: 18 }}>⚡</span>
              <h1 style={{ fontWeight: 700, fontSize: 20, color: 'white', letterSpacing: '-0.3px' }}>
                ヤフオク<span style={{ fontWeight: 400, fontStyle: 'italic', opacity: 0.92 }}>watch</span>
              </h1>
            </div>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginLeft: 25, fontWeight: 400 }}>
              {loading ? '読み込み中...' : `${conditions.length}件の監視条件`}
              {activeCount > 0 && !loading && (
                <span style={{ marginLeft: 7, color: 'rgba(255,255,255,0.95)', fontWeight: 500 }}>
                  · {activeCount}件稼働中
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => loadConditions()}
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 20, width: 36, height: 36, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}
          >
            {loading ? '⟳' : '↻'}
          </button>
        </div>

        {/* カテゴリータブ */}
        {tabs.length > 0 && (
          <div style={{
            maxWidth: 480, margin: '12px auto 0',
            display: 'flex', gap: 6, overflowX: 'auto',
            paddingBottom: 2,
            scrollbarWidth: 'none',
          }}>
            {tabs.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flexShrink: 0, padding: '6px 12px',
                  borderRadius: 20, border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 700,
                  background: activeTab === tab ? 'white' : 'rgba(255,255,255,0.2)',
                  color: activeTab === tab ? 'var(--accent)' : 'rgba(255,255,255,0.9)',
                  transition: 'all 0.15s',
                }}
              >
                {tab}
                {tab !== 'すべて' && (
                  <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.8 }}>
                    {categoryMap.get(tab)?.length ?? 0}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '16px', maxWidth: 480, margin: '0 auto' }}>

        {/* 通知未設定バナー */}
        {!notifyReady && !loading && (
          <a href="/settings" style={{
            display: 'block', marginBottom: 14,
            borderRadius: 16, textDecoration: 'none', overflow: 'hidden',
          }}>
            <div style={{
              background: 'var(--grad-warm)',
              padding: '14px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: 14, color: 'white' }}>⚠️ 通知がまだ設定されていません</p>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>タップして通知先を設定 →</p>
              </div>
            </div>
          </a>
        )}

        {/* 稼働中ステータスカード */}
        {conditions.length > 0 && !loading && (
          <div style={{
            borderRadius: 16,
            background: 'var(--card)',
            padding: '14px 8px', marginBottom: 14,
            boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
            border: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-around', alignItems: 'center',
          }}>
            {[
              { val: activeCount, label: '稼働中', color: activeCount > 0 ? 'var(--accent)' : 'var(--text-tertiary)' },
              { val: conditions.length, label: '総条件数', color: 'var(--text-primary)' },
              { val: '10分', label: 'チェック間隔', color: 'var(--text-secondary)' },
            ].map((item, i) => (
              <div key={i} style={{ textAlign: 'center', flex: 1, borderLeft: i > 0 ? '1px solid var(--border)' : 'none', padding: '2px 0' }}>
                <p style={{ fontSize: 22, fontWeight: 700, color: item.color, lineHeight: 1 }}>{item.val}</p>
                <p style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, fontWeight: 400, letterSpacing: 0.3 }}>{item.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* 空状態 */}
        {!loading && conditions.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 60, paddingBottom: 40 }}>
            <div style={{
              width: 100, height: 100, borderRadius: 30, margin: '0 auto 20px',
              background: 'var(--grad-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 48, boxShadow: '0 12px 40px rgba(255,107,53,0.35)',
            }}>🔍</div>
            <p style={{ fontWeight: 600, fontSize: 18, color: 'var(--text-primary)', marginBottom: 10 }}>
              ウォッチリストが空です
            </p>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 32, lineHeight: 1.7 }}>
              監視したいキーワードと価格を設定すると<br />新着商品を自動で通知します
            </p>
            <button onClick={() => setShowForm(true)} className="btn-primary" style={{ display: 'inline-block', width: 'auto', padding: '14px 32px' }}>
              最初の条件を追加する
            </button>
          </div>
        )}

        {/* カテゴリーラベル（タブが有効かつ特定カテゴリ選択中） */}
        {tabs.length > 0 && activeTab !== 'すべて' && displayedConditions.length > 0 && (
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10, paddingLeft: 4 }}>
            {activeTab} · {displayedConditions.length}件
          </p>
        )}

        {/* 条件リスト */}
        {displayedConditions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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

        {/* タブ絞り込み中で0件 */}
        {tabs.length > 0 && activeTab !== 'すべて' && displayedConditions.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)', fontSize: 14 }}>
            このカテゴリの条件はありません
          </div>
        )}

        {conditions.length > 0 && (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={runNow}
                disabled={runState === 'running' || resetting || !notifyReady}
                style={{
                  flex: 1, padding: '13px 16px',
                  background: (runState === 'running' || resetting) ? 'var(--bg)' : 'var(--card)',
                  border: '1px solid var(--border)', borderRadius: 12,
                  fontSize: 13, fontWeight: 600, cursor: (runState === 'running' || resetting) ? 'default' : 'pointer',
                  color: 'var(--text-primary)', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  opacity: !notifyReady ? 0.45 : 1,
                }}
              >
                {runState === 'running' ? '🔄 チェック中...' : '▶ 今すぐチェック'}
              </button>
              <button
                onClick={resetAndRun}
                disabled={runState === 'running' || resetting || !notifyReady}
                title="通知済み履歴を全消去して最初からチェック（テスト用）"
                style={{
                  padding: '13px 16px',
                  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
                  fontSize: 12, fontWeight: 500, cursor: (runState === 'running' || resetting) ? 'default' : 'pointer',
                  color: 'var(--text-secondary)', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 4,
                  opacity: !notifyReady ? 0.45 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {resetting ? '🔄' : '↺ リセット'}
              </button>
            </div>

            {runState === 'done' && runResult && (
              <div style={{ padding: '14px 16px', borderRadius: 14, background: 'var(--card)', border: '1px solid var(--border)' }}>
                <p style={{ fontWeight: 700, fontSize: 14, color: runResult.notified > 0 ? 'var(--success)' : 'var(--text-secondary)', marginBottom: 8 }}>
                  {runResult.notified > 0 ? `✅ ${runResult.notified}件を通知送信！` : '📭 新着なし'}
                </p>
                {runResult.results?.map((r, i) => (
                  <div key={i} style={{ paddingTop: i > 0 ? 8 : 0, marginTop: i > 0 ? 8 : 0, borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>{r.name}</p>
                    {r.priceWarning ? (
                      <p style={{ fontSize: 11, color: 'var(--danger)' }}>⚠️ 価格下限 ≥ 上限 → 条件を編集してください</p>
                    ) : r.rawCount === 0 ? (
                      <>
                        <p style={{ fontSize: 11, color: 'var(--danger)', marginBottom: 3 }}>
                          ⚠️ RSS取得0件（HTTP {r.httpStatus}）
                        </p>
                        {r.simpleCount !== undefined && r.simpleCount > 0 && (
                          <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 3 }}>
                            💡 フィルターなしでは {r.simpleCount}件あります → フィルター設定が原因です
                          </p>
                        )}
                        {r.simpleCount !== undefined && r.simpleCount === 0 && (
                          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 3 }}>
                            ヤフオク上に該当商品なし（キーワードか価格帯を変更してください）
                          </p>
                        )}
                        {r.xmlPreview && (
                          <p style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, wordBreak: 'break-all', fontFamily: 'monospace', background: 'var(--bg)', padding: '6px', borderRadius: 6 }}>
                            {r.xmlPreview}
                          </p>
                        )}
                        {r.rssUrl && (
                          <a href={r.rssUrl} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: 10, color: 'var(--accent)', display: 'block', wordBreak: 'break-all', marginTop: 4 }}>
                            🔗 RSSを確認する
                          </a>
                        )}
                      </>
                    ) : r.fetched === 0 ? (
                      <p style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        RSS取得OK（{r.rawCount}件）しかし解析後0件（URLフォーマット不一致）
                      </p>
                    ) : r.newItems === 0 ? (
                      <p style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        {r.fetched}件取得 · 全件通知済み（前回チェック以降に新着なし）
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
              padding: '12px 16px',
              background: 'var(--card)', borderRadius: 14,
              fontSize: 12, color: 'var(--text-tertiary)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 14 }}>⚡</span>
              <span>10分ごとに自動チェック · 新着のみ通知</span>
            </div>
          </div>
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => setShowForm(true)}
        style={{
          position: 'fixed',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
          right: 'max(16px, calc(50% - 240px + 16px))',
          width: 60, height: 60,
          background: 'var(--grad-primary)',
          color: 'white', border: 'none', borderRadius: 30,
          fontSize: 30, fontWeight: 300,
          boxShadow: '0 8px 28px rgba(255,107,53,0.5)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 90,
          transition: 'transform 0.15s, box-shadow 0.15s',
        }}
      >
        +
      </button>

      {/* 新規追加フォーム */}
      {showForm && userId && (
        <ConditionForm
          userId={userId}
          onSave={() => { setShowForm(false); loadConditions() }}
          onClose={() => setShowForm(false)}
        />
      )}

      {/* 編集フォーム */}
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
