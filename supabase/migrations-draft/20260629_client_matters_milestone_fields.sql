-- J8 Milestone Assistant: schema additions
--
-- Adds matter_milestone and matter_milestone_note to client_matters.
-- These feed the POST /api/portal/[firmId]/matters/[matterId]/milestone-draft
-- route so the AI draft composer has access to the current milestone label
-- and the lawyer's optional personal note.
--
-- Also adds quiet_nudge_sent_at, a suppression stamp for the quiet-file
-- nudge cron (/api/cron/quiet-file-nudge). Without it the cron would
-- re-insert a notification_outbox row for the same quiet matter on every
-- daily run until the lawyer sends a client update, spamming the digest.
-- QUIET_NUDGE_SUPPRESSION_DAYS in the route (7 days) gates re-nudging.
--
-- Also extends the notification_outbox event_type constraint to include
-- 'milestone_draft_ready' (used by the quiet-file nudge cron), and
-- schedules the daily pg_cron job that calls the route.
--
-- Safe to apply: all three ALTER TABLE ADD COLUMN calls are additive
-- (nullable). The event_type constraint extension is idempotent (DROP +
-- ADD pattern). The cron schedule block unschedules-then-reschedules by
-- name, idempotent on re-run. RLS: no new policies needed; client_matters
-- already has FORCE RLS + service-role-only write path in place from
-- 20260522014558_s8p1_client_matters.sql.
--
-- DO NOT apply to prod without operator approval.

-- ── client_matters additions ──────────────────────────────────────────────

ALTER TABLE client_matters
  ADD COLUMN IF NOT EXISTS matter_milestone TEXT,
  ADD COLUMN IF NOT EXISTS matter_milestone_note TEXT,
  ADD COLUMN IF NOT EXISTS quiet_nudge_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN client_matters.matter_milestone IS
  'Current milestone label set by the lawyer (e.g. "conditions_waived"). '
  'Fed to the milestone-draft AI composer. Cleared on matter close.';

COMMENT ON COLUMN client_matters.matter_milestone_note IS
  'Optional personal note from the lawyer, woven into the AI draft. '
  'Set alongside matter_milestone. Cleared when a new milestone is set.';

COMMENT ON COLUMN client_matters.quiet_nudge_sent_at IS
  'Last time the quiet-file nudge cron queued a milestone_draft_ready '
  'notification for this matter. Suppresses re-nudging within the cron''s '
  'QUIET_NUDGE_SUPPRESSION_DAYS window. Not reset explicitly; the matter '
  'naturally exits the quiet set once a new client-channel admin message '
  'is sent (matter_messages), independent of this column.';

-- ── notification_outbox event_type extension ──────────────────────────────
-- Pattern mirrors 20260624131132_notification_outbox_deliverable_events.sql
-- and 20260624132001_operator_firm_messaging.sql.

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
    'firm_message_new',
    'milestone_draft_ready'
  ));

-- ── pg_cron schedule ────────────────────────────────────────────────────
-- Pattern mirrors 20260522014741_s8p1_notification_batch_cron.sql. Daily
-- at 13:00 UTC (09:00 America/Toronto EDT / 08:00 EST; no DST adjustment,
-- matching the existing token-expiry-check job's fixed-UTC convention).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'quiet-file-nudge-daily') THEN
    PERFORM cron.unschedule('quiet-file-nudge-daily');
  END IF;

  PERFORM cron.schedule(
    'quiet-file-nudge-daily',
    '0 13 * * *',
    $cmd$ SELECT cron_internal.call_cron_route('/api/cron/quiet-file-nudge'); $cmd$
  );
END $$;
