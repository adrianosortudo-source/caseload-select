-- Keep channel-conversation message bodies default-off until retention and
-- erasure controls are approved. The application requires both this per-firm
-- flag and the exact-true server environment switch.
ALTER TABLE public.intake_firms
  ADD COLUMN channel_conversation_ledger_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.intake_firms.channel_conversation_ledger_enabled IS
  'Per-firm fail-closed approval gate for channel conversation ledger reads, writes, and ledger-dependent sends. Keep false until privacy retention and erasure controls are approved.';

-- The application gate prevents normal server paths from reaching the ledger,
-- while this trigger is the database-enforced backstop. The SHARE row lock
-- permits concurrent inserts for an enabled firm and conflicts with the
-- NO KEY UPDATE lock taken by a boolean flag update. This serializes inserts
-- with disablement so no transaction can commit using a stale true flag.
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
