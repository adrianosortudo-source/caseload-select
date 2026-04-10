ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS stalled_step            integer     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stalled_started_at      timestamptz,
  ADD COLUMN IF NOT EXISTS stalled_last_action_at  timestamptz,
  ADD COLUMN IF NOT EXISTS stalled_status          text        DEFAULT 'inactive'
    CHECK (stalled_status IN ('inactive','active','completed','exited'));
