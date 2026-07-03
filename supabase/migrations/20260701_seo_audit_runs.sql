-- Internal SEO/prospecting diagnostic history.
-- Operator-only through service-role API routes. These scans can include
-- competitor notes and outreach strategy, so do not expose them to anon or
-- authenticated browser clients directly.

CREATE TABLE IF NOT EXISTS public.seo_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_firm_name text NOT NULL,
  primary_domain text NOT NULL,
  market text,
  practice_focus text,
  target_keyword text,
  alternate_domains text[] NOT NULL DEFAULT '{}',
  competitor_domains text[] NOT NULL DEFAULT '{}',
  scan_mode text NOT NULL DEFAULT 'quick'
    CHECK (scan_mode IN ('quick','standard','deep')),
  pages_scanned integer NOT NULL DEFAULT 0
    CHECK (pages_scanned >= 0),
  total_pages_scanned integer NOT NULL DEFAULT 0
    CHECK (total_pages_scanned >= 0),
  overall_score integer
    CHECK (overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100)),
  ai_search_score integer
    CHECK (ai_search_score IS NULL OR (ai_search_score >= 0 AND ai_search_score <= 100)),
  intent_score integer
    CHECK (intent_score IS NULL OR (intent_score >= 0 AND intent_score <= 100)),
  prospect_fit_score integer
    CHECK (prospect_fit_score IS NULL OR (prospect_fit_score >= 0 AND prospect_fit_score <= 100)),
  website_maturity text
    CHECK (website_maturity IS NULL OR website_maturity IN ('poor','basic','decent','strong')),
  urgency_level text
    CHECK (urgency_level IS NULL OR urgency_level IN ('low','medium','high','urgent')),
  diagnostic jsonb NOT NULL,
  scans jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_operator_firm_id uuid,
  created_by_lawyer_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seo_audit_runs_domain_created
  ON public.seo_audit_runs (primary_domain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seo_audit_runs_created
  ON public.seo_audit_runs (created_at DESC);

ALTER TABLE public.seo_audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_audit_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.seo_audit_runs FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.seo_audit_runs TO service_role;
