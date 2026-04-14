-- ============================================================
-- ヤフオクwatch — 完全セットアップSQL（一括実行版）
-- 新しいSupabaseプロジェクトに貼り付けて実行するだけで完了
-- 既存プロジェクトに対しても IF NOT EXISTS で安全に再実行可能
-- ============================================================

-- ─── テーブル作成 ─────────────────────────────────────────

-- ユーザー（ブラウザのUUIDで識別、ログイン不要）
CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,
  ntfy_topic           TEXT,
  discord_webhook      TEXT,
  notification_channel TEXT DEFAULT 'webpush',
  push_sub             JSONB,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- 検索条件
CREATE TABLE IF NOT EXISTS conditions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  keyword          TEXT NOT NULL,
  max_price        INTEGER NOT NULL,
  min_price        INTEGER DEFAULT 0,
  min_bids         INTEGER DEFAULT 0,
  seller_type      TEXT DEFAULT 'all',
  item_condition   TEXT DEFAULT 'all',
  sort_by          TEXT DEFAULT 'endTime',
  sort_order       TEXT DEFAULT 'asc',
  buy_it_now       BOOLEAN DEFAULT FALSE,
  enabled          BOOLEAN DEFAULT TRUE,
  last_checked_at  TIMESTAMPTZ,
  last_found_count INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 通知済みオークションID（重複通知防止・7日で自動クリーンアップ）
CREATE TABLE IF NOT EXISTS notified_items (
  user_id     TEXT NOT NULL,
  auction_id  TEXT NOT NULL,
  notified_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, auction_id)
);

-- 通知履歴（履歴ページ表示用・72時間で自動クリーンアップ）
CREATE TABLE IF NOT EXISTS notification_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT NOT NULL,
  condition_id   UUID,
  condition_name TEXT,
  auction_id     TEXT,
  title          TEXT,
  price          TEXT,
  url            TEXT,
  image_url      TEXT,
  remaining      TEXT,
  notified_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── インデックス ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_conditions_user_id
  ON conditions(user_id);

CREATE INDEX IF NOT EXISTS idx_conditions_enabled
  ON conditions(enabled) WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_notified_items_user_id
  ON notified_items(user_id);

CREATE INDEX IF NOT EXISTS idx_notified_items_notified_at
  ON notified_items(notified_at);

CREATE INDEX IF NOT EXISTS idx_notification_history_user_id
  ON notification_history(user_id);

CREATE INDEX IF NOT EXISTS idx_notification_history_notified_at
  ON notification_history(notified_at);

-- ─── Row Level Security（RLSは使わない設計 — service_roleキーで操作）
-- アプリはサーバーサイド（GitHub Actions / API Routes）から
-- SUPABASE_SERVICE_KEY を使って操作するため RLS 不要

-- ─── 完了メッセージ ────────────────────────────────────
-- 上記を実行後、以下の環境変数を Vercel と GitHub Actions に設定:
--   NEXT_PUBLIC_SUPABASE_URL
--   NEXT_PUBLIC_SUPABASE_ANON_KEY
--   SUPABASE_SERVICE_KEY
--   VAPID_PUBLIC_KEY
--   VAPID_PRIVATE_KEY
--   NEXT_PUBLIC_APP_URL  (例: https://yahooauction-watch.vercel.app)
