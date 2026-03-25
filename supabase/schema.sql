-- ============================================================
-- ヤフオクwatch データベーススキーマ
-- Supabase SQL Editor にそのまま貼り付けて実行してください
-- ============================================================

-- ユーザー（ブラウザのUUIDで識別、ログイン不要）
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ntfy_topic TEXT,
  discord_webhook TEXT,
  notification_channel TEXT DEFAULT 'ntfy',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 検索条件
CREATE TABLE IF NOT EXISTS conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  keyword TEXT NOT NULL,
  max_price INTEGER NOT NULL,
  min_price INTEGER DEFAULT 0,
  enabled BOOLEAN DEFAULT TRUE,
  last_checked_at TIMESTAMPTZ,
  last_found_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 通知済みオークションID（重複通知防止）
CREATE TABLE IF NOT EXISTS notified_items (
  user_id UUID NOT NULL,
  auction_id TEXT NOT NULL,
  notified_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, auction_id)
);

-- 通知履歴
CREATE TABLE IF NOT EXISTS notification_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  condition_id UUID,
  condition_name TEXT,
  auction_id TEXT,
  title TEXT,
  price TEXT,
  url TEXT,
  notified_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_conditions_user_id ON conditions(user_id);
CREATE INDEX IF NOT EXISTS idx_conditions_enabled ON conditions(enabled) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_notified_items_user_id ON notified_items(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_history_user_id ON notification_history(user_id);

-- 7日以上古い通知済みレコードを自動削除（pg_cron使用、任意）
-- SELECT cron.schedule('cleanup-notified', '0 3 * * *',
--   'DELETE FROM notified_items WHERE notified_at < NOW() - INTERVAL ''7 days''');
