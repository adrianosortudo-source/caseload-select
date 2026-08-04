-- =============================================================================
-- RLS Hardening — Full Sweep  20260423 (follow-up to rls_hardening + rls_hardening_fix)
-- =============================================================================
-- Context: live DB audit revealed the first rls_hardening migration only landed
-- on intake_firms. Every other privileged table in public still has:
--   * RLS off (conflict_checks, conflict_register, industry_benchmarks,
--     retainer_agreements), or
--   * a permissive USING(true) / WITH CHECK(true) policy granting anon full
--     access via the {public} role (leads, intake_sessions, email_sequences,
--     sequence_steps, sequence_templates, review_requests, state_history,
--     law_firm_clients, discovery_reports)
--   * direct ALL-privileges grants to anon at the table level
--
-- Shape of the defect: dashboard-button "Enable RLS" permissive defaults plus
-- table-creation grants that default to including anon. The intake_firms fix
-- was a single-table patch; this migration applies the same pattern across
-- every public table so the same class of defect is resolved everywhere.
--
-- Strategy:
--   1. Enable + FORCE RLS on every public table that has it off.
--   2. Drop every permissive qual='true' / with_check='true' policy in public.
--   3. REVOKE ALL from anon and PUBLIC on every public table except the one
--      whitelisted anon read path (public.intake_firms). The narrow
--      column-level GRANT for anon on (id, custom_domain) stays intact,
--      combined with the anon_read_intake_firms_domain_lookup row policy.
--   4. Lock search_path on the 3 flagged SECURITY-sensitive functions.
--   5. Reload PostgREST schema cache.
--
-- All reads/writes for the app go through service_role (BYPASSRLS). So
-- stripping anon from every other table cannot break any server-side code
-- path. If any client-side code is still issuing anon reads to these tables
-- it was already a data-exposure bug; this migration surfaces it instead of
-- masking it.
--
-- Idempotent. Safe to re-run.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enable + FORCE RLS on every public table that currently has it off
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',  t.relname);
    RAISE NOTICE 'RLS enabled+forced on public.%', t.relname;
  END LOOP;
END
$$;

-- Also FORCE RLS on tables that already had it enabled but not forced.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND NOT c.relforcerowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t.relname);
    RAISE NOTICE 'RLS forced on public.%', t.relname;
  END LOOP;
END
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Drop every permissive USING(true) / WITH CHECK(true) policy in public
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual = 'true' OR with_check = 'true')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      pol.policyname, pol.schemaname, pol.tablename
    );
    RAISE NOTICE 'Dropped permissive policy: %.% -> %',
      pol.schemaname, pol.tablename, pol.policyname;
  END LOOP;
END
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Strip anon + PUBLIC + authenticated grants from every public table
--    (except intake_firms, which keeps its narrow column-level GRANT)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname <> 'intake_firms'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon',          t.relname);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t.relname);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',        t.relname);
    RAISE NOTICE 'Stripped grants on public.%', t.relname;
  END LOOP;
END
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Lock search_path on flagged functions
-- ─────────────────────────────────────────────────────────────────────────────
-- Identical block to the first migration — idempotent, harmless if already set.
DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid,
           p.proname,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_dashboard_stats', 'touch_updated_at', 'make_channels')
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public, pg_catalog',
      fn.proname, fn.args
    );
    RAISE NOTICE 'Locked search_path on: public.%(%)', fn.proname, fn.args;
  END LOOP;
END
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Reload PostgREST schema cache
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';


-- =============================================================================
-- Post-apply verification (expected results after running this migration):
--
-- 1. No table in public with RLS off:
--    SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--    WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;
--    → 0 rows
--
-- 2. No permissive qual='true'/with_check='true' policies in public:
--    SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname='public' AND (qual='true' OR with_check='true');
--    → 0 rows
--
-- 3. anon has grants on intake_firms ONLY (and only (id, custom_domain)):
--    SELECT table_name FROM information_schema.table_privileges
--    WHERE table_schema='public' AND grantee='anon';
--    → 0 rows at the table level
--    SELECT column_name, privilege_type FROM information_schema.column_privileges
--    WHERE table_schema='public' AND grantee='anon';
--    → exactly: (custom_domain, SELECT), (id, SELECT) on intake_firms
--
-- 4. Anon probes via PostgREST:
--    GET /rest/v1/leads?select=*&limit=1                 → 401 permission denied
--    GET /rest/v1/intake_sessions?select=*&limit=1       → 401 permission denied
--    GET /rest/v1/email_sequences?select=*&limit=1       → 401 permission denied
--    GET /rest/v1/intake_firms?select=id&custom_domain=eq.<hostname>&limit=1
--                                                        → 200 (proxy.ts path)
-- =============================================================================
