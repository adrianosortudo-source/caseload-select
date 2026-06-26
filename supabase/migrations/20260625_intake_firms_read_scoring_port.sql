-- Migration: add read_scoring_port flag to intake_firms
--
-- Doctrine: every screened_leads insert always writes scoring-delta columns
-- (unconditional). This flag gates the READ surface: when false (default),
-- the brief/triage API returns only the legacy brief_html. When true, the
-- API may additionally expose the scoring-delta columns to the lawyer UI.
--
-- Flip a firm on:
--   UPDATE intake_firms SET read_scoring_port = true WHERE id = '<firm_id>';
-- Rollback is immediate: set read_scoring_port = false → legacy reads restore.

ALTER TABLE intake_firms
  ADD COLUMN IF NOT EXISTS read_scoring_port BOOLEAN NOT NULL DEFAULT FALSE;

-- Explicit RLS note: intake_firms already has FORCE ROW LEVEL SECURITY and
-- service-role-only write access (migration 20260605175457_security_lockdown).
-- No additional RLS rules needed; service-role reads the flag server-side.
