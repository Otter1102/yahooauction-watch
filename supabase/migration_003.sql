-- migration_003: notification_history に remaining カラムを追加
ALTER TABLE notification_history ADD COLUMN IF NOT EXISTS remaining TEXT;
