-- =============================================================================
-- RLS Hardening — 20260423
-- =============================================================================
-- Phase 2 of the Supabase security fix. Phase 1 (commit 064831c) split the
-- Supabase clients so server code uses SUPABASE_SERVICE_ROLE_KEY and no
-- browser bundle ships a privileged client. This migration tightens the
-- database itself so that, even if the anon key leaks, a caller cannot
-- read or mutate privileged tables.
--
-- Security model established by this migration:
--   * service_role  — bypasses RLS (Postgres BYPASSRLS grant). Used by every
--                     server-side API route via supabaseAdmin. Full access.
--   * authenticated — not used by this app. Portal uses HMAC magic links,
--                     not Supabase Auth. No policies granted.
--   * anon          — used ONLY by the edge middleware (src/proxy.ts) for the
--                     custom-domain → firm lookup. Narrowly permitted to
--                     SELECT (id, custom_domain) on intake_firms where
--                     custom_domain IS NOT NULL. Nothing else.
--
-- Changes:
--   1. Enable (and FORCE) RLS on 4 tables created without it:
--      conflict_register, conflict_checks, industry_benchmarks,
--      retainer_agreements.
--   2. Drop every permissive USING(true) / WITH CHECK(true) policy in the
--      public schema. These are the default policies added by the Dashboard
--      "Enable RLS" button and are a security anti-pattern when access is
--      already mediated by service_role.
--   3. Revoke broad grants on intake_firms from anon and grant back only
--      column-level SELECT(id, custom_domain), then add a row-filter policy
--      so anon can only see rows where a custom_domain is configured.
--   4. Lock search_path on the three exposed functions flagged by Supabase's
--      linter: get_dashboard_stats, touch_updated_at, make_channels.
--
-- Idempotent: every statement is IF EXISTS / IF NOT EXISTS / upsert-style.
-- Safe to re-run.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enable RLS on privileged tables created without it
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS public.conflict_register     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.conflict_checks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.industry_benchmarks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.retainer_agreements   ENABLE ROW LEVEL SECURITY;

-- FORCE RLS also applies policies to table owners. Service role retains its
-- BYPASSRLS grant and is unaffected; this closes a loophole where a role
-- happens to own the table.
ALTER TABLE IF EXISTS public.conflict_register     FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.conflict_checks       FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.industry_benchmarks   FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.retainer_agreements   FORCE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Drop all permissive USING(true) / WITH CHECK(true) policies in public
-- ─────────────────────────────────────────────────────────────────────────────
-- These were auto-created when RLS was toggled on via the Dashboard UI. They
-- allow any anon/authenticated caller unlimited access to the row. Service
-- role reads bypass RLS anyway, so dropping them does not affect server code.
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        qual       = 'true'
        OR with_check = 'true'
      )
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
-- 3. Narrow anon access on intake_firms (middleware custom-domain lookup)
-- ─────────────────────────────────────────────────────────────────────────────
-- The Edge middleware (src/proxy.ts) issues:
--   GET /rest/v1/intake_firms?select=id&custom_domain=eq.<hostname>&limit=1
-- with the anon key. Every other read/write on intake_firms is done server-side
-- with the service role. We lock anon down to exactly what the middleware needs.

-- Ensure RLS is on (no-op if already).
ALTER TABLE IF EXISTS public.intake_firms ENABLE ROW LEVEL SECURITY;

-- Strip every grant anon may have on the base table.
REVOKE ALL ON TABLE public.intake_firms FROM anon;

-- Grant back only the two columns the middleware needs.
-- Column-level SELECT: PostgREST will 401/403 on `select=*` and permit
-- `select=id,custom_domain` or subsets.
GRANT SELECT (id, custom_domain) ON public.intake_firms TO anon;

-- Row filter: only rows with a custom_domain set. Firms without a white-label
-- domain are invisible to anon entirely.
DROP POLICY IF EXISTS anon_read_intake_firms_domain_lookup ON public.intake_firms;
CREATE POLICY anon_read_intake_firms_domain_lookup
  ON public.intake_firms
  FOR SELECT
  TO anon
  USING (custom_domain IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Lock search_path on flagged functions
-- ─────────────────────────────────────────────────────────────────────────────
-- Functions without a fixed search_path can be hijacked if an attacker can
-- create objects in any schema the function resolves through. Pinning the
-- search_path to 'public, pg_catalog' eliminates the ambiguity. We iterate
-- pg_proc so we do not need to know each function's argument signature up
-- front and the migration stays stable across overloaded or future-edited
-- versions.
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


-- =============================================================================
-- Post-apply verification queries (run manually to confirm state)
-- =============================================================================
--
-- -- RLS enabled on all privileged tables:
-- SELECT relname, relrowsecurity, relforcerowsecurity
-- FROM pg_class
-- WHERE relnamespace = 'public'::regnamespace
--   AND relname IN ('conflict_register','conflict_checks','industry_benchmarks',
--                   'retainer_agreements','intake_firms','matter_routing')
-- ORDER BY relname;
--
-- -- No permissive policies remain:
-- SELECT schemaname, tablename, policyname, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND (qual = 'true' OR with_check = 'true');
-- -- Expected: 0 rows.
--
-- -- Anon's only grant on intake_firms is column-level SELECT:
-- SELECT grantee, privilege_type, column_name
-- FROM information_schema.column_privileges
-- WHERE table_schema = 'public' AND table_name = 'intake_firms' AND grantee = 'anon'
-- ORDER BY column_name;
-- -- Expected: (anon, SELECT, id) and (anon, SELECT, custom_domain).
--
-- -- Function search_paths locked:
-- SELECT n.nspname, p.proname, p.proconfig
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname IN ('get_dashboard_stats','touch_updated_at','make_channels');
-- -- Expected: proconfig contains 'search_path=public, pg_catalog' for each.
-- =============================================================================
