-- Multi-turn intake sessions for Meta channels.
--
-- Contact-capture doctrine Phase B (2026-05-15): async Meta channels
-- (Messenger / Instagram DM / WhatsApp) cannot satisfy the doctrine in
-- a single shot. When the engine fails the contact gate, the receiver
-- sends a follow-up question via the channel's Send API and persists
-- engine state here so the next inbound webhook can resume.
--
-- Naming note: there is already a public.intake_sessions table that
-- powers the web widget's multi-turn flow. This table is the Meta-
-- channel sibling and gets its own name to avoid collision.
--
-- Lifecycle:
--   1. First inbound from (firm_id, channel, sender_id) creates a row
--      with the post-engine EngineState. If gate fails, a follow-up is
--      sent and the row stays open (finalized=false).
--   2. Next inbound from the same triple loads the row, replays state,
--      processes the new message, and either finalises (gate passes →
--      create screened_lead, finalized=true) or sends another follow-up
--      (follow_up_count++).
--   3. After `max_follow_ups` failed turns, the row is finalised and
--      its contents moved to unconfirmed_inquiries with
--      reason='engine_refused'.
--   4. `expires_at` (default now()+24h) is the abandonment threshold.
--      The hourly cron `/api/cron/expire-channel-intake-sessions`
--      moves expired rows to unconfirmed_inquiries with reason='abandoned'.
--
-- Service-role only.

CREATE TABLE IF NOT EXISTS channel_intake_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  channel            text NOT NULL,
  sender_id          text NOT NULL,
  engine_state       jsonb NOT NULL,
  follow_up_count    int NOT NULL DEFAULT 0,
  max_follow_ups     int NOT NULL DEFAULT 3,
  last_activity_at   timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  finalized          boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- One open session per (firm, channel, sender). Subsequent inbound from
-- the same triple lands on the existing row. Once finalised, a new
-- inbound starts a fresh row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_intake_sessions_open
  ON channel_intake_sessions (firm_id, channel, sender_id)
  WHERE finalized = false;

-- Cron sweep target: open sessions past expires_at.
CREATE INDEX IF NOT EXISTS idx_channel_intake_sessions_expires
  ON channel_intake_sessions (expires_at)
  WHERE finalized = false;

-- RLS: service-role only.
ALTER TABLE channel_intake_sessions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE channel_intake_sessions IS
  'Meta-channel (Messenger/Instagram/WhatsApp) multi-turn intake sessions. Powers the contact-capture follow-up loop. Distinct from public.intake_sessions which powers the web widget.';

COMMENT ON COLUMN channel_intake_sessions.engine_state IS
  'Serialised EngineState (lib/screen-engine/types.EngineState). Restored on subsequent inbound from the same sender.';

COMMENT ON COLUMN channel_intake_sessions.sender_id IS
  'Channel-specific sender identifier: PSID (Messenger), IGSID (Instagram), wa_id (WhatsApp).';

COMMENT ON COLUMN channel_intake_sessions.finalized IS
  'True once the session terminates: either contact captured (→ screened_lead created) or max_follow_ups exhausted (→ unconfirmed_inquiry created).';

NOTIFY pgrst, 'reload schema';
