-- Agency CRM (Layer B): the operator's own pipeline for selling CaseLoad Select retainers.
-- Single-tenant (operator-only). This is NOT client data and is NOT part of the C3 client
-- lead/matter dual-run; these tables are net-new and isolated, safe to apply on their own.
-- Service-role only: RLS forced + anon/authenticated/PUBLIC revoked (new public tables are born exposed).

CREATE TABLE IF NOT EXISTS public.agency_prospects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_name     text NOT NULL,
  contact_name  text,
  contact_email text,
  contact_phone text,
  city          text,
  practice_area text,
  source        text,                          -- toronto_law_firms_db | outscraper | referral | inbound | other
  stage         text NOT NULL DEFAULT 'new'
    CHECK (stage IN ('new','researching','contacted','diagnostic_sent','pitched','won','lost')),
  fit_score     integer CHECK (fit_score IS NULL OR (fit_score >= 0 AND fit_score <= 100)),  -- simple 0-100 operator fit score
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agency_prospects_stage ON public.agency_prospects (stage);

CREATE TABLE IF NOT EXISTS public.agency_deals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id   uuid NOT NULL REFERENCES public.agency_prospects(id) ON DELETE CASCADE,
  title         text NOT NULL,
  stage         text NOT NULL DEFAULT 'proposal'
    CHECK (stage IN ('proposal','negotiation','won','lost')),
  monthly_value numeric,                            -- retainer C$/mo (e.g. 3500)
  expected_close date,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agency_deals_prospect ON public.agency_deals (prospect_id);

CREATE TABLE IF NOT EXISTS public.agency_reminders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid REFERENCES public.agency_prospects(id) ON DELETE CASCADE,
  deal_id     uuid REFERENCES public.agency_deals(id) ON DELETE CASCADE,
  due_at      timestamptz NOT NULL,
  note        text NOT NULL,
  done        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agency_reminders_due ON public.agency_reminders (due_at) WHERE done = false;

ALTER TABLE public.agency_prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_prospects FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.agency_prospects FROM anon, authenticated, PUBLIC;

ALTER TABLE public.agency_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_deals FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.agency_deals FROM anon, authenticated, PUBLIC;

ALTER TABLE public.agency_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_reminders FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.agency_reminders FROM anon, authenticated, PUBLIC;
