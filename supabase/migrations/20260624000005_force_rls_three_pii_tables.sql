-- Force RLS on three PII tables that had RLS enabled but not FORCED.
--
-- Found by a live prod-DB verification (2026-06-24) of the project invariant
-- "every PII table has RLS on AND forced". channel_intake_sessions,
-- firm_onboarding_intake, and unconfirmed_inquiries were enabled-but-not-forced,
-- so the table owner role could bypass RLS. The other 20 PII tables were already
-- forced.
--
-- Safe: all three have zero anon/authenticated grants and are accessed only via
-- the service role (BYPASSRLS), so FORCE changes nothing for the app; it only
-- removes the owner-role bypass, matching the rest of the schema.
--
-- Applied to prod via Supabase MCP and re-verified (rls_forced = true on all three).

alter table public.channel_intake_sessions force row level security;
alter table public.firm_onboarding_intake  force row level security;
alter table public.unconfirmed_inquiries    force row level security;
