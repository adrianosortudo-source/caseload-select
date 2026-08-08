-- 20260730120000_asset_register_single_winner.sql
--
-- Purpose: publishing_package_assets is fully constrained but currently
-- unused for its actual job -- recording who decided an image is approved.
-- Approval has instead been inferred from filenames and timestamps, which
-- failed twice in three days:
--   (1) two LinkedIn-dimensioned cover files were accepted into the
--       website_article_hero role because nothing on the row recorded
--       that no one had actually chosen them for that role;
--   (2) the same English LinkedIn file was live under both en-CA and
--       pt-BR locales at once, because nothing stopped one "winner" file
--       from being claimed by a locale slot it was never approved for.
-- The governing rule going forward: absence of a recorded decision is not
-- approval.
--
-- This migration adds the decision columns needed to record who approved
-- or rejected an asset and when, a partial unique index that makes it
-- impossible for two rows to be release_ready in the same
-- period+role+locale slot at once, and two CHECK constraints that make a
-- rejection or a release impossible to record without a named decider.
--
-- Apply via `supabase db push` only. Never via MCP apply_migration or raw DDL.

ALTER TABLE public.publishing_package_assets
  ADD COLUMN IF NOT EXISTS decided_by_role text,
  ADD COLUMN IF NOT EXISTS decided_by_id uuid,
  ADD COLUMN IF NOT EXISTS decided_by_name text,
  ADD COLUMN IF NOT EXISTS decided_by_email text,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_reason text;
-- Nullable: existing rows predate the decision record.

-- One release_ready winner per period+role+locale slot. This is the
-- constraint that would have caught the same LinkedIn file being live as
-- the release_ready hero for both en-CA and pt-BR at once.
CREATE UNIQUE INDEX IF NOT EXISTS publishing_package_assets_one_release_ready_per_slot
  ON public.publishing_package_assets (period_id, asset_role, locale)
  WHERE status = 'release_ready';

-- A rejection must name who rejected it and why.
ALTER TABLE public.publishing_package_assets
  ADD CONSTRAINT publishing_package_assets_rejection_requires_reason
  CHECK (status <> 'rejected' OR (decision_reason IS NOT NULL AND decided_by_name IS NOT NULL));

-- A release must name who released it and when. This is the constraint
-- that would have blocked inferring approval from a filename/timestamp
-- pattern with no one actually recorded as having decided anything.
ALTER TABLE public.publishing_package_assets
  ADD CONSTRAINT publishing_package_assets_release_requires_decider
  CHECK (status <> 'release_ready' OR (decided_by_name IS NOT NULL AND decided_at IS NOT NULL));

-- ----------------------------------------------------------------------------
-- 5. Add the missing homepage-CTA role.
--
-- Operator-approved 2026-07-30. The existing asset_role CHECK has no value for
-- a homepage feature or card, so three of the seven canonical Week 3 assets
-- (journal-week3-counsel-note.jpg, journal-week3-clause.jpg,
-- journal-week3-clause-card.jpg) cannot be registered at all. Both homepage
-- surfaces -- the 1200x675 Counsel Note feature and the 1200x900 Clause card --
-- share one placement role; dimensions and content_slot_id distinguish them.
-- This mirrors the runtime registry, which also carries a single
-- website_homepage_cta_textless role for both.
--
-- Postgres cannot extend a CHECK in place; drop and recreate with the full list.
-- The constraint name below was read from the live catalogue on 2026-07-30, not
-- guessed, and confirmed as `publishing_package_assets_asset_role_check`:
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.publishing_package_assets'::regclass
--      AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%asset_role%';
-- ----------------------------------------------------------------------------
ALTER TABLE public.publishing_package_assets
  DROP CONSTRAINT IF EXISTS publishing_package_assets_asset_role_check;

ALTER TABLE public.publishing_package_assets
  ADD CONSTRAINT publishing_package_assets_asset_role_check
  CHECK (asset_role = ANY (ARRAY[
    'website_article_hero'::text,
    'website_homepage_cta'::text,          -- NEW 2026-07-30
    'native_linkedin_article_cover'::text,
    'linkedin_post_card'::text,
    'gbp_card'::text,
    'lead_magnet_document_hero'::text,
    'lead_magnet_landing_page_hero'::text,
    'canonical_textless_master'::text,
    'pdf_document'::text,
    'rendered_qa_evidence'::text
  ]));

-- ----------------------------------------------------------------------------
-- ROLLBACK (reference only -- do not run automatically; uncomment by hand)
-- ----------------------------------------------------------------------------
-- Restoring the prior CHECK will FAIL if any row already uses
-- 'website_homepage_cta'; re-role or delete those rows first.
-- ALTER TABLE public.publishing_package_assets DROP CONSTRAINT IF EXISTS publishing_package_assets_asset_role_check;
-- ALTER TABLE public.publishing_package_assets
--   ADD CONSTRAINT publishing_package_assets_asset_role_check
--   CHECK (asset_role = ANY (ARRAY['website_article_hero'::text, 'native_linkedin_article_cover'::text, 'linkedin_post_card'::text, 'gbp_card'::text, 'lead_magnet_document_hero'::text, 'lead_magnet_landing_page_hero'::text, 'canonical_textless_master'::text, 'pdf_document'::text, 'rendered_qa_evidence'::text]));
-- ALTER TABLE public.publishing_package_assets DROP CONSTRAINT IF EXISTS publishing_package_assets_release_requires_decider;
-- ALTER TABLE public.publishing_package_assets DROP CONSTRAINT IF EXISTS publishing_package_assets_rejection_requires_reason;
-- DROP INDEX IF EXISTS publishing_package_assets_one_release_ready_per_slot;
-- ALTER TABLE public.publishing_package_assets
--   DROP COLUMN IF EXISTS decision_reason,
--   DROP COLUMN IF EXISTS decided_at,
--   DROP COLUMN IF EXISTS decided_by_email,
--   DROP COLUMN IF EXISTS decided_by_name,
--   DROP COLUMN IF EXISTS decided_by_id,
--   DROP COLUMN IF EXISTS decided_by_role;
