<!-- DOC-META v1
type: reconciliation-report
status: active
generated: 2026-07-18
scope: publication-operator-dry-run-pilot
-->

# Publication Operator dry-run pilot: Founder Vesting period (DRG Law)

**This is a DRY-RUN EVIDENCE ASSESSMENT, not a publication record.** It reports exactly what the Publication Operator engine (Workstreams 1-4 of this release) computes against real, live production data as of 2026-07-18. Nothing in this report was published, claimed, or registered as a receipt. No content was generated, rewritten, or translated. No production row was inserted, updated, or deleted to produce this report — every fact below was pulled with read-only `SELECT` queries or the engine's own read-only functions.

```json
{
  "schema_version": "publication-operator-dry-run-pilot-1.0",
  "dry_run": true,
  "generated_by": { "role": "operator-directed-agent", "note": "Claude Code, Publication Operator build session" },
  "policy": {
    "generation_policy": "existing_assets_only",
    "may_generate_missing_assets": false,
    "may_modify_copy": false,
    "may_translate": false,
    "may_publish_ready_items": false,
    "requires_explicit_publication_authorization": true
  }
}
```

## Read this first

- **Firm:** DRG Law Professional Corporation (`eec1d25e-a047-4827-8e4a-6eb96becca2b`)
- **Period:** "Founder vesting" (`187a18a7-aca5-4d7e-962e-07789b7c7923`), 2026-07-13 to 2026-07-17
- **The headline finding is a real gap, not an engine defect:** the newer, multi-destination `content_placements` table — the table the Publication Operator's manifest/preflight/adapter pipeline is built to operate on — has **zero rows in production, for every firm, not just DRG** (verified `SELECT count(*) FROM content_placements` → `0`). This is confirmed as of 2026-07-18, independent of this build; nothing in this session created or removed a placement row.
- Because of that gap, **this period's dry-run correctly finds zero active placements to evaluate.** This is the fail-closed behavior the engine is designed to produce when nothing is configured — it is the strongest possible proof that the engine never infers, invents, or defaults a placement into existence. See "Why no placements exist yet" below for what this implies about scope, and "Engine correctness evidence" for how the pipeline's actual logic was proven instead.
- **This session did not create any placement rows.** Doing so would be a production write, prohibited by this release's hard safety boundaries regardless of how incomplete it leaves the pilot. That decision is stated explicitly, not silently worked around.

## Real, current state of the 13-piece period (read-only, 2026-07-18)

| # | Deliverable | Locale | Role | Legacy destination | Status | Approved version |
|---|---|---|---|---|---|---|
| 1 | Founder vesting in Ontario corporations… (Counsel Note) | en-CA | article | firm_website | `in_review` | none |
| 2 | Vesting de fundadores em empresas ontarianas… | pt-BR | article | firm_website | `in_review` | none |
| 3 | What the forfeiture clause… (Clause in the Margin) | en-CA | article | firm_website | `in_review` | none |
| 4 | O que a cláusula de perda faz… | pt-BR | article | firm_website | `in_review` | none |
| 5 | Founder vesting - Article update (GBP) | en-CA | gbp_post | google_business_profile | `in_review` | none |
| 6 | Clause in the margin - Article update (GBP) | en-CA | gbp_post | google_business_profile | `in_review` | none |
| 7 | Founder vesting - Checklist offer (GBP) | en-CA | gbp_post | google_business_profile | `in_review` | none |
| 8 | Founder vesting checklist (PDF) | en-CA | lead_magnet_pdf | firm_website | `in_review` | none |
| 9 | Checklist de vesting de fundadores (PDF) | pt-BR | lead_magnet_pdf | firm_website | `in_review` | none |
| 10 | Founder vesting checklist (Landing page) | en-CA | landing_page | firm_website | `in_review` | none |
| 11 | Checklist de vesting de fundadores (Landing page) | pt-BR | landing_page | firm_website | `in_review` | none |
| 12 | Founder vesting LinkedIn post | en-CA | social_post | linkedin (legacy, no granular type recorded) | `in_review` | none |
| 13 | Clause in the margin LinkedIn post | en-CA | social_post | linkedin (legacy, no granular type recorded) | `in_review` | none |

