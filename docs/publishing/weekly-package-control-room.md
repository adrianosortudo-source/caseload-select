# Weekly Package Control Room

Status: built (schema + manifest engine + all 5 tabs + gateway export/dry-run + manifest creation + preflight persistence), not deployed, migration not applied anywhere. See "Known limits" at the end.

## Product purpose

A permanent, period-level workspace that centralizes one firm's weekly content package: the complete set of pieces, every required visual asset, candidate images, selected/rejected/superseded state, destination renditions, hashes, portal bindings, direct-PDF requirements, QA evidence, approval state, and release readiness -- as one view of a validated manifest, not a manually maintained parallel list. It sits on top of the existing Publishing Package Gateway (the narrow hero-image upload/bind endpoint) and existing content-approval system; it does not replace or duplicate either.

## Data model

Four tables (migration: `supabase/migrations/20260723120000_publishing_package_control_room.sql`):

- **`publishing_packages`** -- one manifest per firm+period+revision. Carries `expected_piece_count` (never hardcoded per-firm in application code -- DRG's weekly package is 16, but this column is what any firm's package validates against), `status`, and the full validated manifest JSON.
- **`publishing_package_assets`** -- one row per candidate, canonical master, rendition, PDF, or QA-evidence asset. 9 asset roles, 13 statuses (`approved` is deliberately never a valid value here -- that word is reserved for the existing content-approval system).
- **`publishing_package_events`** -- append-only audit log + gateway receipts. A Postgres trigger (reusing the existing `block_append_only_mutation()` function) blocks UPDATE/DELETE outright; a genuine correction inserts a new row.
- **`publishing_package_checks`** -- normalized preflight/QA results.

Access model: RLS enabled + forced, all direct anon/authenticated/PUBLIC access revoked, zero `CREATE POLICY` statements -- matching this codebase's established convention (`standing_publishing_authorizations`, `publication_receipts`). Operator/lawyer/gateway-credential authorization is enforced entirely at the Next.js route layer against a service-role client, the same way every other portal table in this codebase works.

## Route map

```
/portal/[firmId]/deliverables/periods/[periodId]                  Overview
/portal/[firmId]/deliverables/periods/[periodId]/content           Content
/portal/[firmId]/deliverables/periods/[periodId]/assets            Assets
/portal/[firmId]/deliverables/periods/[periodId]/review             Review
/portal/[firmId]/deliverables/periods/[periodId]/release            Release (operator-only)
```

All five share one layout (`layout.tsx`) that gates the session and renders `PeriodTabNav`. Entry point: an "Open Package Control Room" link on each period's header in the existing `ContentPlan` component.

## Manifest schema

Defined in `src/lib/publishing-package-control-room-manifest.ts`. Top level: `schema_version`, `firm_id`, `period_id`, `expected_piece_count`, `revision`, `pieces[]`. Each piece carries `content_slot_id`, source deliverable/version, `reader_title`, `format_family`, `locale`, `destination`, `body_relationship`, `required_assets[]`, `cta`, `pdf_asset_id`, `placement_status`, `approval_status`. Each required asset carries `asset_role`, `locale`, `destination`, required dimensions, `text_policy`, `overlay_language`, `safe_area`, `required_copy`, `selected_asset_id`.

