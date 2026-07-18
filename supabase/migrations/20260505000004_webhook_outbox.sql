-- =============================================================================
-- webhook_outbox — at-least-once delivery for GHL outbound webhooks
-- =============================================================================
-- Phase 2 fired webhooks at-most-once: a transient HTTP failure left the
-- DB row in the correct status but the cadence never engaged. This table
-- upgrades delivery to at-least-once with idempotency keyed on
-- (lead_id, action) so the GHL workflow can dedupe.
--
-- Lifecycle:
--   pending  → just inserted by the action endpoint
--   sent     → fireGhlWebhook returned ok=true
--   failed   → max retries exhausted; operator can manually retry
--
-- The retry cron sweeps `pending` rows whose `next_attempt_at` is in the
-- past and re-fires up to `max_attempts` (default 5) with exponential
-- backoff.
-- =============================================================================

CREATE TABLE IF NOT EXISTS webhook_outbox (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id              text NOT NULL,
  firm_id              uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  action               text NOT NULL,
  idempotency_key      text NOT NULL,
  payload              jsonb NOT NULL,
  webhook_url          text NOT NULL,
  status               text NOT NULL DEFAULT 'pending',
  attempts             integer NOT NULL DEFAULT 0,
  max_attempts         integer NOT NULL DEFAULT 5,
  next_attempt_at      timestamptz NOT NULL DEFAULT now(),
  last_error           text,
  last_http_status     integer,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  sent_at              timestamptz,
  failed_at            timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_webhook_outbox_idempotency
  ON webhook_outbox (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_webhook_outbox_retry
  ON webhook_outbox (next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_webhook_outbox_firm_timeline
  ON webhook_outbox (firm_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'webhook_outbox_status_check'
      AND conrelid = 'public.webhook_outbox'::regclass
  ) THEN
    ALTER TABLE webhook_outbox
      ADD CONSTRAINT webhook_outbox_status_check
      CHECK (status IN ('pending', 'sent', 'failed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'webhook_outbox_action_check'
      AND conrelid = 'public.webhook_outbox'::regclass
  ) THEN
    ALTER TABLE webhook_outbox
      ADD CONSTRAINT webhook_outbox_action_check
      CHECK (action IN ('taken', 'passed', 'declined_oos', 'declined_backstop'));
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_touch_webhook_outbox_updated_at ON webhook_outbox;
CREATE TRIGGER trg_touch_webhook_outbox_updated_at
  BEFORE UPDATE ON webhook_outbox
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE webhook_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_outbox FORCE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
