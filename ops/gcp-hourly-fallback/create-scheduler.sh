#!/bin/bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?PROJECT_ID is required}"
REGION="${REGION:-asia-northeast1}"
FUNCTION_NAME="${FUNCTION_NAME:-yahoo-auction-hourly-fallback}"
JOB_NAME="${JOB_NAME:-yahoo-auction-hourly-fallback}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-yahoo-auction-fallback@$PROJECT_ID.iam.gserviceaccount.com}"
SCHEDULE="${SCHEDULE:-10,25,40,55 0,7-23 * * *}"

FUNCTION_URL="$(gcloud functions describe "$FUNCTION_NAME" \
  --gen2 \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(serviceConfig.uri)')"

SECRET_HEADER="x-fallback-secret=$(gcloud secrets versions access latest --project "$PROJECT_ID" --secret yahoo-auction-fallback-secret)"

if gcloud scheduler jobs describe "$JOB_NAME" --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$JOB_NAME" \
    --project "$PROJECT_ID" \
    --location "$REGION" \
    --schedule "$SCHEDULE" \
    --time-zone "Asia/Tokyo" \
    --uri "$FUNCTION_URL" \
    --http-method POST \
    --oidc-service-account-email "$SERVICE_ACCOUNT" \
    --headers "$SECRET_HEADER"
else
  gcloud scheduler jobs create http "$JOB_NAME" \
    --project "$PROJECT_ID" \
    --location "$REGION" \
    --schedule "$SCHEDULE" \
    --time-zone "Asia/Tokyo" \
    --uri "$FUNCTION_URL" \
    --http-method POST \
    --oidc-service-account-email "$SERVICE_ACCOUNT" \
    --headers "$SECRET_HEADER"
fi
