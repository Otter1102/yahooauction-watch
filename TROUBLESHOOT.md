## 2026-04-14 — GitHub Actions スタンドアロンリポジトリ化 + Supabase Secret `\n` 混入問題

| 項目 | 内容 |
|------|------|
| **症状** | GitHub Actions で `Invalid API key` エラーが連発（Supabase code=undefined） |
| **根本原因1** | `.env.local` の値末尾に literal `\n`（バックスラッシュ+n、2文字）が混入していた。`NEXT_PUBLIC_SUPABASE_URL` が40文字→42文字、`SUPABASE_SERVICE_KEY` が41文字→43文字 |
| **根本原因2** | Vault内サブディレクトリに置いた `.github/workflows/` は GitHub Actions が実行しない（リポジトリルートの `.github/workflows/` のみ有効） |
| **解決策1** | `Otter1102/yahooauction-watch` にスタンドアロンリポジトリを作成し、ヤフオクwatch一式を移行 |
| **解決策2** | GitHub Secrets 設定時に Python で literal `\n` を除去: `val.strip().replace(r'\n', '').replace(r'\r', '').strip()` |
| **診断方法** | cron.yml にデバッグステップを一時追加: `curl ... /rest/v1/conditions` → `HTTP: 000` なら URL malformed、`HTTP: 401` なら Key 問題 |
| **注意** | `tr -d '\n'` は実改行(0x0A)のみ除去し literal `\n`(0x5C 0x6E)は除去しない → Python を使う |
| **Node.js** | Node 20 → **24** に変更（Vercel の `nodeVersion: "24.x"` に合わせるため） |
| **変更リポジトリ** | `Otter1102/yahooauction-watch`（新規）/ vault-backup は変更なし |

---

## 2026-04-13 — GitHub Actions 30分バッチ化 + Vercel cronクリーンアップ

| 項目 | 内容 |
|------|------|
| **変更内容** | cron実行をVercel cronからGitHub Actionsに完全移行（30分間隔） |
| **vercel.json** | `crons`セクション削除（VercelはUI表示+条件登録のみ担当） |
| **cron.yml** | スケジュール `*/10 * * * *` → `*/30 * * * *` |
| **app/page.tsx** | 「10分」表示を「30分」に更新（stats行・フッターテキスト・startup check debounce） |
| **デプロイ注意** | iCloud Drive上のプロジェクトのため、vercel CLIが.gitを辿りVault全体をスキャンして詰まる。`cp -r`で/tmpにソースコピーしてからデプロイする必要あり |

---

## 2026-04-13 — [coordinator] ユーザー取得失敗 TimeoutError + no-prefix エラー 根本解決

| 項目 | 内容 |
|------|------|
| **症状** | Discord に `[coordinator] ユーザー取得失敗: TimeoutError` が10分ごとに連発。さらに `ユーザー取得失敗`（プレフィックスなし）も 9:07 頃に発生 |
| **根本原因1** | coordinator の `.or('push_sub.not.is.null,...')` クエリが PostgREST で重く、Supabase の20s AbortSignal でタイムアウト |
| **根本原因2** | `/api/cron/check`（フラットルート）が独自に Supabase クエリしていた（プレフィックスなしエラーの発生源） |
| **解決策** | ①coordinator: `.or()` を廃止して `.select('id')` のみ（全件取得・run-now側でフィルター） + リトライ2→3回・指数バックオフ(3s→8s) + **alertAdmin削除**（自己修復型なのでDiscordスパムを廃止） ②`/api/cron/check`: Supabase直接クエリを全廃。coordinator を起動委譲するだけに完全書き換え |
| **変更ファイル** | `app/api/cron/coordinator/route.ts`, `app/api/cron/check/route.ts` |

---

## 2026-04-12 — [shardX] ユーザー取得失敗 TimeoutError 根本解決（Supabase接続8本→1本）

