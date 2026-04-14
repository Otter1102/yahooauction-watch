'use client'
import { useEffect, useRef, useState, useMemo } from 'react'
import { NotificationRecord } from '@/lib/types'
import AuctionThumbnail from '@/components/AuctionThumbnail'

function getUserId() {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('yahoowatch_user_id') ?? ''
}

// ─── ヤフオクページへ遷移 ───────────────────────────────────
// Yahoo URL に直接遷移（/redirect/ は経由しない）
// ⚠️ /redirect/ 経由は禁止: 302のみのページなのでバック時に空白ページに戻る
// ⚠️ /open は絶対に使わない: プッシュ通知専用の deeplink インタースティシャル
// window.open → iOS PWAで SFSafariViewController として開く
// × で閉じた後に /history へ強制復帰するため sessionStorage にフラグをセット
function openAuction(url: string) {
  // × で閉じた後の強制復帰先を記録（layout.tsx の visibilitychange で消費）
  sessionStorage.setItem('yw_return_to', '/history')
  const win = window.open(url, '_blank', 'noopener')
  if (!win) {
    // iOS PWAではユーザータップ起点のwindow.openは通常成功する
    // 失敗した場合でも location.href は使わない（WKWebView遷移 → 白画面の原因）
    sessionStorage.removeItem('yw_return_to')
  }
}

// ─── Yahoo公式大カテゴリ分類 ───
const CATEGORIES = [
  { id: 'all',        label: 'すべて' },
  { id: 'fashion',    label: 'ファッション' },
  { id: 'bag',        label: 'バッグ・財布' },
  { id: 'watch',      label: '時計・アクセサリー' },
  { id: 'electronics',label: '家電・カメラ' },
  { id: 'game',       label: 'ゲーム' },
  { id: 'sports',     label: 'スポーツ' },
  { id: 'book',       label: '本・メディア' },
  { id: 'other',      label: 'その他' },
] as const
type CategoryId = (typeof CATEGORIES)[number]['id']

const CATEGORY_PATTERNS: Record<Exclude<CategoryId, 'all' | 'other'>, RegExp> = {
  bag:         /バッグ|バック|鞄|かばん|財布|ウォレット|ポーチ|トートバッグ|ショルダーバッグ|ハンドバッグ|リュック|クラッチ|ボストンバッグ|カバン|キーケース|キーホルダー|コインケース|カードケース/i,
  watch:       /時計|ウォッチ|腕時計|指輪|リング|ネックレス|ピアス|イヤリング|ブレスレット|バングル|アクセサリー|ブローチ|ロレックス|オメガ|セイコー|カシオ|シチズン/i,
  fashion:     /シャツ|パンツ|ジャケット|コート|スウェット|トレーナー|ニット|セーター|ジーンズ|デニム|スカート|ワンピース|スニーカー|ブーツ|サンダル|ローファー|靴|シューズ|帽子|キャップ|ベルト|手袋|マフラー|スカーフ|ストール|アパレル|衣類|ウェア|Tシャツ|ダウン|パーカー|フーディ|ソックス|タイ|ネクタイ/i,
  electronics: /iPhone|スマホ|スマートフォン|携帯|Android|iPad|タブレット|MacBook|ノートPC|ノートパソコン|デスクトップ|パソコン|カメラ|レンズ|テレビ|モニター|ディスプレイ|イヤホン|ヘッドフォン|ヘッドホン|スピーカー|家電|電機|充電器|キーボード|マウス/i,
  game:        /ゲーム|Nintendo|Switch|PlayStation|Xbox|ファミコン|ゲームボーイ|ゲームキューブ|Wii|フィギュア|プラモデル|おもちゃ|玩具|レゴ|ガンプラ|ドール/i,
  sports:      /スポーツ|ゴルフ|テニス|サッカー|野球|バスケ|バレー|水泳|自転車|ロードバイク|ランニング|トレーニング|フィットネス|釣り|アウトドア|キャンプ|スキー|スノボ/i,
  book:        /書籍|コミック|漫画|マンガ|CD|DVD|Blu-ray|ブルーレイ|レコード|雑誌|週刊|文庫|小説|参考書|教科書|写真集|楽譜/i,
}

