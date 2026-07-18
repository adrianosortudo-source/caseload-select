-- Migration: Add custom_domain column to intake_firms (S9)
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/qpzopweonveumvuqkqgw/sql

ALTER TABLE intake_firms
  ADD COLUMN IF NOT EXISTS custom_domain TEXT UNIQUE;

-- Index for middleware lookup (hostname → firm_id)
CREATE INDEX IF NOT EXISTS idx_intake_firms_custom_domain ON intake_firms (custom_domain);
