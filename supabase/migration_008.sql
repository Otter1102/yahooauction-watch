-- ============================================================
-- migration_008: device_fingerprint カラム追加 + ゴーストユーザー対策
-- ============================================================
-- 目的:
--   1. device_fingerprint を users テーブルに保存し、
--      再インストール後も同一端末を一意に識別する
--   2. アプリ再インストール時に新しいUUIDで重複レコードが
--      作られるのを防ぐ（サーバー側で統合）
--
-- 実行方法: Supabase SQL Editor に貼り付けて実行
-- ============================================================

-- device_fingerprint カラムを追加（既存なら何もしない）
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS device_fingerprint TEXT;

-- 検索用インデックス（fingerprint → user lookup を高速化）
CREATE INDEX IF NOT EXISTS idx_users_device_fingerprint
  ON users(device_fingerprint)
  WHERE device_fingerprint IS NOT NULL;

-- ============================================================
-- 確認クエリ
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'users' ORDER BY ordinal_position;
-- ============================================================
