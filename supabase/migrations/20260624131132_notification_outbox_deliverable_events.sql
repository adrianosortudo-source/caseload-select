-- Extend notification_outbox event_type CHECK to include the four deliverable
-- review event types added in 20260623_content_approval.sql. The original
-- constraint at 20260520_s8p1_notification_outbox.sql only covered
-- matter-messaging events; any notification_outbox INSERT with a deliverable
-- event type would fail the constraint silently (the insert call in
-- enqueueDeliverableNotification did not check the error return, so callers
-- would stamp review_notified_at without an email ever being queued).
--
-- Idempotent: drops + re-adds the constraint so it is safe to re-run.

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
    'deliverable_changes_requested'
  ));
