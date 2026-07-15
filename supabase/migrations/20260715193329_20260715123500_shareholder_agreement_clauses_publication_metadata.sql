-- Publication Readiness remediation: metadata backfill for DRG Law's
-- "Shareholder agreement clauses" period (firm eec1d25e-a047-4827-8e4a-6eb96becca2b,
-- period_id 5b18cd87-72d4-429c-a1ff-041843af93d5). Mapped by explicit
-- deliverable id, confirmed against production and the live drg-law-website
-- source before writing this file (reconciliation done in-session,
-- 2026-07-15). Mirrors the shape and discipline of
-- 20260715120500_relocation_clause_publication_metadata.sql (Relocation
-- Clause) and 20260714141535_publication_metadata.sql (Founder Vesting).
--
-- All 13 deliverables in this period are status='in_review'. There is no
-- archived sibling to skip (confirmed: `select status, count(*) ... group by
-- status` returns exactly one row, in_review=13). Per the Founder Vesting
-- precedent, an unapproved period still gets its INTENDED metadata recorded
-- here; that is not a fabrication, it is the designed target, clearly
-- distinguished below from anything actually verified live.
--
-- This period covers TWO companion pieces: the Counsel Note ("Shareholder
-- agreements: the three clauses most founders skip") and its "Clause in the
-- Margin" companion ("What a shotgun clause actually forces when one
-- shareholder wants out", the shotgun-clause detail lifted out of the three
-- clauses the Counsel Note covers). Every GBP/LinkedIn row pairs with
-- whichever of the two its title names, exactly like the Relocation Clause
-- and Founder Vesting periods.
--
-- IMPORTANT DIFFERENCE from the Relocation Clause and Founder Vesting
-- precedents: in both of those periods the EN article(s) already existed in
-- drg-law-website's src/lib/articles.ts (either live, or authored-but-not-
-- yet-deployed). In THIS period, neither companion article exists in
-- articles.ts at all, not live and not as an unpublished entry. Full slug
-- inventory pulled from articles.ts (13 slugs total: read-before-sign-ontario,
-- commercial-lease-clauses-ontario, personal-guarantee-commercial-lease-ontario,
-- relocation-clause-ontario, demolition-clause-ontario, renewal-clause-ontario,
-- share-or-asset-purchase-structure-decision, offer-stage-questions-real-
-- estate-lawyer, founder-vesting-ontario, founder-vesting-forfeiture-clause,
-- plus 3 more unrelated to this theme) has no shareholder-agreement or
-- shotgun-clause entry, confirmed by grep. The linked Content Studio piece for
-- the EN Counsel Note (content_pieces.id fbd14fa9-3f80-4e2b-ac7c-54f020e14e8d)
-- confirms this directly: workflow_gate='legal_gate', status='draft' -- the
-- piece has reached legal review but has never been exported/published to the
-- site. No slug was ever designed, so none is invented here: publication_path
-- stays null on all four article rows (EN and PT, both formats), not just the
-- PT ones. This is a stronger "not yet built" case than Relocation Clause's
-- demolition-clause-ontario (which at least had full authored source content
-- sitting in articles.ts, just not deployed).
--
-- Live verification results (2026-07-15, HTTP GET against drglaw.ca):
--   /resources/shareholder-clauses-checklist                    200 (EN landing page, live)
--   /resources/shareholder-clauses-checklist.pdf                200 (EN PDF, live)
--   /pt/resources/shareholder-clauses-checklist                 404 (no PT translation was ever authored -- checklists.ts has no translations.pt entry for this slug)
--   /resources/pt/shareholder-clauses-checklist.pdf              404 (same: no PT file, no PT translation entry)
--   /journal/shareholder-agreement-clauses (guessed candidate)   404 (confirms no such route; not used as a path anywhere below, checked only to be thorough)
--   /journal/shotgun-clause-ontario (guessed candidate)          404 (same)
--   /pt/journal/shareholder-agreement-clauses (guessed candidate) 404 (same)
--
-- publication_path is left NULL for both PT lead-magnet rows (landing page
-- and PDF) because no PT page or PT PDF was ever authored anywhere in the
-- site source, same convention as the Founder Vesting and Relocation Clause
-- PT rows. Note: both PT lead-magnet deliverable rows carry an identical
-- description referencing the EN URL ("Landing-page copy for drglaw.ca/
-- resources/shareholder-clauses-checklist, transcribed verbatim from the live
-- page 2026-07-07") -- that describes what the PT COPY was drafted from
-- (a transcription reference), not a claim that a PT route exists. Verified
-- directly against checklists.ts: the shareholder-clauses-checklist entry's
-- `translations` object has only an `en` key, no `pt` key.
--
-- Title collision resolved via description, not content_kind: all four
-- lead-magnet rows in this period carry content_kind='text' (this period has
-- no content_kind='pdf' distinguishing row, unlike the generic case described
-- in the backfill brief). The landing-page member of each EN/PT pair is
-- identified by its non-null description ("Landing-page copy for
-- drglaw.ca/resources/shareholder-clauses-checklist, transcribed verbatim
-- from the live page 2026-07-07"); the PDF member of each pair has
-- description=null. Confirmed by direct query before writing this file.
--
-- No archived deliverable exists in this period (see status count note
-- above), so there is nothing to skip.
--
-- Every gbp_post/social_post row below sets cta_target_path (the on-site path
-- it promotes), NOT publication_path, per
-- 20260715120200_content_deliverables_cta_target_path.sql. publication_path
-- stays NULL on all five of these rows: no GBP post ID or LinkedIn permalink
-- is known. cta_target_path is ALSO null on the four rows that promote one of
-- the two companion articles (both article paths are themselves unknown, see
-- above); it is set to the real, verified-live checklist landing page only on
-- the one GBP row that promotes the lead magnet.

-- [CLAUSE IN THE MARGIN] shotgun clause, PT -- in_review. No PT article was
-- ever authored (nor, in this period, was the EN companion -- see header).
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = null
where id = '502f67a3-1e62-4b4a-8d7b-bd6e592d0dd9';

-- [CLAUSE IN THE MARGIN] shotgun clause, EN -- in_review. No articles.ts
-- entry exists for this piece at all; nothing to point publication_path at.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = null
where id = '275878d2-1d4e-4658-9f6d-e248081b3ee4';

-- [COUNSEL NOTE] shareholder agreement clauses, PT -- in_review. No PT
-- article was ever authored.
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = null
where id = 'df9fccba-3ba2-4354-9f17-e252d5a8f9ff';

-- [COUNSEL NOTE] shareholder agreement clauses, EN -- in_review. Confirmed
-- via the linked Content Studio piece (fbd14fa9-3f80-4e2b-ac7c-54f020e14e8d):
-- workflow_gate='legal_gate', status='draft'. Never exported/published, no
-- articles.ts entry, no slug was ever designed.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = null
where id = '836bb33e-6d5b-4c96-b1d4-a7c6d82d6e10';

-- [GBP POST] "Clause in the margin - Article update" -- pairs with the
-- shotgun-clause Clause in the Margin companion, which has no known site
-- path (see header). cta_target_path left null; nothing to point it at yet.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'gbp_post', publication_destination = 'google_business_profile',
  publication_path = null, cta_target_path = null
where id = '00969ecf-3c98-49eb-b7fb-15605b9088d5';

-- [GBP POST] "Shareholder clauses - Article update" -- pairs with the
-- Counsel Note article, which has no known site path (see header).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'gbp_post', publication_destination = 'google_business_profile',
  publication_path = null, cta_target_path = null
where id = '5ae3e412-9f5e-4cf1-9605-d4b98a3c5f65';

-- [GBP POST] "Shareholder clauses - Checklist offer" -- pairs with the lead
-- magnet landing page, verified live (200).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'gbp_post', publication_destination = 'google_business_profile',
  publication_path = null, cta_target_path = '/resources/shareholder-clauses-checklist'
where id = '3145f1b1-d5ca-4429-a2fe-30ca6ccea6e5';

-- [LEAD MAGNET . LANDING PAGE] shareholder clauses checklist, PT -- no PT
-- translation was ever authored in checklists.ts (translations object has
-- only an `en` key); identified as the landing-page member of the PT pair by
-- its non-null "Landing-page copy for..." description (content_kind is
-- 'text' for both PT rows in this period, not a usable discriminator here).
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'landing_page', publication_destination = 'firm_website',
  publication_path = null
where id = '7bbe2d94-0846-4170-be61-6376345bf8cf';

-- [LEAD MAGNET . DOCUMENT] shareholder clauses checklist, PT PDF -- no PT
-- pdfFile exists in checklists.ts; identified as the PDF member of the PT
-- pair by its null description (the landing-page sibling has one, this row
-- does not).
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'lead_magnet_pdf', publication_destination = 'firm_website',
  publication_path = null
where id = '9b3b477c-1164-4b01-8993-83d0b2fed5d9';

-- [LEAD MAGNET . DOCUMENT] shareholder clauses checklist, EN PDF -- verified
-- live (200). checklists.ts pdfFile: "shareholder-clauses-checklist.pdf".
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'lead_magnet_pdf', publication_destination = 'firm_website',
  publication_path = '/resources/shareholder-clauses-checklist.pdf'
where id = '8b9bf103-e215-4a2b-bbc4-01119e678a73';

-- [LEAD MAGNET . LANDING PAGE] shareholder clauses checklist, EN -- verified
-- live (200). checklists.ts slug: "shareholder-clauses-checklist".
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'landing_page', publication_destination = 'firm_website',
  publication_path = '/resources/shareholder-clauses-checklist'
where id = '85189c64-df33-47bc-ae76-0c4e94c9c6f3';

-- [LINKEDIN POST] "Clause in the margin LinkedIn post" -- pairs with the
-- shotgun-clause Clause in the Margin companion, no known site path.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'social_post', publication_destination = 'linkedin',
  publication_path = null, cta_target_path = null
where id = 'f1560f2a-3939-4369-9367-fb387235995d';

-- [LINKEDIN POST] "Shareholder clauses LinkedIn post" -- pairs with the
-- Counsel Note article, no known site path.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'social_post', publication_destination = 'linkedin',
  publication_path = null, cta_target_path = null
where id = '18101e31-0378-434f-918b-74eb7055ae05';
