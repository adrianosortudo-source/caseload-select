-- =============================================================================
-- Phase 1 expand-phase migration (C3 dual-run runbook approved 2026-06-25).
-- APPLIED to prod (ssxryjxifwiivghglqer) 2026-06-25 via MCP apply_migration.
-- In supabase/migrations/ so `supabase db push` tracks it; fully idempotent, so
-- a re-run (or a db push that re-applies) is a harmless no-op.
--
-- SCOPE (deliberately narrow): only the additive scoring-delta columns on
-- screened_leads. NO read-surface cutover, NO comms rails, NO conflict/consent
-- tables. The smallest, lowest-risk first step of the expand phase (runbook
-- section 3, row 1). The columns are not read by any surface yet: reads stay on
-- the legacy/Screen path until each surface's read-shadow is green (runbook 6).
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
-- BACKFILL (NOT run by this migration). The scoring-delta values are computed in
-- TypeScript via computeScorePort (src/lib/scoring-port.ts), so the backfill is
-- a batched job run AFTER this migration, not pure SQL. Reference implementation:
-- scripts/backfill-scoring-delta.mjs (staged, not yet executed).
--
-- Per row of screened_leads where matter_type NOT IN ('out_of_scope','unknown')
-- AND firm_id IS NOT NULL (quarantine null-firm rows, runbook section 7):
--   1. state := row.slot_answers           -- slot_answers IS the serialized EngineState
--   2. band  := row.band                   -- (or computeBand(state) if band is null)
--   3. port  := computeScorePort(state, band)
--   4. cols  := scorePortToColumns(port, /* score_version */ 1)
--               -- src/lib/scoring-port-persistence.ts
--   5. UPDATE public.screened_leads SET (the 6 value columns) ... WHERE id = row.id;
--
-- Idempotency: keyed on screened_leads.id; recompute is safe and forward-only
-- (DR-059). After the backfill, run the read-shadow checks (runbook section 6)
-- before any surface reads these columns. requires_human_review is NOT a column:
-- it is derived from band + score_confidence at routing time.
-- =============================================================================
