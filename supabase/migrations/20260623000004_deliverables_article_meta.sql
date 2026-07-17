-- Brand-render metadata for the deliverable preview shell (applied to prod
-- 2026-06-23 via Supabase MCP).
--
-- The portal review page now renders article-kind deliverables for DRG inside
-- a brand-faithful shell (DRGArticleFrame.tsx) that mirrors drglaw.ca's
-- /journal/[slug] structure: chip row (topic, date, byline, read time),
-- display title, lead paragraph, hero image, body. These six columns hold
-- the per-deliverable values that drive that header / chip row / hero.
--
-- All nullable; publish_date NULL renders as "Draft, not yet published" in
-- the chip; hero_image_url NULL renders an empty hero placeholder until the
-- nano-banana generation step backfills it.

ALTER TABLE content_deliverables
  ADD COLUMN IF NOT EXISTS excerpt        text,
  ADD COLUMN IF NOT EXISTS topic          text,
  ADD COLUMN IF NOT EXISTS byline         text,
  ADD COLUMN IF NOT EXISTS publish_date   date,
  ADD COLUMN IF NOT EXISTS read_time      text,
  ADD COLUMN IF NOT EXISTS hero_image_url text;

COMMENT ON COLUMN content_deliverables.excerpt IS
  'One-line lead paragraph rendered under the article display title.';
COMMENT ON COLUMN content_deliverables.topic IS
  'Editorial topic chip (e.g. Real estate, Corporate, Personal exposure, Before you sign). Appears as the boxed chip at the top of the chip row.';
COMMENT ON COLUMN content_deliverables.byline IS
  'Author name as it appears in the chip row.';
COMMENT ON COLUMN content_deliverables.publish_date IS
  'Date the article is scheduled to go live. NULL means draft, not yet scheduled, which the chip row renders as "Draft, not yet published".';
COMMENT ON COLUMN content_deliverables.read_time IS
  'Editorial reading-time label (e.g. "8 min read") rendered in the chip row.';
COMMENT ON COLUMN content_deliverables.hero_image_url IS
  'URL to the article hero image. NULL renders the empty placeholder until nano-banana generates one.';
