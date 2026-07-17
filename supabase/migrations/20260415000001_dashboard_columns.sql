-- ────────────────────────────────────────────────────────────────
-- 20260415_dashboard_columns.sql
-- Adds columns required by the 3-tier client dashboard (S8).
-- Idempotent — safe to run multiple times.
-- ────────────────────────────────────────────────────────────────

-- intake_firms: ad spend (manually populated by operator)
ALTER TABLE intake_firms
  ADD COLUMN IF NOT EXISTS monthly_ad_spend DECIMAL DEFAULT NULL;

-- leads: response-time tracking
-- first_contact_at — set when stage transitions new_lead → contacted
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ DEFAULT NULL;

-- leads: stage-staleness tracking
-- stage_changed_at — updated on every stage transition
-- Backfill existing rows to updated_at as a reasonable proxy
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ DEFAULT NOW();

UPDATE leads
SET stage_changed_at = updated_at
WHERE stage_changed_at IS NULL OR stage_changed_at = NOW()
  AND updated_at IS NOT NULL;
