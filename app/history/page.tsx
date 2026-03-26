'use client'
import { useEffect, useRef, useState } from 'react'
import { NotificationRecord } from '@/lib/types'
import AuctionThumbnail from '@/components/AuctionThumbnail'

function getUserId() {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('yahoowatch_user_id') ?? ''
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

export default function HistoryPage() {
  const [history, setHistory]   = useState<NotificationRecord[]>([])
  const [loading, setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState<CategoryId>('all')
  const tabsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = getUserId()
    if (!id) { setLoading(false); return }
    fetch(`/api/history?userId=${id}`)
      .then(r => r.json())
      .then(d => { setHistory(d); setLoading(false) })
  }, [])

  // カテゴリフィルタ
  const filtered = activeTab === 'all'
    ? history
    : history.filter(r => classifyCategory(r.title, r.conditionName) === activeTab)

  const groups = groupByDate(filtered)

  // タブ切替時に先頭にスクロール
  const handleTab = (id: CategoryId) => {
    setActiveTab(id)
    tabsRef.current?.scrollTo({ left: CATEGORIES.findIndex(c => c.id === id) * 80, behavior: 'smooth' })
  }

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--bg)',
      paddingBottom: 'calc(var(--nav-height) + env(safe-area-inset-bottom, 0px))',
    }}>

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
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 12 }}>
            <h1 style={{
              fontWeight: 700, fontSize: 22, color: 'var(--text-primary)',
              letterSpacing: '-0.3px', lineHeight: 1.2,
            }}>
              通知履歴
            </h1>
            {!loading && (
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 400 }}>
                {history.length > 0 ? `全${history.length}件` : '通知なし'}
              </span>
            )}
          </div>

          {/* ─── Category Tabs ─── */}
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
            <style>{`::-webkit-scrollbar{display:none}`}</style>
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
                    padding: '8px 14px',
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
                    paddingBottom: 10,
                  }}
                >
                  {cat.label}
                  {count > 0 && (
                    <span style={{
                      marginLeft: 4,
                      fontSize: 10,
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
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 16 }}>

        {/* ─── Loading spinner ─── */}
        {loading && (
          <div style={{ padding: '80px 20px', textAlign: 'center' }}>
            <div style={{
              width: 22, height: 22,
              border: '2px solid var(--border)',
              borderTopColor: 'var(--accent)',
              borderRadius: '50%',
              margin: '0 auto',
              animation: 'spin 0.7s linear infinite',
            }} />
          </div>
        )}

        {/* ─── Empty state ─── */}
        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 32px 40px', animation: 'fadeIn 0.3s ease' }}>
            <div style={{ fontSize: 44, marginBottom: 16, opacity: 0.2 }}>🔔</div>
            <p style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)', marginBottom: 8 }}>
              {activeTab === 'all' ? 'まだ通知はありません' : 'このカテゴリの通知はありません'}
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.65 }}>
              {activeTab === 'all'
                ? '検索条件を追加してヤフオクを監視すると\n新着商品を自動で通知します'
                : '他のカテゴリを確認するか、\n検索条件を追加してください'
              }
            </p>
          </div>
        )}

        {/* ─── Grouped list ─── */}
        {groups.map(({ label, items }) => (
          <div key={label} style={{ padding: '16px 16px 0' }}>

            {/* Section header */}
            <p style={{
              fontSize: 11, fontWeight: 700,
              color: 'var(--text-tertiary)',
              paddingLeft: 4, marginBottom: 6,
              letterSpacing: '0.8px', textTransform: 'uppercase',
            }}>{label}</p>

            {/* Grouped card */}
            <div style={{
              borderRadius: 12,
              overflow: 'hidden',
              background: 'var(--card)',
              boxShadow: 'var(--shadow-card)',
            }}>
              {items.map((r, idx) => (
                <a
                  key={r.id}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: 'none', display: 'block' }}
                >
                  <div style={{
                    padding: '11px 14px 11px 14px',
                    borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                    display: 'flex', alignItems: 'flex-start', gap: 11,
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'rgba(0,0,0,0.04)',
                  }}>

                    <AuctionThumbnail
                      savedUrl={r.imageUrl ?? ''}
                      auctionUrl={r.url}
                      size={60}
                      radius={8}
                    />

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Row 1: condition name + time */}
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

                      {/* Row 2: title */}
                      <p style={{
                        fontSize: 13, fontWeight: 400,
                        color: 'var(--text-primary)',
                        lineHeight: 1.45, marginBottom: 5,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}>{r.title}</p>

                      {/* Row 3: price + chevron */}
                      <div style={{
                        display: 'flex', alignItems: 'center',
                        justifyContent: 'space-between',
                      }}>
                        <span style={{
                          fontSize: 13, fontWeight: 700,
                          color: (r.price && r.price !== '価格不明')
                            ? 'var(--accent)'
                            : 'var(--text-tertiary)',
                          fontVariantNumeric: 'tabular-nums',
                        }}>
                          {(r.price && r.price !== '価格不明') ? r.price : '—'}
                        </span>
                        <span style={{
                          fontSize: 14, color: 'var(--text-tertiary)',
                          fontWeight: 300, lineHeight: 1,
                        }}>›</span>
                      </div>
                    </div>
                  </div>
                </a>
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
