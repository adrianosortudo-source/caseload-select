-- CaseLoad Connect Phase 2: reactions + pins.
--
-- Reactions: emoji acks on a message (Slack-style). Pins: surface a key
-- message at the top of the channel. Both service-role only, RLS forced,
-- grants revoked (born-exposed rule + Database Access Invariant).
--
-- Idempotent. Safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- operator_firm_message_reactions
--   participant: 'operator' OR a firm_lawyers.id (same key space as channel reads)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS operator_firm_message_reactions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id         uuid NOT NULL REFERENCES operator_firm_messages(id) ON DELETE CASCADE,
  firm_id            uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  participant        text NOT NULL,
  participant_label  text,
  emoji              text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, participant, emoji)
);

CREATE INDEX IF NOT EXISTS idx_operator_firm_message_reactions_message
  ON operator_firm_message_reactions (message_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Pins: a message is pinned by a participant at a time. Null = not pinned.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE operator_firm_messages
  ADD COLUMN IF NOT EXISTS pinned_at  timestamptz,
  ADD COLUMN IF NOT EXISTS pinned_by  text;

CREATE INDEX IF NOT EXISTS idx_operator_firm_messages_pinned
  ON operator_firm_messages (channel_id, pinned_at)
  WHERE pinned_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Lockdown.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE operator_firm_message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_firm_message_reactions FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON operator_firm_message_reactions FROM anon, authenticated, PUBLIC;
