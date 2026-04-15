-- ============================================================
-- Migration 002: notification_history に image_url カラムを追加
-- Supabase SQL Editor で実行してください
-- ============================================================

ALTER TABLE notification_history
  ADD COLUMN IF NOT EXISTS image_url TEXT;
