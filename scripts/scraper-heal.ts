#!/usr/bin/env tsx
/**
 * スクレイパー自動修復スクリプト（Ollama使用）
 *
 * 用途: Yahoo がHTML構造を変更してスクレイパーが壊れた時に自動修復する
 * 実行: Mac mini の cron で30分ごとに実行
 *
 * crontab 設定例:
 *   */30 * * * * cd /Users/sawadaakira/Projects/MOTHERSHIP && npx tsx apps/yahoo-auction-watcher/scripts/scraper-heal.ts >> /tmp/scraper-heal.log 2>&1
 *
 * 修復フロー:
 *   1. Yahoo 検索でテストスクレイプ（0件なら異常）
 *   2. 異常検出 → HTML + 現在のパース関数を Ollama に送信
 *   3. Ollama が修正コードを返す
 *   4. TypeScript チェック通過なら commit & push（MOTHERSHIP + Vercel用リポジトリ両方）
 *   5. 失敗なら元のコードを復元してログに記録
 */

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

// ── 設定 ──────────────────────────────────────────────────────────────
const OLLAMA_URL    = 'http://localhost:11434'
const OLLAMA_MODEL  = 'qwen2.5:7b'
const REPO_ROOT     = path.join(__dirname, '../../..')     // MOTHERSHIP root
const APP_DIR       = path.join(__dirname, '..')            // apps/yahoo-auction-watcher
const SCRAPER_PATH  = path.join(APP_DIR, 'lib/scraper.ts')
const SCRAPER_REL   = 'apps/yahoo-auction-watcher/lib/scraper.ts'

// 常に数十件の結果があるはずのテスト用クエリ（有名ブランド・上限100万円）
const TEST_URL = 'https://auctions.yahoo.co.jp/search/search?p=%E3%83%96%E3%83%A9%E3%83%B3%E3%83%89&aucmaxprice=1000000&b=1&n=20&aucend=1&s1=end&o1=a'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// ── 健全性チェック ────────────────────────────────────────────────────

async function checkHealth(): Promise<{ ok: boolean; html: string; itemCount: number }> {
  try {
    const res = await fetch(TEST_URL, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'ja,ja-JP;q=0.9' },
      signal: AbortSignal.timeout(15_000),
    })
    const html = await res.text()
    const matches = html.match(/data-auction-id=["'][A-Za-z0-9]+["']/g)
    const itemCount = matches ? new Set(matches).size : 0
    return { ok: itemCount > 0, html, itemCount }
  } catch (e) {
    return { ok: false, html: '', itemCount: 0 }
  }
}

// ── HTMLから修復ヒントを抽出 ──────────────────────────────────────────

function extractHints(html: string): { dataAttrs: string; classes: string; htmlSample: string } {
  const dataAttrs = [...new Set(html.match(/data-auction-\w+/g) ?? [])].join(', ')
  const classes = [...new Set(html.match(/class="[^"]*(?:item|Item|product|Product|bid|Bid|price|Price)[^"]*"/gi) ?? [])]
    .slice(0, 20)
    .join('\n')
  // 最初の商品ブロック周辺を抽出
  const firstItemPos = html.indexOf('data-auction-id=')
  const htmlSample = firstItemPos !== -1
    ? html.slice(Math.max(0, firstItemPos - 200), firstItemPos + 5000)
    : html.slice(0, 3000)
  return { dataAttrs, classes, htmlSample }
}

// ── パース関数のみを抽出（プロンプトを短くするため） ────────────────

function extractParsingFunctions(code: string): { section: string; start: number; end: number } {
  const startMarker = 'function buildStartPriceMap'
  const endMarker   = '// ============================================================\n// フェッチ'
  const start = code.indexOf(startMarker)
  const end   = code.indexOf(endMarker)
  if (start === -1 || end === -1) {
    return { section: code, start: 0, end: code.length }
  }
  return { section: code.slice(start, end), start, end }
}

// ── Ollama にパース修正を依頼 ─────────────────────────────────────────

async function askOllama(parseSection: string, hints: ReturnType<typeof extractHints>): Promise<string> {
  const prompt = `You are a TypeScript expert. A Yahoo Auctions HTML scraper is returning 0 items because Yahoo changed their HTML structure.

Current parsing functions (lib/scraper.ts - parsing section only):
\`\`\`typescript
${parseSection.slice(0, 4000)}
\`\`\`

Data attributes found in the NEW Yahoo HTML (data-auction-*):
${hints.dataAttrs || '(none found - Yahoo may have removed data-auction-* attributes)'}

CSS classes related to price/bid/item in NEW HTML:
${hints.classes || '(none found)'}

Sample of NEW HTML around the first item:
\`\`\`html
${hints.htmlSample.slice(0, 3000)}
\`\`\`

Task: Fix the TypeScript parsing functions so they correctly extract auction items from the new HTML.
- Keep the same function signatures (buildStartPriceMap, parseItem)
- Fix only the CSS selectors, attribute names, or regex patterns that changed
- Return ONLY the fixed TypeScript code block, no explanation`

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.05, num_predict: 3000 },
    }),
    signal: AbortSignal.timeout(180_000),  // 3分タイムアウト
  })
  const data = await res.json() as { response: string }
  return data.response
}

