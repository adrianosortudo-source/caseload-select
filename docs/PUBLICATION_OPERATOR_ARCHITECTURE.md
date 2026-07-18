<!-- DOC-META v1
doc-type: architecture
status: active
version: v1
last-edited: 2026-07-18
-->

# Publication Operator: architecture, manifest schema, adapter contract, release ladder

## What this is

The Publication Operator is a constrained, deterministic, **dry-run-only** release executor for Content Studio. It turns an approved deliverable version bound to one explicit destination placement into an immutable, server-derived `PublicationExecutionManifest`, runs a fail-closed preflight against it, and renders exactly what a live publish action would look like — without ever performing one. This release ships **zero live-execution capability** for any destination.

It is deliberately not a general-purpose agent: it never generates, rewrites, translates, or summarizes content; it never invents a destination, account, or credential; and every field on the manifest is either the exact stored value or an explicit `null` with a stated reason.

### Where it sits relative to prior work

This release builds on an already-substantial backend (a prior build session, self-labeled "Workstream 1-8" in code comments — a different numbering than this doc's Workstream 1-9, no relation):

| Layer | Owner module | Reused as-is |
|---|---|---|
| Deliverables, versions, approvals | `content-studio.ts`, `deliverables.ts`, `approval_records` | Yes |
| Standing publishing authorization (DR-104) | `standing-publishing-authorization.ts` | Yes |
| Multi-destination placements | `content-placements.ts` | Yes |
| Atomic claim-before-publish | `publication-placement-claims.ts`, `claim_placement_for_publish()` RPC | Yes, read-only this release |
| Publication receipts (evidence) | `publication-receipts.ts` | Yes, read-only this release |
| Post-publish evidence checks | `channel-validation.ts` (SSRF-safe fetch) | Yes, wrapped by adapters |
| Placement-scoped release gate | `publication-preflight.ts` / `-loader.ts` | Yes, feeds the queue list view |

**New in this release:**

| Module | Purpose |
|---|---|
| `src/lib/publication-execution-manifest.ts` + `-loader.ts` | The manifest contract (Workstream 1) |
| `src/lib/publication-preflight-status.ts` | 7-way preflight status taxonomy (Workstream 2) |
| `src/lib/publication-destination-validators.ts` | Pre-publish destination format/config checks (Workstream 2) |
| `src/lib/publication-adapter.ts` | Adapter contract, dry-run-only (Workstream 3) |
| `src/lib/publication-queue-pure.ts` | Queue list classification helper (Workstream 5) |
| `GET .../placements/[placementId]/publication-execution-manifest` | Read-only dry-run route (Workstream 4) |
| `/admin/content-studio/publication-queue[/[placementId]]` | Operator queue UI (Workstream 5) |

## The PublicationExecutionManifest

One manifest binds ONE approved deliverable version to ONE explicit placement. A deliverable with several placements (a website article plus a companion LinkedIn post) gets several manifests, never one manifest spanning more than one destination.

**Derivation is server-side only.** `loadPublicationExecutionManifest(firmId, placementId, generatedBy)` accepts only identifiers and the caller's own resolved identity; every other field is pulled from stored, immutable records. There is no code path where a request body can set `title`, `body`, `canonicalUrl`, or any other trusted field.

### Field reference

| Field | Source | Notes |
|---|---|---|
| `firmId`, `deliverableId`, `placementId` | URL params, firm-scoped queries | Cross-firm access returns 404, never leaks another firm's row |
| `contentPeriodId`, `periodLifecycle` | `content_periods` | |
| `approvedVersionId` | `content_deliverables.approved_version_id` | Must equal `current_version_id` or the manifest blocks (version drift) |
| `versionBodyHash` | SHA-256 of `body_html` (text) or the version's own `asset_sha256` (file) | Computed at manifest-build time, deterministic |
| `releaseAuthorizationPath` | Prospective, read-only re-derivation of `claim_placement_for_publish()`'s path-A/path-B gate | **Never authoritative** — see caveat below |
| `destination`, `destinationAccount`, `locale` | `content_placements` + resolved evidence | `destinationAccount.configured` is only `true` when a REAL prior verified artifact/receipt resolves a base URL; never guessed |
| `title`, `body`, `excerpt`, `ctaTargetPath` | `content_deliverables` / `deliverable_versions`, verbatim | Never transformed |
| `canonicalUrl`, `trackedUrl` | Resolved destination base URL + `intended_path`; `utm_content=<placementId>` | `null` when unresolvable, never fabricated |
| `assets` | `publication_artifacts` bound to the approved version, ordered by type then id | Storage path, MIME, size, SHA-256 — exact stored values |
| `scheduledPublishDate`, `scheduledTimezone` | `content_placements.scheduled_publish_date`, firm location → IANA timezone | |
| `destinationMetadata` | Raw facts (body length, required artifact type, asset count, prior receipt/claim state) | Facts only, never a verdict |
| `idempotencyKey` | `sha256(firmId:deliverableId:placementId:approvedVersionId)` | Deterministic — regenerating the manifest for the same intent always yields the same key |
| `generatedAt`, `generatedBy` | Caller-supplied timestamp + resolved operator identity | Never a hardcoded literal — the real resolved operator's id/name |
| `blocked`, `blockReasons` | Computed | A missing required field always adds a reason here; it is never silently defaulted |

**`releaseAuthorizationPath` caveat, stated explicitly in the module's own docstring:** this is a read-only, prospective re-derivation of the real claim RPC's authorization gate, for display and dry-run purposes only. It is never a substitute for actually calling `claim_placement_for_publish()`. Two concurrent manifest generations can both compute a non-null path for the same placement; only one real claim can ever succeed, because the RPC re-runs the same checks under a row lock.

### The 7-way preflight status

`evaluatePublicationPreflightStatus(manifest)` classifies into exactly one of:

1. **`already_published`** — a verified receipt exists for this exact placement + approved version. Highest precedence, checked before anything else.
2. **`ambiguous_external_state`** — a receipt exists but is unverified/failed/reconciling, OR an active competing claim already exists on this placement (idempotency awareness — see Workstream 4 below).
3. **`blocked_content`** — approval, version drift, missing metadata, missing required asset.
4. **`blocked_authorization`** — no release authorization path available (not individually approved, no active standing authorization, or the version is flagged `requires_individual_review`).
5. **`blocked_missing_configuration`** — content and authorization both pass, but the destination account/canonical URL is not configured.
6. **`blocked_destination_validation`** — everything above passes, but a destination format check fails (LinkedIn 3,000-char feed-post limit, LinkedIn article 220-char headline / ~110,000-char body limit, GBP 1,500-char body limit + required image, website slug shape). Limits sourced from current public platform documentation as of 2026-07; re-verify before any release-ladder step that adds live API calls.
7. **`ready`** — every gate passed.

Precedence is fixed and fails closed: any unrecognized block reason falls into `blocked_content` rather than defaulting to `ready`.

## Adapter contract

```ts
interface PublicationAdapter {
  destinations: readonly PlacementDestination[];
  validateConfiguration(manifest): AdapterConfigurationResult;
  preflight(manifest): PublicationPreflightStatus;
  renderDryRun(manifest): DryRunAction;
  execute(manifest): Promise<ExecuteResult>;      // structurally disabled, see below
  reconcile(receipt, opts?): Promise<ChannelValidationResult>;  // wraps channel-validation.ts
  normalizeReceipt(evidence, manifest): NormalizedReceiptInput;
}
```

Four adapters ship: Website (`firm_website`), LinkedIn (`linkedin_article` / `linkedin_post` / `linkedin_company_page`), Google Business Profile (`google_business_profile`), Email (`email_delivery`).

- **`validateConfiguration`** reports whether a real account/location/site is on record. For LinkedIn and GBP this is always `false` — no integration exists anywhere in this codebase (confirmed at Workstream 0 discovery: no OAuth client, no API credentials, no `.env` variable). For Website it mirrors the manifest's own `destinationAccount.configured`.
- **`renderDryRun`** returns the exact, redacted action shape: an illustrative endpoint (explicitly labeled "no live client exists" for LinkedIn/GBP), a summary sentence referencing the manifest's own resolved canonical URL, and a payload preview containing only non-secret facts (title length, body length, locale, tracked URL, idempotency key) — proven secret-free by a regex scan in the adapter's own test suite.
- **`execute`** always returns `{ok: false, error: "..."}`. No adapter, in any code path, ever calls `fetch` — proven by a `fetch` spy across every destination in `publication-adapter.test.ts`, including with a forged `PUBLICATION_OPERATOR_ENABLE_LIVE_EXECUTE=true` environment flag. There is no live-call implementation to gate; the flag/credential check exists only to name the future gate shape (release ladder step 3+).
- **`reconcile`** delegates directly to the existing, tested `channel-validation.ts` (`validateReceiptForDestination`), which itself uses the existing SSRF-safe fetch wrapper (`ssrf-fetch.ts`). Never duplicated, never bypassed.
- **`normalizeReceipt`** passes through only what the caller actually supplied (a `publicUrl`/`externalPostId` an operator has personally confirmed) — never invents evidence.

## Orchestration and idempotency (Workstream 4)

The read-only route (`GET .../placements/[placementId]/publication-execution-manifest`) assembles manifest → preflight status → configuration check → dry-run render, in that order, and returns all four. It never calls `claim_placement_for_publish`, never writes a `publication_receipts` row, and never calls an adapter's `execute`.

**Idempotency-awareness without claiming:** the manifest loader reads the placement's most recent claim (`getLatestClaimForPlacement`, a display-only query, never the write RPC) and, if it is `active` for the same approved version, adds a blocking reason surfaced as `ambiguous_external_state` — "an active publication claim already exists... publishing now would race a concurrent or in-progress attempt." This is how the dry-run engine avoids ever implying a duplicate-publish action is safe, without acquiring a claim itself.

**Design for a future execute mode** (not built, not enabled, this release):

1. Load the manifest (as today).
2. Confirm `preflightStatus.category === "ready"`.
3. Call `claimPlacementForPublish()` with the manifest's own `idempotencyKey` — the existing RPC's `(placement_id, idempotency_key)` uniqueness already makes a retry with the same key return the same claim (`idempotentReplay: true`), never a duplicate.
4. Call the adapter's `execute` (once a real implementation exists) inside the claim's lifetime.
5. On success, call `adapter.normalizeReceipt` then the existing `createReceipt()`, threading the claim id through (the existing DB trigger already refuses a receipt whose claim doesn't match).
6. Call `adapter.reconcile` to verify; for LinkedIn/GBP this will always report `unverifiable`, requiring an operator's own `manualOutcome` attestation, exactly as the existing `channel-validation.ts` already enforces.
7. A timeout after step 4 (platform may have accepted the request) is handled by re-running preflight before any retry: `already_published` or `ambiguous_external_state` will correctly stop a blind retry from double-posting.

None of steps 3-6 are implemented in this release. This section exists so the eventual implementation reuses the exact primitives already proven here, rather than inventing a second reservation mechanism.

## Release ladder

1. **Local/unit dry-run.** This release. `execute` structurally disabled, no credentials anywhere, 117 targeted tests + full 5652-test suite passing.
2. **Authenticated preview dry-run.** Operator Publication Queue deployed to a preview environment, exercised against real (non-production-mutating) reads by a real operator session.
3. **Production internal dry-run with external writes disabled.** The manifest/preflight/queue routes live in production; `execute` remains structurally disabled (the flag described above stays unset in every environment).
4. **One explicitly approved DRG placement on one channel.** A named, human-reviewed change adds a real adapter `execute` implementation for exactly one destination (website is the least-risky starting point — no third-party API, just a recorded receipt after a human-performed deploy), gated behind the enable flag, exercised once, by hand, with an operator watching.
5. **Reconciliation and receipt verification.** Prove the claim → execute → receipt → reconcile loop end-to-end on that one placement before trusting it unattended.
6. **Controlled expansion by channel.** LinkedIn and GBP each require their own OAuth/API integration work (none exists today) before step 4 can repeat for them — this is new integration work, not a flag flip.
7. **No broad autonomous scheduling** until operational evidence from steps 4-6 supports it.

## Known real gap surfaced by this release (not fixed by it)

`content_placements` has zero rows in production, for every firm — confirmed by read-only query. The Publication Operator's manifest/preflight/adapter pipeline is fully built and tested against realistic fixture data, but has no real production placement to run against end-to-end yet. See `docs/reconciliation/publication-operator-dry-run-founder-vesting-2026-07-18.md` for the full pilot report and the two honest paths forward (an operator manually creating real placements through the existing route, or a separate, explicitly-scoped backfill) — neither of which this release performs, since both are production writes requiring their own review.
