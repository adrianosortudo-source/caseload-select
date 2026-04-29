-- Allow Band X (Needs Review) on intake_sessions.band, leads.band, leads.priority_band.
-- Required by KB-23 Lesson 02 (Band X fallback router). Without this, the engine's
-- attempts to persist a band='X' session fail with check_constraint violations and
-- the lead is silently dropped  -  the exact failure mode Band X was designed to prevent.
-- Idempotent: safe to re-run.

ALTER TABLE intake_sessions DROP CONSTRAINT IF EXISTS intake_sessions_band_check;
ALTER TABLE intake_sessions ADD CONSTRAINT intake_sessions_band_check
  CHECK (band IS NULL OR band = ANY (ARRAY['A','B','C','D','E','X']));

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_band_check;
ALTER TABLE leads ADD CONSTRAINT leads_band_check
  CHECK (band IS NULL OR band = ANY (ARRAY['A','B','C','D','E','X']));

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_priority_band_check;
ALTER TABLE leads ADD CONSTRAINT leads_priority_band_check
  CHECK (priority_band IS NULL OR priority_band = ANY (ARRAY['A','B','C','D','E','X']));

-- ── Drop stale prototype-era CHECK constraints ──
-- These hardcoded vocabularies pre-date the 35-practice-area expansion, the
-- 10-stage pipeline (CRM Bible v3 + Band X), the per-firm source taxonomy,
-- and the urgency model the engine actually emits. Any of them silently
-- rejects valid intakes today. The application layer is the source of truth.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_case_type_check;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_stage_check;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_lead_state_check;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_urgency_check;
