-- Publication Readiness remediation: metadata backfill for DRG Law's
-- "Decision tools" period (2026-06-01 to 2026-06-30, firm
-- eec1d25e-a047-4827-8e4a-6eb96becca2b, period_id
-- 5a755803-499c-4405-8bd7-9366de6050ed). DR-097. Mapped by explicit
-- deliverable id, confirmed against production and the live
-- drg-law-website source/deploy before writing this file (see the
-- reconciliation done in-session, 2026-07-15). Mirrors the shape and
-- discipline of 20260714141535_publication_metadata.sql (Founder Vesting)
-- and 20260715120500_relocation_clause_publication_metadata.sql (the two
-- periods backfilled before this one).
--
-- This period is structurally different from Founder Vesting and
-- Relocation Clause: it is not a publish-week content cluster with a
-- journal article plus GBP/LinkedIn companions plus a lead-magnet PDF. Per
-- the period's own `details` field ("The three interactive decision tools
-- live on drglaw.ca/tools. Standing assets reviewed for accuracy and LSO
-- 4.2-1 compliance, not tied to a single publish week."), it holds exactly
-- three standing review deliverables, one per interactive decision tool,
-- all `content_kind='text'`, all already `status='approved'`. There is no
-- GBP post, no LinkedIn post, no lead-magnet PDF, and no separate PT-locale
-- deliverable row in this period, so cta_target_path (added in
-- 20260715120200_content_deliverables_cta_target_path.sql) is not touched
-- by any row here: none of the three carry deliverable_role IN
-- ('gbp_post','social_post').
--
-- Title-to-source mapping (verified against drg-law-website, not guessed):
--   "[DECISION TOOL] Closing Clarity Map"
--     -> src/app/tools/closing-clarity-map/page.tsx, H1 title="Closing
--        Clarity Map" (exact match).
--   "[DECISION TOOL] Estate Structure Check"
--     -> src/app/tools/estate-structure-check/page.tsx, H1
--        title="Estate Structure Check" (exact match; the route's
--        <head> metadata title is the near-synonym "Estate Structure
--        Checklist", not used for this match).
--   "[DECISION TOOL] Small Business Legal Readiness Score"
--     -> src/app/tools/business-readiness-score/page.tsx, metadata
--        title: "Small Business Legal Readiness Score" (exact match).
-- No title collision existed in this period (all three titles are
-- distinct), so content_kind was not needed to disambiguate; it is
-- reported here only because the task brief asked for it.
--
-- Locale: every deliverable's current version body opens with a
-- blockquote reading "Live tool: drglaw.ca/tools/<slug>" (the EN path)
-- and instructs the reviewer to check "the copy below is what readers
-- see on the page" against that EN URL -- there is no mention of the PT
-- route anywhere in any of the three version bodies. All three are
-- therefore locale='en-CA'. drg-law-website does carry live PT routes for
-- all three tools (src/app/pt/tools/<slug>/page.tsx, confirmed live
-- below), but this content period never created a PT-locale deliverable
-- row to attach that path to; that is a real gap in the content plan, not
-- something to paper over by inventing a PT row or by guessing a PT
-- publication_path onto an EN-scoped deliverable. Flagged to the operator
-- as a content-plan follow-up, not fixed here.
--
-- Role: the five-value deliverable_role CHECK (article / social_post /
-- gbp_post / lead_magnet_pdf / landing_page) has no dedicated
-- "interactive tool" value. Of the five, landing_page is the closest
-- correct fit: each decision tool is a standalone page at its own
-- publish path on the firm's own site, not a journal article, not a PDF,
-- not a social/GBP post. publication_destination = 'firm_website' for
-- all three accordingly.
--
-- Live verification results (2026-07-15, HTTP GET against drglaw.ca):
--   /tools/closing-clarity-map          200 (EN, live)
--   /tools/estate-structure-check       200 (EN, live)
--   /tools/business-readiness-score     200 (EN, live)
--   /pt/tools/closing-clarity-map       200 (PT route exists and is live;
--                                            no PT deliverable row exists
--                                            in this period to attach it to)
--   /pt/tools/estate-structure-check    200 (same as above)
--   /pt/tools/business-readiness-score  200 (same as above)
--
-- All three deliverables are already status='approved' with a current
-- version; none is draft/in_review, so there is no "still pending, path
-- is only the intended target" case in this period (unlike Relocation
-- Clause's one open in_review row). Every publication_path below is a
-- verified-live (200) path, not an intended-but-unconfirmed one.
--
-- No deliverable in this period is archived, so nothing is skipped here
-- (the Relocation Clause precedent's archived-GBP-sibling skip does not
-- apply; this period simply has none).

-- [DECISION TOOL] Closing Clarity Map -- approved, verified live (200).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'landing_page', publication_destination = 'firm_website',
  publication_path = '/tools/closing-clarity-map'
where id = '13e6e6f8-f997-45ae-a619-33768c8fc723';

-- [DECISION TOOL] Estate Structure Check -- approved, verified live (200).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'landing_page', publication_destination = 'firm_website',
  publication_path = '/tools/estate-structure-check'
where id = '74a555c5-8e17-4af8-b9f0-e23b25db0525';

-- [DECISION TOOL] Small Business Legal Readiness Score -- approved,
-- verified live (200).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'landing_page', publication_destination = 'firm_website',
  publication_path = '/tools/business-readiness-score'
where id = '6cd22d18-5c9e-44c3-a713-3babe9dccf10';
