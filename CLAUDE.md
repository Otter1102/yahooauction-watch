# CLAUDE.md

## 🔒 機密ファイル 絶対禁止ルール（最優先・いかなる理由でも例外なし）

**.env / .env.local / .env.* ファイルは絶対に読まない・表示しない・内容を出力しない。**

- `Read .env.local` → **禁止**
- `grep .env.local` → **禁止**
- `cat .env` → **禁止**
- `vercel env pull` で取得した値を出力・使用 → **禁止**

シークレットが必要な作業はユーザーに直接確認を求めること。

---

## 🔔 通知配信 信頼性ルール（必須・変更禁止）

### 設計値（Vercel Hobby 60秒制限に合わせた厳密な計算値）

| パラメータ | 値 | 根拠 |
|-----------|-----|------|
| `TOTAL_SHARDS` | **8** | 200ユーザー ÷ 8 = 25ユーザー/シャード |
| `CONCURRENCY` | **25** | 25ユーザーを1バッチで並列処理。絶対に下げない |
| `USER_TIMEOUT_MS` | **30_000** | 30条件÷5並列=6バッチ×2s=12s + 通知 < 30s。余裕を持って60s以内 |
| `CONDITION_CONCURRENCY` | **5** | 1ユーザーあたり5条件並列。30条件÷5=6バッチ×2s=12s |
| `notified_items` TTL | **25時間** | 通知対象は「残り24h以内」→ 25h後には全終了済み |
| cronで処理する条件数/ユーザー | **全件（上限なし）** | 並列バッチ処理で30条件も12秒以内に完了 |
| 条件上限（有料プラン） | **30件** | 旧50件から変更（2026-04-10）。トライアルは5件 |

**⚠️ CONCURRENCY を下げると一部ユーザーへの通知が届かなくなる。絶対に変更しないこと。**

計算式:
```
シャードあたりユーザー数 = 200 ÷ TOTAL_SHARDS(8) = 25
処理時間 = ceil(25 / CONCURRENCY(25)) × USER_TIMEOUT_MS(30s) = 1 × 30s = 30s < 60s ✅
run-nowあたり時間 = ceil(30条件 / CONDITION_CONCURRENCY(5)) × 2s = 6 × 2s = 12s < USER_TIMEOUT_MS(30s) ✅
```

### 自己修復システム（`resetStalledNotified`）

毎cron実行時に以下を自動チェック:
- 条件: 「48時間通知なし AND notified_items 20件以上」
- 対応: 対象ユーザーの notified_items を強制リセット → 次のcronで通知再開
- ログ: `[cron] 自己修復: N ユーザーの通知ログをリセット`

このログが頻繁に出る場合は根本原因を調査すること。

### クリーンアップ設計（毎cron実行）

```
cleanupOldNotified()        → notified_items の 25h超えレコードを削除
cleanupOldHistory(72)       → notification_history の 72h超えを削除
cleanupEndedAuctions()      → 終了済みオークションを両テーブルから削除
  ├ 25h超: Yahoo確認なしで即削除（確実に終了済み）
  └ 1分〜25h: 5並列でYahoo確認し終了済みのみ削除
resetStalledNotified()      → 48h通知なし+20件溜まりユーザーを自動リセット
```

---

## 📱 Pull-to-Refresh（引っ張り更新）実装ルール

モバイルアプリでリロードボタンがある画面には**必ず pull-to-refresh も実装**すること。

```typescript
// state + ref
const [pullY, setPullY] = useState(0)
const pullStartY = useRef(-1)
const PULL_THRESHOLD = 64

// ハンドラー
const onPullStart = (e: React.TouchEvent) => {
  if (window.scrollY === 0) pullStartY.current = e.touches[0].clientY
}
const onPullMove = (e: React.TouchEvent) => {
  if (pullStartY.current < 0) return
  const dy = e.touches[0].clientY - pullStartY.current
  if (dy > 0) setPullY(Math.min(dy * 0.45, 80))
}
const onPullEnd = async () => {
  const triggered = pullY >= PULL_THRESHOLD
  setPullY(0); pullStartY.current = -1
  if (triggered) await loadData()
}

// インジケーター（pullY >= PULL_THRESHOLD でスピナー色変化）
{pullY > 0 && (
  <div style={{ position:'fixed', top:0, left:0, right:0, height:pullY, zIndex:100,
    display:'flex', justifyContent:'center', alignItems:'flex-end', paddingBottom:8, pointerEvents:'none' }}>
    <div style={{ width:28, height:28, borderRadius:'50%', border:'2.5px solid var(--border)',
      borderTopColor: pullY >= PULL_THRESHOLD ? 'var(--accent)' : 'var(--text-tertiary)',
      animation: pullY >= PULL_THRESHOLD ? 'spin 0.6s linear infinite' : 'none' }} />
  </div>
)}
```

