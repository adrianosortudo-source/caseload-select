-- Publication Readiness remediation: separate "what this deliverable
-- promotes" from "where this deliverable itself lives". DR-097 (review
-- correction).
--
-- publication_path was documented (20260714141535_publication_metadata.sql)
-- as "the deliverable's own placement": an article's journal URL, a PDF's
-- own file path. That is still exactly right for deliverable_role IN
-- ('article', 'landing_page', 'lead_magnet_pdf').
--
-- It is NOT right for deliverable_role IN ('gbp_post', 'social_post'). A
-- Google Business Profile post or a LinkedIn post does eventually have its
-- own placement (a GBP post ID, a LinkedIn permalink), but we never learn
-- or record that value here; what the Founder Vesting migration actually
-- wrote into publication_path for its GBP/LinkedIn rows was the URL of the
-- ARTICLE OR LANDING PAGE the post promotes -- a call-to-action target, a
-- fundamentally different thing wearing the same column. Nothing in the
-- readiness evaluator currently reads publication_path for these two
-- roles (SOCIAL_OR_GBP_BASE and GBP_POST in publication-requirements.ts
-- check destination_configuration and campaign_image, never
-- publication_path), so this was not a correctness bug in evaluation, but
-- it is a real semantic conflation in the data model: a future
-- requirement keyed on "does this social post have a placement" would
-- silently read a CTA link instead.
--
-- cta_target_path is the correctly-named home for that value. For
-- deliverable_role IN ('gbp_post', 'social_post'): publication_path stays
-- NULL (no known placement yet) and cta_target_path holds the on-site path
-- the post promotes. For every other role: cta_target_path stays NULL and
-- publication_path keeps meaning exactly what it always meant.

alter table public.content_deliverables
  add column if not exists cta_target_path text;

comment on column public.content_deliverables.cta_target_path is
  'For deliverable_role gbp_post/social_post only: the on-site path this post promotes (e.g. /journal/some-article or /resources/some-checklist), distinct from publication_path (this deliverable''s OWN placement, which for a social/GBP post is not yet known and stays NULL). Not read by any readiness requirement today; purely descriptive. See 20260715120200_content_deliverables_cta_target_path.sql.';

notify pgrst, 'reload schema';
