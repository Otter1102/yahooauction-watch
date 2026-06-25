-- ============================================================
-- migration_008: notification_history の同一商品重複を禁止
-- ============================================================
-- 目的:
--   同じユーザーの同じ auction_id が履歴に何件も並ばないようにする。
--   既存の重複は最新 notified_at の1件だけ残して削除する。
--
-- 実行方法:
--   Supabase SQL Editor に貼り付けて実行
-- ============================================================

ALTER TABLE notification_history
  ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, auction_id
      ORDER BY notified_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM notification_history
  WHERE auction_id IS NOT NULL
)
DELETE FROM notification_history h
USING ranked r
WHERE h.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_history_user_auction_unique
  ON notification_history(user_id, auction_id)
  WHERE auction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_history_end_at
  ON notification_history(end_at)
  WHERE end_at IS NOT NULL;
