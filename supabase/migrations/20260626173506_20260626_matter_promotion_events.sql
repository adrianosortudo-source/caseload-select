-- H3 MATTER PROMOTION EVENTS: idempotency / observability table for take-to-matter.
--
-- APPLIED to prod (ssxryjxifwiivghglqer) 2026-06-26 via MCP apply_migration.
-- logPromotionEvent wired into take/route.ts at 4 points (same session).
--
-- WHY:
--   createMatterFromBandATake is best-effort: the take route returns 200
--   even when matter creation fails, relying on operator backfill. This table
--   makes silently missed matters discoverable without Vercel log access.
--
-- HOW TO FIND BROKEN PROMOTIONS:
--   SELECT e.screened_lead_id, e.lawyer_id, e.error_text, e.created_at
--   FROM matter_promotion_events e
--   WHERE e.event_type = 'matter_failed';
--
--   -- Takes that have no corresponding outcome event:
--   SELECT e.*
--   FROM matter_promotion_events e
--   WHERE e.event_type = 'take_recorded'
--     AND NOT EXISTS (
--       SELECT 1 FROM matter_promotion_events e2
--       WHERE e2.screened_lead_id = e.screened_lead_id
--         AND e2.event_type IN ('matter_created', 'matter_skipped', 'matter_failed')
--     );
--
-- DR reference: H3 (Codex audit v2, take-to-matter atomicity).

BEGIN;

CREATE TABLE IF NOT EXISTS public.matter_promotion_events (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  screened_lead_id    UUID        NOT NULL,  -- the lead being taken (NOT a FK)
  firm_id             UUID        NOT NULL REFERENCES public.intake_firms(id) ON DELETE CASCADE,
  lawyer_id           TEXT        NOT NULL,  -- session actor id
  event_type          TEXT        NOT NULL,
  matter_id           UUID,                  -- null until matter is created
  error_text          TEXT,                  -- populated on matter_failed
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_promotion_events_event_type_check') THEN
    ALTER TABLE public.matter_promotion_events
      ADD CONSTRAINT matter_promotion_events_event_type_check
        CHECK (event_type IN ('take_recorded', 'matter_created', 'matter_skipped', 'matter_failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_matter_promotion_events_lead
  ON public.matter_promotion_events (screened_lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_matter_promotion_events_firm
  ON public.matter_promotion_events (firm_id, event_type, created_at DESC);

ALTER TABLE public.matter_promotion_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_promotion_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.matter_promotion_events FROM anon;
REVOKE ALL ON public.matter_promotion_events FROM authenticated;
REVOKE ALL ON public.matter_promotion_events FROM PUBLIC;

GRANT ALL ON public.matter_promotion_events TO service_role;

COMMIT;
