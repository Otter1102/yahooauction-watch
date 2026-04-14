-- trial_sessions に push_endpoint カラムを追加
-- 同一ブラウザの別userId試行を検知するため
ALTER TABLE trial_sessions
  ADD COLUMN IF NOT EXISTS push_endpoint TEXT;

-- push_endpoint でも検索できるようにインデックスを追加
CREATE INDEX IF NOT EXISTS idx_trial_sessions_push_endpoint
  ON trial_sessions(push_endpoint)
  WHERE push_endpoint IS NOT NULL;
