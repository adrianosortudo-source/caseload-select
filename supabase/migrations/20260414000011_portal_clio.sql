-- Migration: Add clio_config column to intake_firms (S8)
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/qpzopweonveumvuqkqgw/sql

-- Stores Clio OAuth tokens per firm.
-- Schema: { access_token, refresh_token, expires_at (ms timestamp) }
ALTER TABLE intake_firms
  ADD COLUMN IF NOT EXISTS clio_config JSONB DEFAULT NULL;
