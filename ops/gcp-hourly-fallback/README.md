# Google Cloud hourly fallback

Yahoo Auction Watcher の通知保険を Mac mini から Google Cloud へ移すための Cloud Run functions 実装。

## 役割

- Cloud Scheduler が JST `0,7-23` 時台の `10,25,40,55` 分にHTTP関数を呼ぶ
- 関数は GitHub Actions `cron.yml` のrun一覧を確認
- 同じJST時間帯にrunが既にあれば何もしない
- queued / in_progress のrunがあれば何もしない
- 同じJST時間帯のrunが無ければ `workflow_dispatch` でGitHub Actionsを起動
- 通知の重複は `scripts/run-check.ts` 側の `__notification_hour_YYYY-MM-DDTHH` マーカーで止める

## 必要なSecret

Secret Managerに以下を登録する。

```bash
printf '%s' '<GitHub fine-grained token>' | gcloud secrets create yahoo-auction-github-token \
  --project "$PROJECT_ID" \
  --replication-policy automatic \
  --data-file=-

openssl rand -hex 32 | gcloud secrets create yahoo-auction-fallback-secret \
  --project "$PROJECT_ID" \
  --replication-policy automatic \
  --data-file=-
```

GitHub token は `Otter1102/yahooauction-watch` に対して Actions workflow dispatch ができる権限を付ける。

## 初回セットアップ

```bash
export PROJECT_ID='<gcp-project-id>'
export REGION='asia-northeast1'

gcloud services enable cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com --project "$PROJECT_ID"

gcloud iam service-accounts create yahoo-auction-fallback \
  --project "$PROJECT_ID" \
  --display-name 'Yahoo Auction fallback dispatcher'

gcloud secrets add-iam-policy-binding yahoo-auction-github-token \
  --project "$PROJECT_ID" \
  --member "serviceAccount:yahoo-auction-fallback@$PROJECT_ID.iam.gserviceaccount.com" \
  --role roles/secretmanager.secretAccessor

gcloud secrets add-iam-policy-binding yahoo-auction-fallback-secret \
  --project "$PROJECT_ID" \
  --member "serviceAccount:yahoo-auction-fallback@$PROJECT_ID.iam.gserviceaccount.com" \
  --role roles/secretmanager.secretAccessor

cd apps/yahoo-auction-watcher/ops/gcp-hourly-fallback
npm install
npm test
./deploy.sh
./create-scheduler.sh
```

`deploy.sh` は関数デプロイ後に、Cloud Schedulerが使うサービスアカウントへ関数呼び出し権限も付与する。

## 動作確認

```bash
gcloud scheduler jobs run yahoo-auction-hourly-fallback \
  --project "$PROJECT_ID" \
  --location "$REGION"

gh run list --repo Otter1102/yahooauction-watch --workflow cron.yml --limit 5
```

## Mac miniを外す場合

Cloud Scheduler側が安定したら、Mac miniのLaunchAgentは停止できる。

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.yahoo-auction-watcher.dispatch-check.plist
```

Mac mini保険を残す場合も、Cloud側と同じく「同じJST時間帯にrunが無い時だけ」起動するため、通知はDBマーカーで1時間1回に収まる。
