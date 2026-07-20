<!-- DOC-META v1
doc-type: architecture
status: draft
version: v1
last-edited: 2026-07-19
supersedes: none (additive to docs/PUBLICATION_OPERATOR_ARCHITECTURE.md, docs/PUBLICATION_READINESS_OPERATING_MODEL.md, and DR-105)
note: §4.1a and the two new §5 states (surface_adaptation_rule_missing, substantive_adaptation_requires_approval) were added same-day, after DR-105 was locked; §11's verification trail describes only this document's original authoring pass and was not rewritten.
-->

# Publication Resolution preflight: design and gap-closure plan

## 0. What this document is, and what it is not

This is a **documentation-only design revision**. Nothing in this pass created, applied, or modified a migration; wrote, updated, or deleted a production row; touched application code; ran a build or test suite; or published, scheduled, or sent anything. Every fact below that concerns live data was pulled with **read-only** queries (`list_tables`, single `SELECT` statements) via the Supabase MCP against project `ssxryjxifwiivghglqer`, or with read-only `git` commands (`ls-tree`, `cat-file`, `diff --stat`, `log`) against `origin/main` and local worktrees. Section 8 lists the exact commands and files.

This document does two things the prior architecture doc does not:

1. It gives an accurate, source-verified inventory of what already exists for publication — and, critically, **which of it is actually merged to `origin/main` (deployed) versus sitting in an unmerged branch**. The distinction matters: a large amount of relevant engineering already exists, tested, but has never shipped.
2. It specifies a new mandatory **Publication Resolution** preflight stage — the six-fact resolution gate this task was scoped around — as a formalization and gap-closure on top of that inventory, not a parallel system.

**Guiding constraint honored throughout:** where existing, tested code already computes something this design needs, this document says so and points at it, rather than proposing new code that would duplicate it. Where nothing exists, that is stated as plainly as where something does.

## 1. System inventory (verified, tiered by actual deployment state)

The repository has **far more publication-evidence infrastructure already built than is visible from `origin/main`'s app-facing surface alone**, because a substantial build (self-labeled "Ses.21 Publication Operator" in `CLAUDE.md`, branch `feat/publication-operator`) has never been merged. The working tree checked out at the repository root (`fix/restore-marketing-homepage`) is itself 93 commits behind `origin/main` and was not used as the source of truth for this inventory — `origin/main` was, via direct `git ls-tree`/`cat-file` checks, independent of any local checkout's staleness.

### Tier 1 — Live in production today (schema AND app code on `origin/main`)

| Table (confirmed via `list_tables`, rows as of 2026-07-19/20) | Purpose |
|---|---|
| `content_deliverables` (104 rows), `deliverable_versions` (335), `deliverable_comments` (23), `approval_records` (26) | The lawyer approval/sign-off system (2026-06-23 build). `approval_records` is append-only. |
| `publication_artifacts` (8 rows), `publication_artifact_validations` (12 rows) | Version-bound evidence ledger (hero images, PDFs, deployed webpages) + its append-only reconciliation history. Doctrine: `docs/PUBLICATION_READINESS_OPERATING_MODEL.md`. |
| `publication_releases` (0), `publication_release_items` (0) | Data foundation for a future named release step. No UI writes to these yet. |
| `content_placements` (**1 row**, see §3) | Version-bound, multi-destination placement record. `destination` is a hard CHECK enum: `firm_website`, `linkedin_article`, `linkedin_post`, `linkedin_company_page`, `google_business_profile`, `email_delivery`. Mutable lifecycle (`planned → ready → published → retired`) but identity fields (`firm_id`, `deliverable_id`, `destination`, `locale`) are trigger-locked against mutation once created. |
| `publication_receipts` (0 rows) | Append-only evidence a specific approved version was published to a specific destination. Scope-validated against the referenced placement (same firm/deliverable/destination) and version (same firm/deliverable) at INSERT via `validate_publication_receipt_scope()`; unconditionally blocked from UPDATE/DELETE. Carries `verification_state` (`unverified/verified/failed/reconciling`), `reconciles_receipt_id` for corrections. |
| `publication_placement_claims` (0 rows) | Atomic pre-publish reservation, written only by the `claim_placement_for_publish()` RPC. |
| `standing_publishing_authorizations` (0 rows, DRG has never enabled it) | Append-only, lawyer-only firm-level publish authorization (DR-104). Latest row by `event_seq` is current state. |
| `content_attribution_evidence` (0 rows) | Unrelated to publishing itself; content-to-matter attribution evidence, out of scope here. |

| Lib file (confirmed present on `origin/main`) | Role |
|---|---|
| `src/lib/content-placements.ts` | I/O: `listPlacementsForDeliverable`, `listPlacementsForPeriod`, `createPlacement`, `updatePlacement`. |
| `src/lib/publication-receipts.ts` | I/O: `createReceipt`, `verifyReceipt`, `getReceiptById`, `listReceiptsForDeliverable`, `listReceiptsForPlacement`, `getCurrentReceiptForPlacement`, `listCurrentReceiptsByPlacementForDeliverable`. |
| `src/lib/publication-placement-claims.ts` | I/O wrapper over `claim_placement_for_publish()`: `claimPlacementForPublish`, `getLatestClaimForPlacement`. Returns `ClaimPlacementResult { ok, claimId, idempotentReplay, status, nextAction, releasePath }`; `nextAction` is one of `approve_deliverable / resolve_version_drift / already_published / needs_reverification / use_new_idempotency_key`. |
| `src/lib/standing-publishing-authorization.ts` | I/O + canonical authorization text builder; `getStandingAuthorizationState`, `enableStandingAuthorization`, `disableStandingAuthorization`, `setDeliverableVersionIndividualReviewRequirement`. |
| `src/lib/publication-preflight.ts` / `-loader.ts` | Existing, older, **single-destination** preflight: binary `mayPublish` + one reason string. Still the basis the newer 7-way taxonomy (Tier 2) classifies on top of. |
| `src/lib/publication-readiness.ts` / `-loader.ts` | The evaluator behind `PUBLICATION_READINESS_OPERATING_MODEL.md`'s manifest endpoint (seven-state chain: copy present → … → published → live and verified). |
| `src/lib/channel-validation.ts` | Post-publish evidence re-check (SSRF-safe fetch wrapper), the only thing today that can independently confirm a `firm_website`/PDF receipt's URL is real. LinkedIn/GBP are **unverifiable by this layer** — it reports `unverifiable`, requiring an operator's own attestation. |
| `src/lib/content-placement-tracking-pure.ts` | Deterministic `utm_content=<placementId>` tracking-parameter generation. The `firm_website` receipts route rejects a `public_url` that doesn't carry this marker — the one destination where a tracked URL is honestly enforceable without assuming a domain. |
| `src/lib/content-studio-gates.ts` | Content Studio's own `draft → legal_gate` gate (requires a zero-fail validation run) and `legal_gate → authoring/production` gate (requires deliverable approved or an active — currently unbuilt — publish delegation). Distinct from lawyer approval; this is the **QA/validator** gate. |

