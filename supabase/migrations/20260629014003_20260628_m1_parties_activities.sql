-- M1: CANONICAL PARTY AND ACTIVITY TABLES
--
-- NOT YET APPLIED to prod. Apply when ready to advance from the
-- dual-read fallback path to the canonical CRM layer.
--
-- WHY:
--   The dual-read layer (src/lib/crm-dual-read.ts) already gracefully handles
--   these tables being absent: readParties() and readActivities() fall back to
--   deriving data from client_matters, matter_stage_events, matter_messages,
--   and matter_promotion_events. Once rows exist in these tables, the canonical
--   path takes over automatically with zero code changes.
--
-- ROLLBACK:
--   TRUNCATE parties, activities;
--   -- Fallback path resumes; no feature flag needed.
--
-- POST-APPLY:
--   Backfill script: scripts/backfill-m1-parties-activities.ts
--   Parity check: compareLeadParity() from crm-dual-read.ts
--
-- DR reference: M1 (CODEX-PLAN-AUDIT-v3.md: canonical party/activity tables).

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- PARTIES
--
-- Role-discriminated contact records tied to a matter.
-- One row per party per matter; deduped on name + email/phone
-- at the contact gate. Primary contact must always have is_primary=true.
--
-- Used by: readParties() in crm-dual-read.ts
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.parties (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  matter_id       UUID        NOT NULL REFERENCES public.client_matters(id) ON DELETE CASCADE,
  firm_id         UUID        NOT NULL REFERENCES public.intake_firms(id)   ON DELETE CASCADE,
  full_name       TEXT,
  email           TEXT,
  phone           TEXT,
  party_role      TEXT        NOT NULL DEFAULT 'unknown',
  is_primary      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parties_party_role_check') THEN
    ALTER TABLE public.parties
      ADD CONSTRAINT parties_party_role_check
        CHECK (party_role IN (
          'client', 'adverse', 'third_party', 'unknown',
          'prospect', 'referrer', 'lawyer', 'related'
        ));
  END IF;
END $$;

-- Enforce at most one primary party per matter
CREATE UNIQUE INDEX IF NOT EXISTS idx_parties_primary_per_matter
  ON public.parties (matter_id, firm_id)
  WHERE is_primary = TRUE;

CREATE INDEX IF NOT EXISTS idx_parties_matter
  ON public.parties (matter_id, firm_id);

CREATE INDEX IF NOT EXISTS idx_parties_firm
  ON public.parties (firm_id, created_at DESC);

ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parties FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.parties FROM anon;
REVOKE ALL ON public.parties FROM authenticated;
REVOKE ALL ON public.parties FROM PUBLIC;

GRANT ALL ON public.parties TO service_role;

-- ──────────────────────────────────────────────────────────────
-- ACTIVITIES
--
-- Polymorphic, channel-tagged timeline on every matter object.
-- The intake conversation is the origin event.
--
-- When rows exist, readActivities() uses this table directly.
-- When empty, it falls back to aggregating matter_stage_events,
-- matter_messages, and matter_promotion_events.
--
-- Used by: readActivities() in crm-dual-read.ts
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.activities (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  matter_id       UUID        NOT NULL REFERENCES public.client_matters(id) ON DELETE CASCADE,
  firm_id         UUID        NOT NULL REFERENCES public.intake_firms(id)   ON DELETE CASCADE,
  activity_type   TEXT        NOT NULL,
  title           TEXT        NOT NULL,
  body            TEXT,
  actor_role      TEXT        NOT NULL DEFAULT 'system',
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activities_activity_type_check') THEN
    ALTER TABLE public.activities
      ADD CONSTRAINT activities_activity_type_check
        CHECK (activity_type IN (
          'intake', 'stage_change', 'message', 'conflict_check', 'promotion'
        ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activities_actor_role_check') THEN
    ALTER TABLE public.activities
      ADD CONSTRAINT activities_actor_role_check
        CHECK (actor_role IN (
          'admin', 'staff', 'operator', 'system', 'lawyer', 'client'
        ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_activities_matter
  ON public.activities (matter_id, firm_id, occurred_at ASC);

CREATE INDEX IF NOT EXISTS idx_activities_firm
  ON public.activities (firm_id, activity_type, occurred_at DESC);

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.activities FROM anon;
REVOKE ALL ON public.activities FROM authenticated;
REVOKE ALL ON public.activities FROM PUBLIC;

GRANT ALL ON public.activities TO service_role;

COMMIT;
