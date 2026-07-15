-- Publication Readiness remediation: correct the already-merged Founder
-- Vesting metadata (20260714141535_publication_metadata.sql) now that
-- cta_target_path exists (20260715120200). DR-097 (review correction).
--
-- That migration set publication_path on Founder Vesting's three GBP
-- posts and two LinkedIn posts to the URL of the article/landing-page
-- each one promotes, not a placement of the post itself (no GBP post ID
-- or LinkedIn permalink was ever known). Moves those five values to the
-- correctly-named cta_target_path and nulls publication_path on the same
-- five rows -- publication_path now correctly reads "not yet known" for a
-- social/GBP post, matching every future gbp_post/social_post backfill
-- (see the Relocation Clause and later period migrations, all of which
-- write cta_target_path for these two roles from the start).
--
-- No other column changes. deliverable_role/locale/publication_destination
-- are untouched and remain correct.

update public.content_deliverables set
  publication_path = null, cta_target_path = '/journal/founder-vesting-ontario'
where id = '387ef3df-11fe-482f-8ebd-d1025fbe7a88'; -- [GBP POST] Founder vesting - Article update

update public.content_deliverables set
  publication_path = null, cta_target_path = '/resources/founder-vesting-checklist'
where id = '1c6df784-4a50-4035-8c9c-c08fa373f240'; -- [GBP POST] Founder vesting - Checklist offer

update public.content_deliverables set
  publication_path = null, cta_target_path = '/journal/founder-vesting-forfeiture-clause'
where id = 'a5b686e7-f631-4172-95ba-591d2de323fe'; -- [GBP POST] Clause in the margin - Article update

update public.content_deliverables set
  publication_path = null, cta_target_path = '/journal/founder-vesting-forfeiture-clause'
where id = '1130161f-01bf-49ca-880d-c0af1aa0fe95'; -- [LINKEDIN POST] Clause in the margin LinkedIn post

update public.content_deliverables set
  publication_path = null, cta_target_path = '/journal/founder-vesting-ontario'
where id = '267180e2-8e95-474d-b76f-818e70caca74'; -- [LINKEDIN POST] Founder vesting LinkedIn post
