-- Hosted Supabase projects can grant broad table privileges to service_role
-- through the creator role's default ACL. Make this append-only ledger's
-- intended server contract explicit and independent of those defaults.
ALTER TABLE public.intake_firms
  ADD COLUMN channel_conversation_ledger_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.intake_firms.channel_conversation_ledger_enabled IS
  'Per-firm fail-closed approval gate for channel conversation ledger reads, writes, and ledger-dependent sends. Keep false until privacy retention and erasure controls are approved.';

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

-- The application gate prevents normal server paths from reaching the ledger,
-- while this trigger is the database-enforced backstop. It prevents an
-- accidental service-role insert from storing a message body for a firm whose
-- approval flag is still off.
CREATE OR REPLACE FUNCTION public.require_channel_conversation_ledger_enabled()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM public.intake_firms AS firm
  WHERE firm.id = NEW.firm_id
    AND firm.channel_conversation_ledger_enabled = true
  -- SHARE allows concurrent ledger inserts for the same enabled firm, but
  -- conflicts with the NO KEY UPDATE lock taken by a boolean flag update.
  -- KEY SHARE would be insufficient because the flag is not a key column.
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'channel conversation ledger is disabled for firm'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.require_channel_conversation_ledger_enabled()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER channel_conversation_events_require_enabled_firm
  BEFORE INSERT ON public.channel_conversation_events
  FOR EACH ROW EXECUTE FUNCTION public.require_channel_conversation_ledger_enabled();

NOTIFY pgrst, 'reload schema';
