-- =============================================================================
-- S8 Phase 1 · matter_messages: client + internal threads on every matter
-- =============================================================================
-- Two thread types in one table, discriminated by channel_type:
--   'client'    - lawyer-to-client thread. Both parties read and write.
--   'internal'  - lawyer-to-paralegal thread. Privileged work product.
--                 Client sessions can never read this row through any route.
--
-- Three recipient scopes in the data model (Phase 1 ships individual only;
-- group and company UI is Phase 2):
--   'individual'  - one matter, one client contact
--   'group'       - custom subset (e.g., CEO + CFO but not the assistant)
--   'company'     - all contacts at a company
--
-- broadcast_id (Story 11) groups per-recipient thread copies on a
-- mass-message fan-out. NULL on normal messages.
-- =============================================================================

CREATE TABLE IF NOT EXISTS matter_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id           uuid NOT NULL REFERENCES client_matters(id) ON DELETE CASCADE,
  firm_id             uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,

  -- Discriminator: client-facing thread vs internal team thread (DR-041 proposed)
  channel_type        text NOT NULL,

  -- Phase 1 ships individual only; the column exists so the future group /
  -- company UI lands without a schema change.
  recipient_scope     text NOT NULL DEFAULT 'individual',

  -- Sender identity
  sender_role         text NOT NULL,
  sender_lawyer_id    uuid REFERENCES firm_lawyers(id) ON DELETE SET NULL,
  -- For client senders: stamped with the client's primary_email at send time
  -- (the client does not have a firm_lawyers row).
  sender_client_email text,

  -- Body
  body                text NOT NULL,
  attachments         jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Mass-message fan-out (Story 11). NULL on normal messages.
  broadcast_id        uuid,

  created_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matter_messages_channel_type_check'
      AND conrelid = 'public.matter_messages'::regclass
  ) THEN
    ALTER TABLE matter_messages
      ADD CONSTRAINT matter_messages_channel_type_check
      CHECK (channel_type IN ('client', 'internal'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matter_messages_recipient_scope_check'
      AND conrelid = 'public.matter_messages'::regclass
  ) THEN
    ALTER TABLE matter_messages
      ADD CONSTRAINT matter_messages_recipient_scope_check
      CHECK (recipient_scope IN ('individual', 'group', 'company'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matter_messages_sender_role_check'
      AND conrelid = 'public.matter_messages'::regclass
  ) THEN
    ALTER TABLE matter_messages
      ADD CONSTRAINT matter_messages_sender_role_check
      CHECK (sender_role IN ('admin', 'staff', 'client', 'system'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matter_messages_attachments_array_check'
      AND conrelid = 'public.matter_messages'::regclass
  ) THEN
    ALTER TABLE matter_messages
      ADD CONSTRAINT matter_messages_attachments_array_check
      CHECK (jsonb_typeof(attachments) = 'array');
  END IF;

  -- Client sessions can never write to channel_type='internal'. Application
  -- enforces this at the route handler; DB constraint is defense-in-depth.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matter_messages_client_internal_block_check'
      AND conrelid = 'public.matter_messages'::regclass
  ) THEN
    ALTER TABLE matter_messages
      ADD CONSTRAINT matter_messages_client_internal_block_check
      CHECK (NOT (sender_role = 'client' AND channel_type = 'internal'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_matter_messages_matter_created
  ON matter_messages (matter_id, channel_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_matter_messages_broadcast
  ON matter_messages (broadcast_id)
  WHERE broadcast_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_matter_messages_firm_recent
  ON matter_messages (firm_id, created_at DESC);

ALTER TABLE matter_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE matter_messages FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- matter_message_recipients: per-recipient state for fan-out + read receipts
-- =============================================================================
-- A normal individual message has zero rows here. A broadcast has one row per
-- recipient matter, tracking read_at independently per recipient.
-- =============================================================================

CREATE TABLE IF NOT EXISTS matter_message_recipients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid NOT NULL REFERENCES matter_messages(id) ON DELETE CASCADE,
  matter_id   uuid NOT NULL REFERENCES client_matters(id) ON DELETE CASCADE,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matter_message_recipients_message
  ON matter_message_recipients (message_id);

CREATE INDEX IF NOT EXISTS idx_matter_message_recipients_matter_unread
  ON matter_message_recipients (matter_id)
  WHERE read_at IS NULL;

ALTER TABLE matter_message_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE matter_message_recipients FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE matter_messages IS
  'Threaded messages on a matter. Two channel_type values (client, internal). Phase 1 S8 Story 6. DR-041 proposed.';

COMMENT ON COLUMN matter_messages.channel_type IS
  'client | internal. Internal-type messages are privileged work product, never visible to client sessions.';

COMMENT ON COLUMN matter_messages.recipient_scope IS
  'individual | group | company. Phase 1 ships individual UI only; group + company are Phase 2.';

COMMENT ON COLUMN matter_messages.broadcast_id IS
  'Set when this message is a per-recipient copy from a mass-message fan-out (Story 11). NULL otherwise.';

COMMENT ON TABLE matter_message_recipients IS
  'Per-recipient state for mass-message fan-out and future per-recipient read tracking. Phase 1 S8 Story 6 + 11.';

NOTIFY pgrst, 'reload schema';
