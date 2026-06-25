-- =============================================================================
-- DRAFT, NOT APPLIED. Phase 1 expand-phase migration (gated by the C3 dual-run
-- runbook: CRM_Research/CRM-DUAL-RUN-ROLLBACK-RUNBOOK-v1.md).
--
-- This file lives in supabase/migrations-draft/ on purpose: `supabase db push`
-- only reads supabase/migrations/, so it CANNOT pick this up. To apply, only
-- after the C3 runbook is approved: move this file into supabase/migrations/,
-- apply it, then run the backfill (plan below).
--
-- SCOPE (deliberately narrow): only the additive scoring-delta columns on
-- screened_leads + the backfill path that uses computeScorePort. NO read-surface
-- cutover, NO comms rails, NO conflict/consent tables. This is the smallest,
-- lowest-risk first step of the expand phase (runbook section 3, row 1).
--
-- NON-DESTRUCTIVE. The existing four-axis columns are preserved untouched:
--   value_score, complexity_score, urgency_score, readiness_score,
--   readiness_answered, band, band_c_subtrack  (verified live 2026-06-25).
--
-- RLS / GRANTS UNCHANGED. screened_leads is CLS-sensitive (service-role only):
-- RLS is forced and the 20260605 lockdown REVOKEd anon/authenticated at the
-- TABLE level, which covers future columns too. ADD COLUMN does not re-grant,
-- so the new columns inherit the service-role-only posture. No GRANT/REVOKE and
-- no RLS statements belong in this migration; adding them would be a mistake.
-- =============================================================================

-- ── Additive columns (idempotent) ───────────────────────────────────────────
ALTER TABLE public.screened_leads
  ADD COLUMN IF NOT EXISTS score_confidence     text,    -- high | medium | low (C1)
  ADD COLUMN IF NOT EXISTS score_completeness   numeric, -- weighted completeness ratio 0..1 (C1)
  ADD COLUMN IF NOT EXISTS score_explanation    text,    -- synthesized "why this score" (C2)
  ADD COLUMN IF NOT EXISTS score_missing_fields jsonb,   -- [{ slot_id, label }] unanswered scoring inputs (C3)
  ADD COLUMN IF NOT EXISTS field_provenance     jsonb,   -- { slot_id: confirmed|inferred|unknown } (refinement 8.2)
  ADD COLUMN IF NOT EXISTS score_version        integer, -- bumps on re-score (C4, forward-only DR-059)
  ADD COLUMN IF NOT EXISTS calibration_version  integer; -- reserved for per-firm recalibration (C5)

-- ── Value guards (idempotent; nullable until the backfill stamps them) ───────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'screened_leads_score_confidence_chk') THEN
    ALTER TABLE public.screened_leads
      ADD CONSTRAINT screened_leads_score_confidence_chk
      CHECK (score_confidence IS NULL OR score_confidence IN ('high', 'medium', 'low'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'screened_leads_score_completeness_chk') THEN
    ALTER TABLE public.screened_leads
      ADD CONSTRAINT screened_leads_score_completeness_chk
      CHECK (score_completeness IS NULL OR (score_completeness >= 0 AND score_completeness <= 1));
  END IF;
END $$;

-- =============================================================================
-- BACKFILL PLAN (NOT executed here). The scoring-delta values are computed in
-- TypeScript via computeScorePort (src/lib/scoring-port.ts), so the backfill is
-- a batched node script run AFTER this migration applies, not pure SQL.
--
-- Per row of screened_leads where matter_type NOT IN ('out_of_scope','unknown')
-- AND firm_id IS NOT NULL (quarantine null-firm rows, runbook section 7):
--   1. state := row.slot_answers           -- slot_answers IS the serialized EngineState
--   2. band  := row.band                   -- (or computeBand(state) if band is null)
--   3. port  := computeScorePort(state, band)
--   4. cols  := scorePortToColumns(port, /* score_version */ 1)
--               -- src/lib/scoring-port-persistence.ts
--   5. UPDATE public.screened_leads
--        SET score_confidence     = cols.score_confidence,
--            score_completeness   = cols.score_completeness,
--            score_explanation    = cols.score_explanation,
--            score_missing_fields = cols.score_missing_fields,   -- jsonb
--            field_provenance     = cols.field_provenance,       -- jsonb
--            score_version        = cols.score_version,          -- 1
--            updated_at           = now()
--      WHERE id = row.id;
--
-- Idempotency: keyed on screened_leads.id; recompute is safe and forward-only
-- (DR-059, no historical recompute beyond this one explicit one-shot). Batch
-- (e.g. 500 rows per transaction). requires_human_review is NOT a column: it is
-- derived from band + score_confidence at routing time.
-- =============================================================================