| 項目 | 内容 |
|------|------|
| **症状** | Discord に `[shard0/3/4/5/6/7] ユーザー取得失敗: TimeoutError: The operation was aborted due to timeout` が複数同時発生 |
| **根本原因** | cron-job.org が旧設定のまま shard0〜7 の GET を同時発火 → 8本が同時に Supabase へ接続 → 無料プランの接続プール枯渇 → タイムアウト。コーディネーターパターンに移行済みのはずが、実際には旧設定が残っていた |
| **解決策** | シャードGETハンドラーを変更: shard0 のみ `/api/cron/coordinator` を起動し、shard1-7 は即座にno-opで返す。コーディネーターが全ユーザーを1接続で取得しPOSTでシャードに配布 → Supabase接続は常に1本のみ |
| **cron-job.org 設定変更** | 不要（コードで吸収済み）。既存の 8ジョブ設定のまま動作する |
| **変更ファイル** | `app/api/cron/check/[shard]/route.ts` — GETハンドラーを coordinator トリガー型に変更 |

---

## 2026-04-12 — 終了オークション自動クリーンアップ改善（50件/cron・10並列・重複排除）

| 項目 | 内容 |
|------|------|
| **課題** | ①ソフトチェック（Yahoo終了確認）が20件/cronのみで消化不足 ②`cleanupOldNotified()`と`cleanupEndedAuctions`の25hハードデリートが重複 ③`cleanupOldHistory(72)`が25h即削除と矛盾（実際には25hで消えているのに72hと明記） ④notified_items個別削除が順次実行で遅い |
| **解決** | ①ソフトバッチ 20→**50件/cron**・並列チェック 5→**10並列** ②重複だった`cleanupOldNotified()`と`cleanupOldHistory(72)`の呼び出しを削除 ③ハードカットオフ削除を`Promise.all`で並列化 ④notified_items削除も`Promise.all`で並列化 |
| **変更ファイル** | `app/api/cron/check/[shard]/route.ts` — `cleanupEndedAuctionsFromHistory` → `cleanupEndedAuctions` にリネーム・改良 |
| **動作** | オークション終了を自動検知→即削除。25h超は無確認で削除。notified_itemsの残留による「通知が止まる」バグを根本防止 |

---

## 2026-04-12 — shard3エラー多発 再発 → run-now全ボトルネック同時解消（根本解決）

| 項目 | 内容 |
|------|------|
| **症状** | 前回修正後も Discord「[shard3] エラー多発: 1/1 ユーザーで失敗」が30分ごとに継続発生 |
| **根本原因（複合）** | ①CONDITION_CONCURRENCY=5 → 6バッチ×5s=30s（正常）だが Yahooが遅いと6バッチ×8s=48s ≒ USER_TIMEOUT_MS(50s) でギリギリ ②`sendWebPushToUser` が条件ループ内でアイテムごとに Supabase から push_sub を再取得（N×1s のDB往復が積み重なる） ③`updateCondition` を条件ごとに順次 await（30件×0.5s=15s の直列ブロッキング）→ 合計で USER_TIMEOUT_MS を超えて AbortError → totalErrors++ → アラート発火 |
| **解決策** | ①`CONDITION_CONCURRENCY` 5→**10**（3バッチ×5s=15s。バッチ数半減）②`FETCH_TIMEOUT` 8s→**5s**（遅いYahooを早く諦める）③`RUN_DEADLINE_MS=47_000` 追加（USER_TIMEOUT_MS-3sで処理を必ず打ち切り→確実にレスポンスを返す安全網）④`cachedPushSub`: getUser時に push_sub をキャッシュし、条件ループ内でDB再取得しない⑤`updateConditionQueue`: 全条件をループ後に `Promise.all` で並列実行（~1sに短縮） |
| **新しい時間計算** | fetch: 3バッチ×5s=15s / updateCondition並列: ~1s / push_subキャッシュ: 0 / 合計: ~20s << RUN_DEADLINE_MS(47s) << USER_TIMEOUT_MS(50s) ✅ |
| **変更ファイル** | `lib/scraper.ts` (FETCH_TIMEOUT 5s), `lib/webpush.ts` (cachedSub param), `app/api/run-now/route.ts` (CONDITION_CONCURRENCY=10, RUN_DEADLINE_MS, parallel updateCondition, cachedPushSub) |

