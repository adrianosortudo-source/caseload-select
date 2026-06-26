-- H3 MATTER PROMOTION EVENTS: idempotency / observability table for take-to-matter.
--
-- STATUS: DRAFT. NOT APPLIED TO PROD.
-- Apply when the operator approves Phase 1 idempotency hardening.
-- After applying, wire logPromotionEvent into the take route
-- (src/app/api/portal/[firmId]/triage/[leadId]/take/route.ts).
--
-- WHY:
--   createMatterFromBandATake is best-effort: the take route returns 200
--   even when matter creation fails, relying on operator backfill. This table
--   makes silently missed matters discoverable without Vercel log access.
--
-- HOW TO FIND BROKEN PROMOTIONS AFTER APPLYING:
--   SELECT e.screened_lead_id, e.lawyer_id, e.error_text, e.created_at
--   FROM matter_promotion_events e
--   WHERE e.event_type = 'matter_failed';
--
--   -- Or: takes that have no corresponding matter_created or matter_skipped:
--   SELECT e.*
--   FROM matter_promotion_events e
--   WHERE e.event_type = 'take_recorded'
--     AND NOT EXISTS (
--       SELECT 1 FROM matter_promotion_events e2
--       WHERE e2.screened_lead_id = e.screened_lead_id
--         AND e2.event_type IN ('matter_created', 'matter_skipped', 'matter_failed')
--     );
--
-- DR reference: H3 (Codex audit v2 — take-to-matter atomicity).
-- Related: supabase/migrations-draft/20260626_screened_leads_consent.sql (DR-075)

BEGIN;

CREATE TABLE IF NOT EXISTS public.matter_promotion_events (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  screened_lead_id    UUID        NOT NULL,  -- the lead being taken (NOT a FK: lead may not have been persisted yet)
  firm_id             UUID        NOT NULL REFERENCES public.intake_firms(id) ON DELETE CASCADE,
  lawyer_id           TEXT        NOT NULL,  -- auth.uid of the taking lawyer
  event_type          TEXT        NOT NULL,  -- 'take_recorded' | 'matter_created' | 'matter_skipped' | 'matter_failed'
  matter_id           UUID,                  -- null until matter is created
  error_text          TEXT,                  -- populated on matter_failed
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.matter_promotion_events
  ADD CONSTRAINT IF NOT EXISTS matter_promotion_events_event_type_check
    CHECK (event_type IN ('take_recorded', 'matter_created', 'matter_skipped', 'matter_failed'));

-- Lookups by lead (check promotion status for a given intake).
CREATE INDEX IF NOT EXISTS idx_matter_promotion_events_lead
  ON public.matter_promotion_events (screened_lead_id, created_at DESC);

-- Lookups by firm (operator dashboard: find broken promotions).
CREATE INDEX IF NOT EXISTS idx_matter_promotion_events_firm
  ON public.matter_promotion_events (firm_id, event_type, created_at DESC);

-- ============================================================
-- RLS lockdown (DB Access Invariant: service-role only)
-- ============================================================

ALTER TABLE public.matter_promotion_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_promotion_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.matter_promotion_events FROM anon;
REVOKE ALL ON public.matter_promotion_events FROM authenticated;
REVOKE ALL ON public.matter_promotion_events FROM PUBLIC;

GRANT ALL ON public.matter_promotion_events TO service_role;

COMMIT;