function classifyCategory(title: string, conditionName: string): Exclude<CategoryId, 'all'> {
  const text = `${title} ${conditionName}`
  for (const [id, pattern] of Object.entries(CATEGORY_PATTERNS) as [Exclude<CategoryId, 'all' | 'other'>, RegExp][]) {
    if (pattern.test(text)) return id
  }
  return 'other'
}

function groupByDate(records: NotificationRecord[]): { label: string; items: NotificationRecord[] }[] {
  const today     = new Date().toDateString()
  const yesterday = new Date(Date.now() - 86400000).toDateString()
  const map = new Map<string, NotificationRecord[]>()

  for (const r of records) {
    const d = new Date(r.notifiedAt)
    let label: string
    if (d.toDateString() === today)     label = '今日'
    else if (d.toDateString() === yesterday) label = '昨日'
    else label = d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) + '日'
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(r)
  }

  return Array.from(map.entries()).map(([label, items]) => ({ label, items }))
}

function SkeletonItem({ isFirst }: { isFirst?: boolean }) {
  return (
    <div style={{
      padding: '11px 14px',
      borderTop: isFirst ? 'none' : '1px solid var(--border)',
      display: 'flex', alignItems: 'flex-start', gap: 11,
      animation: 'pulse 1.4s ease-in-out infinite',
    }}>
      <div style={{ width: 60, height: 60, borderRadius: 8, background: 'var(--fill)', flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ width: '30%', height: 10, borderRadius: 4, background: 'var(--fill)' }} />
          <div style={{ width: '15%', height: 10, borderRadius: 4, background: 'var(--fill)' }} />
        </div>
        <div style={{ width: '90%', height: 12, borderRadius: 4, background: 'var(--fill)', marginBottom: 4 }} />
        <div style={{ width: '70%', height: 12, borderRadius: 4, background: 'var(--fill)', marginBottom: 8 }} />
        <div style={{ width: '25%', height: 12, borderRadius: 4, background: 'var(--fill)' }} />
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}`}</style>
    </div>
  )
}

export default function HistoryPage() {
  const [history, setHistory]       = useState<NotificationRecord[]>([])
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab]   = useState<CategoryId>('all')
  const [selectedCondition, setSelectedCondition] = useState<string>('all')
  const tabsRef    = useRef<HTMLDivElement>(null)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)

  // ─── Pull-to-Refresh ──────────────────────────────────────────
  const [pullY, setPullY] = useState(0)
  const [isPullRefreshing, setIsPullRefreshing] = useState(false)
  const pullStartY = useRef(-1)
  const PULL_THRESHOLD = 40

  // ─── データ取得 ─────────────────────────────────────────────
  async function fetchHistory() {
    const id = getUserId()
    if (!id) return
    const data = await fetch(`/api/history?userId=${id}`).then(r => r.json())
    setHistory(data)
  }

  useEffect(() => {
    fetchHistory().finally(() => setLoading(false))
  }, [])

  // ─── リロード（クリーンアップ + 通知チェック + 履歴更新を同時実行）────
  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      const id = getUserId()
      if (id) {
        // クリーンアップ・通知チェックをバックグラウンドで並列実行（待たない）
        fetch('/api/history/cleanup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: id }),
        }).catch(() => {})
        // 取りこぼし通知を即回収
        fetch('/api/run-now', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: id, manual: false }),
        }).catch(() => {})
      }
      // 少し待ってから履歴取得（バックグラウンド処理が先行しやすくする）
      await new Promise(r => setTimeout(r, 1000))
      await fetchHistory()
    } finally {
      setRefreshing(false)
    }
  }

  // ─── 条件名リスト（プルダウン用） ────────────────────────
  const conditionNames = useMemo(() => {
    const names = new Set(history.map(r => r.conditionName))
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'ja'))
  }, [history])

  // ─── カテゴリ + 条件名フィルタ ───────────────────────────
  const filtered = useMemo(() => {
    let result = activeTab === 'all'
      ? history
      : history.filter(r => classifyCategory(r.title, r.conditionName) === activeTab)
    if (selectedCondition !== 'all') {
      result = result.filter(r => r.conditionName === selectedCondition)
    }
    return result
  }, [history, activeTab, selectedCondition])

  const groups = groupByDate(filtered)

  // ─── タブ切替（スクロール連動） ──────────────────────────
  const handleTab = (id: CategoryId) => {
    setActiveTab(id)
    const idx = CATEGORIES.findIndex(c => c.id === id)
    tabsRef.current?.scrollTo({ left: idx * 80, behavior: 'smooth' })
  }

  // ─── 横スワイプ + Pull-to-Refresh（共存） ───────────────────
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    if (window.scrollY === 0) pullStartY.current = e.touches[0].clientY
  }

  const onTouchMove = (e: React.TouchEvent) => {
    if (pullStartY.current < 0) return
    const dy = e.touches[0].clientY - pullStartY.current
    if (dy > 0) setPullY(Math.min(dy * 0.65, 80))
  }

  const onTouchEnd = async (e: React.TouchEvent) => {
    // Pull-to-Refresh
    const triggered = pullY >= PULL_THRESHOLD
    setPullY(0)
    pullStartY.current = -1
    if (triggered) {
      setIsPullRefreshing(true)
      await refresh()
      setIsPullRefreshing(false)
      return
    }

    // 横スワイプでカテゴリ切替
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy) * 1.5) return
    const idx = CATEGORIES.findIndex(c => c.id === activeTab)
    if (dx < 0 && idx < CATEGORIES.length - 1) handleTab(CATEGORIES[idx + 1].id)
    else if (dx > 0 && idx > 0)                handleTab(CATEGORIES[idx - 1].id)
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: 'var(--bg)',
        paddingBottom: 'calc(var(--nav-height) + env(safe-area-inset-bottom, 0px))',
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        ::-webkit-scrollbar { display: none }
      `}</style>

      {/* ─── Pull-to-Refresh インジケーター ─── */}
      {(pullY > 0 || isPullRefreshing) && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
          display: 'flex', justifyContent: 'center', alignItems: 'flex-end',
          height: isPullRefreshing ? 56 : pullY, pointerEvents: 'none', paddingBottom: 8,
          transition: isPullRefreshing ? 'height 0.2s ease' : 'none',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            border: '2.5px solid var(--border)',
            borderTopColor: 'var(--accent)',
            animation: (pullY >= PULL_THRESHOLD || isPullRefreshing) ? 'spin 0.6s linear infinite' : 'none',
            transition: 'border-top-color 0.15s',
          }} />
        </div>
      )}

      {/* ─── Header ─── */}
      <div style={{
        background: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--border)',
        padding: 'calc(env(safe-area-inset-top, 0px) + 16px) 20px 0',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>

          {/* Row 1: タイトル + 件数 + リロード */}
          <div style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', paddingBottom: 12,
          }}>
            <h1 style={{
              fontWeight: 700, fontSize: 22, color: 'var(--text-primary)',
              letterSpacing: '-0.3px', lineHeight: 1.2,
            }}>
              通知履歴
            </h1>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!loading && (
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 400 }}>
                  {filtered.length > 0
                    ? `${filtered.length}件`
                    : history.length > 0 ? '0件' : '通知なし'}
                </span>
              )}
              {/* リロードボタン */}
              <button
                onClick={refresh}
                disabled={refreshing}
                style={{
                  background: 'var(--fill)',
                  border: '1px solid var(--border)',
                  borderRadius: 20,
                  width: 32, height: 32,
                  cursor: refreshing ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--text-secondary)', opacity: refreshing ? 0.5 : 1,
                  flexShrink: 0,
                }}
              >
                <span style={{
                  fontSize: 15, lineHeight: 1,
                  display: 'inline-block',
                  animation: refreshing ? 'spin 0.8s linear infinite' : 'none',
                }}>↻</span>
              </button>
            </div>
          </div>

          {/* Row 2: カテゴリタブ */}
          <div
            ref={tabsRef}
            style={{
              display: 'flex', gap: 0,
              overflowX: 'auto', scrollbarWidth: 'none',
              WebkitOverflowScrolling: 'touch',
              marginLeft: -20, marginRight: -20,
              paddingLeft: 20,
            }}
          >
            {CATEGORIES.map(cat => {
              const count = cat.id === 'all'
                ? history.length
                : history.filter(r => classifyCategory(r.title, r.conditionName) === cat.id).length
              const isActive = activeTab === cat.id
              return (
                <button
                  key={cat.id}
                  onClick={() => handleTab(cat.id)}
                  style={{
                    flexShrink: 0,
                    padding: '8px 14px 10px',
                    background: 'none',
                    border: 'none',
                    borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: isActive ? 700 : 400,
                    color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                    letterSpacing: '0.3px',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s',
                    fontFamily: 'inherit',
                  }}
                >
                  {cat.label}
                  {count > 0 && (
                    <span style={{
                      marginLeft: 4, fontSize: 10,
                      color: isActive ? 'var(--accent)' : 'var(--text-tertiary)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Row 3: 条件名プルダウン（2件以上の時のみ表示） */}
          {conditionNames.length > 1 && (
            <div style={{ padding: '8px 0 10px' }}>
              <div style={{ position: 'relative' }}>
                <select
                  value={selectedCondition}
                  onChange={e => setSelectedCondition(e.target.value)}
                  style={{
                    width: '100%',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    background: selectedCondition !== 'all'
                      ? 'rgba(0,153,226,0.08)'
                      : 'var(--fill)',
                    border: selectedCondition !== 'all'
                      ? '1px solid rgba(0,153,226,0.4)'
                      : '1px solid var(--border)',
                    borderRadius: 9,
                    padding: '8px 32px 8px 12px',
                    fontSize: 13,
                    fontWeight: selectedCondition !== 'all' ? 600 : 400,
                    color: selectedCondition !== 'all'
                      ? 'var(--accent)'
                      : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                >
                  <option value="all">すべての条件を表示</option>
                  {conditionNames.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                {/* カスタム矢印 */}
                <span style={{
                  position: 'absolute', right: 10, top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: 9, color: 'var(--text-tertiary)',
                  pointerEvents: 'none', lineHeight: 1,
                }}>▼</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 16 }}>

        {/* ─── スケルトンローディング ─── */}
        {loading && (
          <div style={{ padding: '16px 16px 0' }}>
            <div style={{
              borderRadius: 12, overflow: 'hidden',
              background: 'var(--card)', boxShadow: 'var(--shadow-card)',
            }}>
              <SkeletonItem isFirst />
              <SkeletonItem />
              <SkeletonItem />
              <SkeletonItem />
              <SkeletonItem />
            </div>
          </div>
        )}

        {/* ─── Empty state ─── */}
        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 32px 40px', animation: 'fadeIn 0.3s ease' }}>
            <div style={{ fontSize: 44, marginBottom: 16, opacity: 0.2 }}>🔔</div>
            <p style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)', marginBottom: 8 }}>
              {history.length === 0
                ? 'まだ通知はありません'
                : selectedCondition !== 'all'
                  ? `「${selectedCondition}」の通知はありません`
                  : 'このカテゴリの通知はありません'}
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.65 }}>
              {history.length === 0
                ? '検索条件を追加してヤフオクを監視すると\n新着商品を自動で通知します'
                : selectedCondition !== 'all'
                  ? '他の条件を選択するか\n「すべての条件」に戻してください'
                  : '他のカテゴリを確認するか、\n検索条件を追加してください'}
            </p>
            {selectedCondition !== 'all' && (
              <button
                onClick={() => setSelectedCondition('all')}
                style={{
                  marginTop: 16, padding: '8px 20px', borderRadius: 20,
                  background: 'var(--fill)', border: '1px solid var(--border)',
                  fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                絞り込みを解除
              </button>
            )}
          </div>
        )}

        {/* ─── Grouped list ─── */}
        {groups.map(({ label, items }) => (
          <div key={label} style={{ padding: '16px 16px 0' }}>

            <p style={{
              fontSize: 11, fontWeight: 700,
              color: 'var(--text-tertiary)',
              paddingLeft: 4, marginBottom: 6,
              letterSpacing: '0.8px', textTransform: 'uppercase',
            }}>{label}</p>

            <div style={{
              borderRadius: 12,
              overflow: 'hidden',
              background: 'var(--card)',
              boxShadow: 'var(--shadow-card)',
            }}>
              {items.map((r, idx) => (
                <div
                  key={r.id}
                  onClick={() => openAuction(r.url)}
                  style={{
                    padding: '11px 14px 11px 14px',
                    borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                    display: 'flex', alignItems: 'flex-start', gap: 11,
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'rgba(0,0,0,0.04)',
                  }}
                >
                  <AuctionThumbnail
                    savedUrl={r.imageUrl ?? ''}
                    auctionUrl={r.url}
                    size={60}
                    radius={8}
                  />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Row 1: 条件名 + 時刻 */}
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between', marginBottom: 3,
                    }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700,
                        color: 'var(--accent)',
                        letterSpacing: '0.8px', textTransform: 'uppercase',
                      }}>{r.conditionName}</span>
                      <time style={{
                        fontSize: 10, color: 'var(--text-tertiary)',
                        fontWeight: 400, fontVariantNumeric: 'tabular-nums',
                        flexShrink: 0, marginLeft: 8,
                      }}>
                        {new Date(r.notifiedAt).toLocaleTimeString('ja-JP', {
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </time>
                    </div>

                    {/* Row 2: 商品名 */}
                    <p style={{
                      fontSize: 13, fontWeight: 400,
                      color: 'var(--text-primary)',
                      lineHeight: 1.45, marginBottom: 5,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}>{r.title}</p>

                    {/* Row 3: 価格 + 残り時間 + 矢印 */}
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <span style={{
                          fontSize: 13, fontWeight: 700,
                          color: (r.price && r.price !== '価格不明')
                            ? 'var(--accent)'
                            : 'var(--text-tertiary)',
                          fontVariantNumeric: 'tabular-nums',
                          flexShrink: 0,
                        }}>
                          {(r.price && r.price !== '価格不明') ? r.price : '—'}
                        </span>
                        {r.remaining && (
                          <span style={{
                            fontSize: 10, fontWeight: 500,
                            color: 'var(--text-tertiary)',
                            background: 'var(--fill)',
                            borderRadius: 4,
                            padding: '1px 5px',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                          }}>
                            {r.remaining}
                          </span>
                        )}
                      </div>
                      <span style={{
                        fontSize: 14, color: 'var(--text-tertiary)',
                        fontWeight: 300, lineHeight: 1, flexShrink: 0,
                      }}>›</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* ─── Footer note ─── */}
        {history.length > 0 && !loading && (
          <p style={{
            textAlign: 'center', fontSize: 11,
            color: 'var(--text-tertiary)', fontWeight: 400,
            padding: '20px 16px 4px',
            letterSpacing: '0.3px',
          }}>
            終了したオークションは自動的に削除されます
          </p>
        )}
      </div>
    </div>
  )
}
