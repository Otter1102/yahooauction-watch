-- トライアル管理テーブル
-- デバイスフィンガープリントでトライアル開始日を追跡し、再インストールでのリセットを防ぐ
CREATE TABLE IF NOT EXISTS trial_sessions (
  fp_hash  TEXT PRIMARY KEY,          -- SHA-256(fingerprint + salt)
  ip_hash  TEXT,                      -- SHA-256(IP + salt)
  cookie_id UUID UNIQUE,              -- httpOnly Cookie で二重照合
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL     -- created_at + 30日
);

-- RLS: サービスロールのみアクセス可（クライアントから直接読み書き不可）
ALTER TABLE trial_sessions ENABLE ROW LEVEL SECURITY;
-- サービスロールはバイパスするため追加ポリシー不要
