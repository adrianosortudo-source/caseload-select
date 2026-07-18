-- Codex audit 2026-07-07, finding 2 (High): the consent_log repair sweep
-- loaded only the oldest N eligible screened_leads and skipped the ones that
-- already had a log. Once those oldest N all had evidence, any NEWER lead
-- missing its audit row was never reached: every daily tick re-scanned the
-- same covered rows and reported missing:0, looking healthy while a
-- compliance-evidence gap persisted.
--
-- This anti-join returns up to batch_limit eligible leads that have NO email
-- consent_log row, regardless of age, so the sweep repairs current gaps
-- directly instead of paging oldest-first through covered rows. NOT EXISTS is
-- age-independent by construction, so it cannot starve.
--
-- Access: SECURITY INVOKER. The only caller is the repair sweep via
-- supabaseAdmin (service_role), which bypasses RLS on both tables anyway.
-- EXECUTE is revoked from anon/authenticated/PUBLIC and granted to
-- service_role only, matching the Database Access Invariant (screened_leads
-- and consent_log are service-role-only tables).
--
-- APPLIED to prod 2026-07-07 via Supabase MCP. Verified live: function exists
-- (to_regprocedure not null); ACL is {postgres=X/postgres,service_role=X/
-- postgres} (no anon/authenticated/PUBLIC EXECUTE).

CREATE OR REPLACE FUNCTION public.find_leads_missing_email_consent_log(batch_limit integer)
RETURNS TABLE (
  id                        uuid,
  firm_id                   uuid,
  email_consent_status      text,
  email_consent_captured_at timestamptz,
  six_month_expiry_date     timestamptz,
  consent_ip                text,
  consent_user_agent        text,
  submitted_at              timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT sl.id,
         sl.firm_id,
         sl.email_consent_status,
         sl.email_consent_captured_at,
         sl.six_month_expiry_date,
         sl.consent_ip,
         sl.consent_user_agent,
         sl.submitted_at
  FROM public.screened_leads sl
  WHERE sl.email_consent_status IN ('explicit', 'implied')
    AND NOT EXISTS (
      SELECT 1
      FROM public.consent_log cl
      WHERE cl.subject_id = sl.id
        AND cl.channel = 'email'
    )
  ORDER BY sl.created_at ASC
  LIMIT GREATEST(batch_limit, 0);
$$;

REVOKE ALL ON FUNCTION public.find_leads_missing_email_consent_log(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_leads_missing_email_consent_log(integer) TO service_role;
