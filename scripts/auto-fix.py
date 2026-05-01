#!/usr/bin/env python3
"""
auto-fix.py — Yahoo Auction Watcher 自動コード修正エージェント
フロー:
  1. health-check.ts の JSON レポートを stdin から受け取る
  2. Ollama (qwen2.5:14b) で診断 → 修正プラン JSON を生成
  3. 信頼度 >= 0.8 → Ollama の修正をそのまま適用
     信頼度 < 0.8  → claude -p (Claude Code CLI) に丸投げ
  4. git push → Discord 通知

使い方:
  node --env-file=.env.local -r tsx/cjs scripts/health-check.ts | python3 scripts/auto-fix.py
"""
import json, subprocess, sys, os, re, time
import urllib.request, urllib.error

APP_DIR    = "/Users/sawadaakira/Projects/MOTHERSHIP/apps/yahoo-auction-watcher"
CLONE_DIR  = "/tmp/yaw-autofix"
REPO_URL   = "https://github.com/Otter1102/yahooauction-watch.git"
OLLAMA_URL = "http://localhost:11434/api/generate"

# Discord Webhook は環境変数から（auto-maintain.sh が source .env.local 済み）
DISCORD_WEBHOOK = os.environ.get("DISCORD_ADMIN_WEBHOOK", "")

# 診断対象ファイル（Ollama に渡すコンテキスト）
KEY_FILES = [
    "scripts/run-check.ts",
    "lib/storage.ts",
    "lib/webpush.ts",
    "lib/types.ts",
    "lib/supabase.ts",
]

# ──────────────────────────────────────────────────────────────────────
# ユーティリティ
# ──────────────────────────────────────────────────────────────────────

def run(cmd: str, cwd: str = None) -> tuple[str, str, int]:
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=cwd, timeout=120)
    return r.stdout.strip(), r.stderr.strip(), r.returncode

def log(msg: str):
    print(f"[auto-fix {time.strftime('%H:%M:%S')}] {msg}", flush=True)

