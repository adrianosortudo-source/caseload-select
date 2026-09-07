# GTA Prospect Batch 010 — EAST_OUTER lane

Observation date: 2026-09-07  
Status: research-only, unsent, not accepted for import

## Scope and method

This lane covers distinct private-practice firms with a first-party web presence in Scarborough, Pickering, Ajax, Whitby, Oshawa, Hamilton, Burlington, Oakville, Milton, or another GTA outer municipality. Public search was used only for discovery. Evidence URLs in the JSON are firm-owned roster/team or firm-owned office pages. No LSO, forms, chat, booking, email/phone, CRM, ads, GBP, contact-data collection, or outreach was used.

For each candidate, I counted only people presented by the firm as a lawyer, partner, counsel, associate, barrister, solicitor, or equivalent. Clerks, paralegals, students, intake/operations staff, and office managers were excluded unless the page explicitly identified them as lawyers. `exact` means the first-party page exposes a countable current roster; `at_least` means the page clearly supports a minimum but may include additional lawyer profiles; `uncertain` is held and not promoted.

Before recording a page, I requested each domain's public `robots.txt`. Most returned HTTP 200. A small number returned 403/404/timeout (`fdhlawyers.com`, `geneseemartin.ca`, `hamiltoncblaw.com`, `rossmcbride.com`, and `oshawalaw.com`); those domains were retained only where the first-party evidence was independently accessible through the roster/home page. I did not bypass interstitials or access controls. Where a first-party terms/privacy link was visible, the page was treated as read-only public content and no interactive action was taken.

## Reconciliation and counts

- 33 distinct lane records written.
- 24 `candidate` records (all `accepted: false`): countable first-party roster evidence, with 23 exact and 1 at-least count.
- 9 `held` records (all `accepted: false`): uncertain/stale/inaccessible evidence or a count outside the 3–20 lane ceiling.
- 0 accepted records. This is deliberate: the lane is a research artifact and has not been authorized for import or contact.
- Exact-name and exact-canonical-domain comparison against PR #231, batches 001–009, and the current 103-record accepted-manifest baseline found no duplicates after removing previously seen firms.

## Held records and reasons

- TMA Law — 12 people are visible, but lawyer-role labels are not consistently explicit.
- Genesee Martin Associates — the page describes a three-lawyer firm but also says Chris Martin is no longer with the firm, creating a stale/conflicting roster.
- AP Lawyers — the page says “several lawyers” but does not enumerate a countable roster.
- Bowman Law LLP — experienced attorneys are described but no countable roster is exposed.
- O’Connor MacLeod Hanna LLP — a Lawyers tab exists, but the rendered roster was unavailable.
- Elliott & Hills — search-visible first-party copy says all lawyers practise family law, but direct roster retrieval returned an anti-bot interstitial.
- Hassaan & Associates PC — growth by adding associates is described, but no current countable roster is exposed.
- KMB Law — the team page was discovered, but direct roster retrieval timed out; no count promoted.
- Gelman & Associates — 21 active lawyer profiles are supported after excluding one explicitly “not practising” profile, which exceeds the 3–20 lane ceiling.

The JSON contains no phone numbers, email addresses, form payloads, contact identifiers, or outreach state.
