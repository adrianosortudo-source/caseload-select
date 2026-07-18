-- Saved scan history for the canonical operator SEO tool (/admin/seo-check).
-- Distinct from seo_audit_runs, which is shaped for the prospecting-diagnostic
-- workflow (required prospect firm name, multi-domain compare, ACTS narrative
-- wrapper). This table stores plain single-domain SeoCheckResult scans so the
-- daily-use operator tool has its own save/list/load history without being
-- forced into the prospecting UX. Operator-only through service-role routes.

CREATE TABLE IF NOT EXISTS public.seo_check_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  scan_mode text NOT NULL DEFAULT 'quick'
    CHECK (scan_mode IN ('quick','standard','deep')),
  pages_scanned integer NOT NULL DEFAULT 0
    CHECK (pages_scanned >= 0),
  overall_score integer
    CHECK (overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100)),
  ai_search_score integer
    CHECK (ai_search_score IS NULL OR (ai_search_score >= 0 AND ai_search_score <= 100)),
  ai_policy_score integer
    CHECK (ai_policy_score IS NULL OR (ai_policy_score >= 0 AND ai_policy_score <= 100)),
  grade text,
  rendering_risk text
    CHECK (rendering_risk IS NULL OR rendering_risk IN ('low','medium','high')),
  issue_count integer NOT NULL DEFAULT 0
    CHECK (issue_count >= 0),
  result jsonb NOT NULL,
  created_by_lawyer_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seo_check_runs_domain_created
  ON public.seo_check_runs (domain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seo_check_runs_created
  ON public.seo_check_runs (created_at DESC);

ALTER TABLE public.seo_check_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_check_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.seo_check_runs FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.seo_check_runs TO service_role;
