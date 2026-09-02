-- Hosted Supabase projects can grant broad table privileges to service_role
-- through the creator role's default ACL. Make this append-only ledger's
-- intended server contract explicit and independent of those defaults.
REVOKE ALL PRIVILEGES ON TABLE public.channel_conversation_events
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT ON TABLE public.channel_conversation_events
  TO service_role;

-- Trigger invocation does not require the calling role to have EXECUTE on the
-- trigger function. Keep both functions owner-only so they cannot be called
-- directly by API roles while their table triggers continue to enforce the
-- terminal-pairing and append-only invariants.
REVOKE ALL PRIVILEGES ON FUNCTION public.validate_channel_conversation_terminal()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.reject_channel_conversation_event_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
