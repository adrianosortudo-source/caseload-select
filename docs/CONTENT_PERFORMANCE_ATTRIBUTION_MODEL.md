# Content Performance / Content-to-Matter Attribution -- Operating Model

Status: active. Owner surface: Content Studio (`/admin/content-studio/attribution`,
`/portal/[firmId]/content-performance`). This is the initial, evidence-first
home for content-to-matter attribution inside CaseLoad Select. It is not a
general marketing-attribution platform and is not paid-media attribution.

## What this is

Content Studio already owns the evidence chain from an approved deliverable
version through to a verified placement and publication receipt (see
`PUBLICATION_READINESS_OPERATING_MODEL.md`). This module extends that chain
one hop further: from a verified placement/receipt to a lead-source signal,
and from a lead-source signal to the existing qualified-matter/outcome
state, without inventing a second CRM or duplicating any canonical record.

```
approved version
  -> verified placement / receipt      (content_placements, publication_receipts)
  -> lead-source evidence              (content_attribution_evidence, THIS module)
  -> qualified-matter or outcome       (client_matters, existing, reused)
  -> client-safe performance insight   (content_attribution_current view + reporting)
```

## Core principle: evidence, not guessing

Every attribution fact carries two things, always: an **attribution
state** and a **provenance/evidence method**. Never one without the
other, and never inferred from topic similarity, timing proximity, or
"this looks like it's about the same thing."

### Attribution states

| State | Meaning |
|---|---|
| `known_first_touch` | Verified evidence the lead's first touch came through a specific tracked channel (UTM, referrer, landing path). Deliverable/placement link only when a deterministic identifier match exists. |
| `known_assisted` | Verified evidence of a touch that was not the first, but is corroborated (reserved for future multi-touch capture; not currently written by any code path). |
| `self_reported` | The prospect said so, in their own words, captured verbatim or paraphrased with a structured category. Not verified. Never overwrites observed evidence; both are preserved as distinct rows. |
| `offline_referral` | An operator recorded what they observed or were told (e.g. an existing client mentioned referring someone). Not verified. |
| `unknown` | No trustworthy connection exists. This is a legitimate, expected, common state -- it is never hidden or padded away. |

### Evidence/provenance methods

`verified_utm`, `observed_referrer`, `verified_landing_path`, `self_report`,
`operator_offline_referral`, `imported_crm_outcome`, `insufficient_evidence`.
`attribution_state='unknown'` and `evidence_method='insufficient_evidence'`
are paired 1:1 by a database CHECK constraint -- one never appears without
the other.

### What the system can know automatically

Only what `screened_leads` already captures: `utm_source`, `utm_medium`,
`utm_campaign`, `utm_term`, `utm_content`, `referrer`. A deliverable/placement
link is attached only when `utm_content` or `utm_term` exactly equals a real
`content_placements.id` for that firm -- no fuzzy matching, no topic
inference. When no such tag exists (true for essentially all traffic today,
since no publishing workflow yet embeds a placement id in outbound links),
the evidence still upgrades to `known_first_touch` (we know the channel) but
carries no deliverable/placement link (we do not know which piece). This is
intentional, not a bug: "correlated" is not "attributed," and a piece of
evidence that only proves a channel is still real evidence, just narrower
than a piece that proves a specific placement.

### What requires self-report or operator entry

