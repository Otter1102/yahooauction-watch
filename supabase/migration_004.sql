-- migration_004: buy_it_now を null 許容に変更（null = 両方通知）
-- null  → オークションも即決も両方通知（デフォルト）
-- false → オークションのみ通知
-- true  → 即決のみ通知
ALTER TABLE conditions ALTER COLUMN buy_it_now DROP NOT NULL;
ALTER TABLE conditions ALTER COLUMN buy_it_now SET DEFAULT NULL;
-- 既存データ: false（オークションのみ）→ null（両方）に変換
UPDATE conditions SET buy_it_now = NULL WHERE buy_it_now = FALSE;
