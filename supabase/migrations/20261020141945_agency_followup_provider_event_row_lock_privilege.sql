-- Postgres requires UPDATE privilege to lock an existing inbox row with FOR UPDATE.
-- Grant only the immutable event key column to the server-only service role.
-- The existing BEFORE UPDATE OR DELETE trigger still rejects any mutation.
GRANT UPDATE (provider_event_id) ON public.agency_followup_provider_events TO service_role;