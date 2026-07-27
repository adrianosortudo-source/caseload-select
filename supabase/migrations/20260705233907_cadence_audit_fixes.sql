-- Audit fix (2026-07-05 sprint audit, critical finding): the three cadence
-- idempotency keys were PARTIAL unique indexes, which Postgres cannot infer
-- as an ON CONFLICT arbiter from the bare column list PostgREST emits for
-- supabase-js `.upsert(..., { onConflict })`. Every enrollment and ledger
-- upsert therefore errored 42P10 at runtime (reproduced against prod before
-- this fix), the runner swallowed the enrollment error, and the shadow
-- ledger stayed silently empty.
--
-- Fix: real UNIQUE constraints, which ON CONFLICT (col, col) infers.
-- Semantics check per constraint (default NULLS DISTINCT):
--   (cadence_key, matter_id): lead-only runs carry matter_id NULL and never
--     collide with each other; matter runs are unique per key. Same as the
--     old partial index.
--   (cadence_key, screened_lead_id): matter runs also carry a lead id, but a
--     lead maps to at most one matter (client_matters.source_screened_lead_id
--     is unique) and no cadence key is both stage-sourced and lead-sourced,
--     so this is never violated by a legitimate insert. Rows with NULL lead
--     never collide.
--   (cadence_run_id, step_number): NULL run ids never collide; per-run steps
--     are unique. Same as the old partial index.

BEGIN;

DROP INDEX IF EXISTS public.uq_cadence_runs_key_matter;
ALTER TABLE public.cadence_runs
  ADD CONSTRAINT uq_cadence_runs_key_matter UNIQUE (cadence_key, matter_id);

DROP INDEX IF EXISTS public.uq_cadence_runs_key_lead;
ALTER TABLE public.cadence_runs
  ADD CONSTRAINT uq_cadence_runs_key_lead UNIQUE (cadence_key, screened_lead_id);

DROP INDEX IF EXISTS public.uq_outbound_messages_run_step;
ALTER TABLE public.outbound_messages
  ADD CONSTRAINT uq_outbound_messages_run_step UNIQUE (cadence_run_id, step_number);

COMMIT;
