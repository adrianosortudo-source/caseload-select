-- Operator-controlled review notification (applied to prod 2026-06-23 via MCP).
--
-- The default flow auto-fires a notification when a new version is posted.
-- For bulk seeding, the operator wants to upload first, verify the items are
-- correctly placed, then manually fire ONE consolidated notification per firm.
-- Tracking review_notified_at lets the manual fire find exactly the
-- deliverables that have not yet been announced and skip the ones that have,
-- so re-running notify-pending is idempotent.

ALTER TABLE content_deliverables
  ADD COLUMN IF NOT EXISTS review_notified_at timestamptz;

COMMENT ON COLUMN content_deliverables.review_notified_at IS
  'When the firm was notified of a pending review for this deliverable. NULL means no notification has been sent (e.g. silent upload). Stamped by addVersion (default flow) or by the operator notify-pending action.';