---

## 2026-04-12 — shard3エラー多発: 1/1ユーザーで失敗 → タイムアウト根本原因修正

| 項目 | 内容 |
|------|------|
| **症状** | Discord通知「[shard3] エラー多発: 1/1 ユーザーで失敗」が30分ごとに連続発生 |
| **原因** | ①`fetchAuctionRssSimple`(15s)がcronモードでも呼ばれていた: rawCount=0の条件で診断用フェッチが走り1バッチ最悪30s②FETCH_TIMEOUT=15sが長すぎ: 遅いYahooフェッチが詰まると6バッチ×15s=90s >> USER_TIMEOUT_MS(30s)③USER_TIMEOUT_MS=30sが短すぎ: 通常時(2s×6=12s)は問題ないが、Yahooがやや遅い場合(8s×6=48s)でタイムアウト |
| **対策** | ①`run-now/route.ts`: `fetchAuctionRssSimple`をmanualモードのみに制限（cronでは呼ばない）②`lib/scraper.ts`: FETCH_TIMEOUT 15s→8s（遅いYahooを早く諦める）③`app/api/cron/check/[shard]/route.ts`: USER_TIMEOUT_MS 30s→50s（最悪ケース: 6バッチ×8s=48s<50s） |
| **新しい時間計算** | fetchAuctionRssSimple除外 + FETCH_TIMEOUT=8s: 6バッチ×8s=48s < USER_TIMEOUT_MS(50s) ✅ |
| **再発防止** | cronモードで診断用コードを追加しない。USER_TIMEOUT_MSはFETCH_TIMEOUT×ceil(30/CONDITION_CONCURRENCY)+余裕で設定 |

---

## 2026-04-12 — 通知タップ → ヤフオク商品ページへ直接遷移（× で /history に自動復帰）

| 項目 | 内容 |
|------|------|
| **要件** | 通知をタップしたら直接ヤフオク商品ページを開きたい。× を押したらアプリ（/history）に戻りたい |
| **問題点** | ①サービスワーカーから `window.open()` は postMessage経由で呼べないポップアップブロック対象 ②`clients.openWindow()` は外部URLに使えない（同一オリジンのみ）|
| **解決策** | ①`sw.js` `notificationclick`: auctionIdがあれば `postMessage({ type: 'OPEN_AUCTION', auctionId })` を送信。アプリが起動していなければ `/history?openAuction=xxx` でアプリを起動 ②`layout.tsx` script: `OPEN_AUCTION` 受信時に `sessionStorage('yw_return_to', '/history')` + `window.location.href = '/redirect/auctionId'`（user gesture不要）③layout.tsx script: 起動時に `?openAuction` クエリパラメータを検出→300ms後に同じく `/redirect/auctionId` へ遷移 ④既存の `visibilitychange → ywReturnCheck()` が `/history` への自動復帰を担当 |
| **重要な制約** | `window.open()` は postMessage ハンドラでは blocked（user gestureチェーンが断ち切られる）。`window.location.href` はそのような制限なし。これが `/redirect/[id]` を使う理由 |

---

## 2026-04-12 — エラー回復後に通知が止まる → 起動時自動チェック + 自己修復閾値短縮

