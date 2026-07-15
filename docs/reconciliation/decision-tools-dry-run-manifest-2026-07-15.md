# Dry-run evidence assessment: Decision tools

**This is a dry-run evidence assessment, not a reconciliation record.** No publication receipt or artifact was invented anywhere in this file.

## Read this first

- This is a DRY-RUN EVIDENCE ASSESSMENT, not a reconciliation record. It classifies what evidence exists or is missing per deliverable; it does not register, bind, or authorize anything.
- Metadata backfill (`deliverable_role`/`locale`/`publication_destination`/`publication_path`, applied to production 2026-07-15 via `20260715193219_20260715121500_decision_tools_publication_metadata.sql`) is NOT artifact binding. Zero `publication_artifacts` rows exist for any of this period's 3 deliverables, confirmed live against production 2026-07-15 (direct query, `artifact_count: 0` for every row).
- No evidence is fabricated anywhere in this file. Every `verified_and_bindable` classification below traces to a live HTTP GET check the applying migration's own header records against `drglaw.ca` on 2026-07-15.
- The period (`5a755803-499c-4405-8bd7-9366de6050ed`) is `readiness_lifecycle = 'legacy_unreconciled'` in production. It has not been activated (`enforced`) and this document does not activate it.
- This document does NOT claim historical evidence reconciliation is complete. Reconciliation (registering real, personally-verified `publication_artifacts` evidence) has not started for this period. See "Remaining work" at the end.

- Firm: DRG Law Professional Corporation (`eec1d25e-a047-4827-8e4a-6eb96becca2b`)
- Period: `5a755803-499c-4405-8bd7-9366de6050ed`, "Decision tools"
- Live production lifecycle: `legacy_unreconciled` (confirmed 2026-07-15)
- `publication_artifacts` rows registered for this period: **0**

## Why this period is structurally different

Per the period's own `details` field, this covers standing review of the three interactive decision tools on `drglaw.ca/tools`, not a publish-week content cluster. Exactly 3 deliverables, all `content_kind='text'`, all already `status='approved'`. No GBP post, no LinkedIn post, no lead-magnet PDF, no separate PT-locale deliverable row exists in this period.

Role: the five-value `deliverable_role` check (`article`/`social_post`/`gbp_post`/`lead_magnet_pdf`/`landing_page`) has no dedicated "interactive tool" value. `landing_page` is the closest correct fit (a standalone page at its own publish path, not a journal article, not a PDF, not a social/GBP post) and is what the applying migration used.

## A real content-plan gap, noted but not fixed here

`drg-law-website` carries live PT routes for all three tools (`/pt/tools/closing-clarity-map`, `/pt/tools/estate-structure-check`, `/pt/tools/business-readiness-score`, all confirmed HTTP 200 on 2026-07-15), but this content period never created a PT-locale deliverable row to attach that path to. This is a real gap in the content plan, not something this reconciliation pass invents a row to paper over.

## Evidence classification, per active deliverable

Classification vocabulary: `verified_and_bindable` (confirmed real, an operator can register it as evidence in a separate reviewed step), `missing`, `not_applicable`.

| Deliverable | Path | Live check (2026-07-15) | Classification | Requirements not yet met |
|---|---|---|---|---|
| Closing Clarity Map | `/tools/closing-clarity-map` | HTTP 200 | verified_and_bindable | webpage_artifact, webpage_validated |
| Estate Structure Check | `/tools/estate-structure-check` | HTTP 200 | verified_and_bindable | webpage_artifact, webpage_validated |
| Small Business Legal Readiness Score | `/tools/business-readiness-score` | HTTP 200 | verified_and_bindable | webpage_artifact, webpage_validated |

All three: role `landing_page`, locale `en-CA`, destination `firm_website`, current version matches approved version, zero `publication_artifacts` rows registered.

## Remaining work for real historical evidence/placement reconciliation

1. Register a `publication_artifacts` row (type `webpage`) for each of the 3 deliverables above. An operator must personally load each URL and record it via the manual insert path in `docs/PUBLICATION_READINESS_OPERATING_MODEL.md`.
2. Operator decision: author a PT-locale deliverable row for each of the 3 tools to match the already-live PT routes, or explicitly decide this period stays English-only in Content Studio even though the live site is bilingual for these pages.
3. Only after item 1: consider whether to activate (enforce) this period via `POST /api/portal/[firmId]/periods/[periodId]/activate-readiness`. Activation is a separate, later, operator-only decision this document does not make and does not recommend a timeline for.

No LinkedIn, no GBP, no lead magnet, no legal-approval gate, and no deploy gap exists in this period. The only remaining work is artifact registration (operator action) and the PT-locale content-plan decision noted above.