Validated by hand-written pure TypeScript functions (no Zod, no other schema library was added -- this repo doesn't have one and the build was explicitly scoped not to add one). Every violation is collected in one pass, never just the first. Sections 8 and 17 of the original build spec describe the same rule set from two angles and were implemented as one merged validator, not two.

## Asset roles

`website_article_hero`, `native_linkedin_article_cover`, `linkedin_post_card`, `gbp_card`, `lead_magnet_document_hero`, `lead_magnet_landing_page_hero`, `canonical_textless_master`, `pdf_document`, `rendered_qa_evidence`.

## Status state machine

`required` -> `missing` | `candidate` -> `visually_selected` -> `hash_verified` -> `uploaded` -> `bound` -> `rendered_verified` -> `release_ready`, with `blocked`, `rejected`, `superseded`, `not_planned` as terminal/side states reachable from most points. Visual selection (`visually_selected` / `is_selected`) is a strictly weaker claim than release-readiness -- every surface that shows a selected candidate also carries an explicit disclaimer saying so (see "Permissions" below for exact wording).

## Locale rules

Exactly two supported locales: `en-CA`, `pt-BR`. A required asset's `locale` must match its piece's locale. A text-bearing asset's `overlay_language` must match the piece's locale (`en-CA` -> `en`, `pt-BR` -> `pt`) -- an EN overlay on PT content (or vice versa) is a hard validation failure, not a warning.

## Lead-magnet direct-download rules

A lead-magnet piece's CTA must have `behavior: "download"` and must never target the portal's Files hub (`/files/...` in any form, root-relative or absolute -- checked by `targetsFilesHub()`, shared between the manifest validator and the Overview/Release computations so the three surfaces can never disagree about what counts as a blocker). The DRG fixture's exact required labels: `Download the Renewal Clause Checklist (PDF)` (EN) / `Baixe o Checklist da Cláusula de Renovação (PDF)` (PT).

## Permissions

- **Operator**: full read/write across all 5 tabs, all candidate/hash/receipt detail, all action buttons (register, upload, select, reject, supersede, bind, record verification, export, dry-run).
- **Lawyer/client**: Review tab only shows reader title, the selected visual's filename, locale, destination, source content status, and existing approval/release status. Rejected/superseded candidates, storage keys, asset ids, and sha256 hashes are stripped entirely (`filterPackageForViewer`, verified by asserting their absence from the serialized lawyer payload, not just by not-rendering them). Every lawyer-facing surface that shows a selected visual carries: *"Reviewing or preferring an image does not approve, publish, replace, or authorize the related content."* The asset detail drawer's candidate-comparison section carries: *"Visual selection does not approve the content, authorize publication, or confirm release readiness."*
- **Gateway credential**: reaches only its own narrow endpoint (`POST /api/publishing-agent/hero-package`); cannot read or mutate these tables through a general API; cannot approve, change status, place, or notify.

## Gateway integration

`src/lib/publishing-package-gateway-export.ts` builds the gateway's own hero-binding manifest shape from Control Room data. Eligibility for export: `is_selected === true`, status in `hash_verified` or `uploaded` (not yet `bound`), role is exactly `website_article_hero` (the only role the gateway binds -- it writes only `content_deliverables.hero_image_url`), and the piece's `deliverable_id` is resolved. Excluded: rejected, superseded, missing, already-bound, PDFs, every other role, unresolved-deliverable pieces. The built manifest is re-validated with the gateway's own `validatePublishingPackageManifest` -- export fails closed if that validator itself would reject it, not just when this module's own filter would.

`runAssetBindingDryRun()` re-validates and re-checks eligibility with zero network calls and zero writes. Real binding still only ever happens through `scripts/publishing-bind-heroes.mjs` (the gateway's own CLI, run outside the portal) -- this portal code never shells out to it and never calls the gateway endpoint directly. That boundary is deliberate: the gateway's own auth-boundary test statically proves its credential can't reach any other code path, and this build does not create a second, portal-side path around that proof.

Exclusion reason codes: `not_selected`, `rejected`, `superseded`, `missing`, `already_bound`, `unsupported_role`, `deliverable_not_resolved`, `not_hash_verified` (a selected `website_article_hero` whose status hasn't yet reached `hash_verified`/`uploaded` -- distinct from `unsupported_role`, since the role is fine, the pipeline stage isn't there yet).

## Events and receipts

Section 18's full receipt field set (operation id, package/period/firm/slot/deliverable/source-version/asset ids, filename, role, destination, locale, expected+computed hash, previous+resulting binding, actor, timestamp, outcome, failure reason) is built by `src/lib/publishing-package-events.ts`'s `buildEventReceipt()` and is append-only at the database level (a trigger blocks UPDATE/DELETE). Wired to real mutations: `registerCandidate`/`selectCandidate`/`rejectCandidate`/`supersedeCandidate`/`createPackageManifest`/`runPackagePreflight` (`src/lib/publishing-package-control-room-mutations.ts`) each append exactly one event after their single write (two for `runPackagePreflight` when every piece passes -- `package_preflight_run` then `package_release_ready`), in that order -- guard/validation failure returns before any write, a receipt-append failure after a successful write is reported as its own distinct error rather than silently dropped. Every mutation populates the receipt fields it actually knows (filename/role/destination/locale/hashes from the loaded or supplied row) rather than leaving knowable fields null.

`createPackageManifest` is the activation path: validates the pasted manifest with the same `validatePackageManifest` every other surface trusts, cross-checks the manifest's own `firm_id`/`period_id` against the route's params (an operator can't paste another firm's manifest into this period even if it's internally valid), confirms the period exists, and inserts the next `manifest_revision`. Exposed via `POST .../package-manifest` and a `CreateManifestPanel` shown on the Overview tab's empty state, operator-only, a JSON textarea (not a file upload).

## Preflight gates

`src/lib/publishing-package-control-room-release.ts` computes 4 gates per piece: Editorial (source/version, locale, content approval, EN/PT pairing), Asset (required-present, hash-verified, uploaded, bound, not-blocked), Experience (rendered-verified, CTA present, no Files-hub CTA, correct CTA behavior), Publication (content approval, standing/individual authorization, destination identity, channel auth, placement, receipt). Every failure carries an exact `reasonCode` (e.g. `files_hub_cta`, `asset_not_bound`, `content_not_approved`). The Release tab is read-only -- there is no Publish button anywhere in this build, and every instance carries: *"HTTP success, passing tests, asset upload, visual selection, and portal rendering are not approval or publication authorization."*

Publication-gate inputs (authorization, destination identity, channel auth, receipt state) are populated by `loadPublicationInputs()` (`src/lib/publishing-package-control-room-loader.ts`) -- one implementation, called by both the Release page and the preflight-persistence mutation, never reimplemented twice. `standingAuthorizationActive` comes from `getStandingAuthorizationState()`. `approvedByDeliverableId` and `receiptsByDeliverableId` are per-piece override maps built from `content_deliverables` (`status`/`approved_version_id`) and `listCurrentReceiptsByPlacementForDeliverable()`. `destinationIdentityConfirmed` and `channelAuthenticated` stay package-level `false` -- no per-piece or firm-wide source for either exists anywhere in this codebase yet, so those two checks fail closed rather than guess.

**Persistence:** `runPackagePreflight()` runs the same 4 gates (via the pure, independently-tested `buildPreflightCheckRows()`) and writes every individual check to `publishing_package_checks` (one batched upsert, `onConflict` on the table's own unique key). **Dedup key:** `(package_id, content_slot_id, asset_scope, check_key)` -- deliberately NOT `asset_id`. `asset_id` is nullable, and Postgres treats NULL as distinct from NULL inside a UNIQUE constraint, so a nullable column in the conflict target would make every preflight run's piece-level checks look like brand-new rows instead of updates to the same row -- duplicates would accumulate on every click of "Run preflight" instead of upserting in place. `asset_scope` is a never-null discriminator column (`'piece'` for every check in this build; a future asset-scoped check would set it to the asset's own id) that makes the conflict target deterministic. This was found and fixed by an independent audit before the migration was ever applied. Severity mapping: a failing Asset or Publication check is `critical` (these two gates are the ones that actually block a real release); a failing Editorial or Experience check is `high`; every passing check is `informational`. It then sets `publishing_packages.status` to `release_ready` (every piece passes) or `release_blocked`, and appends `package_preflight_run` (always) plus `package_release_ready` (only when every piece passes). Exposed via `POST .../package-preflight-run` (loads the package once, passes it straight through to `runPackagePreflight`'s optional `preloaded` argument -- one query, not two) and a "Run preflight" button on the Release tab -- present only on the real route (`canRun`), never on the fixture preview, which stays strictly read-only since it has no database to persist to.

**Deliberately not built:** a portal-side "mark hash_verified" action. Hash verification means recomputing a hash from real file bytes; the portal has no bytes (no storage integration), so a button here would be an evidence-free rubber stamp -- exactly the "hash-mismatched asset marked verified" failure Section 17 requires to fail closed. Hash verification stays on the gateway/CLI path (`scripts/publishing-bind-heroes.mjs`) only.

## Operator workflow

For a period with no package yet: Overview's empty state -> paste a manifest into `CreateManifestPanel` -> package created in `draft` status. Then: Overview -> spot a missing/blocked piece -> Content tab for inventory context -> Assets tab, filter to the relevant role/locale, open the Asset Brief Builder for any missing requirement (Copy brief / Download brief as JSON) -> register/select/reject/supersede candidates (wired to real operator-only API routes -- see "Known limits" for what's still disabled) -> Release tab, "Run preflight" to persist check results and update package status -> see exactly which gate and reason code is still failing -> Export manifest / run dry-run once genuinely ready.

## Lawyer/client workflow

Review tab only: see this week's pieces, their selected visual, and existing content approval/release status. No upload, bind, select, reject, supersede, export, or release-mark controls are ever rendered for this role.

## Non-goals

- No external publishing in this feature.
- No second approval system.
- No generic file upload.
- No browser-cookie automation.
- No direct database workflow.
- No image generation provider.
- No CSB screenshot storage.
- No hardcoded DRG-only shared logic.

## Known limits

1. **Migration unapplied, never test-applied.** No local Postgres or Docker is available in this build environment, so the migration was written and reviewed carefully but never actually run against any database, local or remote. It must be applied and independently reviewed before any real data flows through these tables.
2. **Register/select/reject/supersede/create-manifest/run-preflight/export/dry-run are wired to real operator-only API routes**, tested against a mocked data layer (8 route files, 38 route tests). **Upload via Gateway, Bind via Gateway, and Record rendered verification remain disabled** -- they need the deployed gateway credential and a real rendered-evidence pipeline, neither of which exists in this build. Hash verification is deliberately never built as a portal action at all -- see "Preflight gates" above. No end-to-end database test has run anywhere, because the migration is unapplied: a live click-through of Select against the real routes in this environment returns HTTP 500, not because the wiring is wrong, but because `supabase-admin.ts` throws at module load without real Supabase env vars -- the same root constraint that keeps the whole authenticated portal tree from booting here. The routes' own `requireOperator` auth-first ordering is proven separately by the mocked route tests, not by this live run.
3. **Route handlers are tested with a mocked mutations layer.** The mutations layer's own DB round-trips (`publishing-package-control-room-mutations.ts`) are untested until a live database exists -- see limit 1. Pure input-validation rules (alt text/filename/mime-type/byte-size/dimensions required, manifest firm/period cross-check) ARE tested, independent of any database, by mocking `supabaseAdmin.from()` to throw and proving each rejection happens before it would ever be called. The same applies to `buildPreflightCheckRows()` -- its dedup-key correctness (no two rows sharing `content_slot_id`+`asset_scope`+`check_key`) is proven at the pure row-builder level; the actual `ON CONFLICT` upsert behavior against a real `publishing_package_checks` table remains untestable until the migration is applied.
4. **The `asset_scope` column** on `publishing_package_checks` exists specifically so preflight persistence is idempotent (see "Preflight gates" above) -- every check this build writes uses `'piece'`. A future capability that scopes an individual check to one specific asset would set `asset_scope` to that asset's own id instead.
5. **10 named screenshots (Section 23) were not captured as image files** across four separate sessions -- the Browser pane was not displayed client-side in this environment in any of them. Verification used `get_page_text`, accessibility-tree reads, live click-simulated interactions (drawer open, filter toggles, inline forms, Select/dry-run/preflight against the real routes), and computed-style/overflow checks instead, across all 5 tabs, both roles, desktop and mobile. Structurally verified, not visually captured.