| 項目 | 内容 |
|------|------|
| **症状** | エラー修正後も通知が再開されない。手動で「通知ログをリセット」を押さないと通知が来なかった |
| **原因** | ①エラー期間中に notified_items が溜まって新着をブロック ②自己修復（resetStalledNotified）の閾値が48h/20件と保守的すぎてエラー回復後もすぐに動かなかった ③アプリ起動時に自動チェックが走っていなかった |
| **対策** | ①`app/page.tsx`: 起動時に `runNow()` をサイレント実行（10分デバウンス付き）→ 取りこぼし通知を即配信 ②`lib/storage.ts`: resetStalledNotified の閾値を「48h/20件」→「6h/5件」に短縮 → エラー回復後6時間以内に自動再開 ③`app/settings/page.tsx`: 「通知ログをリセット」ボタン削除 ④「今すぐ確認」ボタン削除（自動化で不要） ⑤pull-to-refresh（ホーム・履歴画面）でも `runNow()` を実行して取りこぼし即回収 |
| **再発防止** | resetStalledNotified の閾値変更時は「6h/5件」を基準値として維持する。起動時チェックは sessionStorage の `yw_startup_check` キーで重複実行を防ぐ（10分デバウンス） |

---

## 2026-04-12 — iPhone通知タップ後 × で白画面 → visibilitychange強制復帰を実装

| 項目 | 内容 |
|------|------|
| **症状** | 通知タップ → ヤフオクページ表示 → × 押下 → PWAが白画面になる |
| **原因** | `openAuction()` の `window.open` 失敗時フォールバック `window.location.href = url` が WKWebView を外部ドメインに遷移させていた。WKWebView が PWA スコープ外のYahoo URLに移動すると、× 後にアプリが空白状態になる |
| **対策** | ①`history/page.tsx` の `openAuction` から `window.location.href` フォールバックを削除（iOS PWAではユーザータップ起点の `window.open` は必ず成功するため不要）② 外部ページを開く前に `sessionStorage.setItem('yw_return_to', '/history')` をセット ③ `layout.tsx` のインラインスクリプトに `visibilitychange → visible` と `pageshow persisted=true` のハンドラを追加し、フラグがあれば `sw-navigate` イベントで `/history` へ強制ナビゲーション |
| **再発防止** | `openAuction` から `window.location.href = externalUrl` は絶対に使わない。`window.open(_blank)` のみ使用 |

## 2026-04-12 — TimeoutError 再発（shard2/4/5/6/7）+ 白画面 → スタガー増加・エラーハンドリング強化

| 項目 | 内容 |
|------|------|
| **症状** | Discord に `[shard2][4][5][6][7] ユーザー取得失敗: TimeoutError` が再発（9:34）。ユーザーから「画面が真っ白になる」報告も届いた |
| **タイムアウト原因** | 前回の 600ms スタガーでは shard7 でも 4.2s しか遅延せず、8シャードが事実上同時にSupabaseへ接続。Supabase接続プールの枯渇でshard2以降がタイムアウト |
| **白画面原因** | ①`app/page.tsx` の `loadConditions` が `res.ok` チェックなしで `res.json()` を呼んでいた → APIエラー時に例外がスロー ②`init()` 内で JSON parse エラーが起きると `setLoading(false)` が呼ばれず永久ローディング/白画面 ③App Router に `error.tsx` がなくレンダリングエラーが白画面に直結していた |
| **対策** | ①スタガーを `600ms → 1000ms` に増加（shard7 worst case: 7s+20s×2+3s=50s < 60s ✅）②`loadConditions` に `res.ok` チェック + try/catch 追加 ③`init()` の条件取得を try/finally でラップして必ず `setLoading(false)` を実行 ④`app/error.tsx` を新規作成してエラー時に再試行ボタン付き画面を表示 |
| **再発防止** | スタガー計算式: `shard7: 7s + 20s×2 + 3s = 50s < 60s`。変更時は必ず再計算すること |

---

## 2026-04-11 — 全シャードでSupabaseユーザー取得がタイムアウト（再発） → シャードずらし対応