| Route (confirmed on `origin/main`) | Purpose |
|---|---|
| `GET /api/admin/content-periods/[periodId]/publication-manifest` | The older, **period-level**, single-destination-per-deliverable readiness report (doctrine doc's subject). |
| `GET /api/portal/[firmId]/periods/[periodId]/publication-preflight` | Batched preflight report across placements in a period. |
| `POST/GET /api/portal/[firmId]/deliverables/[deliverableId]/placements` (+ `[placementId]`) | Create/list/update a placement. |
| `POST /api/portal/[firmId]/deliverables/[deliverableId]/placements/[placementId]/claim` | Calls `claim_placement_for_publish()`. |
| `POST /api/portal/[firmId]/deliverables/[deliverableId]/placements/[placementId]/receipts` (+ `[receiptId]/verify`) | Record and verify a receipt. |

28 migrations matching `publication|placement|standing_publishing` are present on `origin/main`.

### Tier 2 — Built and tested, NOT merged (branch `feat/publication-operator`, HEAD `7a6ae79`, pending publication to `origin/main`)

Confirmed absent from `origin/main` by direct `git cat-file -e` check (not inferred from a doc):

| File | Role |
|---|---|
| `src/lib/publication-execution-manifest.ts` + `-loader.ts` | **The new, per-(approved-version, placement) immutable manifest.** Distinct from the older period-level manifest above — one manifest binds exactly one release version to exactly one placement. Server-derived only; every field is either a stored value or an explicit typed `null` with a reason. See §4 for the exact field reference; it already covers facts A, most of B, C (partially), D, and F of this design's six-fact list. |
| `src/lib/publication-preflight-status.ts` | The 7-way `PreflightStatusCategory` taxonomy layered on the manifest: `ready`, `blocked_content`, `blocked_authorization`, `blocked_missing_configuration`, `blocked_destination_validation`, `already_published`, `ambiguous_external_state`. Fixed precedence, fails closed on any unrecognized reason. |
| `src/lib/publication-destination-validators.ts` | Format checks sourced from public platform docs as of 2026-07: LinkedIn feed post ≤3,000 chars; LinkedIn article ≤220-char headline / ~110,000-char body; GBP post ≤1,500 chars + required image; website slug shape. |
| `src/lib/publication-adapter.ts` | `PublicationAdapter` contract (`validateConfiguration / preflight / renderDryRun / execute / reconcile / normalizeReceipt`) for four destinations (`firm_website`, `linkedin_*`, `google_business_profile`, `email_delivery`). `execute()` is **structurally disabled** — always returns `{ok:false}`, proven by a `fetch` spy across every destination including a forged live-execution env flag. `reconcile()` delegates to the Tier-1 `channel-validation.ts`, never duplicated. |
| `src/lib/publication-queue-pure.ts` | Pure classification for the operator queue list. |
| `GET .../placements/[placementId]/publication-execution-manifest` route | Read-only: assembles manifest → preflight status → configuration check → dry-run render. Never calls the claim RPC, never writes a receipt, never calls `execute`. |
| `/admin/content-studio/publication-queue[/[placementId]]` | Operator UI: firm/period picker, status-count summary, per-placement detail (approved-version preview, destination/authorization, asset/hash table, redacted dry-run action, claim/receipt history, raw manifest). |

Test coverage on this branch (confirmed present, not run in this pass — running tests would require a worktree checkout and package install, out of scope): `publication-execution-manifest.test.ts`, `publication-preflight-status.test.ts`, `publication-destination-validators.test.ts`, `publication-adapter.test.ts`, `publication-queue-pure.test.ts`, plus route tests for the manifest endpoint, the claim route, the receipts routes, and the receipt-verify route, plus three real-Postgres integration tests (`publication-placement-claim-concurrency`, `publication-receipt-concurrency`, `standing-publishing-authorization-concurrency`). The branch's own docs (`docs/PUBLICATION_OPERATOR_ARCHITECTURE.md`, `docs/runbooks/publication-operator-runbook.md`, `docs/reconciliation/publication-operator-dry-run-founder-vesting-2026-07-18.md`, all present only on this branch) report 117 targeted tests plus a full 5652/5652 suite passing on the day of that build.

**This is not new work to design from scratch — it is unmerged, tested, well-documented work that already implements most of this task's asks.** The primary decision this design surfaces for the operator is stated in §7: whether to promote this branch, and under what review.

### Tier 3 — Designed, not applied anywhere (not even in the Tier-2 branch's own database)

| Artifact | Status |
|---|---|
| `supabase/migrations/20260718121500_publication_destination_configs.sql` (in the Tier-2 branch only) | Explicitly headed "PROPOSED, NOT APPLIED." Confirmed absent from `list_tables` against production. Written in direct response to the exact conflation problem this task's doctrine item B calls out: *"Destination concepts are conflated. The system needs separate records for: Publishing account … Content destination … CTA target."* Table shape: `publication_destination_configs(id, firm_id, destination, config_seq [identity], active, identifier, label, configured_by_role='operator', configured_by_id, configured_by_name, note, created_at)`, append-only via the shared `block_append_only_mutation` trigger, current config = latest row by `config_seq` where `active=true`. This is the correct foundation for doctrine item B's "no inference from copy or title" / "stored firm-level destination" requirement — see §6. |
| `content_publish_delegations` | Referenced in `CLAUDE.md` (Ses.16 WP-2) as "staged not applied." Confirmed absent from `list_tables`. Not otherwise found as a migration file in any branch checked in this pass. |

### Tier 4 — Does not exist anywhere in this codebase

- No LinkedIn API client, OAuth flow, or credential of any kind (`LINKEDIN_CLIENT_ID`/`_SECRET`/`_ACCESS_TOKEN` are named-only placeholders in the Tier-2 runbook, not real env vars).
- No Google Business Profile API client, OAuth flow, or credential.
- No website-deploy API for any firm's site. The firm site (`drg-law-website`) is a separate, CLI-deployed repository; a human runs `vercel --prod` there by hand. This is confirmed unchanged by the fresh 2026-07-19 relocation-clause reconciliation pass (§3).
- No email-destination delivery model for placements at all (`email_delivery` exists only as an enum value; nothing resolves an account/sender for it).

## 2. The doctrine restated, precisely

Everything below inherits, unchanged, from the CaseLoad Select doctrine already in force and from this task's instructions:

- Content Studio approval is version-bound. An agent publishes an immutable approved version, never draft text.
- A deliverable can be approved while lacking a destination placement, live public page, channel authorization, or receipt.
- A plain public URL is never an acceptable substitute for a version-bound tracked placement URL.
- The release chain is: approved immutable version → validate required live asset → create/retrieve version-bound placement → publish to the configured channel account → capture external receipt → write evidence back to Content Studio.
- Never regenerate content. Never guess a destination, URL, account, or approval. Never use a draft or an untracked fallback link.
- The 2026-07-18 migration-lineage freeze remains in force. This document recommends but does not apply the Tier-3 migration.
- Content Performance Attribution, standing publishing authorization's own UI, notification-choice functionality, the DRG website's own code, SEO/AEO work, and historical-reconciliation *data* (as opposed to the *process*, which this document formalizes) are out of scope.
- No LinkedIn/GBP/website/email publication happened, or will happen, as part of producing this document.

## 3. The case study, mapped onto the real, current state

**Deliverable `23661929-b4f8-489e-b022-96d98ad04384`** — "[LINKEDIN POST] Clause in the margin LinkedIn post" (DRG Law, firm `eec1d25e-a047-4827-8e4a-6eb96becca2b`) — is the exact deliverable a same-day historical reconciliation pass (row 9 of a per-period evidence review) flagged as `inaccessible_with_current_permissions`: approved (`status='approved'`, `current_version_id = approved_version_id = 9b272d6a-…`, no drift), promoting a now-confirmed-live article, but with no way to verify a LinkedIn post exists without a login nobody attempted. Historical reconciliation evidence is not yet committed to `origin/main` and is not relied on as an implementation dependency for this design.

A **read-only query run for this document** (2026-07-19) found this is no longer fully unresolved:

```
content_placements: 1 row
  id: ce4cb25b-91a6-4935-933f-d98dd3949475
  deliverable_id: 23661929-...
  destination: linkedin_post        (disambiguated from the legacy generic
                                      publication_destination='linkedin' —
                                      exactly the ambiguity the Tier-2
                                      runbook calls out as requiring a human
                                      choice among linkedin_post /
                                      linkedin_article / linkedin_company_page)
  locale: en-CA
  state: planned
  created_at: 2026-07-19 22:46 America/Toronto (approx, from UTC timestamp)
```

`publication_receipts` for this firm remains **0 rows**. So, run through the Publication Resolution preflight this document specifies (§4–5):

- **A (exact content):** satisfied — approved, no drift, version hash resolvable.
- **B (exact destination):** partially satisfied — `content_placements.destination = linkedin_post` disambiguates the channel *type*; **no `publication_destination_configs` row exists** (table not applied) to say *which* LinkedIn company page. Today the system has no way to answer that question at all.
- **C (required live asset):** satisfied for the article it promotes — `/journal/demolition-clause-ontario` returned HTTP 200 with title-matched content in the same 2026-07-19 pass.
- **D (version-bound placement):** satisfied — the row above.
- **E (channel capability):** **not satisfied** — no LinkedIn integration exists anywhere in this codebase.
- **F (receipt contract):** the schema and adapter contract for this exact destination already exist (Tier 1 `publication_receipts` + Tier 2 `normalizeReceipt`), so the contract itself is defined even though no receipt has been written.

Net: this deliverable resolves today to **`channel_auth_missing`** (§5) — placement now exists, live target confirmed, but no channel credential exists to post through, and no destination-account identity is on record either. This is the precise, current, worked example the rest of this document is built to classify correctly and never silently paper over.

This deliverable's placement is `linkedin_post`, a teaser, so §4.1's republish-identity rule does not apply to it as it stands. It will apply the first time a `linkedin_article` placement is created for this or any deliverable, including under the pilot in §7C.

## 4. The Publication Resolution preflight: the six facts

This is the mandatory stage. **No external publication action may be attempted until all six resolve.** Each fact states what already computes it and what is missing.

### A. Exact content

Required: deliverable ID, immutable approved version ID, version hash/integrity identity, proof of eligibility under existing authorization/legal/QA rules.

- **Already built (Tier 1 + Tier 2).** `resolveReleaseVersion()` (Tier 2, `publication-execution-manifest.ts`) is the single source of truth for which version would actually release and via which path — it mirrors `claim_placement_for_publish()`'s own gate byte-for-byte: path A requires `deliverable.status === 'approved'` with no drift; path B requires the current version not flagged `requires_individual_review` and an active standing authorization. `versionBodyHash` (SHA-256 of `body_html` or the version's own `asset_sha256`) gives the integrity identity. `content-studio-gates.ts` (Tier 1) already gates a Content Studio piece's own QA/validator pass independently of lawyer approval — that is the "eligible under existing … QA rules" half of this fact, and it is a **distinct** gate from lawyer approval (see the new `qa_or_legal_gate_missing` state in §5; the manifest currently only checks lawyer approval, not the Content Studio QA gate, which is a real gap — see §7).
- **Gap:** the Tier-2 manifest loader does not currently cross-check `content_pieces`/`content_ai_runs`'s own validator-pass state for pieces that originated in Content Studio (as opposed to deliverables created directly in the portal). Needs a lookup by `content_pieces.deliverable_id` when present.

