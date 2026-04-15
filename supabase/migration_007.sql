-- ============================================================
-- migration_007: Row Level Security (RLS) 有効化
-- ============================================================
-- 目的: Supabase anon キーで直接テーブルにアクセスされても
--       データが読み書きできないよう保護する
--
-- 設計:
--   - アプリは全て SUPABASE_SERVICE_KEY（サービスロールキー）を
--     サーバーサイドのAPI Routes から使用する
--   - サービスロールはRLSをバイパスするため、既存の動作は変わらない
--   - anon キー（ブラウザからの直接アクセス）は全テーブルで拒否
--
-- 実行方法: Supabase SQL Editor に貼り付けて実行
-- ============================================================

-- ── RLS を有効化 ─────────────────────────────────────────────

ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE conditions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notified_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_history ENABLE ROW LEVEL SECURITY;

-- trial_sessions テーブルが存在する場合も保護
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trial_sessions') THEN
    EXECUTE 'ALTER TABLE trial_sessions ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- ── anon キーによる全アクセスを拒否 ─────────────────────────
-- サービスロールはRLSをバイパスするため影響なし

-- users
DROP POLICY IF EXISTS "anon_deny_users" ON users;
CREATE POLICY "anon_deny_users"
  ON users FOR ALL TO anon USING (false);

-- conditions
DROP POLICY IF EXISTS "anon_deny_conditions" ON conditions;
CREATE POLICY "anon_deny_conditions"
  ON conditions FOR ALL TO anon USING (false);

-- notified_items
DROP POLICY IF EXISTS "anon_deny_notified_items" ON notified_items;
CREATE POLICY "anon_deny_notified_items"
  ON notified_items FOR ALL TO anon USING (false);

-- notification_history
DROP POLICY IF EXISTS "anon_deny_notification_history" ON notification_history;
CREATE POLICY "anon_deny_notification_history"
  ON notification_history FOR ALL TO anon USING (false);

-- trial_sessions（存在する場合）
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trial_sessions') THEN
    EXECUTE 'DROP POLICY IF EXISTS "anon_deny_trial_sessions" ON trial_sessions';
    EXECUTE 'CREATE POLICY "anon_deny_trial_sessions" ON trial_sessions FOR ALL TO anon USING (false)';
  END IF;
END $$;

-- ============================================================
-- 確認クエリ（実行後にこれを使って確認）
-- SELECT schemaname, tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;
-- ============================================================
