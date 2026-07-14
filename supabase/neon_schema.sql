-- ============================================================
-- Yahoo Auction Watcher — Neon 完全移行スキーマ（v2, 2026-07-14）
-- Neon SQL Editor にそのまま貼り付けて1回実行する。
--
-- 目的:
--   Supabase Free tier の egress/DB size 制限に依存させないため、
--   notification_history だけでなく users / conditions も Neon 側へ退避する。
--   （notified_items は Upstash Redis で完結、Supabase は完全にゼロコスト待機）
--
-- Supabase 側の同名テーブルは残す。NEON_DATABASE_URL 未設定 or
-- HISTORY_STORE=supabase の緊急キルスイッチ時のフォールバック用。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==============================================================
-- users (push_sub 設定・幽霊ユーザー掃除の対象)
-- ==============================================================
CREATE TABLE IF NOT EXISTS users (
  id                 TEXT PRIMARY KEY,
  push_sub           JSONB,
  device_fingerprint TEXT,
  is_trial           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_push_sub_not_null
  ON users((push_sub IS NOT NULL))
  WHERE push_sub IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_device_fingerprint
  ON users(device_fingerprint)
  WHERE device_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_created_at
  ON users(created_at);

-- ==============================================================
-- conditions (ユーザーの検索条件)
-- ==============================================================
CREATE TABLE IF NOT EXISTS conditions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  keyword          TEXT NOT NULL,
  max_price        INTEGER NOT NULL,
  min_price        INTEGER NOT NULL DEFAULT 0,
  min_bids         INTEGER NOT NULL DEFAULT 0,
  max_bids         INTEGER,
  seller_type      TEXT NOT NULL DEFAULT 'all',
  item_condition   TEXT NOT NULL DEFAULT 'all',
  sort_by          TEXT NOT NULL DEFAULT 'endTime',
  sort_order       TEXT NOT NULL DEFAULT 'asc',
  buy_it_now       BOOLEAN,
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  last_checked_at  TIMESTAMPTZ,
  last_found_count INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conditions_user_id
  ON conditions(user_id);

CREATE INDEX IF NOT EXISTS idx_conditions_enabled
  ON conditions(enabled)
  WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_conditions_user_enabled
  ON conditions(user_id, enabled)
  WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_conditions_created_at
  ON conditions(created_at);

-- ==============================================================
-- notification_history (通知履歴 / 表示用スナップショット)
-- ==============================================================
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
  end_at         TIMESTAMPTZ,
  notified_at    TIMESTAMPTZ DEFAULT NOW()
);

-- storage.ts の upsert onConflict: 'user_id,auction_id' に対応する部分ユニーク索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_history_user_auction_unique
  ON notification_history(user_id, auction_id)
  WHERE auction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_history_user_id
  ON notification_history(user_id);

CREATE INDEX IF NOT EXISTS idx_notification_history_notified_at
  ON notification_history(notified_at);

CREATE INDEX IF NOT EXISTS idx_notification_history_user_notified_at
  ON notification_history(user_id, notified_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_history_end_at
  ON notification_history(end_at)
  WHERE end_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_history_end_at_auction
  ON notification_history(end_at)
  WHERE end_at IS NOT NULL
    AND auction_id IS NOT NULL
    AND auction_id NOT LIKE '__check_%';

CREATE INDEX IF NOT EXISTS idx_notification_history_check_notified_at
  ON notification_history(notified_at)
  WHERE auction_id LIKE '__check_%';

CREATE INDEX IF NOT EXISTS idx_notification_history_unknown_end_notified_at
  ON notification_history(notified_at)
  WHERE end_at IS NULL
    AND auction_id IS NOT NULL
    AND auction_id NOT LIKE '__check_%';

-- ==============================================================
-- updated_at 自動更新 (users のみ)
-- ==============================================================
CREATE OR REPLACE FUNCTION trg_users_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_touch_updated_at ON users;
CREATE TRIGGER users_touch_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trg_users_touch_updated_at();

-- ==============================================================
-- 動作確認クエリ
-- ==============================================================
SELECT
  'ok' AS status,
  (SELECT COUNT(*) FROM users) AS users_rows,
  (SELECT COUNT(*) FROM conditions) AS conditions_rows,
  (SELECT COUNT(*) FROM notification_history) AS history_rows;