### B. Exact destination

Required: channel, firm, specific configured account/page/location/list — never inferred from copy or title.

- **Already built (Tier 1).** `content_placements.destination` is a firm-scoped, deliverable-scoped, hard-enumerated channel type, never free text.
- **Missing (Tier 3, drafted not applied).** The actual **account identity** — which LinkedIn company page, which GBP location, which website origin — has no explicit record today except a weak inference for `firm_website` only (the most recent *validated* webpage artifact). For every other destination the Tier-2 adapter's `validateConfiguration()` returns `configured: false` unconditionally, which is honest but not resolvable without the Tier-3 table. **Recommendation:** review and apply `publication_destination_configs` exactly as drafted (§6), which makes this an explicit, append-only, operator-set record instead of inference or a future guess.

### C. Required public target

Required: the linked article/landing page/PDF is live, canonical, and (where applicable) bilingual-complete — never assumed live from portal text alone.

- **Already built (Tier 1).** `publication_artifacts` + `publication_artifact_validations` is exactly this: a registered evidence row plus an append-only re-check history (`storage_object_check`, `route_check`, `deployment_check`, SHA-256 match for PDFs). `ManifestAsset.validated` (Tier 2) already requires the *most recent* validation row to say `pass`, not merely that an artifact was registered — registration is a claim, validation is evidence the claim was checked, and the manifest already treats these as different things.
- **What this preflight adds:** a placement whose `required_artifact_type` has no artifact, or whose only matching artifact is `validated: false` or bound to a stale (non-release) version, must resolve to `live_asset_missing` (§5) as its own distinct state — never silently folded into a generic "content not ready." The Tier-2 `PreflightStatusCategory` currently folds this into `blocked_content` via a string-match on the reason (`"no registered asset of required type"`); this design keeps that detection logic but promotes the *category* to a first-class, distinctly-named state per the task's requirement (§5).

### D. Version-bound placement

Required: retrieve an existing valid placement or create one through the approved system path; no plain fallback URL when tracking is required; placement binds destination, deliverable, version, final URL, UTM data.

- **Already built (Tier 1).** `content_placements` is exactly this record. `content-placement-tracking-pure.ts` generates the deterministic `utm_content=<placementId>` marker, and the `firm_website` receipts route already **rejects** a `public_url` that doesn't carry it — the strongest existing enforcement of "no untracked fallback."
- **Gap:** nothing in this codebase creates a placement automatically. The only path is the operator-run `POST .../placements` route. This is intentional (§6, "no inference from copy or title") and this design keeps it that way — placement creation stays an explicit, human-confirmed action in every mode, never an agent inference from deliverable metadata.

### E. Channel capability

Required: credentials/integration/account mapping exist; if not, a precise blocked state, never browser improvisation or a request to log into a personal account.

