-- Scoring model + full component snapshot on leads
-- =============================================================================
-- leads currently has sub-score columns (geo_score, contactability_score,
-- legitimacy_score, complexity_score, urgency_score, strategic_score,
-- fee_score, fit_score, value_score) that were shaped for the v2.1 form
-- scoring engine in src/lib/scoring.ts (fit max 30, value max 65, 7 factors).
--
-- The CaseLoad Screen (GPT) path runs a different engine  -  CpiBreakdown in
-- src/lib/cpi-calculator.ts  -  with 8 factors (fit max 40, value max 60):
-- geo, practice, legitimacy, referral, urgency, complexity, multi_practice, fee.
-- Five factors overlap (geo, legitimacy, complexity, urgency, fee); three do
-- not (practice, referral, multi_practice) and have no leads columns.
--
-- Writing GPT's fit_score (0-40) into a column the admin UI labels "/30"
-- would show "35/30" for strong fits  -  visually broken. Keeping it all-null
-- would drop the full breakdown on the floor.
--
-- Solution:
--   - scoring_model flags which engine produced the row (v2.1_form | gpt_cpi_v1)
--   - score_components JSONB holds the full native breakdown from that engine
--   - The overlapping 5 sub-score columns still fill from GPT sessions so the
--     current admin score-bar UI renders something useful today without a UI
--     rewrite; fit_score / value_score stay null for GPT rows until the UI
--     becomes source-aware
--
-- Consumers (future):
--   - src/lib/score-components.ts (helper that reads scoring_model and builds
--     the right ScoreRationaleInput per source)
--   - src/app/leads/[id]/page.tsx (admin lead detail rewrite)
--   - src/app/portal/[firmId]/leads/[leadId]/page.tsx (portal lead detail)
-- =============================================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS scoring_model    text,
  ADD COLUMN IF NOT EXISTS score_components jsonb;

-- Domain guard. Named so a future engine swap can ALTER the constraint cleanly.
-- NULL allowed for historical rows and any third-party ingest paths that have
-- not been wired yet.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leads_scoring_model_check'
      AND conrelid = 'public.leads'::regclass
  ) THEN
    ALTER TABLE leads
      ADD CONSTRAINT leads_scoring_model_check
      CHECK (scoring_model IS NULL OR scoring_model IN ('v2.1_form','gpt_cpi_v1'));
  END IF;
END $$;

-- Analytics often wants to slice by scoring source (e.g. conversion by engine).
-- Partial index to keep the scan cheap without an index on every null row.
CREATE INDEX IF NOT EXISTS idx_leads_scoring_model
  ON leads (scoring_model, created_at DESC)
  WHERE scoring_model IS NOT NULL;

NOTIFY pgrst, 'reload schema';