**なぜ**: モバイルユーザーはリロードボタンを探さず、引っ張り更新を自然に期待する。ボタンだけでは気づかないユーザーが多い。

**⚠️ アニメーション維持ルール（必須）**: リリース後もデータ取得が完了するまでスピナーを表示し続けること。`setPullY(0)` するとインジケーターが消えるので、`isPullRefreshing` state を別途用意してローディング中は表示を維持する。

```typescript
const [isPullRefreshing, setIsPullRefreshing] = useState(false)

const onPullEnd = async () => {
  const triggered = pullY >= PULL_THRESHOLD
  setPullY(0); pullStartY.current = -1
  if (triggered) {
    setIsPullRefreshing(true)   // ← リリース後もスピナー維持
    await loadData()
    setIsPullRefreshing(false)  // ← 取得完了で非表示
  }
}

// インジケーターは pullY > 0 OR isPullRefreshing で表示
{(pullY > 0 || isPullRefreshing) && <Spinner />}
```

---

## 📋 フォームを開く時のスクロールルール

フォーム（追加・編集モーダル）を**開く時**は、必ずページ先頭にスクロールしてからフォームを表示すること。

```typescript
// ✅ setShowForm(true) を直接呼ばず openForm() を経由する
function openForm() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
  setShowForm(true)
}

// ボタンのonClickには必ずopenForm()を使う
<button onClick={() => openForm()}>条件を追加する</button>
```

**なぜ**: ユーザーがスクロールした状態でフォームを開くと、フォームが画面外やスクロール位置の途中に表示されてUXが壊れる。フォームを開く時点でトップに戻すのが正解（保存後ではなく開く時）。

---

## 🚨 ナビゲーション実装ルール（絶対禁止・2度同じミスをした）

### `/open` vs `/redirect/[id]` の使い分け

| ルート | 用途 | 挙動 |
|--------|------|------|
| `/open?url=...` | **プッシュ通知タップ専用（deeplink interstitial）** | yahuoku:// スキームの「アプリを起動する」ボタンページを表示する |
| `/redirect/[id]` | **アプリ内ナビゲーション専用** | サーバーサイド302リダイレクト（ページ表示なし・即座にYahoo URLへ飛ばす） |

### ❌ 絶対に /open を通知履歴からのナビゲーションに使わない

```typescript
// ❌ NG: deeplink interstitial ページが出てしまう
window.location.href = `/open?url=${encodeURIComponent(yahooUrl)}`

// ✅ OK: window.open(_blank) で SFSafariViewController として開く
window.open(`/redirect/${auctionId}`, '_blank', 'noopener')
```

**なぜ**: `/open` はWKWebView内で「アプリを起動する」ボタンを表示するページ。
アプリ内タップから使うと中間ページが挟まってUXを壊す。

---

## 📱 iOS PWA の Safari アイコンについて（既知の制限）

### Safari アイコンは PWA では消せない（確認済み）

以下のアプローチはすべて試して失敗した。**再度試みないこと。**

| アプローチ | 結果 |
|-----------|------|
| `window.location.href = '/redirect/id'` | SFSafariViewController が開く → Safari アイコン表示 |
| `window.open('_blank')` | 同上 |
| `window.location.href = 'yahuoku://'` | iOS WKWebView がブロック → 「ページを開けません」 |
| `<a href="yahuoku://...">` でユーザータップ | 同上（scheme が WKWebView でブロックされる） |