def notify_discord(msg: str, color: int = 16744272):
    if not DISCORD_WEBHOOK:
        return
    payload = json.dumps({
        "embeds": [{"title": "🤖 YAW Auto-Fix", "description": msg[:3900], "color": color}]
    }).encode()
    try:
        req = urllib.request.Request(
            DISCORD_WEBHOOK,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        log(f"Discord通知失敗: {e}")

def read_repo_file(path: str) -> str:
    full = os.path.join(CLONE_DIR, path)
    try:
        with open(full, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return f"[ファイルなし: {path}]"

def write_repo_file(path: str, content: str):
    full = os.path.join(CLONE_DIR, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(content)

# ──────────────────────────────────────────────────────────────────────
# Ollama 呼び出し
# ──────────────────────────────────────────────────────────────────────

def ollama_generate(prompt: str, model: str = "qwen2.5:14b", timeout: int = 180) -> str:
    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.05, "num_predict": 2048},
    }).encode()
    try:
        req = urllib.request.Request(
            OLLAMA_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.load(resp)["response"]
    except Exception as e:
        return f"[Ollamaエラー: {e}]"

def extract_json(text: str) -> dict | None:
    """LLM レスポンスから最初の JSON ブロックを抽出"""
    # コードブロック内の JSON
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        text = m.group(1)
    else:
        # 生の JSON
        m = re.search(r"(\{.*\})", text, re.DOTALL)
        if m:
            text = m.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None

# ──────────────────────────────────────────────────────────────────────
# Claude Code CLI フォールバック
# ──────────────────────────────────────────────────────────────────────

def claude_fix(report: str, issues: list[str]) -> bool:
    """claude -p で自律修正を試みる。成功=True"""
    log("Claude Code CLI フォールバック実行中...")

    # コンテキストとして関連ファイルを読む
    files_ctx = ""
    for f in KEY_FILES:
        content = read_repo_file(f)
        files_ctx += f"\n\n--- {f} ---\n{content[:4000]}"

    prompt = f"""Yahoo Auction Watcherアプリ ({CLONE_DIR}) に以下の問題が検出されました。
コードを修正して /tmp/yaw-autofix にある git リポジトリに push してください。

【問題一覧】
{chr(10).join(f'- {i}' for i in issues)}

【健全性レポート】
{report}

【関連ファイル】
{files_ctx}

【手順】
1. 問題のファイルを特定する
2. 修正を適用する (Edit ツールを使う)
3. cd /tmp/yaw-autofix && git add -A && git commit -m "fix: 自動修正" && git push origin main
4. 修正完了を報告する"""

    out, err, code = run(
        f'claude --print --allowedTools "Bash,Read,Edit,Glob,Grep" -p {json.dumps(prompt)}',
        cwd=CLONE_DIR,
    )
    log(f"Claude CLI 終了コード: {code}")
    if out:
        log(f"Claude CLI 出力: {out[:300]}")
    return code == 0

# ──────────────────────────────────────────────────────────────────────
# メイン
# ──────────────────────────────────────────────────────────────────────

# コード修正では解決できない設定/シークレット系の問題
# → Ollama/Claude ループに渡さず Discord アラートのみ
CONFIG_ISSUES = [
    "SUPABASE_CHECK_ERROR",   # GitHub Secrets の SUPABASE_SERVICE_KEY が無効
    "SUPABASE_QUERY_ERROR",
    "NO_NOTIFICATIONS_48H",   # SUPABASE_CHECK_ERROR の downstream 副作用
    "GITHUB_CHECK_ERROR",     # gh 認証切れ
]

CONFIG_FIX_HINTS = {
    "SUPABASE_CHECK_ERROR": "GitHub Secrets の SUPABASE_SERVICE_KEY を Supabase ダッシュボード (Settings → API → service_role) の最新キーで更新してください",
    "GITHUB_CHECK_ERROR":   "GitHub CLI 認証が切れています。Mac mini で `gh auth login` を再実行してください",
    "NO_NOTIFICATIONS_48H": "SUPABASE_CHECK_ERROR が原因の可能性があります。Supabase キーを確認してください",
}

def main():
    # stdin から health-check.ts の JSON レポートを受け取る
    raw = sys.stdin.read().strip()
    try:
        health = json.loads(raw)
    except json.JSONDecodeError:
        log(f"JSON 解析失敗: {raw[:200]}")
        sys.exit(1)

    issues: list[str] = health.get("issues", [])
    report: str       = health.get("report", "")
    fixes: list[str]  = health.get("fixes", [])

    log(f"問題 {len(issues)} 件: {issues}")

    if not issues:
        log("問題なし — 終了")
        return

    # ── 設定/シークレット問題は Discord アラートのみ（コード修正不可）──
    config_hits = [i for i in issues if any(c in i for c in CONFIG_ISSUES)]
    if config_hits:
        hints = []
        for hit in config_hits:
            for key, hint in CONFIG_FIX_HINTS.items():
                if key in hit:
                    hints.append(f"• {hint}")
                    break
        msg = "⚠️ **設定/シークレット問題を検出（コード自動修正では解決不可）**\n\n"
        msg += "\n".join(f"❌ {i}" for i in config_hits)
        if hints:
            msg += "\n\n**対応手順:**\n" + "\n".join(hints)
        notify_discord(msg, color=16744272)
        log("設定問題検出 → Discord に通知済み（コード修正スキップ）")

    # 設定問題を除いたコード修正可能な問題のみを後続処理に渡す
    issues = [i for i in issues if not any(c in i for c in CONFIG_ISSUES)]
    if not issues:
        log("コード修正が必要な問題なし — 終了")
        return

    # ── リポジトリ準備 ────────────────────────────────────────────────
    log("リポジトリをクローン中...")
    if os.path.isdir(CLONE_DIR):
        out, _, rc = run("git pull origin main", cwd=CLONE_DIR)
        if rc != 0:
            run(f"rm -rf {CLONE_DIR}")
            run(f"git clone {REPO_URL} {CLONE_DIR}")
    else:
        run(f"git clone {REPO_URL} {CLONE_DIR}")

    # ── Agent 1: Ollama 診断 ──────────────────────────────────────────
    log("Ollama qwen2.5:14b で診断中...")

    files_ctx = {}
    for f in KEY_FILES:
        content = read_repo_file(f)
        files_ctx[f] = content[:3000]  # 長すぎるものはカット

    diagnosis_prompt = f"""あなたはNext.js/TypeScriptアプリの上級エンジニアです。
以下のエラーレポートを読んで、修正プランをJSONで出力してください。

【エラー一覧】
{json.dumps(issues, ensure_ascii=False)}

【健全性レポート】
{report}

【関連ファイル】
{json.dumps(files_ctx, ensure_ascii=False, indent=2)}

以下のJSON形式のみで回答してください。説明は不要です:
{{
  "diagnosis": "根本原因の1行説明",
  "confidence": 0.0から1.0の数値（修正の確実性）,
  "files_to_fix": [
    {{
      "path": "scripts/run-check.ts",
      "old_code": "変更前の正確なコード（空文字列の場合は新規追加）",
      "new_code": "変更後の正確なコード",
      "reason": "変更理由"
    }}
  ]
}}"""

    ollama_resp = ollama_generate(diagnosis_prompt)
    log(f"Ollama応答: {ollama_resp[:200]}...")

    fix_plan = extract_json(ollama_resp)

    if not fix_plan:
        log("Ollama のJSON解析失敗 → Claude Code CLI フォールバック")
        success = claude_fix(report, issues)
        status_msg = "✅ Claude Code CLI で自動修正完了" if success else "❌ 自動修正失敗 — 手動確認が必要です"
        notify_discord(f"{status_msg}\n\n問題:\n{chr(10).join(issues)}", 65280 if success else 16711680)
        return

    confidence  = float(fix_plan.get("confidence", 0))
    diagnosis   = fix_plan.get("diagnosis", "不明")
    files_plan  = fix_plan.get("files_to_fix", [])

    log(f"診断: {diagnosis}")
    log(f"信頼度: {confidence:.0%} / 修正ファイル: {len(files_plan)} 件")

    # ── Agent 2: 修正適用 ─────────────────────────────────────────────
    applied = []

    if confidence >= 0.8 and files_plan:
        log("信頼度 80%以上 → Ollama 修正を適用")

        for fix in files_plan:
            path     = fix.get("path", "")
            old_code = fix.get("old_code", "")
            new_code = fix.get("new_code", "")

            if not path or not new_code:
                log(f"  スキップ: path={path!r} new_code 空")
                continue

            content = read_repo_file(path)

            if old_code and old_code in content:
                write_repo_file(path, content.replace(old_code, new_code, 1))
                log(f"  ✅ 修正: {path}")
                applied.append(path)
            elif not old_code:
                # 新規追加
                write_repo_file(path, new_code)
                log(f"  ✅ 新規作成: {path}")
                applied.append(path)
            else:
                log(f"  ⚠️ パターン不一致: {path} — Claude フォールバック")
                # このファイルだけ Claude に任せる
                success = claude_fix(report, [f"ファイル {path} の修正が必要: {fix.get('reason', '')}"])
                if success:
                    applied.append(f"{path} (via Claude)")

    else:
        log(f"信頼度 {confidence:.0%} < 80% → Claude Code CLI フォールバック")
        success = claude_fix(report, issues)
        if success:
            applied.append("(Claude Code CLI が修正)")

    # ── git push ─────────────────────────────────────────────────────
    if applied:
        log("git push 中...")
        commit_msg = f"fix: 自動修正 — {diagnosis[:60]}"
        # まず変更があるか確認
        diff_out, _, _ = run("git diff --cached --name-only && git status --short", cwd=CLONE_DIR)
        if not diff_out.strip():
            log("変更なし — push スキップ")
            notify_discord(f"ℹ️ 自動修正を試みましたが変更なし\n診断: {diagnosis}", color=3447003)
            return
        out, err, rc = run(
            f'git add -A && git commit -m {json.dumps(commit_msg)} && git push origin main',
            cwd=CLONE_DIR,
        )
        if rc == 0:
            log("✅ git push 成功")
            notify_discord(
                f"✅ 自動修正完了!\n\n**診断:** {diagnosis}\n**信頼度:** {confidence:.0%}\n**修正ファイル:** {', '.join(applied)}\n\n**問題:**\n{chr(10).join(f'- {i}' for i in issues)}",
                color=65280,
            )
        else:
            log(f"❌ git push 失敗: {err[:300]}")
            notify_discord(
                f"❌ 自動修正は完了しましたが push に失敗\n\n{err[:500]}",
                color=16711680,
            )
    else:
        log("修正を適用できませんでした")
        notify_discord(
            f"⚠️ 自動修正スキップ\n\n**診断:** {diagnosis}\n**信頼度:** {confidence:.0%}\n\n手動確認が必要です:\n{chr(10).join(f'- {i}' for i in issues)}",
            color=16744272,
        )


if __name__ == "__main__":
    main()
