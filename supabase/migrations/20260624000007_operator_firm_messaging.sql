-- CaseLoad Connect: operator-to-firm messaging (CaseLoad <-> lawyer).
--
-- A dedicated channel between the CaseLoad operator and each firm's
-- lawyers. Structurally Slack Connect: one shared channel per firm, two
-- participant classes (operator sees every firm, a lawyer sees only its
-- own firm). This is NOT the lawyer-to-client matter thread
-- (matter_messages, channel_type='client'); those stay privileged and
-- firm-private and the operator never reads them.
--
-- Service-role only. RLS forced, anon/authenticated/PUBLIC revoked, per
-- the Database Access Invariant (DR-063) and the born-exposed rule: a new
-- public table is granted anon+authenticated CRUD by pg_default_acl, so
-- every CREATE TABLE must lock down in the same migration.
--
-- Idempotent. Safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- operator_firm_channels
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS operator_firm_channels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  name        text NOT NULL DEFAULT 'CaseLoad',
  archived    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, name)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- operator_firm_messages
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS operator_firm_messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id         uuid NOT NULL REFERENCES operator_firm_channels(id) ON DELETE CASCADE,
  firm_id            uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  parent_message_id  uuid REFERENCES operator_firm_messages(id) ON DELETE SET NULL,
  sender_role        text NOT NULL CHECK (sender_role IN ('operator', 'lawyer', 'system')),
  sender_id          text,
  sender_name        text,
  body               text NOT NULL,
  attachments        jsonb NOT NULL DEFAULT '[]'::jsonb,
  edited_at          timestamptz,
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operator_firm_messages_channel_created
  ON operator_firm_messages (channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_operator_firm_messages_firm
  ON operator_firm_messages (firm_id);
CREATE INDEX IF NOT EXISTS idx_operator_firm_messages_parent
  ON operator_firm_messages (parent_message_id)
  WHERE parent_message_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- operator_firm_channel_reads
--   participant: 'operator' (the single operator) OR a firm_lawyers.id.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS operator_firm_channel_reads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    uuid NOT NULL REFERENCES operator_firm_channels(id) ON DELETE CASCADE,
  firm_id       uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  participant   text NOT NULL,
  last_read_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, participant)
);

CREATE INDEX IF NOT EXISTS idx_operator_firm_channel_reads_firm
  ON operator_firm_channel_reads (firm_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Lockdown: force RLS, revoke all grants. No policies = service-role only.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE operator_firm_channels       ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_firm_channels       FORCE  ROW LEVEL SECURITY;
ALTER TABLE operator_firm_messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_firm_messages       FORCE  ROW LEVEL SECURITY;
ALTER TABLE operator_firm_channel_reads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_firm_channel_reads  FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON operator_firm_channels      FROM anon, authenticated, PUBLIC;
REVOKE ALL ON operator_firm_messages      FROM anon, authenticated, PUBLIC;
REVOKE ALL ON operator_firm_channel_reads FROM anon, authenticated, PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- notification_outbox: allow the firm_message_new event type.
-- Idempotent: drop + re-add the CHECK with the full known set plus the new one.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE notification_outbox
  DROP CONSTRAINT IF EXISTS notification_outbox_event_type_check;

ALTER TABLE notification_outbox
  ADD CONSTRAINT notification_outbox_event_type_check
  CHECK (event_type IN (
    'message_new',
    'message_internal_new',
    'file_uploaded',
    'matter_stage_changed',
    'explainer_assigned',
    'welcome_draft_ready',
    'broadcast_received',
    'deliverable_review_requested',
    'deliverable_comment_added',
    'deliverable_approved',
    'deliverable_changes_requested',
    'firm_message_new'
  ));
