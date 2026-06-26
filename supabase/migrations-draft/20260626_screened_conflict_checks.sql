-- H4: Canonical conflict-check schema rooted on screened_leads / intake_firms.
--
-- WHY: The legacy conflict_checks / conflict_register tables FK to the
-- legacy leads / law_firm_clients tables. New intake flows use screened_leads
-- and intake_firms exclusively. The canonical tables here are additive; the
-- legacy tables are left intact for historical paths.
--
-- Tables:
--   screened_conflict_checks  -- one check per matter, human-dispositioned
--   screened_conflict_parties -- searchable adverse parties for each check
--
-- RLS: service-role only (anon / authenticated / PUBLIC revoked).
-- No FK to legacy tables.

-- ── screened_conflict_checks ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.screened_conflict_checks (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Core FKs (canonical tables only)
  firm_id               UUID NOT NULL REFERENCES public.intake_firms(id) ON DELETE CASCADE,
  screened_lead_id      UUID NOT NULL REFERENCES public.screened_leads(id) ON DELETE CASCADE,
  matter_id             UUID REFERENCES public.client_matters(id) ON DELETE SET NULL,

  -- Check lifecycle
  check_status          TEXT NOT NULL DEFAULT 'pending'
                          CHECK (check_status IN (
                            'pending',    -- created, awaiting review
                            'potential',  -- similarity found, needs human review
                            'cleared',    -- human confirmed: no conflict
                            'waived',     -- human waived: conflict acknowledged, consent on file
                            'blocked'     -- human confirmed: conflict exists, matter blocked
                          )),
  check_type            TEXT NOT NULL DEFAULT 'intake'
                          CHECK (check_type IN (
                            'intake',       -- triggered at intake / Band A take
                            'matter_stage', -- triggered at stage-gate crossing
                            'manual'        -- operator-initiated
                          )),

  -- Human disposition (all three must be set together when resolving)
  disposition           TEXT CHECK (disposition IN ('cleared', 'waived', 'blocked')),
  dispositioned_by      TEXT,       -- actor id (firm_lawyers.id or 'operator')
  dispositioned_at      TIMESTAMPTZ,
  notes                 TEXT,

  -- Optional consent or waiver reference (FK to consent_log once that migration is applied)
  waiver_consent_id     UUID,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable and force RLS
ALTER TABLE public.screened_conflict_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screened_conflict_checks FORCE ROW LEVEL SECURITY;

-- Revoke all access from roles that must not read conflict data
REVOKE ALL ON public.screened_conflict_checks FROM anon;
REVOKE ALL ON public.screened_conflict_checks FROM authenticated;
REVOKE ALL ON public.screened_conflict_checks FROM PUBLIC;

-- Service-role bypass: pg_role 'service_role' already bypasses RLS by default.
-- No explicit policy needed; the REVOKE above ensures anon/authenticated cannot read.

-- Indexes for gate and lookup performance
CREATE INDEX IF NOT EXISTS idx_screened_conflict_checks_matter_id
  ON public.screened_conflict_checks (matter_id, created_at DESC)
  WHERE matter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_screened_conflict_checks_screened_lead_id
  ON public.screened_conflict_checks (screened_lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_screened_conflict_checks_firm_status
  ON public.screened_conflict_checks (firm_id, check_status, created_at DESC);

-- ── screened_conflict_parties ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.screened_conflict_parties (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conflict_check_id     UUID NOT NULL
                          REFERENCES public.screened_conflict_checks(id) ON DELETE CASCADE,
  firm_id               UUID NOT NULL REFERENCES public.intake_firms(id) ON DELETE CASCADE,

  -- Searchable name fields
  party_name            TEXT NOT NULL,     -- normalized (lowercase, trimmed)
  party_name_raw        TEXT NOT NULL,     -- as entered by the reviewer
  party_role            TEXT NOT NULL
                          CHECK (party_role IN (
                            'client',
                            'opposing_party',
                            'related_party',
                            'third_party'
                          )),
  is_active             BOOLEAN NOT NULL DEFAULT true,

  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable and force RLS
ALTER TABLE public.screened_conflict_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screened_conflict_parties FORCE ROW LEVEL SECURITY;

-- Revoke all access
REVOKE ALL ON public.screened_conflict_parties FROM anon;
REVOKE ALL ON public.screened_conflict_parties FROM authenticated;
REVOKE ALL ON public.screened_conflict_parties FROM PUBLIC;

-- Indexes for party search
CREATE INDEX IF NOT EXISTS idx_screened_conflict_parties_name
  ON public.screened_conflict_parties (party_name text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_screened_conflict_parties_check_id
  ON public.screened_conflict_parties (conflict_check_id);

CREATE INDEX IF NOT EXISTS idx_screened_conflict_parties_firm_active
  ON public.screened_conflict_parties (firm_id, is_active, party_name text_pattern_ops);
