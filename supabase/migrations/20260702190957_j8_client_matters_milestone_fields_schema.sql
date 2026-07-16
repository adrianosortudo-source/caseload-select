-- J8 Milestone Assistant: schema additions (cron scheduling deferred, applied separately)
--
-- APPLIED TO PROD 2026-07-02 via Supabase MCP (operator approved schema-only;
-- deferred the pg_cron schedule until the quiet-file-nudge cron has been run
-- manually at least once). See supabase/migrations-draft/20260702_quiet_file_nudge_cron_schedule.sql
-- for the deferred pg_cron piece.
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
-- 'milestone_draft_ready' (used by the quiet-file nudge cron).
--
-- Safe to apply: all three ALTER TABLE ADD COLUMN calls are additive
-- (nullable). The event_type constraint extension is idempotent (DROP +
-- ADD pattern). RLS: no new policies needed; client_matters and
-- notification_outbox already have FORCE RLS + service-role-only write
-- paths in place (verified unaffected post-apply).

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
