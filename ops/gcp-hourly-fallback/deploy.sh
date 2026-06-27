#!/bin/bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?PROJECT_ID is required}"
REGION="${REGION:-asia-northeast1}"
FUNCTION_NAME="${FUNCTION_NAME:-yahoo-auction-hourly-fallback}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-yahoo-auction-fallback@$PROJECT_ID.iam.gserviceaccount.com}"

gcloud functions deploy "$FUNCTION_NAME" \
  --gen2 \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --runtime nodejs22 \
  --source . \
  --entry-point hourlyFallback \
  --trigger-http \
  --no-allow-unauthenticated \
  --service-account "$SERVICE_ACCOUNT" \
  --set-env-vars "GITHUB_REPOSITORY=Otter1102/yahooauction-watch,GITHUB_WORKFLOW_ID=260488766,GITHUB_REF=main,TIME_ZONE=Asia/Tokyo,FALLBACK_AFTER_MINUTE=10" \
  --set-secrets "GITHUB_TOKEN=yahoo-auction-github-token:latest,FALLBACK_SHARED_SECRET=yahoo-auction-fallback-secret:latest"

gcloud functions add-invoker-policy-binding "$FUNCTION_NAME" \
  --gen2 \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --member="serviceAccount:$SERVICE_ACCOUNT"
