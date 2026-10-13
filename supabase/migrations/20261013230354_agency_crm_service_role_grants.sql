-- The Agency CRM API uses the service-role Supabase client, while RLS remains
-- enabled and forced on these operator-only tables. The original table
-- migration revoked public roles but omitted explicit service_role grants.
REVOKE ALL ON TABLE public.agency_prospects FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.agency_deals FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.agency_reminders FROM anon, authenticated, PUBLIC;

GRANT ALL ON TABLE public.agency_prospects TO service_role;
GRANT ALL ON TABLE public.agency_deals TO service_role;
GRANT ALL ON TABLE public.agency_reminders TO service_role;