// ── メイン ────────────────────────────────────────────────────────────

async function main() {
  const timestamp = new Date().toLocaleString('ja-JP')
  console.log(`\n[${timestamp}] === スクレイパーヘルスチェック開始 ===`)

  // 1. ヘルスチェック
  const { ok, html, itemCount } = await checkHealth()
  if (ok) {
    console.log(`[OK] スクレイパー正常: ${itemCount}件取得`)
    return
  }

  // Yahoo 自体が応答しているか確認
  if (!html.includes('yahoo') && !html.includes('<html')) {
    console.log('[SKIP] Yahoo へのアクセス失敗（ネットワーク問題）。修復をスキップ。')
    return
  }

  console.log('[WARN] スクレイパー異常（0件取得）。自動修復を開始...')

  // 2. 現在のコードを読み込み
  const currentCode = fs.readFileSync(SCRAPER_PATH, 'utf-8')
  const { section: parseSection, start, end } = extractParsingFunctions(currentCode)
  const hints = extractHints(html)

  console.log(`[INFO] data-auction-* 属性: ${hints.dataAttrs.slice(0, 120)}`)

  // 3. Ollama に修復を依頼
  console.log(`[Ollama] ${OLLAMA_MODEL} に修復リクエスト送信中...`)
  let response: string
  try {
    response = await askOllama(parseSection, hints)
  } catch (e) {
    console.error('[ERROR] Ollama 呼び出し失敗:', e instanceof Error ? e.message : e)
    return
  }

  // 4. コードブロックを抽出
  const codeMatch = response.match(/```(?:typescript|ts|)\n([\s\S]*?)```/)
  if (!codeMatch) {
    console.log('[ERROR] Ollama から有効なコードブロックが返りませんでした')
    console.log('Response preview:', response.slice(0, 300))
    return
  }
  const fixedSection = codeMatch[1].trim()
  const fixedCode    = currentCode.slice(0, start) + fixedSection + '\n\n' + currentCode.slice(end)

  // 5. バックアップして適用
  const backupPath = SCRAPER_PATH + `.bak.${Date.now()}`
  fs.writeFileSync(backupPath, currentCode, 'utf-8')
  fs.writeFileSync(SCRAPER_PATH, fixedCode, 'utf-8')
  console.log(`[INFO] バックアップ: ${path.basename(backupPath)}`)

  try {
    // 6. TypeScript 型チェック
    execSync('npx tsc --noEmit', { cwd: APP_DIR, stdio: 'pipe' })
    console.log('[OK] TypeScript チェック通過')

    // 7. 修正後の取得件数を確認
    const { ok: nowOk, itemCount: newCount } = await checkHealth()
    if (!nowOk) {
      throw new Error(`修復後も0件取得。修復コードが不十分。`)
    }
    console.log(`[OK] 修復後テスト成功: ${newCount}件取得`)

    // 8. Git commit（MOTHERSHIP）
    execSync(`git -C "${REPO_ROOT}" add "${SCRAPER_REL}"`)
    execSync(
      `git -C "${REPO_ROOT}" commit -m "fix: scraper自動修復 by Ollama (${new Date().toISOString().slice(0, 10)})"`,
    )

    // 9. vault-backup（MOTHERSHIP バックアップ）にプッシュ
    execSync(`git -C "${REPO_ROOT}" push origin main`, { stdio: 'pipe' })
    console.log('[OK] vault-backup プッシュ完了')

    // 10. yahooauction-watch（Vercel 接続リポジトリ）にサブツリープッシュ
    const splitHash = execSync(
      `git -C "${REPO_ROOT}" subtree split --prefix=apps/yahoo-auction-watcher HEAD`,
      { stdio: 'pipe' },
    ).toString().trim()
    execSync(
      `git -C "${REPO_ROOT}" push yahooauction ${splitHash}:main --force`,
      { stdio: 'pipe' },
    )
    console.log('[SUCCESS] Vercel へのデプロイ完了。自動修復成功！')

    // バックアップ不要になったら削除
    fs.unlinkSync(backupPath)

  } catch (err) {
    // 失敗 → 元に戻す
    fs.writeFileSync(SCRAPER_PATH, currentCode, 'utf-8')
    console.error('[FAIL] 自動修復失敗。元のコードを復元しました。')
    console.error(err instanceof Error ? err.message : err)
    // バックアップは残しておく（デバッグ用）
  }
}

main().catch(err => {
  console.error('[ERROR]', err instanceof Error ? err.message : err)
  process.exit(1)
})
