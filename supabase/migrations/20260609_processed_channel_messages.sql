-- Webhook idempotency claims for Meta channels (launch audit H1).
--
-- Meta redelivers webhook events (slow ACK, subscription retries) and users
-- double-send, so the same message mid can hit a receiver more than once.
-- Each Meta receiver (Messenger / Instagram DM / WhatsApp) claims the mid
-- here with INSERT ... ON CONFLICT DO NOTHING before any engine work runs.
-- Losing the claim means another delivery already owns the mid: the loser
-- ACKs 200 and skips processing entirely.
--
-- Rows are transient. They only need to outlive Meta's redelivery window
-- (hours); the daily /api/cron/data-retention sweep deletes rows older
-- than 7 days.
--
-- Service-role only, same posture as channel_intake_sessions.

CREATE TABLE IF NOT EXISTS processed_channel_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     uuid NOT NULL REFERENCES public.intake_firms(id) ON DELETE CASCADE,
  channel     text NOT NULL,
  message_mid text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, channel, message_mid)
);

-- Cron sweep target: rows older than the retention window.
CREATE INDEX IF NOT EXISTS idx_processed_channel_messages_created
  ON processed_channel_messages (created_at);

-- RLS: service-role only. No policies on purpose; the service role bypasses
-- RLS and nothing else may touch the table.
ALTER TABLE processed_channel_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_channel_messages FORCE ROW LEVEL SECURITY;

-- Defense in depth alongside RLS (security lockdown posture, 2026-06-05):
-- the PostgREST roles get no grants at all, so even a future policy slip
-- cannot expose the table to anon or authenticated.
REVOKE ALL ON public.processed_channel_messages FROM anon, authenticated;

COMMENT ON TABLE processed_channel_messages IS
  'Meta-channel webhook dedup claims. One row per (firm, channel, message mid) processed; receivers claim before running the engine so redelivered events skip. Swept after 7 days by the data-retention cron.';

COMMENT ON COLUMN processed_channel_messages.channel IS
  'Inbound channel: facebook | instagram | whatsapp.';

COMMENT ON COLUMN processed_channel_messages.message_mid IS
  'Meta message id: message.mid (Messenger / Instagram) or messages[].id (WhatsApp, wamid).';

NOTIFY pgrst, 'reload schema';
