#!/bin/bash
# Dispatch Yahoo Auction Watcher GitHub Actions when scheduled runs are stale.
set -euo pipefail

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
REPO="Otter1102/yahooauction-watch"
WORKFLOW_ID="260488766"
LOG_DIR="/Users/sawadaakira/Projects/MOTHERSHIP/apps/yahoo-auction-watcher/logs"
LOG_FILE="$LOG_DIR/dispatch-check.log"
STALE_SECONDS=3000

mkdir -p "$LOG_DIR"

log() {
  echo "[$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S JST')] $*" >> "$LOG_FILE"
}

hour="$(TZ=Asia/Tokyo date '+%H')"
hour_num=$((10#$hour))
if [ "$hour_num" -ge 1 ] && [ "$hour_num" -le 6 ]; then
  log "skip quiet hour: $hour"
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  log "gh command not found"
  exit 1
fi

in_progress="$(gh run list --repo "$REPO" --limit 10 --json status \
  --jq '[.[] | select(.status == "queued" or .status == "in_progress")] | length' 2>>"$LOG_FILE" || echo "0")"
if [ "${in_progress:-0}" -gt 0 ]; then
  log "skip: workflow already queued/in_progress ($in_progress)"
  exit 0
fi

latest_created="$(gh run list --repo "$REPO" --workflow "$WORKFLOW_ID" --limit 1 --json createdAt \
  --jq '.[0].createdAt // empty' 2>>"$LOG_FILE" || true)"

now_epoch="$(date +%s)"
if [ -n "$latest_created" ]; then
  latest_epoch="$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$latest_created" "+%s" 2>/dev/null || echo 0)"
  age=$((now_epoch - latest_epoch))
  if [ "$latest_epoch" -gt 0 ] && [ "$age" -lt "$STALE_SECONDS" ]; then
    log "skip: latest run age ${age}s < ${STALE_SECONDS}s ($latest_created)"
    exit 0
  fi
fi

log "dispatch workflow: latest=${latest_created:-none}"
gh workflow run "$WORKFLOW_ID" \
  --repo "$REPO" \
  -f force_check_complete=false \
  -f stamp_last_checked_only=false >> "$LOG_FILE" 2>&1
log "dispatch requested"
