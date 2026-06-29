-- J8 Milestone Assistant: schema additions
--
-- Adds matter_milestone and matter_milestone_note to client_matters.
-- These feed the POST /api/portal/[firmId]/matters/[matterId]/milestone-draft
-- route so the AI draft composer has access to the current milestone label
-- and the lawyer's optional personal note.
--
-- Also extends the notification_outbox event_type constraint to include
-- 'milestone_draft_ready' (used by the quiet-file nudge cron).
--
-- Safe to apply: both ALTER TABLE ADD COLUMN calls are additive (nullable).
-- The event_type constraint extension is idempotent (DROP + ADD pattern).
-- RLS: no new policies needed; client_matters already has FORCE RLS +
-- service-role-only write path in place from 20260522014558_s8p1_client_matters.sql.
--
-- DO NOT apply to prod without operator approval.

-- ── client_matters additions ──────────────────────────────────────────────

ALTER TABLE client_matters
  ADD COLUMN IF NOT EXISTS matter_milestone TEXT,
  ADD COLUMN IF NOT EXISTS matter_milestone_note TEXT;

COMMENT ON COLUMN client_matters.matter_milestone IS
  'Current milestone label set by the lawyer (e.g. "conditions_waived"). '
  'Fed to the milestone-draft AI composer. Cleared on matter close.';

COMMENT ON COLUMN client_matters.matter_milestone_note IS
  'Optional personal note from the lawyer, woven into the AI draft. '
  'Set alongside matter_milestone. Cleared when a new milestone is set.';

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
