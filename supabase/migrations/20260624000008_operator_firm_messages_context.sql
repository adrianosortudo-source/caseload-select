-- CaseLoad Connect: structured context on a message.
--
-- Lets a message carry a typed reference to the thing it is about, so the
-- channel can render a deep-link affordance. First use: deliverable
-- comments + lifecycle events fan into the channel and link back to the
-- exact comment / deliverable.
--
--   { kind: 'deliverable_comment', deliverable_id, deliverable_title,
--     comment_id, version_id, annotation_label }
--   { kind: 'deliverable_lifecycle', deliverable_id, deliverable_title, event }
--
-- Nullable; ordinary human messages leave it null. Service-role only
-- (table already RLS-forced + grants revoked).
--
-- Idempotent.

ALTER TABLE operator_firm_messages
  ADD COLUMN IF NOT EXISTS context jsonb;
