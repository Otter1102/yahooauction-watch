-- ============================================================
-- Migration 001: 詳細条件フィルター追加
-- Supabase SQL Editor で実行してください
-- ============================================================

ALTER TABLE conditions
  ADD COLUMN IF NOT EXISTS min_bids INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seller_type TEXT DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS item_condition TEXT DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS sort_by TEXT DEFAULT 'endTime',
  ADD COLUMN IF NOT EXISTS sort_order TEXT DEFAULT 'asc',
  ADD COLUMN IF NOT EXISTS buy_it_now BOOLEAN DEFAULT FALSE;
