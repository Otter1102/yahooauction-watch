#!/usr/bin/env tsx
/**
 * E2Eフェッチテスト（50条件）
 * - buyItNow=null（ソート未設定）の条件でfetchが0件にならないか検証
 * - 5並列 × 10バッチで実行
 */
import { fetchAuctionRssWithMeta } from '../lib/scraper'

type Condition = {
  label: string
  keyword: string
  maxPrice: number
  minPrice: number
  minBids: number
  buyItNow: boolean | null
}

// 実際のユーザー利用を想定した50条件
const CONDITIONS: Condition[] = [
  // ブランドバッグ系（buyItNow=null、minBids=0）
  { label: 'コーチ 両方', keyword: 'コーチ バッグ', maxPrice: 30000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'ルイヴィトン 両方', keyword: 'ルイヴィトン', maxPrice: 80000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'グッチ 両方', keyword: 'グッチ バッグ', maxPrice: 50000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'プラダ 両方', keyword: 'プラダ', maxPrice: 40000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'シャネル 両方', keyword: 'シャネル 財布', maxPrice: 60000, minPrice: 0, minBids: 0, buyItNow: null },
  // ブランドバッグ系（minBids=1 — これがabuynow=2の影響を受けていた）
  { label: 'コーチ 入札1+', keyword: 'コーチ バッグ', maxPrice: 30000, minPrice: 0, minBids: 1, buyItNow: null },
  { label: 'ルイヴィトン 入札1+', keyword: 'ルイヴィトン', maxPrice: 80000, minPrice: 0, minBids: 1, buyItNow: null },
  { label: 'グッチ 入札1+', keyword: 'グッチ バッグ', maxPrice: 50000, minPrice: 0, minBids: 1, buyItNow: null },
  { label: 'プラダ 入札1+', keyword: 'プラダ', maxPrice: 40000, minPrice: 0, minBids: 1, buyItNow: null },
  { label: 'シャネル 入札1+', keyword: 'シャネル 財布', maxPrice: 60000, minPrice: 0, minBids: 1, buyItNow: null },
  // カメラ・レンズ系
  { label: 'ニコン レンズ 両方', keyword: 'ニコン レンズ', maxPrice: 50000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'キャノン レンズ 両方', keyword: 'キャノン レンズ', maxPrice: 50000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'ソニー レンズ 両方', keyword: 'ソニー レンズ', maxPrice: 50000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'ニコン 一眼 入札1+', keyword: 'ニコン 一眼', maxPrice: 80000, minPrice: 0, minBids: 1, buyItNow: null },
  { label: 'キャノン EOS 入札1+', keyword: 'キャノン EOS', maxPrice: 80000, minPrice: 0, minBids: 1, buyItNow: null },
  // スマホ・PC系
  { label: 'iPhone 両方', keyword: 'iPhone 14', maxPrice: 80000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'iPad 両方', keyword: 'iPad Air', maxPrice: 60000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'MacBook 両方', keyword: 'MacBook Air', maxPrice: 120000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'iPhone 入札1+', keyword: 'iPhone 14', maxPrice: 80000, minPrice: 0, minBids: 1, buyItNow: null },
  { label: 'iPad 入札1+', keyword: 'iPad Air', maxPrice: 60000, minPrice: 0, minBids: 1, buyItNow: null },
  // 腕時計系
  { label: 'セイコー 両方', keyword: 'セイコー 腕時計', maxPrice: 30000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'カシオ 両方', keyword: 'カシオ 腕時計', maxPrice: 20000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'オメガ 両方', keyword: 'オメガ 腕時計', maxPrice: 200000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'セイコー 入札1+', keyword: 'セイコー 腕時計', maxPrice: 30000, minPrice: 0, minBids: 1, buyItNow: null },
  { label: 'オメガ 入札1+', keyword: 'オメガ 腕時計', maxPrice: 200000, minPrice: 0, minBids: 1, buyItNow: null },
  // ゲーム系
  { label: 'PS5 両方', keyword: 'PS5 本体', maxPrice: 60000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'Switch 両方', keyword: 'Switch 本体', maxPrice: 30000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'PS5 入札1+', keyword: 'PS5 本体', maxPrice: 60000, minPrice: 0, minBids: 1, buyItNow: null },
  { label: 'ポケモン ゲーム 両方', keyword: 'ポケモン カードゲーム', maxPrice: 10000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'ポケモン 入札1+', keyword: 'ポケモン カードゲーム', maxPrice: 10000, minPrice: 0, minBids: 1, buyItNow: null },
  // 衣類・ファッション
  { label: 'ユニクロ 両方', keyword: 'ユニクロ ダウン', maxPrice: 5000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'ナイキ スニーカー 両方', keyword: 'ナイキ スニーカー', maxPrice: 20000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'アディダス 両方', keyword: 'アディダス スニーカー', maxPrice: 15000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'ナイキ 入札1+', keyword: 'ナイキ スニーカー', maxPrice: 20000, minPrice: 0, minBids: 1, buyItNow: null },
  { label: 'スーパードライ 両方', keyword: 'スーパードライ ジャケット', maxPrice: 30000, minPrice: 0, minBids: 0, buyItNow: null },
  // 家電系
  { label: 'ダイソン 両方', keyword: 'ダイソン 掃除機', maxPrice: 40000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'バルミューダ 両方', keyword: 'バルミューダ', maxPrice: 30000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'ルンバ 両方', keyword: 'ルンバ 掃除機', maxPrice: 50000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'ダイソン 入札1+', keyword: 'ダイソン 掃除機', maxPrice: 40000, minPrice: 0, minBids: 1, buyItNow: null },
  { label: 'Bose ヘッドホン 両方', keyword: 'Bose ヘッドホン', maxPrice: 30000, minPrice: 0, minBids: 0, buyItNow: null },
  // 工具・DIY
  { label: 'マキタ ドリル 両方', keyword: 'マキタ 電動ドリル', maxPrice: 20000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'ハイコーキ 両方', keyword: 'ハイコーキ 工具', maxPrice: 30000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'マキタ 入札1+', keyword: 'マキタ 電動ドリル', maxPrice: 20000, minPrice: 0, minBids: 1, buyItNow: null },
  // アウトドア系
  { label: 'スノーピーク 両方', keyword: 'スノーピーク テント', maxPrice: 80000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'コールマン 両方', keyword: 'コールマン キャンプ', maxPrice: 30000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'スノーピーク 入札1+', keyword: 'スノーピーク テント', maxPrice: 80000, minPrice: 0, minBids: 1, buyItNow: null },
  // 自動車・バイク部品
  { label: 'ホンダ バイク 両方', keyword: 'ホンダ バイク', maxPrice: 100000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'タイヤ 両方', keyword: 'タイヤ サマー', maxPrice: 30000, minPrice: 0, minBids: 0, buyItNow: null },
  { label: 'バイク ヘルメット 入札1+', keyword: 'バイク ヘルメット', maxPrice: 20000, minPrice: 0, minBids: 1, buyItNow: null },
  // おもちゃ・コレクション
  { label: 'レゴ 両方', keyword: 'レゴ セット', maxPrice: 20000, minPrice: 0, minBids: 0, buyItNow: null },
]

