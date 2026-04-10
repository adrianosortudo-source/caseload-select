-- Migration 009 — WF-05 No-Show Recovery columns
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS no_show_step            integer     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS no_show_started_at      timestamptz,
  ADD COLUMN IF NOT EXISTS no_show_last_action_at  timestamptz,
  ADD COLUMN IF NOT EXISTS no_show_status          text        DEFAULT 'inactive'
    CHECK (no_show_status IN ('inactive','active','completed','exited'));