Excluded correctly (not counted above, matching `evaluateDeliverableReadiness`'s own archived-exclusion rule): 1 archived sibling, `[GBP POST] Founder vesting GBP cards` (`d6858ffb-…`).

**Every one of the 13 is currently `in_review` with `approved_version_id = null`.** This is a real, live snapshot — not the same moment the `PUBLICATION_READINESS_OPERATING_MODEL.md` doctrine doc's evidence table was written (2026-07-14); the content has evidently moved back into review since then (a new version posted, or a change-request cycle) which is ordinary, expected editorial activity, not a defect either in this build or in the underlying review system.

4 of the 13 deliverables (#1, #3, #8, #10) carry `publication_artifacts` rows registered on 2026-07-14 (hero images, a webpage record, a PDF with a verified SHA-256, a form record) — real evidence from that earlier state. Because their current version is no longer the approved one, the readiness evaluator (`publication-readiness.ts`, untouched by this build, reused as-is) would correctly flag those artifacts as **stale** — bound to a non-current version — the exact behavior the doctrine doc documents as intentional, not a bug to route around.

## Why no placements exist yet

`content_placements` is additive to, not a replacement for, the legacy `deliverable_role`/`publication_destination`/`publication_path` columns already on `content_deliverables` (confirmed via the migration's own header comment). The legacy columns are fully populated for all 13 deliverables (table above). The newer placement table has never been written to in production for any firm — there is no UI or API flow anywhere in this codebase that creates a `content_placements` row today (`POST /api/portal/[firmId]/deliverables/[deliverableId]/placements` exists and works — proven by this build's own manifest/adapter pipeline consuming its output correctly — but nothing has ever called it against real data).

This means the "one deliverable, several destination placements" model this Publication Operator release is built around is real, tested, and ready, but has not yet been populated for any real firm's content. Two honest paths forward, neither taken in this session:

1. **An operator manually creates the 13 real placements** through the existing `POST .../placements` route, one call per deliverable, using the legacy columns above as the source of truth for `destination`/`locale`/`intended_path` — a deliberate, reviewed, human action, not something this pilot does automatically.
2. **A future, explicitly-scoped backfill** (its own reviewed change, not folded into this release) that mechanically derives placements from the legacy columns for deliverables that already carry complete metadata — deferred because it is a production write and a real design decision (e.g., what granular LinkedIn destination type `social_post` + `linkedin` should map to: `linkedin_post`, `linkedin_article`, or `linkedin_company_page` are three genuinely different destinations the legacy single `"linkedin"` value cannot disambiguate; inventing an answer would violate the No Invention doctrine).

## Engine correctness evidence (since production has no real placement to run the pipeline against end-to-end)

The manifest/preflight/adapter pipeline itself is proven correct through:

- **117 targeted unit and route tests** (`publication-execution-manifest.test.ts`, `publication-preflight-status.test.ts`, `publication-destination-validators.test.ts`, `publication-adapter.test.ts`, the manifest route's own `route.test.ts`), all passing, covering exactly the shape of a real DRG placement (article deliverable, `firm_website` destination, hero image asset, tracked URL) plus every blocking condition: unapproved content, version drift, missing locale/role, an unconfigured destination, a version flagged `requires_individual_review`, an already-active competing claim, LinkedIn/GBP character-limit and image/CTA violations.
- **The full existing suite, 5652/5652 tests passing** after this build's changes, zero regressions.
- **Live UI verification against real production data** (not fixtures): the operator Publication Queue (`/admin/content-studio/publication-queue`) was loaded against DRG's real firm id and this real period, correctly showing the true `setup_required` lifecycle, the true 13-deliverables-with-no-placement gap, and a correct zero-row placements table — no fabricated row was ever rendered. A placement-detail 404 was also verified against a placement id that does not exist.
- **If a placement existed today for, say, deliverable #1** (the Counsel Note article), the manifest/preflight pipeline would report `blocked_content` with the reason `deliverable status is "in_review", not approved` — provably correct against this real deliverable's real current status, computed by hand-tracing the same logic the passing unit tests already exercise against equivalent fixture data.

## Period-level summary

| Metric | Value |
|---|---|
| Active deliverables in period | 13 |
| Excluded (archived) | 1 |
| Period readiness lifecycle | `setup_required` (not yet activated for enforcement) |
| Real `content_placements` rows for this period | 0 |
| Real `content_placements` rows firm-wide (DRG) | 0 |
| Real `content_placements` rows database-wide | 0 |
| Deliverables currently approved (`status='approved'`, no version drift) | 0 of 13 |
| Deliverables with prior (now stale) registered artifacts | 4 of 13 |
| Destination coverage implied by legacy metadata | firm_website (8), google_business_profile (3), linkedin — generic, granular type not yet chosen (2) |
| Missing credentials/configuration for live execution | LinkedIn API integration: none exists. Google Business Profile API integration: none exists. Website deploy integration: none exists (manual `vercel --prod` from a separate repository). Confirmed unchanged from Workstream 0 discovery. |
| Manifest hashes generated | 0 (no real placement existed to generate one from; the hashing logic itself is unit-tested against realistic fixture content in `publication-execution-manifest.test.ts`) |
| External writes performed by this pilot | 0 |
| Publication receipts created by this pilot | 0 |
| Placement claims created by this pilot | 0 |
| Items marked published by this pilot | 0 |

## Confirmations

- **Zero external writes.** No HTTP request was made to LinkedIn, Google Business Profile, or any website deploy target, by this pilot or by any code this release ships (`execute()` is structurally disabled and network-call-free, proven by a `fetch` spy in `publication-adapter.test.ts` across every destination, including with a forged live-execution flag).
- **Zero fabricated receipts.** `createReceipt`/`claim_placement_for_publish` were never called by this pilot or by any code path exercised.
- **No content was regenerated, rewritten, or translated.** This pilot performed read-only `SELECT` queries and ran the engine's own pure functions against real rows; nothing was written to `content_deliverables`, `deliverable_versions`, `content_placements`, `publication_artifacts`, `publication_placement_claims`, or `publication_receipts`.
- **No item was marked published.** No `content_placements.state` or `content_deliverables.status` was changed by this pilot.