- **Does not exist for LinkedIn or GBP (Tier 4).** The Tier-2 adapter already returns a precise `{configured: false, reason}` for these, and `execute()` is structurally disabled with a test proving no `fetch` call is ever reachable, including with a forged enable flag. This design keeps that posture exactly and formalizes it as its own state (`channel_auth_missing`, distinct from `destination_unconfigured` — see §5 and §7 for why these are two different facts, not one).
- **A worth-evaluating option, not a decision:** this session's connected MCP tool roster includes a GoHighLevel social-media-posting surface (`create-post`/`get-account`/`get-posts` etc.) against the operator's existing GHL account, which CaseLoad Select already uses for CRM/SMS/Voice. This *may* be a faster integration path for LinkedIn/GBP channel capability than building raw platform OAuth from scratch, since GHL already brokers those connections for its own customers. This is noted here as something worth an operator evaluation later (§9's external-integration lane) — it was not investigated further, no credentials were touched, and nothing was posted through it. It does not change any conclusion in this document.

### F. Receipt contract

Required: external post URL, platform-native ID, timestamp, destination account ID, placement ID, deliverable ID, approved version + integrity identity, final resolved URL, result/status, platform error.

- **Already fully specified (Tier 1).** `publication_receipts`'s columns are, field for field, this exact list: `public_url`, `external_post_id`, `published_at`, (destination account is implicit via the linked `placement_id` once Tier 3 lands), `placement_id`, `deliverable_id`, `approved_version_id`, `artifact_sha256`, plus `verification_state`/`failure_reason` for result/status/error. `normalizeReceiptInput` (Tier 2 adapter contract) is the typed pass-through that ensures a caller only ever supplies real, operator-confirmed values — never invents evidence.
- **Gap, forward-looking only:** nothing today would stop a future sixth `destination` enum value from being added to `content_placements` without a matching adapter/`normalizeReceipt` implementation. §5's `receipt_contract_missing` state exists to fail closed on that specific future mistake, not because today's four adapters are missing anything.

### 4.1 Routing rule: a LinkedIn Article is a republish surface, not a new deliverable

Flagged during operator review of this document (2026-07-19). `content_placements.destination` lists `linkedin_post` and `linkedin_article` as two entries in the same enum, which is correct for storage but risks an implicit assumption that both are authored the same way. They are not, and this rule states the distinction explicitly so a future agent, or human, never creates a `linkedin_article` placement bound to freshly drafted copy:

- **`linkedin_post`** is a teaser: short, independently authored copy whose job is to drive a click to a target the deliverable's own `cta_target_path` names (already modeled today, resolved independently of the placement's own destination as `ctaTargetUrl`/`ctaTrackedUrl` on the manifest, see §4A). The case-study deliverable in §3 is exactly this shape: its own short body, a CTA pointing at `/journal/demolition-clause-ontario`.
- **`linkedin_article`** is a republish surface for LinkedIn's own long-form Article format. Its content identity must be the same approved version already bound to the source `firm_website` (or equivalent) placement, never a separately authored deliverable and never a separately approved version. In practice: before a `linkedin_article` placement is ever created, resolution of fact A (exact content, §4A) for that placement must trace back to the identical `releaseVersionId` already resolved for the same deliverable's `firm_website` placement, not to a sibling `content_deliverables` row with its own version history.
- This adds one more `blocked_content` reason for the manifest loader to check when `destination = 'linkedin_article'`: the placement's release version must equal the release version of the same deliverable's `firm_website` placement (when one exists), or the preflight blocks with an explicit content-identity-mismatch reason rather than proceeding on independently drafted text.
- No `linkedin_article` placement exists in production as of this document (the single production `content_placements` row is `linkedin_post`), so this is a forward requirement, not a correction of live data. It is stated here because the operator-endorsed LinkedIn pilot (§7C) introduces the first one.

### 4.1a Surface-presentation adaptation (DR-105, added 2026-07-19, same-day follow-on)

Discovered the same day as this document, on the exact case study in §3: even once fact A (exact content) resolves to the correct `releaseVersionId`, rendering that version on a destination surface other than its source surface can require destination-specific presentation that the source surface's own template does not supply. The concrete instance: DRG's website injects a DR-082 compliance disclaimer around every article server-side (`LsoDisclaimer.tsx`), worded "What you read on **this website**..."; that sentence is literally false on a LinkedIn Article, which is not the website. Fact A's version-hash identity says nothing about this — a byte-identical `body_html` can still need a different, surface-correct wrapper around it.

This adds a new, mandatory preflight sub-step, `resolve_surface_presentation_adaptation`, run for every placement whose `destination_surface` differs from the release version's `source_surface` (today, concretely: any `linkedin_article` placement, since `linkedin_post` is an independently-authored teaser per §4.1 and is out of scope for this step; `firm_website` is always its own source surface). Full policy, eligibility conditions, and the allow/forbid transformation lists live in DR-105 (`00_System/01_Doctrine/DECISION_RECORDS.md`) and are not restated here; this section states only where the step sits in this preflight and what it returns.

**Inputs:** the resolved `releaseVersionId` and its `source_surface` (fact A), the placement's `destination_surface`, the firm and locale.

**Resolution:** look up `docs/publication-operator/surface-presentation-adaptation-registry.md` for a rule keyed on the exact `(firm, locale, source_surface, destination_surface)` tuple.

**Outcomes:**

| Outcome | Condition |
|---|---|
| `surface_adaptation_not_required` | `destination_surface === source_surface` (e.g. the `firm_website` placement itself), or the destination role does not carry a compliance wrapper at all. |
| `surface_adaptation_resolved` | An exact registry rule matches the tuple. The rule's `compliance_block_exact_text` (or equivalent whitelisted output) is used verbatim; nothing is generated. |
| `surface_adaptation_rule_missing` | No registry rule matches the exact tuple. Preflight failure — see §5. |
| `substantive_adaptation_requires_approval` | A human is asking for a change to the rendering that falls outside every matching rule's `allowed_output_changes` (e.g. wording beyond the registered substitution, a shortened version, a translation). Preflight failure — see §5. |
| `surface_adaptation_integrity_mismatch` | A registry rule matches, but the rendered output does not equal source-body-plus-rule-whitelisted-output when recomputed (defensive, not reachable under normal operation; guards against a future bug applying the wrong rule or a stale cached render). Preflight failure — see §5. |

**Registry state today:** exactly one rule exists, `drg_en_website_article_to_linkedin_article_lso_notice_v1` (DRG Law, en-CA, `website_article` to `linkedin_native_article`). Re-run against the §3 case study: if a `linkedin_article` placement is created for deliverable `23661929-...`'s companion article (`e3fb60fe-08c5-45ee-854b-889beaaa9136`, approved version `46e5a5c8-c111-4472-b0ec-98a46981e81c`, source surface `website_article`, live at `drglaw.ca/journal/demolition-clause-ontario`), this step resolves `surface_adaptation_resolved`. No rule exists for `pt-BR` or for `google_business_profile`/`email_delivery`; a placement on either resolves `surface_adaptation_rule_missing` until its own rule is added, reviewed, and registered the same way.

**Agent constraints, restated from DR-105 because this is exactly where an agent could quietly violate them:** never draft, paraphrase, translate, or "lightly edit" a compliance wrapper at publish time, even when the requested change looks obviously safe; never copy the source surface's own wrapper onto a different surface unchanged, since a website-scoped sentence can be false elsewhere; never treat a missing rule as an invitation to write one on the spot; never fold `substantive_adaptation_requires_approval` into a wording tweak an operator can authorize alone — it routes to the same lawyer-approval path as any other substantive content change.

## 5. State machine

Twelve states: the eleven the task requires, plus `ambiguous_external_state`, already built and proven valuable in Tier 2, kept as an addition beyond the required minimum.