async function runTest(cond: Condition): Promise<{ label: string; count: number; httpStatus: number; preview: string }> {
  const key = {
    keyword: cond.keyword,
    maxPrice: cond.maxPrice,
    minPrice: cond.minPrice,
    minBids: cond.minBids,
    sellerType: 'all' as const,
    itemCondition: 'all' as const,
    sortBy: 'endTime' as const,
    sortOrder: 'asc' as const,
    buyItNow: cond.buyItNow,
  }
  const { rawCount, httpStatus, xmlPreview } = await fetchAuctionRssWithMeta(key)
  return { label: cond.label, count: rawCount, httpStatus, preview: xmlPreview.slice(0, 80) }
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) {
    console.log('⚠️  NEXT_PUBLIC_SUPABASE_URL未設定（Supabase接続なし）— scraper単体テストとして実行')
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`  ヤフオクwatch フェッチE2Eテスト（${CONDITIONS.length}条件）`)
  console.log(`  目的: buyItNow=null（ソート未設定）での0件発生を確認`)
  console.log(`${'='.repeat(60)}\n`)

  const CONCURRENCY = 5
  const results: Array<{ label: string; count: number; httpStatus: number; preview: string }> = []

  for (let i = 0; i < CONDITIONS.length; i += CONCURRENCY) {
    const batch = CONDITIONS.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(batch.map(runTest))
    results.push(...batchResults)
    // Yahoo レート制限対策
    if (i + CONCURRENCY < CONDITIONS.length) {
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  // 結果表示
  const zeros = results.filter(r => r.count === 0)
  const nonZeros = results.filter(r => r.count > 0)
  const errors = results.filter(r => r.httpStatus !== 200)

  console.log('【全結果】')
  for (const r of results) {
    const icon = r.count === 0 ? '❌' : r.count < 5 ? '⚠️ ' : '✅'
    console.log(`  ${icon} [${r.httpStatus}] ${r.label.padEnd(25)} → ${r.count}件`)
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`  合計: ${results.length}条件`)
  console.log(`  ✅ 取得成功: ${nonZeros.length}条件`)
  console.log(`  ❌ 0件:      ${zeros.length}条件`)
  if (errors.length > 0) {
    console.log(`  🔴 HTTPエラー: ${errors.length}条件`)
  }
  console.log(`${'='.repeat(60)}`)

  if (zeros.length > 0) {
    console.log('\n【0件の条件一覧】')
    for (const r of zeros) {
      console.log(`  - ${r.label} [HTTP ${r.httpStatus}]`)
      console.log(`    preview: ${r.preview.slice(0, 100)}`)
    }
  }

  const successRate = Math.round(nonZeros.length / results.length * 100)
  console.log(`\n  📊 取得成功率: ${successRate}%`)

  // HTTPステータスが200以外の場合はIP blocking の可能性
  const blockCount = results.filter(r => r.httpStatus !== 200 && r.httpStatus !== 0).length
  if (blockCount > 3) {
    console.log(`\n  ⚠️  HTTPエラーが${blockCount}件 → Yahoo IP blockingの可能性があります`)
    console.log('  → GitHub Actionsクロンでの通知が主系なのでそちらは問題ありません')
  }

  console.log()
}

main().catch(err => {
  console.error('エラー:', err)
  process.exit(1)
})
