-- =============================================================================
-- webhook_outbox action CHECK expansion (2026-06-09)
-- =============================================================================
-- The original 20260505 constraint allowed only the four launch actions
-- ('taken', 'passed', 'declined_oos', 'declined_backstop'). Two actions
-- postdate it:
--
--   referred             Band D Refer action (DR-037, Band D doctrine flip
--                        2026-05-15). The refer route enqueues this action;
--                        with the stale CHECK in place those outbox inserts
--                        were rejected, so referred webhooks never delivered.
--   matter_stage_changed DR-049 matter-stage cadences move to GHL-owned
--                        execution (operator decision 2026-06-09, CRM Bible
--                        section 12). Stage transitions enqueue this event
--                        instead of scheduling dead in-app email_sequences
--                        rows.
--
-- Idempotent: drop-if-exists then re-add with the full six-action set.
-- =============================================================================

ALTER TABLE webhook_outbox DROP CONSTRAINT IF EXISTS webhook_outbox_action_check;
ALTER TABLE webhook_outbox ADD CONSTRAINT webhook_outbox_action_check
  CHECK (action IN (
    'taken',
    'passed',
    'referred',
    'declined_oos',
    'declined_backstop',
    'matter_stage_changed'
  ));

NOTIFY pgrst, 'reload schema';
