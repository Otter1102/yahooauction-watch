-- ============================================================
-- migration_009: device_type カラム追加 + デバイス単位 UNIQUE 制約
-- ============================================================
-- 目的:
--   1. device_type (mobile / desktop) を users テーブルに追加
--   2. (device_fingerprint, device_type) の組み合わせを UNIQUE にし
--      「1デバイス = 1レコード」をDB レベルで強制
--   3. 旧インデックス（非 UNIQUE）を削除して置き換え
--
-- 実行方法: Supabase SQL Editor に貼り付けて実行
-- 注意: device_fingerprint が NULL の旧レコードは制約対象外
--       （WHERE device_fingerprint IS NOT NULL で除外）
-- ============================================================

-- device_type カラムを追加（既存なら何もしない）
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS device_type TEXT DEFAULT 'unknown';

COMMENT ON COLUMN users.device_type IS 'mobile | desktop | unknown';

-- 旧インデックス（非 UNIQUE）を削除
DROP INDEX IF EXISTS idx_users_device_fingerprint;

-- (device_fingerprint, device_type) の UNIQUE インデックスを作成
-- NULL レコードは除外（旧レコード・フィンガープリント未取得端末は制約から外す）
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_fp_type_unique
  ON users(device_fingerprint, device_type)
  WHERE device_fingerprint IS NOT NULL;

-- ============================================================
-- 確認クエリ
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'users' ORDER BY ordinal_position;
--
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE tablename = 'users';
-- ============================================================
