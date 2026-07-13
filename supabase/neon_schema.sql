-- ============================================================
-- Yahoo Auction Watcher — Neon overflow schema
-- Neon SQL Editor にそのまま貼り付けて1回実行する。
-- 目的: Supabase Free tier の DB size / egress を逼迫させている
--       notification_history テーブルを Neon 側へ退避する。
-- Supabase 側の同名テーブルは残す（NEON_DATABASE_URL 未設定時のフォールバック用）。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

-- 動作確認クエリ
SELECT 'ok' AS status, COUNT(*) AS rows FROM notification_history;
