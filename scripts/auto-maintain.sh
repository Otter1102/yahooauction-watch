#!/bin/bash
# ============================================================
# auto-maintain.sh — Yahoo Auction Watcher 自動メンテナンス
# 3エージェント構成:
#   Agent1: health-check.ts (スクリプト点検)
#   Agent2: Ollama qwen2.5:7b (LLM診断)
#   Agent3: claude -p (LLM修正)
#
# 実行: bash scripts/auto-maintain.sh
# launchd 経由で毎日自動実行
# ============================================================
set -euo pipefail

APP_DIR="/Users/sawadaakira/Projects/MOTHERSHIP/apps/yahoo-auction-watcher"
LOG_DIR="/Users/sawadaakira/Projects/MOTHERSHIP/apps/yahoo-auction-watcher/logs"
LOG_FILE="$LOG_DIR/maintain-$(date +%Y%m%d-%H%M%S).log"
HEALTH_REPORT="/tmp/yaw-health-report.json"
OLLAMA_DIAGNOSIS="/tmp/yaw-ollama-diagnosis.txt"
DISCORD_WEBHOOK="${DISCORD_ADMIN_WEBHOOK:-}"

mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

notify_discord() {
  local message="$1"
  local color="${2:-16711680}"  # 赤=問題, 65280=緑=正常
  if [ -z "$DISCORD_WEBHOOK" ]; then
    log "⚠️ DISCORD_WEBHOOK 未設定 — Discord通知スキップ"
    return
  fi
  curl -s -X POST "$DISCORD_WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "{\"embeds\":[{\"title\":\"🔧 YAW Auto-Maintain\",\"description\":$(echo "$message" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\"color\":$color}]}" \
    > /dev/null 2>&1 || true
}

# ──────────────────────────────────────────────────────────
# ロード: .env.local
# ──────────────────────────────────────────────────────────
if [ -f "$APP_DIR/.env.local" ]; then
  set -a; source "$APP_DIR/.env.local"; set +a
fi
export DISCORD_WEBHOOK="${DISCORD_ADMIN_WEBHOOK:-}"

log "======================================================"
log " Yahoo Auction Watcher 自動メンテナンス 開始"
log "======================================================"

cd "$APP_DIR"

# ──────────────────────────────────────────────────────────
# Agent 1: スクリプト点検 (health-check.ts)
# ──────────────────────────────────────────────────────────
log ""
log "▶ [Agent1] スクリプト点検 実行中..."

node --env-file=.env.local -r tsx/cjs scripts/health-check.ts > "$HEALTH_REPORT" 2>>"$LOG_FILE" || true

HEALTHY=$(cat "$HEALTH_REPORT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["healthy"])' 2>/dev/null || echo "False")
ISSUES_COUNT=$(cat "$HEALTH_REPORT" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["issues"]))' 2>/dev/null || echo "99")
REPORT_TEXT=$(cat "$HEALTH_REPORT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["report"])' 2>/dev/null || echo "取得失敗")
FIXES_JSON=$(cat "$HEALTH_REPORT" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["fixes"]))' 2>/dev/null || echo "[]")

log "Agent1 結果: healthy=$HEALTHY, issues=$ISSUES_COUNT件"
log "$REPORT_TEXT"

if [ "$HEALTHY" = "True" ]; then
  log "✅ 正常確認。メンテナンス不要。"
  notify_discord "$(echo "$REPORT_TEXT" | head -10)" "65280"
  exit 0
fi

log ""
log "🚨 異常検出: $ISSUES_COUNT 件の問題"

# ──────────────────────────────────────────────────────────
# 自動修正: 既知パターン (LLM不要)
# ──────────────────────────────────────────────────────────
AUTO_FIXED=0

# パターン1: ワークフロー無効化
if echo "$FIXES_JSON" | grep -q "gh workflow enable"; then
  log ""
  log "🔧 自動修正: ワークフロー有効化"
  ENABLE_CMD=$(echo "$FIXES_JSON" | python3 -c 'import json,sys; cmds=json.load(sys.stdin); print([c for c in cmds if "gh workflow enable" in c][0])' 2>/dev/null || true)
  if [ -n "$ENABLE_CMD" ]; then
    eval "$ENABLE_CMD" >> "$LOG_FILE" 2>&1 && log "✅ ワークフロー有効化 完了" && AUTO_FIXED=1
  fi
fi

# パターン2: notified_items 蓄積 → リセット
if echo "$FIXES_JSON" | grep -q "RUN_RESET"; then
  log ""
  log "🔧 自動修正: notified_items リセット"
  node --env-file=.env.local -r tsx/cjs scripts/reset-notified.ts >> "$LOG_FILE" 2>&1 && log "✅ リセット 完了" && AUTO_FIXED=1
fi

# パターン3: ワークフロー停止中 → 手動起動
if echo "$FIXES_JSON" | grep -q "gh workflow run"; then
  log ""
  log "🔧 自動修正: ワークフロー手動起動"
  gh workflow run 260488766 --repo Otter1102/yahooauction-watch >> "$LOG_FILE" 2>&1 && log "✅ ワークフロー起動 完了" && AUTO_FIXED=1
fi

# ──────────────────────────────────────────────────────────
# Agent 2: Ollama LLM 診断 (コードバグ等の複雑な問題)
# ──────────────────────────────────────────────────────────
REMAINING_ISSUES=$(cat "$HEALTH_REPORT" | python3 -c '
import json,sys
data = json.load(sys.stdin)
# 自動修正済みパターンを除外
remaining = [i for i in data["issues"] if not any(skip in i for skip in ["WORKFLOW_DISABLED","NOTIFIED_ITEMS_OVERFLOW","RUN_STALE"])]
print(json.dumps(remaining))
' 2>/dev/null || echo "[]")

REMAINING_COUNT=$(echo "$REMAINING_ISSUES" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null || echo "0")

if [ "$REMAINING_COUNT" -gt 0 ]; then
  log ""
  log "▶ [Agent2] Ollama LLM 診断 実行中... (残存問題: $REMAINING_COUNT 件)"

  OLLAMA_PROMPT="あなたはYahoo Auction Watcherアプリの保守エンジニアです。
以下の健全性レポートを読み、根本原因と修正方針を日本語で答えてください。
修正に必要なファイルパスとコード変更の方向性を具体的に教えてください。

【健全性レポート】
$REPORT_TEXT

【残存問題】
$REMAINING_ISSUES

【アプリ概要】
- Next.js + Supabase + GitHub Actions + Web Push通知
- 主要ファイル: scripts/run-check.ts, lib/webpush.ts, lib/storage.ts
- GitHub: https://github.com/Otter1102/yahooauction-watch

修正方針を端的に答えてください:"

  echo "$OLLAMA_PROMPT" | ollama run qwen2.5:7b --nowordwrap 2>/dev/null > "$OLLAMA_DIAGNOSIS" || \
    echo "Ollama診断失敗 — モデルが応答しませんでした" > "$OLLAMA_DIAGNOSIS"

  OLLAMA_RESULT=$(cat "$OLLAMA_DIAGNOSIS")
  log ""
  log "Agent2 (Ollama) 診断結果:"
  log "$OLLAMA_RESULT"

  # ──────────────────────────────────────────────────────────
  # Agent 3: Claude Code LLM 修正
  # ──────────────────────────────────────────────────────────
  log ""
  log "▶ [Agent3] Claude Code LLM 修正 実行中..."

  CLAUDE_PROMPT="Yahoo Auction Watcherアプリに問題が検出されました。
以下の診断結果を元に、コードを修正してGitHubにプッシュしてください。

【健全性レポート】
$REPORT_TEXT

【Ollama診断】
$OLLAMA_RESULT

【作業ディレクトリ】
$APP_DIR

【手順】
1. 問題のあるファイルを確認する
2. 修正を適用する
3. ローカルでスクリプトをテスト実行して動作確認する
4. /tmp/yaw-fix リポジトリにプッシュする:
   cd /tmp/yaw-fix && git clone https://github.com/Otter1102/yahooauction-watch.git . 2>/dev/null || git pull
   (該当ファイルをコピーして修正)
   git add . && git commit -m 'fix: 自動メンテナンスによる修正' && git push origin main"

  claude --print \
    --allowedTools "Bash,Read,Edit,Write,Glob,Grep" \
    -p "$CLAUDE_PROMPT" 2>>"$LOG_FILE" | tee -a "$LOG_FILE" || log "⚠️ Claude修正 失敗または警告あり"

  log ""
  log "Agent3 (Claude) 修正完了"
fi

# ──────────────────────────────────────────────────────────
# 最終レポート → Discord
# ──────────────────────────────────────────────────────────
FINAL_MSG="🚨 問題検出・自動修正実行
$REPORT_TEXT

$([ -f "$OLLAMA_DIAGNOSIS" ] && echo "【Ollama診断】$(head -5 $OLLAMA_DIAGNOSIS)" || echo "")

ログ: $LOG_FILE"

notify_discord "$FINAL_MSG" "16744272"  # オレンジ

log ""
log "======================================================"
log " 自動メンテナンス 完了"
log "======================================================"
