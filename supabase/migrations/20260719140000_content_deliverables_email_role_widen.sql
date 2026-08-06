-- Widen deliverable_role and publication_destination to cover email
-- deliverables, for The DRG Law Minute (Content Studio v5.2 model). Also
-- widens publication_destination to distinguish a native LinkedIn article
-- from a LinkedIn teaser post, closing the gap that left two "Native LinkedIn
-- Article Adaptation" deliverables (fc59485e, 6224e7c1 in The Renewal Clause
-- period) with deliverable_role/publication_destination stuck at NULL,
-- because the schema had no value to give them.
--
-- 20260714141535_publication_metadata.sql's own design notes anticipated
-- exactly this: "Both lists are expected to widen over time via a small
-- additive migration, the same way webhook_outbox's action CHECK was
-- widened in 20260609_webhook_outbox_action_check_expand.sql. That is a
-- deliberate, reviewable event, not a design flaw."
--
-- content_placements.destination already includes 'email_delivery',
-- 'linkedin_post', 'linkedin_article', 'linkedin_company_page' (added
-- 20260715191218_20260715130100_content_placements.sql) for the newer
-- multi-destination model. The single-row legacy columns on
-- content_deliverables (deliverable_role, publication_destination) still
-- drive the existing Publication Readiness evaluator and had no email or
-- article/post distinction. This migration adds email_newsletter/email/
-- linkedin_article, additive only, no existing value removed or renamed.
--
-- publication_artifacts.destination shares content_deliverables'
-- publication_destination vocabulary at the TypeScript level
-- (PublicationDestination in types.ts) and is widened the same way here, so
-- the two never diverge: an artifact bound for a native LinkedIn article
-- (its cover image) or an email send (its hero image) needs to say so.
--
-- Deliberately NOT decided here: which deliverable_role the two existing
-- "Native LinkedIn Article Adaptation" deliverables should backfill to.
-- social_post is the mechanical choice, but ROLE_COPY_CONSTRAINTS currently
-- attaches a 40-80 word constraint to social_post for short teasers -- wrong
-- for a full-length article. That is a content-model decision, left to a
-- separate, deliberate change; this migration only makes the destination
-- expressible.
--
-- Companion backfill (data only, not schema): see
-- 20260719140600_drg_law_minute_backfill.sql, which fills in the ALREADY
-- LIVE Minute deliverable (764cd417-7f71-4b3e-919e-39e720fb9c13, created
-- 2026-07-20) once these constraints permit it. The original
-- 20260719140500_renewal_clause_drg_law_minute_deliverable.sql prepared on
-- 2026-07-19 predates that live deliverable and would have inserted a
-- SECOND, different Minute; it has been removed from the tree rather than
-- applied.
--
-- Migration-lineage freeze (docs/audits/MIGRATION_LINEAGE_INCIDENT_2026-07-18.md)
-- LIFTED 2026-07-27 (docs/audits/MIGRATION_LINEAGE_CLOSURE_2026-07-27.md).
-- This file now goes through the normal path: `supabase db push`.

alter table public.content_deliverables
  drop constraint if exists content_deliverables_role_check,
  add constraint content_deliverables_role_check
    check (
      deliverable_role is null or deliverable_role in (
        'article', 'social_post', 'gbp_post', 'lead_magnet_pdf', 'landing_page',
        'email_newsletter'
      )
    );

alter table public.content_deliverables
  drop constraint if exists content_deliverables_destination_check,
  add constraint content_deliverables_destination_check
    check (
      publication_destination is null or publication_destination in (
        'firm_website', 'linkedin', 'google_business_profile', 'email',
        'linkedin_article'
      )
    );

alter table public.publication_artifacts
  drop constraint if exists publication_artifacts_destination_check,
  add constraint publication_artifacts_destination_check
    check (
      destination is null or destination in (
        'firm_website', 'linkedin', 'google_business_profile', 'email',
        'linkedin_article'
      )
    );

comment on column public.content_deliverables.deliverable_role is
  'What kind of publication this is: article | social_post | gbp_post | lead_magnet_pdf | landing_page | email_newsletter. Drives the requirement profile in application code (Workstream 3).';
comment on column public.content_deliverables.publication_destination is
  'Destination TYPE, not a literal domain: firm_website | linkedin | linkedin_article | google_business_profile | email. linkedin is a teaser post; linkedin_article is a native long-form LinkedIn article -- kept distinct because they are different content shapes with different constraints. A firm''s own domain and this deliverable''s path live in publication_path.';
comment on column public.publication_artifacts.destination is
  'Same vocabulary as content_deliverables.publication_destination (see PublicationDestination in types.ts) -- which surface this specific artifact is evidence for, since a deliverable can carry artifacts bound to different destinations.';
