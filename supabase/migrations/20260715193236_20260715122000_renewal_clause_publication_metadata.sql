-- Publication Readiness remediation: metadata backfill for DRG Law's "The
-- renewal clause" period (firm eec1d25e-a047-4827-8e4a-6eb96becca2b, period_id
-- 7ca11880-42a9-4bab-940a-baf2966b9f7e). DR-097. Mapped by explicit
-- deliverable id, confirmed against production and the live
-- drg-law-website source/deploy before writing this file (session
-- 2026-07-15). Mirrors the shape and discipline of
-- 20260715120500_relocation_clause_publication_metadata.sql (Relocation
-- Clause) and 20260714141535_publication_metadata.sql (Founder Vesting).
--
-- Every non-archived row in this period is still status='in_review'. Nothing
-- here is approved or published yet -- that is normal and expected (same
-- posture as Founder Vesting's unapproved rows). This migration still
-- records the INTENDED role/locale/destination/path per deliverable; the
-- header below states plainly what is verified-live versus merely designed,
-- and status/approved_version_id are NOT touched by this file.
--
-- This period covers TWO companion "Clause in the Margin" cluster topics:
-- the renewal clause (title-prefixed "[COUNSEL NOTE]") and a companion
-- angle, "the good-standing clause" (title-prefixed "[CLAUSE IN THE
-- MARGIN]"). Unlike the Relocation Clause period, where the CLAUSE IN THE
-- MARGIN companion (demolition clause) already had a full, real
-- articles.ts entry (slug demolition-clause-ontario) just not yet deployed,
-- "the good-standing clause" has NO matching entry anywhere in
-- drg-law-website's articles.ts -- no slug, no title match, in English or
-- Portuguese. "Good standing" is discussed only as a subtopic INSIDE the
-- renewal-clause-ontario article body (one of the vague renewal conditions
-- the article warns about), not as its own standalone piece. The five
-- named lease clauses this content series draws from (personal guarantee,
-- renewal, demolition, relocation, default) do not include a "good
-- standing" clause at all. Per the no-invention rule, publication_path and
-- cta_target_path for every deliverable and CTA row tied to this companion
-- angle are left NULL rather than guessing a slug or reusing the renewal
-- article's path under a different topic label. Flag to the operator as a
-- content-plan gap (a "good-standing-clause-ontario" article may need to be
-- authored, or the content-plan title needs correcting to name one of the
-- five clauses already in scope), not something this migration should
-- paper over.
--
-- Live verification results (2026-07-15, HTTP GET against drglaw.ca):
--   /journal/renewal-clause-ontario                      200 (EN, live)
--   /resources/renewal-clause-checklist                  200 (EN landing page, live)
--   /resources/renewal-clause-checklist.pdf              200 (EN PDF, live)
--   /pt/journal/renewal-clause-ontario                   404 (no PT article was ever authored; articles.ts
--                                                             has no translations/locale mechanism at all)
--   /pt/resources/renewal-clause-checklist               404 (checklists.ts renewal-clause-checklist entry
--                                                             carries only an "en" translation, no "pt" key)
--   /resources/pt/renewal-clause-checklist.pdf           404 (no PT PDF file in public/resources/pt/;
--                                                             confirmed by directory listing, not just the 404)
-- No candidate path exists to check for the good-standing companion (EN or PT); nothing to verify.
--
-- publication_path is left NULL for the two PT lead-magnet rows and the PT
-- counsel-note row because no PT page was ever authored anywhere for this
-- topic (same convention as Founder Vesting's and Relocation Clause's PT
-- rows) -- not a deploy gap, a translation that was never written.
--
-- The two archived GBP rows in this theme (e1c52856-ddd8-443a-8d0e-4f72f337a5cd,
-- "[GBP POST] Clause in the margin - Article update", and
-- 9b61392c-d8ee-49b0-9a09-3e25e55badf9, "[GBP POST] Renewal clause GBP
-- cards") are NOT touched here, matching the Relocation Clause / Founder
-- Vesting precedent: they stay archived and out of every downstream
-- readiness/manifest query by virtue of their status, not by any
-- special-case in this file.

-- [CLAUSE IN THE MARGIN] good-standing clause companion, PT -- in_review.
-- No matching article exists in source for this companion angle in any
-- language (see header); path left null, not a translation gap.
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = null
where id = 'f269d5df-16b5-4e21-9084-714596a374c1';

-- [CLAUSE IN THE MARGIN] good-standing clause companion, EN -- in_review.
-- No matching article exists in drg-law-website's articles.ts for this
-- title (verbatim or near-verbatim); good standing is discussed only as a
-- subtopic inside renewal-clause-ontario, not as its own page. Left null
-- rather than guessing a slug or borrowing the renewal article's path.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = null
where id = '6a168ab2-4ef5-42be-873a-10adc70e3f95';

-- [COUNSEL NOTE] renewal clause, PT -- in_review, but no PT article page
-- was ever authored (articles.ts has no translations/locale mechanism).
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = null
where id = 'f544114b-82e8-487a-9e34-a64ef6d8abfb';

-- [COUNSEL NOTE] renewal clause, EN -- in_review. Title matches
-- articles.ts renewal-clause-ontario verbatim ("How an Ontario commercial
-- lease renewal clause shapes your control of the space after Year
-- Five."). Verified live (200).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = '/journal/renewal-clause-ontario'
where id = 'd57c1204-1a9e-4577-b205-994f3a363a36';

-- [GBP POST] "Good-standing clause" -- pairs with the good-standing
-- companion article, which does not exist in source (see header). No CTA
-- target to record.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'gbp_post', publication_destination = 'google_business_profile',
  publication_path = null, cta_target_path = null
where id = '47192242-5edc-4cfc-809c-0b03e5221213';

-- [GBP POST] "Renewal clause checklist" -- pairs with the lead magnet
-- landing page, verified live.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'gbp_post', publication_destination = 'google_business_profile',
  publication_path = null, cta_target_path = '/resources/renewal-clause-checklist'
where id = '35736fd7-5592-43f7-9933-7c06498be668';

-- [GBP POST] "Renewal clause guide" -- pairs with the renewal clause
-- article (the counsel note), verified live. "Renewal clause checklist"
-- above already claims the lead-magnet CTA, so by elimination and topical
-- match this is the article-promotion post.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'gbp_post', publication_destination = 'google_business_profile',
  publication_path = null, cta_target_path = '/journal/renewal-clause-ontario'
where id = '7bd947f0-fb0b-409d-bfc5-47a23153dc07';

-- [LEAD MAGNET . DOCUMENT] renewal clause checklist, EN PDF -- verified
-- live (200).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'lead_magnet_pdf', publication_destination = 'firm_website',
  publication_path = '/resources/renewal-clause-checklist.pdf'
where id = 'bcf435da-c620-4e78-b4b5-621dca500d2e';

-- [LEAD MAGNET . DOCUMENT] renewal clause checklist, PT PDF -- no PT
-- translation exists for this checklist in checklists.ts (only an "en" key
-- is present) and no PT PDF file exists in public/resources/pt/. Confirmed
-- 404 live; path left null.
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'lead_magnet_pdf', publication_destination = 'firm_website',
  publication_path = null
where id = '74d63fbc-faea-40b4-8ea9-209327b8068a';

-- [LEAD MAGNET . LANDING PAGE] renewal clause checklist, EN -- verified
-- live (200).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'landing_page', publication_destination = 'firm_website',
  publication_path = '/resources/renewal-clause-checklist'
where id = '90afafad-793b-45e9-b61e-8830062e4831';

-- [LEAD MAGNET . LANDING PAGE] renewal clause checklist, PT -- no PT
-- translation exists in source (same checklists.ts entry as the PDF row
-- above); confirmed 404 live; path left null.
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'landing_page', publication_destination = 'firm_website',
  publication_path = null
where id = '5e6eef9b-0c04-4919-a05d-a058c496891b';

-- [LINKEDIN POST] "Clause in the margin LinkedIn post" -- pairs with the
-- good-standing companion article, which does not exist in source (see
-- header). No CTA target to record.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'social_post', publication_destination = 'linkedin',
  publication_path = null, cta_target_path = null
where id = '6286c371-20a3-4a29-983a-a52ac01ba599';

-- [LINKEDIN POST] "Renewal clause LinkedIn post" -- pairs with the renewal
-- clause article, verified live.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'social_post', publication_destination = 'linkedin',
  publication_path = null, cta_target_path = '/journal/renewal-clause-ontario'
where id = '9e71eed2-ad1b-4481-b66c-73918e52c15a';
