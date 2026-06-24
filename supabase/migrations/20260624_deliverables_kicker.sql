-- Slice 1.5: separate the operator queue label from the rendered display
-- title. Applied to prod 2026-06-24 via Supabase MCP.
--
-- Before this column: the operator was putting "Backfill · " and "Wk N · "
-- in the title field for queue identification. That prefix then leaked into
-- the rendered article header on the DRG preview, which made the title not
-- match the live drglaw.ca page. The rendered title needs to be the bare
-- display title; the queue label moves here.
--
-- DeliverableList still shows "{kicker} · {title}" so the operator can scan
-- the queue. DRGArticleFrame ignores kicker entirely and renders only title.

ALTER TABLE content_deliverables ADD COLUMN IF NOT EXISTS kicker text;

COMMENT ON COLUMN content_deliverables.kicker IS
  'Operator queue label (e.g. "Backfill", "Wk 1") shown in the deliverables list as a prefix on the title. Intentionally NOT rendered in the article header: the rendered display title must match drglaw.ca.';