| 項目 | 内容 |
|------|------|
| **症状** | Discord に全shard0〜7 `ユーザー取得失敗: TimeoutError: The operation was aborted due to timeout` が10分ごとに届く。cronジョブ自体は200で成功している |
| **原因** | ①8シャードが同時起動しSupabaseへの接続が集中 ②3回リトライ（20秒×3回 + 2秒×2間隔 = 64秒）がVercelの`maxDuration: 60秒`を超え、`waitUntil`内が強制終了 → `AbortSignal`がタイムアウトエラーを発火 |
| **対策** | `runShardJob`冒頭に`shard × 600ms`の起動ずらしを追加。リトライを3回→2回に削減（合計最大47.2秒 < 60秒）。リトライ間隔を2秒→3秒に延長 |
| **E2Eテスト結果** | スマホ10台（iPhone 12/13/14/15、Pixel 5/6/7、Galaxy S5/S8/S9+）100テスト中97 passed。失敗3件は`run-now`のコールドスタート時タイムアウト（flaky・本質的問題ではない） |
| **再発防止** | 60秒制限の計算式: `shard×0.6s + 20s×2 + 3s = 47.2s < 60s`。リトライ回数を変更するときは必ずこの計算を確認すること |

---

## 2026-04-11（旧） — 全シャードでSupabaseユーザー取得がタイムアウト → 通知全停止

| 項目 | 内容 |
|------|------|
| **症状** | Discord に全シャード `ユーザー取得失敗: TimeoutError` が連続で届き、全ユーザーへの通知が止まった |
| **原因** | 8シャードが数分以内に同時起動し、Supabase REST API への接続が混雑。`AbortSignal.timeout(30_000)` が全シャードで発火してユーザー取得に失敗した |
| **対策** | ①`lib/supabase.ts` のグローバルタイムアウトを 30s → 20s に短縮（リトライ込みの合計時間を60s以内に収めるため）②`runShardJob` にリトライ処理を追加: 最大3回 × 2s間隔。1回目が失敗してもSupabaseが「起動済み」になるので2回目は高速成功する |
| **解決した理由** | 20s(失敗) + 2s(待機) + <1s(成功) = 約23s でユーザー取得完了 → 残り37sで処理可能。以前は30s×1回=失敗でそのまま終了していた |
| **再発防止** | Discord アラートで即検知できる体制は維持。1回の失敗でアラートを送らず3回試行後に送信するよう変更したので誤報も減る |

---

## 2026-04-11 — minBids フィルターが全件除外していた（data-auction-bids 属性の消失）

| 項目 | 内容 |
|------|------|
| **症状** | `minBids >= 1` を設定したユーザーに通知が0件になる。E2Eテストで確認済み |
| **原因** | Yahoo Auctions が HTML から `data-auction-bids` 属性を削除した。さらに `data-auction-startprice` が常に `data-auction-price` と同値になっており、旧フォールバック（価格比較）も機能しなかった。結果、全商品が `bids=0` と判定され `minBids>0` フィルターで全件除外された |
| **対策** | `lib/scraper.ts` の `parseItem` を修正。入札件数検出の優先順位を変更: ①ショッピング商品→0 ②`class="Item__bid"` セクション内の `<span class="Item__text">N</span>` テキストをパース（現行Yahoo HTML構造）③data-auction-bids属性（旧構造フォールバック）④価格比較（旧フォールバック） |
| **解決した理由** | Yahoo現行HTMLは `<div class="Item__bid"><span class="Item__label">入札</span><span class="Item__text">5</span>` 構造で入札数を表示しており、この方法で正確な件数が取得できる。E2Eテストで `bids=null` が0件になったことを確認 |
| **再発防止** | Yahoo HTML構造が変更されても `Item__bid` クラスがある限り動作する。将来の構造変更は定期E2Eで検知する |

---

## 2026-04-10 — APIエラーメッセージからサーバー内部情報が漏洩していた

| 項目 | 内容 |
|------|------|
| **症状** | `catch (e)` ブロックで `{ error: String(e) }` を返していたため、スタックトレースやDB接続文字列が外部に露出しうる状態だった |
| **原因** | エラーハンドリングで汎用化せずそのまま `String(e)` を返していた。加えて signup 時に `err.message` をそのまま表示していた |
| **対策** | 全APIルートの catch を `{ error: 'Internal Server Error' }` に統一。ログは `console.error` でサーバー側のみに残す。`login/page.tsx` のsignupエラーも汎用メッセージに変更 |
| **解決した理由** | クライアントには最小限の情報しか返らず、内部エラー詳細はVercelログにのみ記録される |
| **再発防止** | API Route の catch は必ず `{ error: 'Internal Server Error' }` + `console.error` の組み合わせで実装する |

