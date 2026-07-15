-- Publication Readiness remediation: metadata backfill for DRG Law's
-- "Already published, retroactive review" period (firm
-- eec1d25e-a047-4827-8e4a-6eb96becca2b, period_id
-- 2d84aca7-0680-4c96-9cbd-79b95c34c81f). DR-097. Mapped by explicit
-- deliverable id, confirmed against production and the live
-- drg-law-website source before writing this file (reconciliation done
-- in-session, 2026-07-15). Mirrors the shape and discipline of
-- 20260714141535_publication_metadata.sql (Founder Vesting) and
-- 20260715120500_relocation_clause_publication_metadata.sql (Relocation
-- Clause).
--
-- This period is unusually simple: exactly five deliverables, all
-- format "Counsel Note", all status='approved', all content_kind='text'.
-- There are no GBP posts, no LinkedIn posts, no lead-magnet checklists or
-- PDFs, no PT companion rows, and no archived sibling to skip in this
-- period -- the inventory query returned exactly these five rows and
-- nothing else. Each title (stripped of the content-plan's
-- "[COUNSEL NOTE] " bracket prefix) matches, verbatim, the `title` field
-- of one entry in drg-law-website's src/lib/articles.ts, so every row is
-- deliverable_role='article', publication_destination='firm_website'.
--
-- Live verification results (2026-07-15, HTTP GET against drglaw.ca):
--   /journal/read-before-sign-ontario                              200 (EN, live)
--   /journal/commercial-lease-clauses-ontario                      200 (EN, live)
--   /journal/personal-guarantee-commercial-lease-ontario           200 (EN, live)
--   /journal/share-or-asset-purchase-structure-decision            200 (EN, live)
--   /journal/offer-stage-questions-real-estate-lawyer              200 (EN, live)
--   /pt/journal/read-before-sign-ontario                           404
--   /pt/journal/commercial-lease-clauses-ontario                   404
--   /pt/journal/personal-guarantee-commercial-lease-ontario        404
--   /pt/journal/share-or-asset-purchase-structure-decision         404
--   /pt/journal/offer-stage-questions-real-estate-lawyer           404
--
-- All five EN paths are verified live (200). No locale column is set to
-- pt-BR for any row in this period, and no pt-BR row exists to set NULL:
-- the `articles.ts` Article type carries no `translations` field at all
-- (unlike checklists.ts, which does), so there is no PT article content,
-- authored or unauthored, anywhere in the site's source tree for any of
-- these five slugs. This is a stronger case than the Relocation Clause
-- precedent's "no PT page was ever authored" rows: there the PT 404s
-- were on genuinely bilingual content (a checklist with a full pt
-- translation object). Here the underlying content type (long-form
-- journal article) has never had a PT variant mechanism built for it.
-- Every row below is therefore locale='en-CA' with a real, verified-live
-- publication_path; no row needed a null-path branch.
--
-- One title-resolution note: the "read-before-sign-ontario" article
-- (articleKind: "pillar" in articles.ts) is a DIFFERENT page from the
-- pillars.ts hub at /journal/read-before-sign ("Read before sign, five
-- clauses on every commercial lease"). The two live at different slugs
-- (read-before-sign-ontario vs read-before-sign) with different titles;
-- there is no collision. The deliverable's title matches the articles.ts
-- entry verbatim, so that is the one mapped here.
--
-- No archived deliverable exists in this period to skip.

-- [COUNSEL NOTE] "Five clauses to read before signing a commercial lease
-- in Ontario." -- approved, verified live (200). Matches articles.ts
-- slug commercial-lease-clauses-ontario (cluster article under the
-- read-before-sign-ontario pillar).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = '/journal/commercial-lease-clauses-ontario'
where id = '33493ae8-1d58-4931-913c-2dc66e58a086';

-- [COUNSEL NOTE] "Read before you sign: Ontario leases, contracts, and
-- share agreements." -- approved, verified live (200). Matches
-- articles.ts slug read-before-sign-ontario (the ~3,000-word pillar
-- article; distinct from the pillars.ts hub page at /journal/read-
-- before-sign, see header note above).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = '/journal/read-before-sign-ontario'
where id = 'bf0b6c67-3203-414f-b58a-082fc7f093d4';

-- [COUNSEL NOTE] "Share purchase or asset purchase: the structure
-- decision before due diligence." -- approved, verified live (200).
-- Matches articles.ts slug share-or-asset-purchase-structure-decision.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = '/journal/share-or-asset-purchase-structure-decision'
where id = '8e4187dc-d362-4997-b25e-f17e8066a963';

-- [COUNSEL NOTE] "What a personal guarantee actually does on an Ontario
-- commercial lease." -- approved, verified live (200). Matches
-- articles.ts slug personal-guarantee-commercial-lease-ontario (cluster
-- article under the read-before-sign-ontario pillar).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = '/journal/personal-guarantee-commercial-lease-ontario'
where id = '295535a5-e32b-4e6b-bb1c-26feca508507';

-- [COUNSEL NOTE] "What to ask your real estate lawyer at the offer
-- stage." -- approved, verified live (200). Matches articles.ts slug
-- offer-stage-questions-real-estate-lawyer.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = '/journal/offer-stage-questions-real-estate-lawyer'
where id = 'c7f21b02-2a5e-41df-ad40-a6104d6678a2';