**結論**: PWA（WKWebView）から外部ドメインを開く場合、Safari アイコンは必ず表示される。これは iOS の OS レベルの UI で、Web コードでは除去不可能。ネイティブアプリラッパー（App Store 申請）が必要。

**現在の実装**: `window.location.href = '/redirect/${auctionId}'` で Yahoo ページを開く（動作確認済み）。Safari アイコンは表示されるが機能は正常。

---

## 📦 スクレイピング取得数最大化ルール（cron/バッチ設計 必須）

ヤフオクのような検索結果が複数ページにわたるサービスでは、**1ページ取得だけでは候補の大半を見落とす**。
cron/バッチ設計時は以下のパターンを必ず採用すること。

### 基本戦略: 常に b=1 から2ページ同時取得（確認済み・動作中）

```typescript
// scraper 内で b=1(1〜50件) + b=51(51〜100件) の2ページを自動取得
// startOffset=1 固定。ページローテーションは使わない（理由↓）
const items = await fetchWithRetry(group.key)  // startOffset デフォルト=1
```

### ❌ 時間ベースのページローテーションは使わない（失敗済み）

```typescript
// ❌ やってはいけない: 多くの検索条件は50〜100件しかなく b=101以降は空
// → 空ページへのリトライ(×3回)が蓄積 → GitHub Actions タイムアウト → 通知全滅
const runGroupIndex = Math.floor(Date.now() / (10 * 60 * 1000)) % 3
const pageStartOffset = runGroupIndex * 100 + 1  // b=101, b=201 が空で詰まる
```

### なぜ2ページ固定が正しいか

- ヤフオクの「終了間近24時間・入札あり」フィルター済み結果は通常50〜150件
- 2ページ（100件）取得で十分カバーできる
- `notifiedIds` の重複排除で2回目以降は新着のみ通知される

### ⚠️ `abuynow=2` 自動適用禁止（2026-04-10 廃止）

**`minBids >= 1` + `buyItNow=null` のとき `abuynow=2`（オークションのみ）を自動適用していたが廃止した。**

理由: `abuynow=2` はYahooサーバー側で「オークション+即決オプション付き出品」も一括除外する。
コーチ等ブランド商品はオークション+即決形式が多く、入札件数条件を設定しても0件になる現象が発生した。

現在の動作: `buyItNow` はユーザーの設定値をそのまま使う。`null`（両方）の場合は `abuynow` パラメータなし。

---

## 🗑️ notified_items クリーンアップ設計ルール（必須）

### オークション終了時は notification_history と notified_items の両方を削除する

```typescript
// ❌ NG: notification_history だけ消してもnotified_itemsが残り続ける
await supabase.from('notification_history').delete().in('id', toDelete)

// ✅ OK: 両方削除する（cleanupEndedAuctions で実施済み）
await supabase.from('notification_history').delete().in('id', historyIds)
for (const { userId, auctionId } of ended) {
  await supabase.from('notified_items').delete()
    .eq('user_id', userId).eq('auction_id', auctionId)
}
```

**なぜ両方消す必要があるか**:
- `notified_items` は重複通知防止ログ。終了済みIDが残り続けると新着も「通知済み」扱いになり通知が止まる
- アプリ削除→再インストール後は新userId生成 → notified_itemsは空からスタートするため問題ない
- 7日TTL（`cleanupOldNotified`）はあくまで安全網。主系はオークション終了検出で即削除する設計が正しい

<!-- CC_CONTEXT_START -->
<!-- cc:session:c15157ba-cd57-4092-b924-93046564c39d:2026-04-11 22:59 -->
**最後の作業** (2026-04-11 22:59)
- 改善できた？
- <task-notification> <task-id>befasve0p</task-id> <tool-use-id>toolu_01Lubua3RMidqa21vZCR5LQ9</tool-…
- <task-notification> <task-id>b6y0sxoue</task-id> <tool-use-id>toolu_01PkrjegJJWX7UHe9yXEkDmX</tool-…
- 編集ファイル: route.ts、multi-device.spec.ts、TROUBLESHOOT.md、playwright.multi-device.config.ts
<!-- CC_CONTEXT_END -->
