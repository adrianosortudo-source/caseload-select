-- Security lockdown 2026-06-05
-- Closes: anon SELECT * on intake_firms (firm-token leak future-tense risk),
-- SECURITY DEFINER functions callable by anon/authenticated, mutable function
-- search_paths, and PostgREST-default wide CRUD grants to anon/authenticated on
-- every public-schema table. App access is exclusively service-role except
-- for the edge-middleware host lookup, which now sees only (id, custom_domain,
-- subdomain) on intake_firms.
--
-- PROVENANCE NOTE (2026-06-09, launch audit H7): this migration was applied to
-- the live project on 2026-06-05 via the Supabase MCP (ledger version
-- 20260605175457) but the SQL file was never committed to the repo. This file
-- is the byte-faithful recovery of the ledger's statements column so that a
-- rebuild, branch, or db push reproduces the lockdown. The filename carries the
-- full ledger timestamp so the CLI reconciles it as already applied.

-- ============================================================
-- 1) intake_firms: column-scoped anon SELECT for host lookup
-- ============================================================
DROP POLICY IF EXISTS anon_read_intake_firms_domain_lookup ON public.intake_firms;
REVOKE ALL ON public.intake_firms FROM anon, authenticated;
GRANT SELECT (id, custom_domain, subdomain) ON public.intake_firms TO anon;
CREATE POLICY anon_read_intake_firms_host_lookup
  ON public.intake_firms
  FOR SELECT TO anon
  USING (custom_domain IS NOT NULL OR subdomain IS NOT NULL);

-- ============================================================
-- 2) Revoke wide CRUD grants on every server-only public table
-- ============================================================
REVOKE ALL ON public.channel_intake_sessions       FROM anon, authenticated;
REVOKE ALL ON public.client_matters                FROM anon, authenticated;
REVOKE ALL ON public.conflict_checks               FROM anon, authenticated;
REVOKE ALL ON public.conflict_register             FROM anon, authenticated;
REVOKE ALL ON public.diagnostics                   FROM anon, authenticated;
REVOKE ALL ON public.discovery_reports             FROM anon, authenticated;
REVOKE ALL ON public.email_sequences               FROM anon, authenticated;
REVOKE ALL ON public.explainer_articles            FROM anon, authenticated;
REVOKE ALL ON public.firm_decline_templates        FROM anon, authenticated;
REVOKE ALL ON public.firm_file_events              FROM anon, authenticated;
REVOKE ALL ON public.firm_files                    FROM anon, authenticated;
REVOKE ALL ON public.firm_lawyers                  FROM anon, authenticated;
REVOKE ALL ON public.firm_onboarding_intake        FROM anon, authenticated;
REVOKE ALL ON public.industry_benchmarks           FROM anon, authenticated;
REVOKE ALL ON public.intake_sessions               FROM anon, authenticated;
REVOKE ALL ON public.law_firm_clients              FROM anon, authenticated;
REVOKE ALL ON public.leads                         FROM anon, authenticated;
REVOKE ALL ON public.matter_explainer_assignments  FROM anon, authenticated;
REVOKE ALL ON public.matter_message_recipients     FROM anon, authenticated;
REVOKE ALL ON public.matter_messages               FROM anon, authenticated;
REVOKE ALL ON public.matter_routing                FROM anon, authenticated;
REVOKE ALL ON public.matter_stage_events           FROM anon, authenticated;
REVOKE ALL ON public.notification_outbox           FROM anon, authenticated;
REVOKE ALL ON public.retainer_agreements           FROM anon, authenticated;
REVOKE ALL ON public.review_requests               FROM anon, authenticated;
REVOKE ALL ON public.screened_leads                FROM anon, authenticated;
REVOKE ALL ON public.sequence_steps                FROM anon, authenticated;
REVOKE ALL ON public.sequence_templates            FROM anon, authenticated;
REVOKE ALL ON public.state_history                 FROM anon, authenticated;
REVOKE ALL ON public.sub_type_conflicts            FROM anon, authenticated;
REVOKE ALL ON public.unconfirmed_inquiries         FROM anon, authenticated;
REVOKE ALL ON public.voice_callback_requests       FROM anon, authenticated;
REVOKE ALL ON public.webhook_outbox                FROM anon, authenticated;

-- ============================================================
-- 3) Lock down SECURITY DEFINER functions to service_role only
--    service_role has its own explicit EXECUTE grant — these
--    REVOKEs do not touch it.
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.fn_firm_lawyers_send_invitation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_cron_health()                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_stats()              FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 4) Pin search_path on trigger functions
-- ============================================================
ALTER FUNCTION public.fn_firm_files_touch_updated_at()       SET search_path = pg_catalog, public;
ALTER FUNCTION public.clear_token_alert_on_expiry_change()   SET search_path = pg_catalog, public;
