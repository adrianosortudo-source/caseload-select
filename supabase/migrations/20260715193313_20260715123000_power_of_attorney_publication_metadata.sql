-- Publication Readiness remediation: metadata backfill for DRG Law's
-- "Power of attorney in Ontario" period (firm eec1d25e-a047-4827-8e4a-6eb96becca2b,
-- period_id f54ad626-a5f1-4cf2-bbf6-d2065828ba7b). DR-097. Mapped by explicit
-- deliverable id, confirmed against production and the live drg-law-website
-- source tree before writing this file (2026-07-15). Mirrors the shape and
-- discipline of 20260714141535_publication_metadata.sql (Founder Vesting)
-- and 20260715120500_relocation_clause_publication_metadata.sql (Relocation
-- Clause).
--
-- This period covers TWO companion "Clause in the Margin" cluster pieces,
-- same pattern as Relocation Clause: the main article (title-prefixed
-- "[COUNSEL NOTE]" in this content plan, "Power of attorney in Ontario: when
-- the document may become difficult to use") and its companion
-- (title-prefixed "[CLAUSE IN THE MARGIN]", "What the continuing power of
-- attorney clause does not say when only one attorney is named"). Every
-- GBP/LinkedIn row pairs with whichever of the two articles its title names.
--
-- ALL 13 deliverables in this period are status='in_review'. There is no
-- archived deliverable in this period to skip (unlike Relocation Clause,
-- which had one archived GBP bundle) -- confirmed by the inventory query
-- returning zero archived rows.
--
-- IMPORTANT PROCESS NOTE -- content_kind did NOT disambiguate the Lead
-- Magnet pair this time. Unlike the pattern described for this backfill
-- (one content_kind='text' landing page vs one content_kind='pdf' file),
-- BOTH the landing-page deliverable and the PDF-content deliverable in each
-- language carry content_kind='text' at the content_deliverables row level
-- (this content-approval system authors PDF content as an HTML body,
-- content_kind is not populated per role here). Disambiguation was done by
-- reading the actual deliverable_versions.body_html for each of the four
-- Lead Magnet rows: the two whose body opens with "Page 1 - Cover" /
-- "Página 1 - Capa" and is structured as the eight-page document itself are
-- the PDF content (EN f18d65b9, PT 8a4d72ef); the two whose body reads as
-- marketing copy ("From the Journal - Checklist..." / "Do Diário -
-- Checklist...", a preview list, and an email-capture form) are the landing
-- pages (EN 03121210, PT ef244a64). This is a body-content match, not a
-- content_kind match or a title-vibes guess.
--
-- IMPORTANT SCOPE NOTE -- both journal articles in this period (the Counsel
-- Note main article and the Clause in the Margin companion, EN and PT alike)
-- have ZERO source in drg-law-website/src/lib/articles.ts. This is a
-- different situation from Relocation Clause's "demolition clause" gap,
-- where the companion article's full source already existed in articles.ts
-- and was only pending deploy. Here, grep of articles.ts for "attorney" /
-- "poa" / "procuração" returns no matches at all across the whole file, and
-- the file's full slug list (read-before-sign-ontario,
-- commercial-lease-clauses-ontario, personal-guarantee-commercial-lease-ontario,
-- relocation-clause-ontario, demolition-clause-ontario, renewal-clause-ontario,
-- share-or-asset-purchase-structure-decision,
-- offer-stage-questions-real-estate-lawyer, founder-vesting-ontario,
-- founder-vesting-forfeiture-clause) confirms no power-of-attorney article
-- slug has been authored, EN or PT. The eventual route is genuinely
-- undetermined (not just "not yet deployed"), so publication_path is left
-- NULL for all four article rows per the no-invented-slug rule, and
-- cta_target_path is correspondingly left NULL on the four GBP/LinkedIn
-- rows that promote those two articles (their deliverable_role, locale, and
-- publication_destination are still recorded, since those are known and
-- intended regardless of the article's eventual slug).
--
-- Live verification results (2026-07-15, HTTP GET against drglaw.ca):
--   /resources/poa-review-checklist              200 (EN landing page, live)
--   /resources/poa-review-checklist.pdf          200 (EN PDF, live)
--   /pt/resources/poa-review-checklist            404 (no PT translation registered
--                                                       in checklists.ts -- no PT
--                                                       landing page was ever authored)
--   /resources/pt/poa-review-checklist.pdf        404 (no PT PDF file exists in
--                                                       public/resources/pt/ -- only
--                                                       relocation-clause-checklist.pdf
--                                                       and control-questions-checklist.pdf
--                                                       are there; poa-review-checklist.pdf
--                                                       exists only under public/resources/,
--                                                       the EN path, confirmed live 200)
--   (no EN or PT path exists in source for either journal article -- not
--    checked live, since there is nothing yet to check against; see the
--    scope note above)
--
-- The checklist's own EN body_html (deliverable_versions row for f18d65b9,
-- the PDF content) contains a reviewer's cross-reference note pointing at
-- "https://drglaw.ca/resources/poa-review-checklist.pdf" -- confirmed against
-- the live site and against checklists.ts (translations.en.pdfFile ===
-- "poa-review-checklist.pdf"), not taken on the deliverable's own word.

-- [CLAUSE IN THE MARGIN] continuing power of attorney clause companion, PT --
-- in_review. No PT article source exists (see scope note above).
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = null
where id = 'a16967f3-3f85-4bb1-9840-ec4f4a1fdc99';

-- [CLAUSE IN THE MARGIN] continuing power of attorney clause companion, EN --
-- in_review. No EN article source exists in articles.ts (see scope note above).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = null
where id = '4b64c0bb-090e-4952-806c-031dfaae0386';

-- [COUNSEL NOTE] power of attorney in Ontario, PT -- in_review. No PT article
-- source exists (see scope note above).
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = null
where id = 'ddb36273-4386-4f5e-bb34-2393eeb1956f';

-- [COUNSEL NOTE] power of attorney in Ontario, EN -- in_review. No EN article
-- source exists in articles.ts (see scope note above).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = null
where id = 'df5aedb8-1b75-4185-ad28-892f8027fa8b';

-- [GBP POST] "Clause in the margin - Article update" -- pairs with the
-- continuing power of attorney clause companion article, which has no known
-- path yet (see scope note above), so cta_target_path stays NULL.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'gbp_post', publication_destination = 'google_business_profile',
  publication_path = null, cta_target_path = null
where id = 'c1f2812f-fb69-4241-8fcf-46467fc995e3';

-- [GBP POST] "Power of attorney - Article update" -- pairs with the Counsel
-- Note main article, which has no known path yet (see scope note above), so
-- cta_target_path stays NULL.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'gbp_post', publication_destination = 'google_business_profile',
  publication_path = null, cta_target_path = null
where id = 'e6942e6c-dfd7-462b-89f8-35cbdac75a1f';

-- [GBP POST] "Power of attorney - Checklist offer" -- pairs with the lead
-- magnet landing page, verified live.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'gbp_post', publication_destination = 'google_business_profile',
  publication_path = null, cta_target_path = '/resources/poa-review-checklist'
where id = 'ea56dbe0-793e-46b7-8946-f09a567f4704';

-- [LEAD MAGNET . DOCUMENT] power of attorney review checklist, EN PDF --
-- verified live (200). Disambiguated from its landing-page sibling by
-- body_html content, not content_kind (see process note above).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'lead_magnet_pdf', publication_destination = 'firm_website',
  publication_path = '/resources/poa-review-checklist.pdf'
where id = 'f18d65b9-7143-49b5-a7c7-8c73b3cd2314';

-- [LEAD MAGNET . DOCUMENT] power of attorney review checklist, PT PDF -- no
-- PT PDF file exists anywhere in the site's source tree (public/resources/pt/
-- holds only relocation-clause-checklist.pdf and control-questions-checklist.pdf);
-- confirmed 404 live. The PT deliverable's own body_html cross-references the
-- EN file's URL for reviewer use, which is not evidence of a PT file existing.
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'lead_magnet_pdf', publication_destination = 'firm_website',
  publication_path = null
where id = '8a4d72ef-5895-42fa-bbac-e6fbbbfddbeb';

-- [LEAD MAGNET . LANDING PAGE] power of attorney review checklist, EN --
-- verified live (200). checklists.ts slug "poa-review-checklist",
-- translations.en present.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'landing_page', publication_destination = 'firm_website',
  publication_path = '/resources/poa-review-checklist'
where id = '03121210-9030-47ae-8182-6ed50c550ccc';

-- [LEAD MAGNET . LANDING PAGE] power of attorney review checklist, PT -- no
-- PT translation registered on the "poa-review-checklist" checklist entry in
-- checklists.ts (translations = { en: {...} } only, no pt key); confirmed
-- 404 live. No PT landing page was ever authored.
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'landing_page', publication_destination = 'firm_website',
  publication_path = null
where id = 'ef244a64-15ab-49cf-9935-fd59ee6da357';

-- [LINKEDIN POST] "Clause in the margin LinkedIn post" -- pairs with the
-- continuing power of attorney clause companion article, no known path yet
-- (see scope note above), so cta_target_path stays NULL.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'social_post', publication_destination = 'linkedin',
  publication_path = null, cta_target_path = null
where id = 'b2877ea4-d99e-4f30-afa1-3b8f628e6cc0';

-- [LINKEDIN POST] "Power of attorney LinkedIn post" -- pairs with the
-- Counsel Note main article, no known path yet (see scope note above), so
-- cta_target_path stays NULL.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'social_post', publication_destination = 'linkedin',
  publication_path = null, cta_target_path = null
where id = 'd92bc3d9-04d7-446c-aafd-294465b01ec8';
