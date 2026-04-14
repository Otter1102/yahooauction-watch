#!/usr/bin/env python3
"""
ヤフオクwatch エラー自動監視・修復スクリプト
Discord チャンネルを60秒ごとにポーリングし、Ollama でエラーを分析して自動修復する

必要な環境変数（.env に記載）:
  DISCORD_BOT_TOKEN   Discord Bot トークン
  DISCORD_CHANNEL_ID  監視するチャンネルID
  YAHOOWATCH_DIR      ヤフオクwatch-appのパス（vercel コマンド実行用）

起動方法:
  python3 monitor.py
  または launchd で自動起動（com.yahoowatch.monitor.plist を ~/Library/LaunchAgents/ にコピー）
"""

from __future__ import annotations
import os, json, time, subprocess, requests
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

# .env 読み込み
load_dotenv(Path(__file__).parent / ".env")

DISCORD_BOT_TOKEN = os.environ["DISCORD_BOT_TOKEN"]
DISCORD_CHANNEL_ID = os.environ["DISCORD_CHANNEL_ID"]
OLLAMA_URL        = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL      = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
YAHOOWATCH_DIR    = os.environ.get(
    "YAHOOWATCH_DIR",
    str(Path(__file__).parent.parent)
)

LAST_ID_FILE   = Path(__file__).parent / ".last_message_id"
POLL_INTERVAL  = 60   # 秒
LOG_FILE       = Path(__file__).parent / "monitor.log"

# ── ログ ─────────────────────────────────────────────────────────────────────
def log(msg: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")

# ── Discord 操作 ──────────────────────────────────────────────────────────────
def _discord_headers() -> dict:
    return {"Authorization": f"Bot {DISCORD_BOT_TOKEN}"}

def fetch_new_error_messages() -> list[dict]:
    """前回取得以降の 🚨 エラーメッセージを取得"""
    last_id = LAST_ID_FILE.read_text().strip() if LAST_ID_FILE.exists() else None
    params  = {"limit": 20}
    if last_id:
        params["after"] = last_id

    resp = requests.get(
        f"https://discord.com/api/v10/channels/{DISCORD_CHANNEL_ID}/messages",
        headers=_discord_headers(),
        params=params,
        timeout=10
    )
    resp.raise_for_status()

    messages = sorted(resp.json(), key=lambda m: int(m["id"]))
    if messages:
        LAST_ID_FILE.write_text(messages[-1]["id"])

    return [m for m in messages if "🚨" in m.get("content", "")]

def send_discord(content: str):
    """Discord チャンネルにメッセージを送信"""
    try:
        requests.post(
            f"https://discord.com/api/v10/channels/{DISCORD_CHANNEL_ID}/messages",
            headers={**_discord_headers(), "Content-Type": "application/json"},
            json={"content": content},
            timeout=10
        )
    except Exception as e:
        log(f"Discord送信失敗: {e}")

# ── Ollama 分析 ───────────────────────────────────────────────────────────────
ANALYZE_PROMPT = """\
あなたはサーバーエラーの自動修復エンジンです。
以下のヤフオクwatch エラーを分析して、最適な修復アクションをJSONで返してください。

【エラーメッセージ】
{error}

【対応アクション一覧】
- "wait"     : 一時的な障害（Supabase瞬断・タイムアウト）。待てば自然回復する
- "redeploy" : デプロイを再実行すれば直る可能性が高い（コールドスタート障害・関数クラッシュ）
- "notify"   : 原因不明。ユーザーに手動調査を依頼する

【重要】JSONのみ返すこと（マークダウン禁止、説明文禁止）
{{"action": "アクション名", "reason": "判断理由（日本語30字以内）", "severity": "low/medium/high"}}
"""

def analyze_with_ollama(error_msg: str) -> dict:
    resp = requests.post(
        f"{OLLAMA_URL}/api/generate",
        json={
            "model": OLLAMA_MODEL,
            "prompt": ANALYZE_PROMPT.format(error=error_msg),
            "stream": False,
            "options": {"temperature": 0.1}  # 安定した判断のため低温
        },
        timeout=60
    )
    resp.raise_for_status()
    raw = resp.json()["response"].strip()
    # ```json ... ``` の除去
    raw = raw.replace("```json", "").replace("```", "").strip()
    # 最初の { から最後の } までを抽出
    start = raw.find("{")
    end   = raw.rfind("}") + 1
    if start >= 0 and end > start:
        raw = raw[start:end]
    return json.loads(raw)

# ── 修復アクション ─────────────────────────────────────────────────────────────
def do_redeploy() -> str:
    """vercel --prod を実行して再デプロイ"""
    try:
        result = subprocess.run(
            ["vercel", "--prod", "--yes"],
            cwd=YAHOOWATCH_DIR,
            capture_output=True,
            text=True,
            timeout=120
        )
        if result.returncode == 0:
            return "✅ 再デプロイ成功"
        else:
            return f"❌ 再デプロイ失敗: {result.stderr[:200]}"
    except subprocess.TimeoutExpired:
        return "❌ 再デプロイタイムアウト（120秒）"
    except Exception as e:
        return f"❌ 再デプロイエラー: {e}"

# ── メインループ ───────────────────────────────────────────────────────────────
def handle_error(msg: dict):
    content = msg["content"]
    log(f"エラー検出: {content[:120]}")

    # Ollama で分析
    try:
        analysis = analyze_with_ollama(content)
        action   = analysis.get("action", "notify")
        reason   = analysis.get("reason", "")
        severity = analysis.get("severity", "medium")
        log(f"分析結果: action={action} severity={severity} reason={reason}")
    except Exception as e:
        log(f"Ollama分析失敗: {e}")
        action, reason, severity = "notify", f"Ollama分析エラー: {e}", "medium"

    # アクション実行
    if action == "wait":
        reply = f"🤖 **自動分析** `{severity}`\n{reason}\n一時的なエラーです。次のcronで自然回復します。"
        send_discord(reply)
        log("対応: 待機（一時エラー）")

    elif action == "redeploy":
        send_discord(f"🔄 **自動修復開始** `{severity}`\n{reason}\nVercelに再デプロイします...")
        result_msg = do_redeploy()
        send_discord(f"🤖 {result_msg}")
        log(f"対応: 再デプロイ → {result_msg}")

    else:  # notify
        reply = (
            f"⚠️ **自動修復不可** `{severity}`\n"
            f"原因: {reason}\n"
            f"手動確認が必要です。Vercel ログを確認してください。"
        )
        send_discord(reply)
        log("対応: ユーザーに通知（要手動対応）")


def main():
    log(f"監視開始 channel={DISCORD_CHANNEL_ID} model={OLLAMA_MODEL} interval={POLL_INTERVAL}s")
    # 起動時に最新IDをセット（過去エラーを再処理しない）
    if not LAST_ID_FILE.exists():
        try:
            resp = requests.get(
                f"https://discord.com/api/v10/channels/{DISCORD_CHANNEL_ID}/messages?limit=1",
                headers=_discord_headers(), timeout=10
            )
            msgs = resp.json()
            if msgs:
                LAST_ID_FILE.write_text(msgs[0]["id"])
                log(f"初期化: 最新メッセージID={msgs[0]['id']} を起点にセット")
        except Exception as e:
            log(f"初期化エラー（無視）: {e}")

    while True:
        try:
            errors = fetch_new_error_messages()
            for msg in errors:
                handle_error(msg)
        except requests.exceptions.HTTPError as e:
            log(f"Discord APIエラー: {e}")
        except Exception as e:
            log(f"メインループ予期しないエラー: {e}")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
