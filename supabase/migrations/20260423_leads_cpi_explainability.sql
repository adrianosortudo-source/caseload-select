-- CPI Explainability columns for leads (v2.2 scoring engine)
-- =============================================================================
-- computeScore() in src/lib/scoring.ts returns three fields that persist
-- the "why this band" rationale for each lead:
--   - confidence:     high | medium | low  - weighted data completeness
--   - explanation:    1-3 sentence plain-English summary
--   - missing_fields: string[] of human-readable labels
--
-- These columns are read by the incomplete-intake nudge cron
-- (src/lib/incomplete-intake.ts), the admin lead detail page
-- (src/app/leads/[id]/page.tsx), and the portal lead detail page
-- (src/app/portal/[firmId]/leads/[leadId]/page.tsx).
--
-- Code follow-up: src/app/api/otp/verify/route.ts currently writes cpi_score
-- and priority_index but not the explainability fields returned by
-- computeScore(). A subsequent code change wires the write-back; this
-- migration lands the columns so that change cannot fail on missing schema.
-- =============================================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS cpi_confidence     text,
  ADD COLUMN IF NOT EXISTS cpi_explanation    text,
  ADD COLUMN IF NOT EXISTS cpi_missing_fields jsonb;

-- Enforce the confidence domain. Named constraint so a future rewrite can
-- ALTER/DROP it by name without a schema sniff. NULL allowed for historical
-- rows and for rows created before explainability is wired into the insert.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leads_cpi_confidence_check'
      AND conrelid = 'public.leads'::regclass
  ) THEN
    ALTER TABLE leads
      ADD CONSTRAINT leads_cpi_confidence_check
      CHECK (cpi_confidence IS NULL OR cpi_confidence IN ('high','medium','low'));
  END IF;
END $$;

-- The incomplete-intake cron filters on cpi_confidence='low' among recent
-- leads; a partial index keeps that scan tight even once the leads table grows.
CREATE INDEX IF NOT EXISTS idx_leads_cpi_confidence_recent
  ON leads (cpi_confidence, created_at DESC)
  WHERE cpi_confidence = 'low';

NOTIFY pgrst, 'reload schema';
