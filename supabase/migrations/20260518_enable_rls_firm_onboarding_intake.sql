-- =============================================================================
-- Enable Row Level Security on firm_onboarding_intake
-- =============================================================================
-- Fixes a pre-existing security advisory surfaced during the 2026-05-18
-- ca-central-1 migration audit:
--
--   "1 table(s) have Row Level Security (RLS) disabled: public.firm_onboarding_intake.
--    These tables are fully exposed to the anon and authenticated roles used by
--    Supabase client libraries."
--
-- The table stores PII collected from the firm onboarding form
-- (legal_name, business_address, authorized_rep_email, verification_doc_storage_path
-- and dozens of other operator-collected fields). Leaking the anon key would
-- previously expose every row. After this migration:
--
--   * RLS is on. anon and authenticated roles see nothing.
--   * Server code uses SUPABASE_SERVICE_ROLE_KEY which has BYPASSRLS, so it
--     keeps full access without any explicit policy. The firm onboarding form
--     routes through /api/firm-onboarding/* endpoints (server-side) that use
--     the service role client.
--
-- No public-facing client should ever talk to this table directly via the anon
-- key. If a public route appears in the future that needs to write to this
-- table from the browser, it should POST to an API route using the service
-- role, not call Supabase from the client.
--
-- This migration is idempotent: enabling RLS twice is a no-op in Postgres.

ALTER TABLE public.firm_onboarding_intake ENABLE ROW LEVEL SECURITY;

-- Optional explicit deny-everyone policy for documentation. service_role
-- continues to bypass RLS regardless of this. Anon and authenticated get
-- no access because there is no policy that includes them.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'firm_onboarding_intake'
      AND policyname = 'firm_onboarding_intake_service_role_only'
  ) THEN
    CREATE POLICY firm_onboarding_intake_service_role_only
      ON public.firm_onboarding_intake
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
