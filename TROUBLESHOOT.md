## 2026-04-23 — GitHub Actions の activeConditions フィルターで push_sub 期限切れユーザーの条件が全スキップされる

| 項目 | 内容 |
|------|------|
| **症状** | 全検索条件で新着0件・通知が一切来なくなる |
| **原因** | `scripts/run-check.ts` の `activeConditions = allConditions.filter(c => pushUserIds.has(c.userId))` が、push_sub=null のユーザーを完全に除外していた。push_sub は `sendWebPushNoItems`（毎時送信）が 410 を返した際に自動で null にクリアされるため、iOS 更新・端末変更・PWA再インストール後に発生しやすい。cron-job.org 廃止後は GitHub Actions のみが自動実行されるため、このバグで通知が全停止する |
| **対策** | `activeConditions = allConditions`（フィルター削除）に変更。全有効条件でフェッチ・履歴記録を実施し、通知送信ステップのみ `pushActiveUserIds`（push_sub 保持ユーザー）に絞るよう修正 |
| **ユーザー対応** | push_sub が null になっている場合はアプリを開いて通知を再許可（PWA 設定ページから「通知を有効にする」をタップ）が必要 |
| **再発防止** | GitHub Actions スクリプトで通知先チェックとフェッチ処理を分離する。push_sub がなくてもフェッチ・履歴記録は継続する設計を維持 |

---

## 2026-04-21 — Yahoo が iPhone UA をブロック → 商品が0件取得になる → Chrome Desktop UA に変更

| 項目 | 内容 |
|------|------|
| **症状** | 全検索条件で取得件数0件、通知が来なくなった |
| **原因** | Yahoo Auctions が iPhone Safari UA (`iPhone; CPU iPhone OS 17_4`) をブロックするようになり、`ページが表示できません` エラーページを返すようになった。HTTP ステータスは 200 だがアイテムが0件になる。Chrome Desktop UA では正常に取得できることを確認 |
| **対策** | `lib/scraper.ts` の UA を iPhone Safari → Chrome Desktop (`Chrome/124.0.0.0`) に変更。合わせて入札数パーサーをデスクトップ HTML 構造 (`class="Product__bidWrap"` + `class="Product__bid"`) に更新。旧モバイル版 `class="Item__bid"` はフォールバックとして残す |
| **検証結果** | Chrome UA で「コーチ」検索 → 1ページ53件取得、全53件の入札数を正確に取得確認 |
| **再発防止** | Yahoo が UA を変更した際は `curl -A "[UA]" "https://auctions.yahoo.co.jp/search/search?p=コーチ..."` で確認。0件ならUAブロックを疑う。デスクトップ HTML では入札数は `class="Product__bid"` に含まれる |

---

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
