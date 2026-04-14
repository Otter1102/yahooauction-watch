-- migration_005: conditions に max_bids カラムを追加
-- 入札件数の上限フィルター（null = 上限なし）

ALTER TABLE conditions
  ADD COLUMN IF NOT EXISTS max_bids INTEGER DEFAULT NULL;

COMMENT ON COLUMN conditions.max_bids IS '入札数上限フィルター。null=上限なし。minBids以上maxBids未満でフィルタリング';
