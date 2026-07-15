-- Publication Readiness remediation: metadata backfill for DRG Law's
-- "The relocation clause" period (2026-06-22 to 2026-06-26, firm
-- eec1d25e-a047-4827-8e4a-6eb96becca2b, period_id
-- 950bad0b-fef6-4c5a-b949-fef5d9cbee90). DR-097. Mapped by explicit
-- deliverable id, confirmed against production and the live
-- drg-law-website source/deploy before writing this file (see the
-- reconciliation done in-session, 2026-07-15). Mirrors the shape and
-- discipline of 20260714141535_publication_metadata.sql (Founder Vesting),
-- the only period backfilled before this one.
--
-- This period actually covers TWO companion "Clause in the Margin" cluster
-- articles: the relocation clause (title-prefixed "[COUNSEL NOTE]" in this
-- content plan) and its companion, the demolition clause (title-prefixed
-- "[CLAUSE IN THE MARGIN]"). Every GBP/LinkedIn row pairs with whichever of
-- the two articles its title names.
--
-- Live verification results (2026-07-15, HTTP GET against drglaw.ca):
--   /journal/relocation-clause-ontario                  200 (EN, live)
--   /resources/relocation-clause-checklist              200 (EN landing page, live)
--   /resources/relocation-clause-checklist.pdf           200 (EN PDF, live)
--   /journal/demolition-clause-ontario                   404
--   /resources/pt/relocation-clause-checklist.pdf        404
--   /pt/resources/relocation-clause-checklist             404
--   /pt/journal/relocation-clause-ontario                404 (no PT article was ever authored)
--   /pt/journal/demolition-clause-ontario                 404 (no PT article was ever authored)
--
-- The three 404s marked "not yet deployed" below correspond to real,
-- already-authored source content (articles.ts has the full
-- demolition-clause-ontario article; checklists.ts has a complete pt
-- translation; the PT PDF file exists in public/resources/pt/) that the
-- separate drg-law-website Vercel project (manual `vercel --prod` deploys,
-- no git integration) has not yet shipped. That is a real, PRE-EXISTING
-- production gap, independent of this migration and of Publication
-- Readiness -- not something this backfill causes or should paper over.
-- publication_path is still set to the real, designed path for that
-- content (never a guess): once readiness enforcement is activated for
-- this period and the matching publication_artifacts evidence is
-- registered and reconciled (a separate, later, reviewed step), these rows
-- will correctly and honestly show "Blocked" on the webpage/PDF artifact
-- checks until drg-law-website is redeployed. Flag the redeploy to the
-- operator as its own follow-up; do not regenerate or fabricate the
-- missing pages here.
--
-- publication_path is left NULL only where no PT page was ever authored
-- anywhere (the two PT "Clause in the Margin"/"Counsel Note" article rows):
-- there is no articles.ts entry, live or unpublished, for a Portuguese
-- relocation-clause or demolition-clause journal page. Same convention as
-- Founder Vesting's PT article rows.
--
-- The one archived GBP bundle in this theme
-- (ac99690c-0643-4732-a209-704da8d0333d, "[GBP POST] Relocation clause GBP
-- cards") is NOT touched here, matching the Founder Vesting precedent: it
-- stays archived and out of every downstream readiness/manifest query by
-- virtue of its status, not by any special-case here.
--
-- Every gbp_post/social_post row below sets cta_target_path (the on-site
-- path it promotes), NOT publication_path (this migration corrects the
-- Founder Vesting precedent's conflation of the two -- see
-- 20260715120200_content_deliverables_cta_target_path.sql and
-- 20260715120400_founder_vesting_cta_target_path_fix.sql). publication_path
-- stays NULL on these five rows: no GBP post ID or LinkedIn permalink is
-- known.

-- [CLAUSE IN THE MARGIN] demolition clause, PT -- in_review, genuinely
-- pending (the one real open approval this period; do not touch status).
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = null
where id = 'b767ef14-dd4e-405e-9c54-1f7f9364f13c';

-- [CLAUSE IN THE MARGIN] demolition clause, EN -- approved. Designed path;
-- currently 404 live (drg-law-website deploy gap, see note above).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = '/journal/demolition-clause-ontario'
where id = 'e3fb60fe-08c5-45ee-854b-889beaaa9136';

-- [COUNSEL NOTE] relocation clause, PT -- approved, but no PT article page
-- was ever authored.
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = null
where id = 'ba1f4aeb-54ef-442a-8d8c-e5ae99a54bb9';

-- [COUNSEL NOTE] relocation clause, EN -- approved, verified live (200).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = '/journal/relocation-clause-ontario'
where id = '22dde96c-9400-403c-8314-1402bcaaab23';

-- [GBP POST] "Clause in the margin - Article update" -- pairs with the
-- demolition article (currently not yet deployed, see note above).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'gbp_post', publication_destination = 'google_business_profile',
  cta_target_path = '/journal/demolition-clause-ontario'
where id = '303151e3-68ae-40a1-b2fe-4e4733b3b17a';

-- [GBP POST] "Relocation clause - Article update" -- pairs with the
-- relocation article, verified live.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'gbp_post', publication_destination = 'google_business_profile',
  cta_target_path = '/journal/relocation-clause-ontario'
where id = 'b0b11b43-de75-430e-8728-f2e52de882fb';

-- [GBP POST] "Relocation clause - Checklist offer" -- pairs with the lead
-- magnet landing page, verified live.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'gbp_post', publication_destination = 'google_business_profile',
  cta_target_path = '/resources/relocation-clause-checklist'
where id = '78b56c81-30ae-4cfc-914e-006a616912d3';

-- [LEAD MAGNET . DOCUMENT] relocation clause checklist, EN PDF -- verified
-- live (200).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'lead_magnet_pdf', publication_destination = 'firm_website',
  publication_path = '/resources/relocation-clause-checklist.pdf'
where id = 'f952ce27-67f9-4813-9d04-418ebd37aeba';

-- [LEAD MAGNET . DOCUMENT] relocation clause checklist, PT PDF -- file
-- exists in the site's source tree; currently 404 live (deploy gap).
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'lead_magnet_pdf', publication_destination = 'firm_website',
  publication_path = '/resources/pt/relocation-clause-checklist.pdf'
where id = '3a15ec4d-c2d9-4d36-b912-eb6c5128f914';

-- [LEAD MAGNET . LANDING PAGE] relocation clause checklist, EN -- verified
-- live (200).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'landing_page', publication_destination = 'firm_website',
  publication_path = '/resources/relocation-clause-checklist'
where id = '897e8ce9-2175-4d9d-811b-30dba72b61cc';

-- [LEAD MAGNET . LANDING PAGE] relocation clause checklist, PT -- full pt
-- translation exists in the site's source tree; currently 404 live
-- (deploy gap).
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'landing_page', publication_destination = 'firm_website',
  publication_path = '/pt/resources/relocation-clause-checklist'
where id = 'e3fa2f5e-d1fb-4011-92a8-089817b2c9c1';

-- [LINKEDIN POST] "Clause in the margin LinkedIn post" -- pairs with the
-- demolition article (not yet deployed, see note above).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'social_post', publication_destination = 'linkedin',
  cta_target_path = '/journal/demolition-clause-ontario'
where id = '23661929-b4f8-489e-b022-96d98ad04384';

-- [LINKEDIN POST] "Relocation clause LinkedIn post" -- pairs with the
-- relocation article, verified live.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'social_post', publication_destination = 'linkedin',
  cta_target_path = '/journal/relocation-clause-ontario'
where id = 'e8218afe-6d7a-483f-b3ec-68888a14a703';
