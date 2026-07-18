-- =============================================================================
-- S8 Phase 1 · notification_outbox: 5-minute batched email events
-- =============================================================================
-- Event-driven notifications (new message, new file, stage transition,
-- explainer assignment) write here instead of firing Resend directly. The
-- /api/cron/notification-batch route drains rows older than 5 minutes,
-- groups by recipient_email, and sends one digest per group.
--
-- Transactional emails (magic-link invite, welcome send, password reset)
-- continue to call sendEmail directly. They bypass this queue.
--
-- Per-recipient toggle: firm_lawyers.email_notifications_enabled (added in
-- the firm_lawyers_roles migration). When false, queued rows for that
-- recipient drop at drain time.
-- =============================================================================

CREATE TABLE IF NOT EXISTS notification_outbox (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id     uuid REFERENCES firm_lawyers(id) ON DELETE CASCADE,
  recipient_email       text NOT NULL,
  firm_id               uuid REFERENCES intake_firms(id) ON DELETE CASCADE,
  matter_id             uuid REFERENCES client_matters(id) ON DELETE CASCADE,

  event_type            text NOT NULL,
  event_payload         jsonb NOT NULL DEFAULT '{}'::jsonb,

  status                text NOT NULL DEFAULT 'queued',
  batch_id              uuid,
  attempts              integer NOT NULL DEFAULT 0,

  created_at            timestamptz NOT NULL DEFAULT now(),
  sent_at               timestamptz,
  failed_at             timestamptz,
  last_error            text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_outbox_status_check'
      AND conrelid = 'public.notification_outbox'::regclass
  ) THEN
    ALTER TABLE notification_outbox
      ADD CONSTRAINT notification_outbox_status_check
      CHECK (status IN ('queued', 'sent', 'failed', 'dropped'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_outbox_event_type_check'
      AND conrelid = 'public.notification_outbox'::regclass
  ) THEN
    ALTER TABLE notification_outbox
      ADD CONSTRAINT notification_outbox_event_type_check
      CHECK (event_type IN (
        'message_new',
        'message_internal_new',
        'file_uploaded',
        'matter_stage_changed',
        'explainer_assigned',
        'welcome_draft_ready',
        'broadcast_received'
      ));
  END IF;
END $$;

-- Drain query: queued rows older than 5 minutes, ordered by created_at.
CREATE INDEX IF NOT EXISTS idx_notification_outbox_drain
  ON notification_outbox (status, created_at)
  WHERE status = 'queued';

-- Per-recipient queue inspection.
CREATE INDEX IF NOT EXISTS idx_notification_outbox_recipient
  ON notification_outbox (recipient_email, created_at DESC);

-- Failed-rows view for the operator console.
CREATE INDEX IF NOT EXISTS idx_notification_outbox_failed
  ON notification_outbox (failed_at DESC)
  WHERE status = 'failed';

ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_outbox FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE notification_outbox IS
  'Batched email event queue. Drained every 5 minutes by /api/cron/notification-batch into Resend digest emails. Phase 1 S8 Story 9.';

COMMENT ON COLUMN notification_outbox.event_type IS
  'message_new | message_internal_new | file_uploaded | matter_stage_changed | explainer_assigned | welcome_draft_ready | broadcast_received';

COMMENT ON COLUMN notification_outbox.batch_id IS
  'Set by the drain process to mark which 5-minute batch absorbed this row. NULL until drained.';

NOTIFY pgrst, 'reload schema';