| State | Exact detection condition | Agent may automatically | Agent must never | Human/operator action needed |
|---|---|---|---|---|
| `eligible_to_publish` | All of A–F resolve; equivalent to Tier-2 `ready`. | Prepare the dry-run manifest and preflight summary (§9's sample form) for operator review. In future-release mode (§7A), still stop here pending human batch confirmation until a channel is pilot-proven. | Publish without a human confirmation during the pilot phase (§7A); skip the idempotency check (§6) even if this state was reached a moment ago. | Confirm the batch (future-release mode) or none (once a channel graduates per §7A's promotion criteria). |
| `approval_missing` | `content_deliverables.status !== 'approved'` on path A, AND no active standing authorization covers the current version on path B (i.e. `resolveReleaseVersion()` returns `releaseAuthorizationPath: null`). | Nothing external. May surface the exact missing step ("go to the deliverable's own review page") per the Tier-2 runbook's existing table. | Approve on the lawyer's behalf; treat a `changes_requested` deliverable as eligible; infer approval from a live-looking public page (this was the DRG demolition-clause-PT near-miss in §3's source reconciliation doc — a page can look reviewed and still not be confirmed approved in the portal). | Firm's lawyer approves the version, or enables standing authorization from their own portal. An operator can never do either. |
| `qa_or_legal_gate_missing` | For a Content Studio-originated piece (`content_pieces.deliverable_id` set): the piece's current version has no validation run with zero failures (`content-studio-gates.ts`'s own `draft → legal_gate` condition, re-checked rather than assumed still true). | Nothing external. May report which validators failed. | Advance the piece's gate itself, or treat a stale (superseded) validation run as current. | Operator/system re-runs Content Studio's own `validate` route; content author addresses findings. |
| `surface_adaptation_rule_missing` | `resolve_surface_presentation_adaptation` (§4.1a) found no registry rule for the exact `(firm, locale, source_surface, destination_surface)` tuple. | Report the exact missing tuple and point at `docs/publication-operator/surface-presentation-adaptation-registry.md`. | Draft, paraphrase, translate, or infer a replacement compliance wrapper; copy the source surface's own wrapper unchanged onto the destination surface. | A human authors and registers a new rule in the adaptation registry (the same review bar DR-105 sets for the one existing rule), or the operator confirms the destination surface genuinely needs no wrapper and the rule should instead resolve `surface_adaptation_not_required`. |
| `substantive_adaptation_requires_approval` | A requested rendering difference falls outside every matching rule's `allowed_output_changes` (§4.1a) — e.g. shortened copy, translation, a reworded CTA, or any change to a legal claim or scope. | Report exactly which part of the request is outside the registry rule's whitelist. | Apply the change itself, on any authority, including an explicit operator instruction; treat it as a Surface-Presentation Adaptation because the requester frames it as "minor" or "just wording." | The change goes through the deliverable's own comment/suggestion/version/approval workflow (`CLAUDE.md`, "Content approval (Phase 2)"; a standalone written playbook for that workflow is referenced in `docs/PUBLICATION_READINESS_OPERATING_MODEL.md`'s own intro but is not yet published on `origin/main` as of this document); only the firm's lawyer approves it. |
| `live_asset_missing` | The placement's `required_artifact_type` has no `publication_artifacts` row bound to the release version whose most recent `publication_artifact_validations` row is `pass`. | Run the existing read-only `reconcile-artifacts` check (never register a new artifact from that check — matches `PUBLICATION_READINESS_OPERATING_MODEL.md`'s existing mandatory-agent rule verbatim). | Register a `publication_artifacts` row without a human having personally opened the storage object or loaded the live URL (this restriction is already enforced at the database level — RLS + revoked grants mean only the service role, invoked by a human-directed operator action, can insert). Assume a source asset is live "because portal text exists" — the literal doctrine line this state exists to enforce. | Operator confirms the asset is real and registers it (today: a direct, documented, service-role insert; §7A/§10 covers replacing this with a route). |
| `placement_missing` | No `content_placements` row exists for `(deliverable_id, destination, locale)`. | Nothing. Report the gap exactly as the Tier-2 runbook already does ("N deliverable(s) with no placement yet"). | Create a placement by guessing `destination` from `deliverable_role`/`publication_destination` (the legacy single-value column cannot disambiguate `linkedin_post` from `linkedin_article` from `linkedin_company_page` — inventing an answer here is exactly the "No Invention" violation the Tier-2 dry-run pilot report already refused to commit). Separately: create a `linkedin_article` placement bound to independently authored content instead of the source deliverable's own approved version (§4.1). | Operator creates the placement through `POST .../placements`, choosing the destination explicitly. |
| `destination_unconfigured` | `content_placements` row exists, but no active `publication_destination_configs` row exists for `(firm_id, destination)` **and** no fallback-eligible verified evidence exists either (today, only `firm_website` has a fallback path at all, via a prior verified artifact/receipt). | Nothing. | Guess an account/page/location identifier from firm name, deliverable title, or any other inference. | Operator configures the publishing account for that firm+destination (§6) — a one-time, per-firm, per-destination technical setup act, distinct from the lawyer's authorization decision. |
| `authorization_missing` | Equivalent to Tier-2 `blocked_authorization`: neither path A nor path B of `resolveReleaseVersion()` resolves, but for a reason distinct from plain non-approval (e.g. the current version carries `requires_individual_review=true`, which forces path A even when standing authorization is active). | Report the exact reason (`resolveReleaseVersion()` already returns one). | Clear the `requires_individual_review` flag (operator-only RPC, and even then only forward — clearing it back never bypasses the underlying need for approval). | Same remedies as `approval_missing`, plus: if `requires_individual_review` was set, that specific version needs individual lawyer review even under an active standing authorization. |
| `channel_auth_missing` | `destination_unconfigured` does NOT apply (an account identity IS on record, or the destination doesn't need one, e.g. `firm_website` deploy is manual by design) but the adapter's own credential/integration check fails (today: unconditionally true for LinkedIn and GBP, since zero credentials exist anywhere in this codebase). | Render the redacted dry-run action (Tier 2's existing `renderDryRun`, proven secret-free by a regex scan in its own test suite) so an operator can see exactly what *would* be sent. | Attempt any live API call (`execute()` stays structurally disabled — no code path reachable from this state may ever call `fetch`); ask a human to hand over personal LinkedIn/GBP credentials; browser-improvise a login. | Real OAuth/API integration work for that channel (§10) — new engineering, not a config flip. |
| `receipt_contract_missing` | The placement's `destination` value has no corresponding branch in `publication-adapter.ts`'s `getPublicationAdapter()` / no `normalizeReceipt` implementation. Not reachable today (all four enum values are covered) — a forward guard, not a current gap. | Nothing. Refuse cleanly. | Fabricate a receipt shape for an unimplemented destination "close enough" to an existing one. | Engineering work to add the adapter before this destination value is ever used in a real placement. |
| `already_published` | A `publication_receipts` row exists for this exact `(placement_id, destination, approved_version_id)` with `verification_state = 'verified'`. Highest precedence — checked before anything else, exactly as Tier 2 already implements it. | Report the existing receipt. Nothing else. | Publish a duplicate. This is the idempotency rule itself; see §6. | None, unless the operator wants to inspect the receipt/evidence. |
| `ambiguous_external_state` (additive, beyond the task's required minimum) | A `publication_receipts` row exists but is `unverified` / `failed` / `reconciling`, OR an active `publication_placement_claims` row already exists for this placement+version. | Run the existing verification check where one is automated (`firm_website`/PDF via `channel-validation.ts`). | Guess whether the ambiguous prior attempt succeeded; start a second claim while one is active. | Same as the Tier-2 runbook's "Ambiguous-state reconciliation" table: resubmit with `manualOutcome` for an operator-confirmed LinkedIn/GBP result, investigate a `failed` receipt before retrying, wait out a genuinely-in-progress concurrent claim, or make a human judgment call on a stale claim (this system will never resolve that judgment call for LinkedIn/GBP, because it cannot check those platforms itself). |
| `historical_reconciliation_required` | The deliverable's period predates this system's placement-based model in practice (no `content_placements` row was ever created for it even though its `content_period` has long since closed), **and** independent public evidence exists or was gathered through the manual reconciliation process (`docs/reconciliation/*.md`) rather than through a receipt. | Everything §7B (Historical reconciliation mode) permits: inspect, cross-reference, propose evidence binding. | Infer a historical post from a title match; create a new post to make the record look complete; skip the future-release preflight if actual (re-)publication is intended. | See §7B in full. |

## 6. Idempotency rule (formalized, not new)

Before any publish attempt: query for an existing receipt for `(placement_id, destination, approved_version_id)`. If a `verified` receipt exists, return `already_published`; do not publish a duplicate. This is not a proposal — it is `evaluatePublicationPreflightStatus()`'s existing, tested, first-checked branch in Tier 2, plus the atomic guarantee already enforced at the database layer: `claim_placement_for_publish()` locks the deliverable and placement rows, re-runs readiness, and a repeated `idempotency_key` (computed deterministically as `sha256(firmId:deliverableId:placementId:releaseVersionId)` by `computeManifestIdempotencyKey()`) always returns the *same* claim (`idempotentReplay: true`) rather than creating a second one. This design's only addition is naming it as a required, explicit preflight step in every mode (§7), so a future integration cannot accidentally skip straight to an adapter's `execute()` without it.

## 7. Two operating modes

### A. Future release mode

For new content passing current readiness requirements:

1. Agent prepares the Publication Resolution preflight (§4) and renders the sample form (§9).
2. Placement resolution/creation happens **only** through the approved system path (`POST .../placements`), always human-directed — never inferred (§5, `placement_missing`).
3. Publishing remains **batch-confirmed by a human** during initial pilots, matching Tier 2's own release ladder steps 1–3 exactly (local dry-run → authenticated preview dry-run → production internal dry-run with `execute` still structurally disabled).
4. **Promotion criteria for a channel to move to an authorized-autonomous-release mode** (the task asks for exact criteria, not a day estimate):
   - Automated test coverage on the promoted implementation (today: 117 targeted tests plus a 5652-test full suite on the Tier-2 branch) is necessary evidence, never sufficient by itself. An independent adversarial code review of the exact merged or rebased code must separately confirm no path from preflight into a live call exists outside the reviewed gate, and the existing real-Postgres integration suites (`publication-placement-claim-concurrency`, `publication-receipt-concurrency`, `standing-publishing-authorization-concurrency`) must be re-run against the actual target database in a disposable environment, not only against mocks, once the migration-lineage freeze allows it (§7C, step 4). A passing test run is a gate this criterion checks, not a substitute for it.
   - At least one real, human-performed `execute` implementation exists for that specific destination value (not the whole `firm_website`/`linkedin_post`/etc. family — each destination value graduates independently, since `linkedin_post` and `linkedin_company_page` are genuinely different integrations even on the same platform).
   - That implementation has been exercised, by hand, with an operator watching, on at least one real placement, end to end through claim → execute → receipt → reconcile (Tier 2's release ladder step 5), with the resulting receipt independently verified (not merely `unverified`).
   - Zero `ambiguous_external_state` or `already_published`-miscategorized outcomes occurred across that channel's pilot runs — any single miscategorization resets the pilot count for that channel to zero, not a decrement.
   - The channel's `channel_auth_missing` gap is closed by a real, reviewed credential/OAuth integration (not a bypass of the state) — `website` is the only destination where this bar is already effectively met (manual deploy has always been "the integration," and its receipt/verification loop is the most mature).
   - An explicit, separate, human-reviewed change proposes the exact scope of autonomous behavior being granted (which destinations, which firms, any rate/volume ceiling) — this document does not pre-authorize that scope; it only defines the bar for proposing it.

### B. Historical reconciliation mode

For old approved periods such as Relocation Clause (§3) or Founder Vesting:

- The agent may inspect real public evidence (the exact browser-driven, unauthenticated checks both existing reconciliation reports already perform: direct HTTP fetch of the promoted URL, a logged-out check of the LinkedIn/GBP public surface) and cross-reference it against the portal's stored approval/version/destination facts.
- It must distinguish **approved/not published** from **approved/already published** — concretely, in the state-machine terms of §5, a historical item resolves to `historical_reconciliation_required` only when evidence is genuinely ambiguous or absent; if a `publication_receipts` row already exists and verifies, the ordinary `already_published` state applies instead, with no special historical handling needed.
- It may propose or prepare evidence binding (a written reconciliation report exactly like the two already in `docs/reconciliation/`, or — once §10's registration route ships — a proposed `publication_artifacts`/`publication_receipts` insert for a human to review and execute) but must never itself write that evidence without the same personal-verification standard §5's `live_asset_missing` remedy already requires (an operator, or an agent under an operator's direct, in-the-moment instruction, having actually opened the URL/file).
- It must never infer an old post from a title match. The two existing reconciliation reports already hold this line explicitly (LinkedIn/GBP rows are marked `Unverified`, not `Missing` or `Live`, precisely because a logged-out check cannot see a historical post archive) — this design keeps that exact distinction as a named requirement, not merely an observed practice.
- It must never create a new post simply to make the historical record look complete. This is the literal wording of the doctrine, and it is the one thing that most sharply separates this mode from the future-release mode: a gap found during reconciliation is a finding to report, never a task to silently close by publishing.
- If publication is genuinely intended for a historical gap (e.g., the operator decides the relocation-clause LinkedIn post should actually go out now, having confirmed it never did), it must run the same future-release preflight (§7A) first, in full — historical mode never grants a shortcut around any of the six facts in §4.

### C. Operator-directed rollout sequence (endorsed 2026-07-19)

The operator reviewed this document and endorsed the following concrete sequence for DRG. It supersedes no doctrine above; it is the specific order these design elements should be exercised in, recorded here so a later session does not have to reconstruct it from a conversation:

1. Commit this design document in a docs-only PR: no code, schema, or any of the Tier-2 branch's migrations included.
2. Keep `feat/publication-operator` frozen: its migrations and adapters are not merged or applied as part of adopting this document.
3. Finish the independent database-engineer review of the migration-lineage remediation design (the separate, already-in-flight workstream this document's §1 freeze note refers to, tracked on `chore/migration-lineage-remediation-design-2026-07-18`) before any further migration, including `publication_destination_configs`, is proposed for application.
4. Once the freeze is safely lifted, apply and verify the destination-configuration migration in a disposable real-Postgres environment first, not directly against production.
5. Configure DRG's actual destinations explicitly through that table once applied: the DRG website origin, the DRG Law LinkedIn company page, the DRG Google Business Profile location, and `info@drglaw.ca` or an approved newsletter list for `email_delivery`. These four are the concrete, named targets for DRG. §8's open question about a permitted-content-roles field should be resolved with this real list in view, not in the abstract.
6. Add LinkedIn credentials through a real, secure OAuth integration only, never a browser-session workaround, matching §9's "no external action after an unresolved preflight failure" and §4E's explicit prohibition on browser-improvised login.
7. Run one controlled LinkedIn pilot, adopted here as the concrete instance of §7A's promotion criteria: an approved version, published to the native LinkedIn Article surface under §4.1's content-identity rule, with a `linkedin_post` placement pointing at that Article as its CTA target, a captured post URL/URN written back as a `publication_receipts` row, and a repeated attempt against the same idempotency key confirmed to return the existing receipt rather than a duplicate (§6).
8. Only after that pilot passes in full does the LinkedIn `linkedin_article`/`linkedin_post` pair become eligible for the autonomous-release proposal §7A's last bullet requires. Every other destination (Google Business Profile, email) needs its own equivalent pilot before it is eligible; this sequence does not grant it by association.

## 8. Destination configuration design

The firm-level configuration contract this task asks for is exactly what Tier 3's drafted (not applied) `publication_destination_configs` table already specifies, reviewed here and adopted as the recommended shape rather than re-designed:

| Requirement | How the drafted table meets it |
|---|---|
| Stable internal ID | `id uuid primary key`. |
| Human-readable label | `label text` (nullable — an operator may not always want to name it, but the identifier itself is always required). |
| Authorization status | `active boolean` — the *current* configuration is the latest row (`max config_seq`) with `active = true`; a firm changing web host, or losing LinkedIn page access, is recorded as a new `active = false` row, never a deletion, preserving the audit trail. |
| Permitted content roles | Not modeled as a separate field in the drafted table; today this is implicit in `content_placements.destination` + `required_artifact_type` per placement. **Open question for a data-engineer**, flagged explicitly per this task's instruction: whether a destination config should itself carry a permitted-roles list (e.g. "this GBP location only accepts `gbp_post`, never `social_post`") independent of any one placement, or whether per-placement `required_artifact_type` is sufficient. This document does not resolve that question. |
| One row per destination type, covering website / LinkedIn company page / GBP location / future email sender-list | The `destination` CHECK enum already covers all four families (`firm_website`, three LinkedIn granularities, `google_business_profile`, `email_delivery`), scoped `(firm_id, destination)`. |
| No schema change performed | Correct — this table is not applied anywhere, including the Tier-2 branch's own environment. This document's recommendation is to review and apply it, not that it is already safe to build against. |

**Smallest future migration, if the open question above resolves toward "yes, model permitted roles":** add a nullable `permitted_content_roles text[]` column to `publication_destination_configs` (additive, no backfill required, matches this codebase's own "deploy-safety is a pattern" convention of guarded-null reads). This is a recommendation only; the active migration-lineage freeze governs when and how it would actually be authored and applied, and that governance is out of scope for this document.

**DRG's concrete target list**, once this table is applied: see §7C step 5 (website origin, LinkedIn company page, GBP location, `info@drglaw.ca`/newsletter list). Nothing on that list is configured today; the table itself does not exist in production or in the Tier-2 branch's own environment.

## 9. Auditability and safety

| Requirement | Design |
|---|---|
| Append-only publication attempts and receipts | Already true for `publication_receipts` (unconditional UPDATE/DELETE block) and `publication_placement_claims` (mutation-lockdown migration confirmed present on `origin/main`). This design adds no new mutable publication-evidence table. |
| Version/placement/destination identity on every attempt | Already enforced at INSERT via `validate_publication_receipt_scope()` and `validate_content_placement_scope()` — a receipt or placement that references a mismatched firm/deliverable/version/destination is rejected by the database, not merely the application. |
| Immutable external evidence once captured | `evidence_storage_bucket`/`evidence_storage_path` on `publication_receipts`, same append-only guarantee. |
| Deterministic retry rules | `computeManifestIdempotencyKey()` + the claim RPC's `idempotentReplay` behavior (§6) — a retry with the same key never creates a second claim. |
| No external action after an unresolved preflight failure | Enforced today by `execute()` being structurally disabled at the code level (not merely a runtime check) for every adapter — the safest form of this rule, since there is no live-call code path to accidentally reach even from a bug elsewhere in the preflight logic. |
| No raw URL guessing | `canonicalUrl`/`trackedUrl` on the manifest are `null` whenever a base URL cannot be resolved from prior *verified* evidence or an explicit destination config — never a constructed guess. |
| No model-authored channel copy | The manifest carries `title`/`body`/`excerpt` verbatim from the stored, approved (or standing-authorized-current) version — this design adds no generation step anywhere in the publish path. An agent operating this system drafts nothing at execute time; content is fixed long before this stage. |
| Output logs safe for client data | The Tier-2 `renderDryRun()` payload preview is proven secret-free by its own regex-scan test; this design's operator-facing preflight summary (below) follows the same standard — facts and identifiers only, never a credential or a full request body. |
| Operator-readable preflight summary | The task's exact sample form, reproduced below as the canonical rendering this design commits to. |

### Publication preflight (canonical form)

```
Publication preflight
- Deliverable:
- Approved version:
- Integrity identity:
- Destination:
- Required live asset:
- Placement:
- Channel authorization:
- Idempotency result:
- Decision:
- Blocking reason, if any:
```

Worked example, using the case study from §3, as it would render today:

```
Publication preflight
- Deliverable: 23661929-b4f8-489e-b022-96d98ad04384 — "[LINKEDIN POST] Clause in the margin LinkedIn post"
- Approved version: 9b272d6a-eb63-4991-8c4c-64d20c33eeb2 (current = approved, no drift)
- Integrity identity: sha256(body_html) — computable, value not reproduced here
- Destination: linkedin_post (en-CA), promoting /journal/demolition-clause-ontario
- Required live asset: /journal/demolition-clause-ontario — confirmed HTTP 200, title-matched, 2026-07-19
- Placement: ce4cb25b-91a6-4935-933f-d98dd3949475 (state: planned)
- Channel authorization: NOT CONFIGURED — no LinkedIn integration exists in this codebase
- Idempotency result: no existing receipt or active claim for this placement + version
- Decision: BLOCKED — channel_auth_missing
- Blocking reason, if any: no LinkedIn API credential/integration exists; this platform's publish path is structurally disabled pending real OAuth integration work (see §10)
```

Second worked example — the hypothetical `linkedin_article` placement for this deliverable's companion article (§4.1a), no such placement exists in production yet, shown to demonstrate the new preflight step resolving against the one registered rule:

```
Publication preflight
- Deliverable: e3fb60fe-08c5-45ee-854b-889beaaa9136 — "[CLAUSE IN THE MARGIN] What the demolition clause in an Ontario commercial lease actually lets your landlord do."
- Approved version: 46e5a5c8-c111-4472-b0ec-98a46981e81c (current = approved, no drift; approved by Damaris Guimaraes, 2026-07-10)
- Integrity identity: sha256(body_html) — computable, value not reproduced here
- Surface adaptation: RESOLVED via rule `drg_en_website_article_to_linkedin_article_lso_notice_v1` (source_surface: website_article, destination_surface: linkedin_native_article)
- Destination: linkedin_native_article (en-CA)
- Required live asset: /journal/demolition-clause-ontario — confirmed HTTP 200, title-matched, 2026-07-19
- Placement: none created yet for this destination
- Channel authorization: NOT CONFIGURED — no LinkedIn integration exists in this codebase
- Idempotency result: n/a (no placement, no prior claim)
- Decision: BLOCKED — placement_missing, then channel_auth_missing once created
- Blocking reason, if any: surface adaptation itself is not the blocker here; the placement still needs to be created through the approved system path, and no LinkedIn API credential/integration exists
```

## 10. Implementation plan

No day estimates; acceptance criteria per lane instead.

### Reusable now (Tier 1, live on `origin/main`, zero further work needed)

- The entire evidence/claim/authorization data layer: `content_placements`, `publication_receipts`, `publication_placement_claims` + RPC, `standing_publishing_authorizations`, `publication_artifacts`/`_validations`.
- **Acceptance:** none — already shipped and load-bearing in production.

### Code changes needed (no migration required)

1. **Promote the Tier-2 branch** (`feat/publication-operator`) through this codebase's normal PR review, or re-derive the equivalent functionality directly on current `origin/main` if a fresh review prefers that over merging a now-stale branch (it predates 93 commits' worth of `origin/main` history, including the client-notification-choice and DRG-content-studio-14-deliverables merges — a rebase/conflict pass is a real, non-trivial step, not a formality).
   - **Acceptance:** the existing 117 targeted tests plus the full suite pass against current `origin/main` HEAD; the manifest/preflight-status/adapter modules are re-verified to still return the exact same category for the §3 worked example (`channel_auth_missing`, once that category exists — see next item).
2. **Extend the 7-way `PreflightStatusCategory`** to the 12-state machine in §5 (adds `qa_or_legal_gate_missing`, splits `live_asset_missing` and `placement_missing` and `channel_auth_missing` and `receipt_contract_missing` out of the current `blocked_content`/`blocked_missing_configuration` buckets).
   - **Acceptance:** every existing Tier-2 test that currently asserts `blocked_content` or `blocked_missing_configuration` for a scenario now covered by a more specific state is updated to assert the more specific state, with zero loss of the fail-closed default (an unrecognized reason must still fall into the most conservative bucket, not silently become `ready`).
3. **Wire `content_pieces`/`content-studio-gates.ts` awareness into the manifest loader** so `qa_or_legal_gate_missing` is actually detectable for Content-Studio-originated deliverables (§4A's stated gap).
   - **Acceptance:** a fixture piece with a failing validation run and an otherwise-approved deliverable resolves to `qa_or_legal_gate_missing`, not `ready`.
4. **Implement `resolve_surface_presentation_adaptation`** (§4.1a, DR-105) as a manifest-loader step: given the release version's `source_surface` and a placement's `destination_surface`, read `docs/publication-operator/surface-presentation-adaptation-registry.md` (or, once ported to structured data, the equivalent runtime table) and return one of the five named outcomes. Wire the two blocking outcomes into the preflight-status taxonomy alongside `qa_or_legal_gate_missing`.
   - **Acceptance:** a fixture placement with `destination_surface = linkedin_native_article` and `source_surface = website_article` for a DRG, en-CA deliverable resolves `surface_adaptation_resolved` against the one registered rule; the same fixture with `locale = pt-BR` resolves `surface_adaptation_rule_missing`; a fixture requesting a rendering change outside the rule's `allowed_output_changes` resolves `substantive_adaptation_requires_approval`; no code path reachable from this step generates, drafts, or paraphrases wrapper text under any input.

### Migration-dependent work (must wait for freeze remediation)

- Review and apply `publication_destination_configs` exactly as drafted, or as amended per §8's open question.
  - **Acceptance:** the migration passes whatever the freeze-remediation process (the separate, already-in-flight migration-lineage workstream referenced in project memory) requires before any migration is applied to `ssxryjxifwiivghglqer` again; `destination_unconfigured` becomes independently resolvable for non-website destinations once a firm's operator configures one.
- The permitted-content-roles column, if the data-engineer decision in §8 lands on "yes."

### External integration / credential work

- LinkedIn OAuth + posting API client (closes `channel_auth_missing` for `linkedin_post`/`linkedin_article`/`linkedin_company_page`).
- Google Business Profile API client (closes it for `google_business_profile`).
- A real website-deploy integration, if the operator ever wants `firm_website` to move past "manual `vercel --prod`, evidence registered after" (not required for `firm_website` to reach `eligible_to_publish` today — that destination's whole model already assumes a human deploy).
- The GHL social-media-posting surface noted in §4E, as an evaluation, not a commitment.
  - **Acceptance per channel:** a real OAuth grant exists, scoped to the specific firm-owned account (never the operator's personal account, per the doctrine's explicit prohibition), and the adapter's `execute()` for that one destination value is implemented and reviewed as its own, isolated, human-watched change — never bundled with an unrelated destination's integration.

### Channel-specific pilot tests

- Per §7A's promotion criteria, run one real, human-watched end-to-end cycle per destination value before that value may be considered for autonomous release.
  - **Acceptance:** the resulting `publication_receipts` row reaches `verification_state = 'verified'`, and the preflight, re-run after, correctly reports `already_published` rather than `ready` (proving the idempotency rule actually holds against a real receipt, not only a fixture).

### Production rollout gates

- No channel moves to autonomous release without the separate, explicit, human-reviewed scope proposal §7A requires.
- Standing publishing authorization remains a firm/lawyer decision throughout; this design changes nothing about who may enable it.
- This document itself is not a rollout — it is the design the rollout, when proposed, should be checked against.

## 11. Verification

- **No code, migration, schema, environment, production-data, or deployment change was made** while producing this document. Every data-facing fact was gathered with read-only `SELECT`/`list_tables` calls; every code-facing fact was gathered with read-only `git` inspection (`ls-tree`, `cat-file -e`, `diff --stat`, `log`) against `origin/main` and existing worktrees, never a checkout, branch switch, or file edit outside this one new document.
- **Confirm only documentation files changed:** exactly one file was created — this document, `docs/publication-operator/publication-resolution-preflight-design-2026-07-19.md`. Nothing else in the repository was touched.
- **Exact source files/tests examined** (read, not modified): `docs/PUBLICATION_READINESS_OPERATING_MODEL.md` (confirmed on `origin/main`, both its stale locally-checked-out v1 and the current v3 were diffed); a same-day historical reconciliation report for this deliverable's period (historical reconciliation evidence is not yet committed to `origin/main` and is not relied on as an implementation dependency for this design); `docs/PUBLICATION_OPERATOR_ARCHITECTURE.md`, `docs/runbooks/publication-operator-runbook.md`, `docs/reconciliation/publication-operator-dry-run-founder-vesting-2026-07-18.md` (branch `feat/publication-operator`, pending publication); `src/lib/publication-execution-manifest.ts`, `publication-preflight-status.ts`, `publication-placement-claims.ts` (same branch, partial reads, exported-symbol greps for `publication-adapter.ts`, `content-placements.ts`, `publication-receipts.ts`, `standing-publishing-authorization.ts`); `supabase/migrations/20260715191218_20260715130100_content_placements.sql`, `20260715191243_20260715130200_publication_receipts.sql`, `20260718121500_publication_destination_configs.sql` (same branch); `CLAUDE.md` (both the stale local-checkout copy and the `feat/publication-operator` branch's copy, for the Ses.16–Ses.21 build-roadmap history); test-file and route-file listings via `find`/`grep` under the `feat/publication-operator` branch. Production database facts: `list_tables` against `ssxryjxifwiivghglqer`; two `SELECT` queries against `content_placements` and `content_deliverables` for the exact case-study deliverable.
- **Every assumption requiring a later database-engineer, operator, or channel-owner decision**, collected from throughout this document:
  1. Whether `publication_destination_configs` should carry a permitted-content-roles field (§8).
  2. The exact review process by which the Tier-2 branch gets promoted — merge-as-is vs. rebase vs. re-derive on current `origin/main` (§10).
  3. Whether the GHL social-media-posting surface is a real integration path for LinkedIn/GBP, worth a dedicated evaluation (§4E, §10) — not investigated beyond noting its existence.
  4. The exact scope (destinations, firms, volume ceiling) of any future autonomous-release authorization — this document defines the bar for proposing it, not the proposal itself (§7A).
  5. Whether/when the `publication_destination_configs` migration can be applied at all, which depends entirely on the separate, already-in-flight migration-lineage freeze-remediation process this document does not own or advance.
