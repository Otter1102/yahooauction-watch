-- ============================================================
-- Yahoo Auction Watcher v2 current setup SQL
-- Supabase SQL Editor にそのまま貼り付けて1回実行する。
-- 既存DBにも再実行できるよう、基本は IF NOT EXISTS / ADD COLUMN IF NOT EXISTS。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Tables ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,
  ntfy_topic           TEXT,
  discord_webhook      TEXT,
  notification_channel TEXT DEFAULT 'webpush',
  push_sub             JSONB,
  device_fingerprint   TEXT,
  device_type          TEXT,
  is_trial             BOOLEAN DEFAULT false,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conditions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  keyword          TEXT NOT NULL,
  max_price        INTEGER NOT NULL,
  min_price        INTEGER DEFAULT 0,
  min_bids         INTEGER DEFAULT 0,
  max_bids         INTEGER DEFAULT NULL,
  seller_type      TEXT DEFAULT 'all',
  item_condition   TEXT DEFAULT 'all',
  sort_by          TEXT DEFAULT 'endTime',
  sort_order       TEXT DEFAULT 'asc',
  buy_it_now       BOOLEAN DEFAULT NULL,
  enabled          BOOLEAN DEFAULT TRUE,
  last_checked_at  TIMESTAMPTZ,
  last_found_count INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notified_items (
  user_id     TEXT NOT NULL,
  auction_id  TEXT NOT NULL,
  notified_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, auction_id)
);

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

CREATE TABLE IF NOT EXISTS trial_sessions (
  fp_hash       TEXT PRIMARY KEY,
  ip_hash       TEXT,
  cookie_id     UUID UNIQUE,
  push_endpoint TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL
);

-- ─── Existing DB migrations ────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS push_sub JSONB,
  ADD COLUMN IF NOT EXISTS device_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS device_type TEXT,
  ADD COLUMN IF NOT EXISTS is_trial BOOLEAN DEFAULT false;

ALTER TABLE conditions
  ADD COLUMN IF NOT EXISTS min_bids INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_bids INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS seller_type TEXT DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS item_condition TEXT DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS sort_by TEXT DEFAULT 'endTime',
  ADD COLUMN IF NOT EXISTS sort_order TEXT DEFAULT 'asc',
  ADD COLUMN IF NOT EXISTS buy_it_now BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_found_count INTEGER DEFAULT 0;

ALTER TABLE conditions ALTER COLUMN buy_it_now DROP NOT NULL;
ALTER TABLE conditions ALTER COLUMN buy_it_now SET DEFAULT NULL;

ALTER TABLE notification_history
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS remaining TEXT,
  ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ;

ALTER TABLE trial_sessions
  ADD COLUMN IF NOT EXISTS push_endpoint TEXT;

-- ─── Indexes ───────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_conditions_user_id
  ON conditions(user_id);

CREATE INDEX IF NOT EXISTS idx_conditions_enabled
  ON conditions(enabled)
  WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_conditions_enabled_id
  ON conditions(id)
  WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_notified_items_user_id
  ON notified_items(user_id);

CREATE INDEX IF NOT EXISTS idx_notified_items_notified_at
  ON notified_items(notified_at);

CREATE INDEX IF NOT EXISTS idx_notification_history_user_id
  ON notification_history(user_id);

CREATE INDEX IF NOT EXISTS idx_notification_history_notified_at
  ON notification_history(notified_at);

CREATE INDEX IF NOT EXISTS idx_notification_history_user_notified_at
  ON notification_history(user_id, notified_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_history_end_at
  ON notification_history(end_at)
  WHERE end_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_history_user_auction_unique
  ON notification_history(user_id, auction_id)
  WHERE auction_id IS NOT NULL;

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

CREATE INDEX IF NOT EXISTS idx_users_device_fingerprint
  ON users(device_fingerprint);

CREATE INDEX IF NOT EXISTS idx_users_push_sub_present
  ON users(id)
  WHERE push_sub IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trial_sessions_push_endpoint
  ON trial_sessions(push_endpoint)
  WHERE push_endpoint IS NOT NULL;

-- ─── Grants ────────────────────────────────────────────────
-- 新しいSupabase API key方式では、service_roleキーでも明示的な権限付与が必要な場合がある。
-- anonには権限を広げず、サーバー側APIで使うservice_roleだけに付与する。

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON TABLE
  users,
  conditions,
  notified_items,
  notification_history,
  trial_sessions
TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ─── Row Level Security ────────────────────────────────────
-- アプリはサーバー側で service_role を使う。anon からの直接アクセスは拒否する。

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notified_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_deny_users" ON users;
DROP POLICY IF EXISTS "anon_deny_conditions" ON conditions;
DROP POLICY IF EXISTS "anon_deny_notified_items" ON notified_items;
DROP POLICY IF EXISTS "anon_deny_notification_history" ON notification_history;
DROP POLICY IF EXISTS "anon_deny_trial_sessions" ON trial_sessions;

CREATE POLICY "anon_deny_users"
  ON users FOR ALL TO anon USING (false);

CREATE POLICY "anon_deny_conditions"
  ON conditions FOR ALL TO anon USING (false);

CREATE POLICY "anon_deny_notified_items"
  ON notified_items FOR ALL TO anon USING (false);

CREATE POLICY "anon_deny_notification_history"
  ON notification_history FOR ALL TO anon USING (false);

CREATE POLICY "anon_deny_trial_sessions"
  ON trial_sessions FOR ALL TO anon USING (false);

-- ─── Smoke check ───────────────────────────────────────────

SELECT
  'ok' AS status,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public') AS public_table_count;
