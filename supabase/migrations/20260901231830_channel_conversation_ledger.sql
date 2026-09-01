-- Append-only Meta-channel conversation ledger for the lawyer portal.
--
-- This table starts the auditable record at deployment. Historical channel
-- messages cannot be reconstructed from screened_leads or the intake session
-- transcript, so they are intentionally not backfilled.
--
-- Each outbound attempt is represented by a pending event followed by one
-- terminal sent/failed event. Rows are never updated. client_request_id makes
-- the initial pending insert a race-safe server idempotency claim.

ALTER TABLE public.screened_leads
  ADD CONSTRAINT screened_leads_id_firm_unique UNIQUE (id, firm_id);

CREATE TABLE public.channel_conversation_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screened_lead_id       uuid NOT NULL,
  firm_id                 uuid NOT NULL,
  channel                 text NOT NULL,
  direction               text NOT NULL,
  source                  text NOT NULL,
  body                    text NOT NULL,
  status                  text NOT NULL,
  meta_message_id         text,
  client_request_id       uuid,
  actor_type               text NOT NULL,
  actor_id                 text,
  authoritative_inbound   boolean NOT NULL DEFAULT false,
  occurred_at             timestamptz NOT NULL,
  failure_reason          text,
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT channel_conversation_events_lead_firm_fk
    FOREIGN KEY (screened_lead_id, firm_id)
    REFERENCES public.screened_leads (id, firm_id)
    ON DELETE CASCADE,
  CONSTRAINT channel_conversation_events_channel_check
    CHECK (channel IN ('facebook', 'instagram', 'whatsapp')),
  CONSTRAINT channel_conversation_events_direction_check
    CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT channel_conversation_events_source_check
    CHECK (source IN ('webhook', 'intake_automation', 'operator', 'expiry_cron')),
  CONSTRAINT channel_conversation_events_status_check
    CHECK (status IN ('received', 'pending', 'sent', 'failed')),
  CONSTRAINT channel_conversation_events_actor_check
    CHECK (actor_type IN ('lead', 'system', 'operator')),
  CONSTRAINT channel_conversation_events_body_check
    CHECK (char_length(body) BETWEEN 1 AND 10000),
  CONSTRAINT channel_conversation_events_shape_check
    CHECK (
      (direction = 'inbound'
        AND status = 'received'
        AND source = 'webhook'
        AND actor_type = 'lead'
        AND client_request_id IS NULL
        AND failure_reason IS NULL)
      OR
      (direction = 'outbound'
        AND status IN ('pending', 'sent', 'failed')
        AND source IN ('intake_automation', 'operator', 'expiry_cron')
        AND actor_type IN ('system', 'operator')
        AND client_request_id IS NOT NULL)
    ),
  CONSTRAINT channel_conversation_events_authoritative_inbound_check
    CHECK (NOT authoritative_inbound OR direction = 'inbound'),
  CONSTRAINT channel_conversation_events_failure_check
    CHECK ((status = 'failed') = (failure_reason IS NOT NULL))
);

CREATE UNIQUE INDEX channel_conversation_events_meta_mid_unique
  ON public.channel_conversation_events (firm_id, channel, meta_message_id)
  WHERE meta_message_id IS NOT NULL;

CREATE UNIQUE INDEX channel_conversation_events_request_status_unique
  ON public.channel_conversation_events (firm_id, client_request_id, status)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX channel_conversation_events_lead_timeline
  ON public.channel_conversation_events (screened_lead_id, occurred_at, created_at);

CREATE INDEX channel_conversation_events_latest_inbound
  ON public.channel_conversation_events (screened_lead_id, occurred_at DESC)
  WHERE authoritative_inbound = true;

ALTER TABLE public.channel_conversation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_conversation_events FORCE ROW LEVEL SECURITY;

-- Server/service-role only. No policies are created on purpose.
REVOKE ALL ON TABLE public.channel_conversation_events FROM anon, authenticated;

COMMENT ON TABLE public.channel_conversation_events IS
  'Append-only, service-role-only Messenger, Instagram DM, and WhatsApp conversation ledger tied to screened leads. No historical backfill is possible.';
COMMENT ON COLUMN public.channel_conversation_events.authoritative_inbound IS
  'True only for a verified non-echo inbound webhook event. The strict Meta reply window is derived exclusively from the latest such event.';
COMMENT ON COLUMN public.channel_conversation_events.client_request_id IS
  'Server idempotency key for an outbound attempt. A pending event claims the key; a sent or failed event records the immutable outcome.';

CREATE OR REPLACE FUNCTION public.reject_channel_conversation_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'channel_conversation_events is append-only';
END;
$$;

REVOKE ALL ON FUNCTION public.reject_channel_conversation_event_mutation() FROM PUBLIC;

CREATE TRIGGER channel_conversation_events_reject_update
  BEFORE UPDATE ON public.channel_conversation_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_channel_conversation_event_mutation();

NOTIFY pgrst, 'reload schema';
