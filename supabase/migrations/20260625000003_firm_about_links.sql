-- Reference links for the per-firm "About this content" panel on the
-- deliverables portal (e.g. a link to the firm's content strategy doc, which
-- also lives in the Files hub). A small labelled set rendered always-visible
-- under the panel body, separate from the collapsible explainer text.
-- Sanitised to absolute http/https URLs on write. Defaults to empty.
--
-- APPLIED to prod 2026-06-25 via Supabase MCP (operator iterating live).

ALTER TABLE firm_about ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '[]'::jsonb;
