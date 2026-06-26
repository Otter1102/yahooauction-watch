-- ============================================================
-- migration_009: DB軽量化・保持期間整理・巡回用index追加
-- ============================================================
-- 目的:
--   100人前後/最大500〜1500条件の運用で notification_history / notified_items が
--   増え続けてSupabase Free computeを詰まらせないようにする。
--
-- 実行方法:
--   Supabase SQL Editor に貼り付けて実行。
--   DBがリソース枯渇している時は、先にSupabase側で負荷が落ち着いてから実行する。
-- ============================================================

ALTER TABLE notification_history
  ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ;

-- 条件巡回: enabled=true を id順でページングする。
CREATE INDEX IF NOT EXISTS idx_conditions_enabled_id
  ON conditions(id)
  WHERE enabled = TRUE;

-- ユーザー別履歴表示: user_id + notified_at DESC。
CREATE INDEX IF NOT EXISTS idx_notification_history_user_notified_at
  ON notification_history(user_id, notified_at DESC);

-- 終了済み履歴削除: end_at が古いauction履歴を削除。
CREATE INDEX IF NOT EXISTS idx_notification_history_end_at_auction
  ON notification_history(end_at)
  WHERE end_at IS NOT NULL
    AND auction_id IS NOT NULL
    AND auction_id NOT LIKE '__check_%';

-- 条件チェック履歴削除: __check_% の古い履歴を削除。
CREATE INDEX IF NOT EXISTS idx_notification_history_check_notified_at
  ON notification_history(notified_at)
  WHERE auction_id LIKE '__check_%';

-- end_at が無い旧auction履歴の短期保持削除。
CREATE INDEX IF NOT EXISTS idx_notification_history_unknown_end_notified_at
  ON notification_history(notified_at)
  WHERE end_at IS NULL
    AND auction_id IS NOT NULL
    AND auction_id NOT LIKE '__check_%';

-- notified_items TTL削除。
CREATE INDEX IF NOT EXISTS idx_notified_items_notified_at
  ON notified_items(notified_at);

-- push通知可能ユーザー取得。
CREATE INDEX IF NOT EXISTS idx_users_push_sub_present
  ON users(id)
  WHERE push_sub IS NOT NULL;

-- 既存データの初回軽量化。
-- チェック履歴は36時間だけ保持。
DELETE FROM notification_history
WHERE auction_id LIKE '__check_%'
  AND notified_at < NOW() - INTERVAL '36 hours';

-- 終了済みauction履歴は終了後24時間だけ保持。
DELETE FROM notification_history
WHERE auction_id IS NOT NULL
  AND auction_id NOT LIKE '__check_%'
  AND end_at IS NOT NULL
  AND end_at < NOW() - INTERVAL '24 hours';

-- end_atなし旧auction履歴は72時間だけ保持。
DELETE FROM notification_history
WHERE auction_id IS NOT NULL
  AND auction_id NOT LIKE '__check_%'
  AND end_at IS NULL
  AND notified_at < NOW() - INTERVAL '72 hours';

-- notified_items は60時間だけ保持。
DELETE FROM notified_items
WHERE notified_at < NOW() - INTERVAL '60 hours';