---

## 2026-04-10 — `select('*')` で不要なカラムを返していた

| 項目 | 内容 |
|------|------|
| **症状** | `/api/run-now` の `getUser` で `select('*')` を使用しており、将来カラム追加時に意図しないデータが返る可能性があった |
| **原因** | 明示的カラム指定をせずにワイルドカードで取得していた |
| **対策** | `select('id, ntfy_topic, discord_webhook, notification_channel, push_sub')` に変更 |
| **解決した理由** | 必要なカラムのみ取得するため、不要なデータ露出リスクが排除される |
| **再発防止** | 新しい DB クエリは必ず明示的カラム指定で書く。`select('*')` は禁止 |

---

## 2026-04-09 — scraper.ts が空になり入札数・価格パースが全滅

| 項目 | 内容 |
|------|------|
| **症状** | ①minBids=1設定なのに0件入札の商品が通知される ②通知の価格が全て同じ値（例: ¥3,000）になる |
| **原因** | 前回セッションで `lib/scraper.ts` が0バイトに空化された。Vercelデプロイ済みの旧バージョンで ① bids regex が誤マッチして巨大な数値（IDや価格）を返し minBids フィルターを無効化 ② price regex が URL パラメータ `aucmaxprice=3000` を誤マッチ |
| **対策** | `lib/scraper.ts` を完全再構築。`data-auction-price=["'](\d+)["']` で完全マッチ（URLパラメータ混同防止）。bids は `data-auction-bids` 属性優先 + `入札N件` テキスト（最大3桁制限で誤マッチ防止）のフォールバック |
| **解決した理由** | 正規表現を厳密化したことで URLパラメータや他の数値との誤マッチが排除された |
| **再発防止** | bids regex のキャプチャは最大3桁（`\d{1,3}`）に制限。`data-auction-price` の前後を `["']..["']` で囲んで完全マッチ必須 |

---

## 2026-04-09 — Supabase RLS 追加（セキュリティ強化）

| 項目 | 内容 |
|------|------|
| **症状** | anon キーで直接 Supabase にアクセスすれば全ユーザーデータを読み書きできる状態だった |
| **原因** | RLS（Row Level Security）が無効だった |
| **対策** | `migration_007.sql` を実行して全テーブルの RLS を有効化。anon キーによる全アクセスを拒否。サービスロールキーはRLSをバイパスするためAPIの動作は変わらない |
| **解決した理由** | サービスロールキー（サーバーサイドのみ）は影響を受けず、anon キーによる直接アクセスだけをブロック |
| **再発防止** | 新しいテーブルを追加する際は必ず RLS を有効化してから anon deny ポリシーを設定する |

---

## 2026-04-05 — 50ユーザー中半数しか通知が届かない（Vercelタイムアウト）

| 項目 | 内容 |
|------|------|
| **症状** | cron実行後、約10〜20ユーザーしか通知を受信しない。残りのユーザーは通知ゼロ |
| **原因** | `CONCURRENCY=10, USER_TIMEOUT_MS=55_000` の設定で、5バッチ×55秒=275秒 >> Vercel Hobby 60秒制限。waitUntil バックグラウンドも60秒で強制打ち切り |
| **対策** | `CONCURRENCY=25, USER_TIMEOUT_MS=20_000` に変更。2バッチ×20秒=40秒 < 60秒制限でOK |
| **解決した理由** | 全50ユーザーが2バッチで処理完了し、60秒以内に終わるようになった |
| **再発防止** | 今後ユーザー数が増えた場合: ユーザー数/CONCURRENCY×USER_TIMEOUT_MS が60秒を超えないように設計する |

