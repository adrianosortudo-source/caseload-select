-- =============================================================================
-- RLS Hardening — Fix  20260423 (follow-up to 20260423_rls_hardening.sql)
-- =============================================================================
-- The first migration left intake_firms still readable by anon. Verification
-- with the anon key showed:
--   GET /rest/v1/intake_firms?select=name   → 200, returns "Sakuraba Law"
--   GET /rest/v1/intake_firms?select=*      → 200, returns full row including
--                                              practice_areas, clio_config,
--                                              ghl_webhook_url
-- while RLS-enabled tables with no anon policy (conflict_register,
-- retainer_agreements) correctly returned [].
--
-- Root cause, almost certain: a legacy permissive policy on intake_firms with
-- a qual expression that did not match qual='true' (e.g. USING(auth.role()=
-- 'anon') or USING(TRUE) with a cast). PERMISSIVE policies OR together, so
-- any one permissive policy leaves anon with full access — the narrow policy
-- we added does not restrict anything, it only expands.
--
-- Strategy: drop EVERY policy on public.intake_firms regardless of qual, then
-- recreate only the single narrow anon_read_intake_firms_domain_lookup policy.
-- Also revoke at both the anon role and the PUBLIC pseudo-role level, and
-- block anon grants that may have been layered in via schema defaults.
-- Idempotent.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Drop EVERY policy on public.intake_firms (no matter its qual)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'intake_firms'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.intake_firms',
      pol.policyname
    );
    RAISE NOTICE 'Dropped policy on intake_firms: %', pol.policyname;
  END LOOP;
END
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Force RLS on and enable it (no-op if already enabled)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.intake_firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intake_firms FORCE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Strip every grant path anon, authenticated, and PUBLIC might hold
-- ─────────────────────────────────────────────────────────────────────────────
-- Table-level REVOKE ALL cascades to column-level grants in Postgres 15+
-- which is what Supabase runs, so no separate column-level REVOKE is needed
-- (and enumerating columns risks drift with the real schema).
--
-- We hit all three grantee paths: anon (direct), authenticated (direct, not
-- used by this app but may have been granted by the Dashboard), and PUBLIC
-- (the implicit "all roles" pseudo-role — earlier migrations or the
-- Dashboard may have layered a PUBLIC grant on, and anon inherits from it).
REVOKE ALL ON TABLE public.intake_firms FROM anon;
REVOKE ALL ON TABLE public.intake_firms FROM authenticated;
REVOKE ALL ON TABLE public.intake_firms FROM PUBLIC;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Re-add only the narrow column grant anon needs
-- ─────────────────────────────────────────────────────────────────────────────
-- This is the ONLY thing anon can see on intake_firms. Combined with the
-- policy below, anon can only SELECT (id, custom_domain) for rows where a
-- custom_domain is configured.
GRANT SELECT (id, custom_domain) ON public.intake_firms TO anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Re-create the single narrow policy
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS anon_read_intake_firms_domain_lookup ON public.intake_firms;
CREATE POLICY anon_read_intake_firms_domain_lookup
  ON public.intake_firms
  FOR SELECT
  TO anon
  USING (custom_domain IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Reload PostgREST schema cache so revoked column grants take effect
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';


-- =============================================================================
-- Post-apply verification (run with anon key; expected results inline):
--
--   GET /rest/v1/intake_firms?select=*&limit=1
--     → either 401 "permission denied for column ..."
--       or [] if RLS filters everything out
--     In either case, name/practice_areas/clio_config MUST NOT appear.
--
--   GET /rest/v1/intake_firms?select=name&limit=1
--     → 401 "permission denied for column name"
--
--   GET /rest/v1/intake_firms?select=id,custom_domain
--     → 200, only rows where custom_domain IS NOT NULL
--
--   GET /rest/v1/intake_firms?select=id&custom_domain=eq.<configured-domain>
--     → 200, returns the matching firm's id  (proxy.ts still works)
-- =============================================================================