Which specific deliverable drove an enquiry, absent a placement-tagged
link, and any offline/word-of-mouth referral. These are always optional,
always attributed to a human decision (a prospect's own words, or an
operator's observation), and never auto-generated.

### What remains unknown by design

Any enquiry with no UTM/referrer signal and no self-report/operator entry.
The reporting layer shows this volume explicitly (`unknown_volume` /
"Unknown / unattributed" tile) rather than omitting it.

## Data model

Append-only evidence ledger (`content_attribution_evidence`) plus a
derived, read-only view (`content_attribution_current`) -- no mutable
"current attribution" field anywhere. See
`supabase/migrations/20260717030000_content_attribution_evidence.sql` for
the full schema, and `src/lib/content-attribution-pure.ts` /
`src/lib/content-attribution.ts` for the pure logic and I/O layer.

- Every row is firm-scoped (`firm_id`), and a database trigger
  (`validate_content_attribution_evidence_scope`) cross-checks every
  optional reference (deliverable, version, placement, receipt) belongs
  to the same firm and the same deliverable chain -- the same
  defense-in-depth pattern `content_placements` and `publication_receipts`
  already use.
- Rows are never updated or deleted (`block_append_only_mutation`, the
  same trigger function `approval_records` and `publication_receipts`
  already share). A correction is a new row with `supersedes_evidence_id`
  pointing at the row it replaces -- the original is retained, never
  erased.
- `content_attribution_current` is a plain SQL view, not a materialized
  table: it always recomputes the best evidence per lead (priority
  `known_first_touch` > `known_assisted` > `self_reported` >
  `offline_referral` > `unknown`, most recent within a tier, excluding
  superseded rows) and left-joins the existing `client_matters` outcome
  via `source_screened_lead_id`. There is no separate "current
  attribution" state to drift out of sync with the ledger.
- Reused, not duplicated: `screened_leads` is the lead subject,
  `content_deliverables` / `deliverable_versions` / `content_placements`
  / `publication_receipts` are the existing publishing-evidence chain,
  `client_matters` is the existing qualified-matter/outcome source of
  truth. No new lead table, no new outcome/revenue field.

## Consent / privacy boundary

Recording attribution evidence never creates, implies, or requires
marketing consent. The self-report/offline-referral capture form
(`ContentAttributionEvidenceForm`) is entirely optional, lives in the
operator console (not the public intake path), and does not touch
`consent_log` or any consent column on `screened_leads` in any way.
Capturing a source is orthogonal to consenting to future marketing
contact; conflating the two was an explicit design decision to avoid.

Client-facing UI (`/portal/[firmId]/content-performance`) never exposes
raw `screened_leads` rows, contact fields, operator evidence notes, or
`recorded_by_*` fields -- only aggregate counts and pre-built
evidence-graded sentences (see `buildClientSafeAttributionSentences`).

## Client-facing language guidelines

- Say "N enquiries have an observed / self-reported / offline-referral
  connection to this content." Never "this content generated N clients"
  or "this content produced N matters."
- Never state or imply an AI engine "definitely generated" a lead unless
  a verified evidence source genuinely supports it. A visitor saying "I
  found you through ChatGPT" is `self_reported`, not verified AI
  attribution.
- Always separate observation from recommendation. The reporting layer's
  "what we learned" section is generated only from evidence actually
  observed in a date range, never padded with speculation.
- Always show data sufficiency. Counts below `MIN_SAMPLE_FOR_OBSERVATION`
  (5) are flagged as insufficient rather than narrated as a pattern.
- No outcome promises, no unverifiable superlatives, no guaranteed
  rankings/citations/enquiries/matters/revenue -- the same LSO Rule
  4.2-1 posture as every other client-facing surface in this app.

## Explicitly out of scope (this build)

- The Supabase fresh-schema baseline corrective branch and any
  migration-ledger repair.
- Publication Operator / automated external publishing, and any
  LinkedIn/GBP/website publishing action. This module never publishes
  anything; it only records evidence about enquiries that already
  arrived.
- Historical attribution backfill based on assumptions. The observed-
  evidence normalizer (`syncObservedEvidenceForLead`) is deterministic
  and evidence-preserving (it translates already-recorded UTM/referrer
  data into the new schema, never guesses), but it is operator-triggered
  per lead, never an automated bulk sweep across all history.
- Paid-media attribution, fingerprinting, cross-device tracking, or
  scraping.
- Content rewriting.
- Prospect-facing intake changes. The self-report/offline capture form
  lives in the operator console, not the live customer-facing intake
  widget -- adding a marketing-adjacent question to the primary legal-
  intake funnel is a distinct, higher-risk product/legal decision
  (conversion impact, exact prospect-facing copy) that needs explicit
  product sign-off, not something to guess at inside an autonomous build.

## Future boundary

A broader, cross-channel attribution product (paid media, multi-touch
modeling, external ad-platform conversion upload) may exist later, but
is not being built now. Any future work in that direction is a distinct
initiative with its own consent/privacy review, not an incremental
extension of this module.

## Reference

- Migration: `supabase/migrations/20260717030000_content_attribution_evidence.sql`
- Pure logic: `src/lib/content-attribution-pure.ts`
- I/O layer: `src/lib/content-attribution.ts`
- Operator surfaces: `src/app/admin/content-studio/attribution/**`
- Client-safe surface: `src/app/portal/[firmId]/content-performance/**`
- Operator runbook: `docs/runbooks/content-performance-attribution-runbook.md`
- Sibling doctrine: `docs/PUBLICATION_READINESS_OPERATING_MODEL.md` (the
  evidence-provenance principle this module inherits verbatim), P12
  tracking-attribution build plan (the UTM/referrer capture this module
  reuses, not duplicates).
