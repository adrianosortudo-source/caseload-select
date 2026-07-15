-- Publication Readiness remediation: metadata backfill for DRG Law's "Equal
-- shares, unequal control" period (2026-07-06 to 2026-07-10, firm
-- eec1d25e-a047-4827-8e4a-6eb96becca2b, period_id
-- c6b76007-8c4d-414b-871f-74c3b5d76676). DR-097. Mapped by explicit
-- deliverable id, confirmed against production and the live
-- drg-law-website source tree before writing this file (reconciliation
-- done in-session, 2026-07-15). Mirrors the shape and discipline of
-- 20260714141535_publication_metadata.sql (Founder Vesting) and
-- 20260715120500_relocation_clause_publication_metadata.sql (Relocation
-- Clause), the two periods backfilled before this one.
--
-- This period is a materially different case from both precedents: it
-- ended five days before this migration was written (ends_on 2026-07-10)
-- with every deliverable still sitting at in_review, and the two dedicated
-- articles this period was built around have NOT been drafted into the
-- site source (src/lib/articles.ts) at all, in either language. This is
-- not a deploy gap (the Relocation Clause pattern, where full article prose
-- already existed in source and only the Vercel deploy was pending); there
-- is no article prose to deploy yet. A thorough search of articles.ts (all
-- slugs, all titles) turned up zero matches for "outside the ordinary
-- course of business," "Equal ownership does not settle control," "50/50,"
-- "reserved matters," or "deadlock" as an article topic. The only place
-- these phrases exist in the codebase are a risk-flag string in
-- lib/lead-magnet-compute.ts and passing mentions inside the unrelated,
-- pre-existing "corporate-decisions" pillar page and the
-- founder-vesting-forfeiture-clause article. Per the no-invented-slugs
-- rule, publication_path stays NULL on all four article rows (EN + PT for
-- both the Clause in the Margin piece and the Counsel Note piece) rather
-- than guessing at a /journal/... slug that has never been authored.
--
-- The lead-magnet side of this period is the opposite story and a genuine
-- surprise: the "Control-questions checklist" lead magnet (landing page +
-- PDF) is fully live in BOTH languages, ahead of the articles that were
-- meant to drive traffic to it. Live verification results (2026-07-15,
-- HTTP GET against drglaw.ca):
--   /resources/control-questions-checklist              200 (EN landing page, live)
--   /resources/control-questions-checklist.pdf           200 (EN PDF, live)
--   /pt/resources/control-questions-checklist            200 (PT landing page, live)
--   /resources/pt/control-questions-checklist.pdf        200 (PT PDF, live)
-- Confirmed against source: checklists.ts carries the "control-questions-
-- checklist" slug with a full en + pt translation pair, and both PDF files
-- exist under public/resources/ and public/resources/pt/.
--
-- The four Lead Magnet-format rows in this period all carry
-- content_kind='text' (this table's content_kind does not reliably
-- distinguish PDF from landing page for this period the way it did for
-- earlier ones), so the PDF-vs-landing-page split here was made instead
-- from deliverable_versions: the two rows whose current version has a
-- stored PDF asset (storage_path + asset_mime='application/pdf') are the
-- lead_magnet_pdf rows; the two rows with only body_html are the
-- landing_page rows. Titles alone would have been ambiguous ("Control
-- questions checklist" vs "Shareholders Agreement Control Questions" do
-- not obviously read as PDF-vs-page), so this migration did not guess from
-- title text per the task's content_kind-ambiguity instruction; it checked
-- the actual stored asset on each row's current_version_id instead.
--
-- GBP/LinkedIn pairing note: two of the three in_review GBP posts and both
-- LinkedIn posts pair, by title, unambiguously with this period's own
-- content ("Control-questions checklist" GBP post -> the lead-magnet
-- landing page; "Clause in the margin LinkedIn post" / "Shareholders
-- control LinkedIn post" -> the two not-yet-authored articles, by format-
-- name match, same convention as the Relocation Clause precedent). The
-- third GBP post, "Reserved-matters clause," and the "Shareholders control
-- guide" GBP post do not literally repeat either article's title text.
-- Reserved-matters consent rights are the substantive subject of the
-- Clause-in-the-Margin piece ("outside the ordinary course of business" is
-- the standard label for the clause that reserves certain decisions from
-- ordinary-course authority), and "Shareholders control guide" reads as
-- the natural GBP-post label for the Counsel Note piece ("Equal ownership
-- does not settle control"). Both pairings are recorded in this file's
-- per-row comments as the most likely reading, not a literal title match;
-- flagged explicitly in the delivery report. It does not change the
-- resulting data either way: both candidate articles are unauthored, so
-- cta_target_path is NULL on both rows regardless of which article each
-- post is ultimately confirmed to promote.
--
-- The one archived GBP bundle in this theme
-- (5c5282a8-d4fe-4194-a1e0-f2fefc70d06a, "[GBP POST] Shareholders control
-- GBP cards") is NOT touched here, matching the Founder Vesting and
-- Relocation Clause precedent: it stays archived and out of every
-- downstream readiness/manifest query by virtue of its status, not by any
-- special-case here.

-- [CLAUSE IN THE MARGIN] "outside the ordinary course of business", EN --
-- in_review. No journal article, live or unpublished, exists under this
-- title or slug anywhere in articles.ts; not a deploy gap, the piece has
-- not been drafted into the site source at all.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = null
where id = '3f1c9d59-3af6-409a-9a45-c1fc9207ae0e';

-- [CLAUSE IN THE MARGIN] "fora do curso normal dos negócios", PT --
-- in_review. Same as the EN sibling: no PT article page was ever authored
-- for this piece.
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = null
where id = '86c547f0-cd78-4a48-b64d-30fb824ebd6e';

-- [COUNSEL NOTE] "Equal ownership does not settle control", EN --
-- in_review. No journal article exists under this title anywhere in
-- articles.ts.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = null
where id = 'ac3027b9-4862-48d3-8b45-a68824301bc4';

-- [COUNSEL NOTE] "Propriedade igual não decide o controle", PT --
-- in_review. Same as the EN sibling: no PT article page was ever authored.
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'article', publication_destination = 'firm_website',
  publication_path = null
where id = '3934d8e6-3070-4a36-bd6b-6dcdff14c198';

-- [GBP POST] "Control-questions checklist" -- pairs with the lead-magnet
-- landing page, verified live.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'gbp_post', publication_destination = 'google_business_profile',
  publication_path = null, cta_target_path = '/resources/control-questions-checklist'
where id = '51d03ddf-e73d-46dc-b52b-e2b12325e4b2';

-- [GBP POST] "Reserved-matters clause" -- most likely pairs with the
-- Clause-in-the-Margin article on "outside the ordinary course of
-- business" (reserved-matters consent rights are that clause's subject),
-- but that article is unauthored, so cta_target_path stays null either
-- way. See header note; flagged in the delivery report as a judgment call,
-- not a literal title match.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'gbp_post', publication_destination = 'google_business_profile',
  publication_path = null, cta_target_path = null
where id = '4a5a44bd-a6e3-4b26-b933-12072eefced2';

-- [GBP POST] "Shareholders control guide" -- most likely pairs with the
-- Counsel Note article "Equal ownership does not settle control", but that
-- article is unauthored, so cta_target_path stays null either way. See
-- header note; flagged in the delivery report as a judgment call, not a
-- literal title match.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'gbp_post', publication_destination = 'google_business_profile',
  publication_path = null, cta_target_path = null
where id = '291f1c4b-ae9b-4233-a8e1-cdd528230597';

-- [LEAD MAGNET . DOCUMENT] control-questions-checklist, EN PDF -- current
-- version carries a stored application/pdf asset. Verified live (200).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'lead_magnet_pdf', publication_destination = 'firm_website',
  publication_path = '/resources/control-questions-checklist.pdf'
where id = 'a379a68b-b830-4cd3-8df7-574fd2aca103';

-- [LEAD MAGNET . DOCUMENT] control-questions-checklist, PT PDF -- current
-- version carries a stored application/pdf asset. Verified live (200).
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'lead_magnet_pdf', publication_destination = 'firm_website',
  publication_path = '/resources/pt/control-questions-checklist.pdf'
where id = 'f1dc2066-68be-4ac8-ac80-99e344870985';

-- [LEAD MAGNET . LANDING PAGE] control-questions-checklist, EN -- current
-- version is body_html only (no stored asset). Verified live (200).
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'landing_page', publication_destination = 'firm_website',
  publication_path = '/resources/control-questions-checklist'
where id = '885a429d-49a9-4ce3-b058-e2e28ef094f4';

-- [LEAD MAGNET . LANDING PAGE] control-questions-checklist, PT -- current
-- version is body_html only (no stored asset). Verified live (200).
update public.content_deliverables set
  locale = 'pt-BR', deliverable_role = 'landing_page', publication_destination = 'firm_website',
  publication_path = '/pt/resources/control-questions-checklist'
where id = '9de93a23-bc7c-40c8-92d3-af53b45928d1';

-- [LINKEDIN POST] "Clause in the margin LinkedIn post" -- pairs with the
-- Clause-in-the-Margin article by format-name match (same convention as
-- the Relocation Clause precedent). That article is unauthored, so
-- cta_target_path stays null.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'social_post', publication_destination = 'linkedin',
  publication_path = null, cta_target_path = null
where id = '8e081b0a-27f9-4310-ac10-9d6a8fd3a453';

-- [LINKEDIN POST] "Shareholders control LinkedIn post" -- pairs with the
-- Counsel Note article "Equal ownership does not settle control". That
-- article is unauthored, so cta_target_path stays null.
update public.content_deliverables set
  locale = 'en-CA', deliverable_role = 'social_post', publication_destination = 'linkedin',
  publication_path = null, cta_target_path = null
where id = '946d118f-f232-4a08-9617-3073801ea59b';
