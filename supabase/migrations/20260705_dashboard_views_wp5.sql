-- CRM Migration Plan §6.1 note 3, WP-5: dashboard saved views.
--
-- "View" is the query primitive; every chart binds to a saved view. Three
-- productized default boards (Triage, Pipeline, Health) ship with role-scoped
-- visibility; a lawyer can Save-As a personal copy with adjusted filters.
--
-- owner is nullable: a NULL owner is a firm-wide default view (visible to
-- every lawyer at the firm); a non-null owner is that lawyer's personal copy.

BEGIN;

CREATE TABLE IF NOT EXISTS public.dashboard_views (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id     uuid        NOT NULL REFERENCES public.intake_firms(id) ON DELETE CASCADE,
  owner       text,                                    -- firm_lawyers.id, or NULL for firm default / operator
  board_key   text        NOT NULL,                     -- 'triage' | 'pipeline' | 'health'
  name        text        NOT NULL,
  filters     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_default  boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_views_board_key_check') THEN
    ALTER TABLE public.dashboard_views
      ADD CONSTRAINT dashboard_views_board_key_check
        CHECK (board_key IN ('triage', 'pipeline', 'health'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dashboard_views_firm_board
  ON public.dashboard_views (firm_id, board_key, owner);

ALTER TABLE public.dashboard_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_views FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.dashboard_views FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.dashboard_views TO service_role;

COMMIT;