---

## 2026-04-05 — notified_items 蓄積で新着通知が永続的にブロックされる

| 項目 | 内容 |
|------|------|
| **症状** | 一定期間後に通知が届かなくなる。リセットボタンを押すと復活する |
| **原因** | `cleanupOldNotified` のTTLが7日だったため、終了済みオークションのIDが7日間残り続けた。オークションIDが再利用された場合に「通知済み」と誤判定される |
| **対策** | TTLを7日→25時間に短縮。根拠: 通知対象は「残り24時間以内」のオークションのみなので、25時間後には必ず終了済み |
| **解決した理由** | 不要なIDが25時間後に自動削除されるようになり、新着が正しく「未通知」と判定される |
| **再発防止** | `cleanupOldNotified` のcutoffは常に「通知対象フィルターの上限+1時間」に設定する |

---

## 2026-04-05 — 自己修復：48時間通知なし + notified_items 溜まりユーザーの自動検知

| 項目 | 内容 |
|------|------|
| **症状** | 何らかの原因でnotified_itemsが異常蓄積し、特定ユーザーだけ通知がブロックされ続ける |
| **原因** | 個別ユーザーの通知ブロック状態は全体cronログには現れないため、気づかない |
| **対策** | `resetStalledNotified()` を毎cronで実行。「48時間通知なし AND notified_items 20件以上」のユーザーを自動検出 → notified_items を強制リセット |
| **解決した理由** | 次のcron実行時に対象ユーザーのnotified_itemsが空になり、通知が再開される |
| **再発防止** | `[cron] 自己修復: N ユーザーの通知ログをリセット` というログが出たら要注意。根本原因を調査すること |

---

## 2026-04-05 — Vercel env var に改行が混入してトライアルモードが無効になった

| 項目 | 内容 |
|------|------|
| **症状** | `NEXT_PUBLIC_TRIAL_MODE=true` を設定したのに、ヤフオク連携が非表示にならず、赤バナーも出ない |
| **原因** | `echo "true" \| vercel env add ...` で登録すると末尾に改行(`\n`)が付き、値が `"true\n"` になる。`=== 'true'` が常に `false` になる |
| **対策** | `printf "true" \| vercel env add NEXT_PUBLIC_TRIAL_MODE production` で再登録。`printf` は末尾改行を付けない |
| **解決した理由** | env var の値が正確に `"true"` になり、ビルド時に `NEXT_PUBLIC_TRIAL_MODE === 'true'` が正しく評価された |
| **再発防止** | Vercel env var の登録は **必ず `printf "値" \| vercel env add`** を使う。`echo` は絶対使わない |

---

## 2026-04-05 — 自動チェックが動いているのに通知が来なくなった

| 項目 | 内容 |
|------|------|
| **症状** | cron-job.org は10分毎に200 OKで正常稼働。テスト通知は届く。しかし実際のオークション通知が来なくなった |
| **原因** | `/api/cron/check` → `/api/run-now` のAPIフローに `cleanupEndedAuctions` 等のクリーンアップ処理が含まれていなかった。そのため `notified_items` テーブルに通知済みIDが蓄積し続け、全検索結果が「通知済み」扱いになって新規通知がゼロになった |
| **対策** | `app/api/cron/check/route.ts` の `processUsers()` 末尾にクリーンアップ処理を追加: `cleanupOldNotified()`（7日以上古いレコード削除）・`cleanupOldHistory(72)`（72h超の履歴削除）・`cleanupEndedAuctionsFromHistory()`（終了済みオークションを即削除） |
| **解決した理由** | cron実行のたびに蓄積した通知済みIDが定期的に掃除されるようになったため、新着オークションが「未通知」として正しく検出されるようになった |
| **再発防止** | 設定画面に「通知ログをリセット」ボタンを追加（`/api/reset-notified` を呼ぶ）。通知が来なくなった場合にユーザーが自己解決できる |

---
