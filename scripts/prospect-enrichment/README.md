# Prospect enrichment compiler and delivery tools

This lane implements local inventory, lossless compilation, offline receipt reconciliation, fixed pilot selection, and a durable staging outbox. It does not approve/apply canonical evidence, alter the active researcher, or select prospects for outreach.

All fixtures are synthetic. Tests make no live HTTP calls.

Run from the feature repository root:

~~~powershell
node --import tsx --test scripts/prospect-enrichment/__tests__/*.node-test.ts
node node_modules/vitest/vitest.mjs run --config scripts/prospect-enrichment/vitest.lane.config.ts
node node_modules/typescript/bin/tsc --project scripts/prospect-enrichment/tsconfig.lane.json --pretty false
node --import tsx scripts/prospect-enrichment/cli.ts help
~~~

The tool shares the actual protocol validator/hash functions and buildProspectEnrichmentClientItems lineage builder in src/lib. Transport client item IDs are src:<sourceId>, obs:<observationId> and assessment:<assessmentId>; the original immutable IDs remain unchanged inside envelopes. Store, manifest and reconciliation outputs must match byte for byte. package.json and CI registration remain root-owned.

## Offline workflow

1. Run inventory to freeze only the two plan-allowlisted source roots into the private D: archive. The output root is fixed to D:\00_Work\01_CaseLoad_Select\07_Prospects\Prospect_Enrichment_Backfill_2026-09-23_v1. No source is modified or locked. Mutable files, unsupported containers, malformed lines, missing references and out-of-scope references remain explicitly accounted for.
2. Run compile --manifest FILE --run-dir DIR against that frozen archive. It creates candidate-index, normalized-packages, validation-errors, identity-reconciliation, coverage-report and RUN_REPORT. Raw candidate data stays out of Git. Later receipt/action/read-back artifacts are created only when they contain actual results.
3. Obtain a fresh authenticated, read-only operator comparison from the root-owned supported reader. Run reconcile --export-comparison --file FILE --output FILE to verify and freeze that exact server-signed reader result with a full canonical snapshot SHA in a new private run artifact. The serializer validates the complete shape and preserves null visibility; it cannot authenticate a local assertion or replace the reader with database DML.
4. Run reconcile --packages FILE --snapshot FILE --output FILE. Use a new output file for each comparison. Local receipt claims without actual receipt/event matches remain receipt_unverified.
5. Run pilot --packages FILE --actions FILE --output FILE after reconciliation. Exactly two ordinal researchKeys from Identity, Qualified, Held, Rejected and Incomplete are required. Historical assessment disagreements remain explicit; no newest-filename shortcut or category substitution is allowed.
6. Run compile --manifest FILE --actions FILE --run-dir NEW_DIR in a new private output directory to freeze final reconciled identity/link metadata. This requires complete action coverage and unchanged original research/event hashes. Use this final normalized-packages file and expected-run-manifest-chunks file for pilot/approval/delivery; the first unresolved compilation must not be registered. Obtain the exact pilot/backfill authorization with both source and run manifest hashes and the final package hashes.
7. Run enqueue --file FILE --outbox DIR for the final reviewed envelope. This only writes a local immutable request and state. Rerunning it with different content at the same key fails.
8. submit --manifest-chunks FILE --snapshot FILE and receipt are dry-run unless --execute is supplied. submit also requires the exact approval-file SHA-256, source/run manifest hashes, package hash allowlist, fixed production origin/project, manifest run match and confirmation SUBMIT-APPROVED-PROSPECT-RESEARCH. Dry-run validates the fresh comparison, complete inventory and selected queued package without reading a token or making a request. The comparison must be at most 15 minutes old; submit checks it immediately before the first manifest request and again before the package POST. Missing/stale comparisons fail closed with missing_snapshot/comparison_stale. Executed submit uploads all chunks sequentially with finalize:false, then replays the exact final chunk with finalize:true. Only an exact finalized receipt with every expected chunk/entry/package count permits package staging.

Original source bytes and protocol-canonical hashes are different. IDs for source observations/assessments exclude enclosing file, manifest, run and transport timestamps. Package IDs use pe- plus the full protocol hash of [adapterVersion, runId, sourceSha256, sourcePointer, originalAssessmentIdOrPointer]. This makes frozen-manifest retries stable while allowing a later run to retain separate package provenance without duplicating source events.

The compiler does not resolve a claimed UUID/stable identity by itself. It sets unresolved/conflict until fresh operator comparison supplies one matching identity. Unmapped leaf paths use RFC 6901 escaping and remain navigable in originalResearch.

Multiple original assessments create separate envelopes. Only explicitly linked findings/sources join an assessment; remaining findings are emitted in a null-assessment envelope. Sources may be empty. Unknown historical outcomes and retrieval data stay unknown. Entire originals remain available even when schema/size limits prevent a transport envelope. An opportunity without an explicitly recorded high/medium/low confidence remains only in originalResearch/unmappedPaths with opportunity_confidence_not_recorded; the adapter never invents a confidence rating.

compile also creates expected-run-manifest.json and expected-run-manifest-chunks.jsonl. Each expected entry includes nullable package/hash/identity for source or schema holds, complete item IDs/hashes for compilable packages and exact source provenance. Chunks default to 100 entries and 1 MiB, with total counts and independently verified hashes. These files are prepared offline. The existing submit command handles authorization-bound registration through POST /api/internal/prospect-enrichment/runs/manifest-chunks using {chunk, finalize}; the server remains root-owned. No generic RPC/database write fallback exists.

## Operator comparison export shape

The root reader/export integration supplies:

~~~typescript
type ComparisonSnapshot = {
  schemaVersion: "prospect-enrichment-comparison/v1";
  projectId: "ssxryjxifwiivghglqer";
  capturedAt: string;
  provenance: {
    reader: string;
    sourceArtifactSha256: string;
    operatorAuthenticated: true;
  };
  identities: {
    researchKey: string;
    databaseFirmId: string;
    stableFirmId: string | null;
    sourceRecordKey: string;
    canonicalDomain: string | null;
  }[];
  packages: {
    clientPackageId: string;
    payloadSha256: string;
    state: string;
    serverPackageId: string;
    visible: boolean | null;
  }[];
  events: {
    sourceEventKey: string;
    semanticSha256: string;
    researchKey: string;
    targets: { table: string; id: string; rowSha256: string }[];
    primaryTarget: { table: string; id: string; rowSha256: string } | null;
    visible: boolean | null;
  }[];
  currentAssessments?: { researchKey: string; clientAssessmentId: string }[];
  snapshotSha256: string;
  signature: {algorithm:"Ed25519";keyId:string;signatureBase64:string};
};
~~~

Every event requires primaryTarget. It is null when the reader cannot prove a primary row; otherwise it must equal exactly one target, including table, id and row SHA. Target order never selects a row. Accepted events with visible null (unknown/read failure) or false (known absent) both produce receipt_unverified with distinct reasons and clear prior existingRecord linkage. Source captures, mappings, audit, core and registry rows cannot substitute for an observation/assessment primary. The primaryTarget field participates in the full snapshot hash.

The server signing serializer input is this object without snapshotSha256 and signature; the local CLI accepts the complete already signed object. Unknown fields or absent required/null fields fail validation instead of being silently dropped. The exported artifact is detached, canonical JSON with one terminal newline; bodySha256 covers those exact file bytes. snapshotSha256 hashes the content excluding snapshotSha256 and signature. The comparison is valid for 15 minutes and must be regenerated immediately before delivery. When a candidate has different historical dispositions, currentAssessments must identify the accepted current assessment explicitly using its assessment:<assessmentId> transport client item ID. The pilot includes all history but uses that exact assessment for its category. The server signature must verify against the explicitly configured trusted Ed25519 public key; the unkeyed provenance fields alone have no authority.

For historic criteria with no separate contact/tag/roster row, link the original gta_prospect_qualification_assessments assessment. The derived projections receive retain-only reason already_preserved_in_linked_legacy_assessment. Nothing creates a duplicate typed row to make a linkage possible.

## Staging approval input

The approved execution record has schemaVersion prospect-enrichment-delivery-approval/v1, scope pilot or backfill, targetOrigin https://admin.caseloadselect.ca, projectId ssxryjxifwiivghglqer, sourceManifestSha256, runManifestSha256, a real approvalReference and packages [{ clientPackageId, payloadSha256 }]. The operator provides its exact file hash to --approval-sha256. This file records the user's approval; creating such a file does not itself authorize staging.

The bearer token is read from --token-file only at execution time. It is never printed, serialized to the outbox, or sent to another origin. Redirect following is prohibited. Agent receipt reads expose only transport metadata, never a claim of visual Admin verification.

Each package delivery and pending manifest request makes at most one bounded 20-second attempt per invocation. Manifest requests run sequentially and stop at the first retry/manual-review state; received receipts are reverified locally on resume. It records nextAttemptAt instead of sleeping. Retryable outcomes are network timeout, 429, 502, 503 and 504. Delays are 5/30/120/600 seconds, at most five total attempts, and a larger valid Retry-After wins. 400/401/403/409/413/422 and unrecognized errors stop for review. Lost responses replay the exact body and idempotency key. Manifest requests and receipts persist under outbox/manifests/RUN_MANIFEST_SHA; neither registration nor its finalized receipt means canonical evidence was applied or visible.

The outbox submission.lock enforces one running delivery invocation. If the process is terminated while it owns the lock, inspect the recorded owner and confirm that process has stopped before removing that exact stale lock; no automatic lease stealing is implemented. Preserve all package/state/receipt files. This is a deliberate fail-closed recovery limit, not evidence that a package was submitted.

## Current integration requirements

- Register these test commands in root-owned CI/package scripts.
- Connect the supported authenticated operator reader to the comparison export shape above.
- Operator review consumes link/retain metadata from backfill-actions; this tool does not bypass protected review.
- Actual delivery/backfill and active-research cutover remain unexecuted until the specific approvals.

## Whole-firm continuous profile

Use --profile whole-firm for future frozen whole-firm snapshots. This uses its own source system, private output root, run identity and whole-firm-run approval schema. Read WHOLE_FIRM_COORDINATOR_PROFILE.md for the exact input, snapshot/package formulas, all-candidate coverage, zero-package hold registration, command sequence and coordinator cutover dependency. Legacy backfill remains the default profile.

The offline raw coordinator adapter is now available through inventory --profile whole-firm --coordinator-state PATH. This input is mutually exclusive with --file. It reads the exact persisted state and declared references, archives original bytes, fails if a source changes, and emits the existing whole-firm standard export. It does not execute coordinator scripts or modify active state. See WHOLE_FIRM_COORDINATOR_PROFILE.md for fixed paths, mappings, holds and the remaining activation gate.

## Exact legacy assessment projection proof

A linked parent assessment does not account for any unmatched child observation by itself. Compilers emit optional `legacyAssessmentProjectionClaims` metadata only for observations mapped from that original assessment's nested criteria. Each claim identifies `observationId`, `parentAssessmentId`, the exact `originalResearch.content` `sourcePointer`, an RFC 6901 `criteriaSelector` rooted at `/criteria/...`, and `selectedValueSha256`. Explicitly linked observations outside those criteria never receive an inferred projection claim.

The authenticated comparison parent event may include `legacyAssessmentProjections`. Every entry has exactly `observationSourceEventKey`, `observationSemanticSha256`, `parentAssessmentClientId`, `parentAssessmentTarget`, `databaseFirmId`, `criteriaSelector`, and `selectedValueSha256`. The entire array participates in `snapshotSha256`. The parent target must equal the event's proven primary target, and the parent client ID must generate that exact parent source event key. Parent visibility must be exactly true and the resolved database firm must match before retention.

The pure `deriveLegacyAssessmentProjection` helper replays the pinned compiler twice: once from unchanged original research and once from the same assessment with stored criteria substituted. Both must recreate the exact normalized child lineage key/hash. This detects changed source/date and changed sibling context even if the selected scalar/object itself still matches. The server independently reads the exact assessment row and verifies firm, full row hash, complete Admin visibility, and selected value hash; local compiler metadata has no authority to assert acceptance.

Only one exact proof yields `already_preserved_in_linked_legacy_assessment`; the observation remains retain-only with `existingRecord:null`. Missing, ambiguous, mismatching or incomplete proof leaves partial accepted history `receipt_unverified`. New staging remains possible only when the fresh comparison contains no accepted claim and the source does not claim prior persistence.

## Offline comparison request

Both `compile` profiles now write `comparison-packages.json` alongside `expected-run-manifest.json`. The package file is a complete JSON array, with exactly `{envelope,payloadSha256,legacyAssessmentProjectionClaims}` per package. JSONL and partial package selections are rejected. Projection claims remain outside the immutable protocol envelope.

Run `node --import tsx scripts/prospect-enrichment/cli.ts comparison-request --manifest <RUN_DIR>/expected-run-manifest.json --packages <RUN_DIR>/comparison-packages.json --output <RUN_DIR>/comparison-request.json`. Add `--profile whole-firm` for a whole-firm run. RUN_DIR must be inside the selected profile's fixed private D: root. This command is strictly offline; token, execute, approval and submission flags are rejected. It creates one new file and refuses to replace an existing destination.

The request is exactly `{schemaVersion:"prospect-enrichment-comparison-request/v1",manifest,packages}` for the protected `POST /api/admin/prospect-enrichment/comparison-export` operator read route. Local validation checks the full frozen manifest hash and entry schema, every expected package exactly once, profile/run identity, payload hashes, shared item lineage and original criteria claim references/hashes. Limits match the route: 10000 manifest entries, 1000 packages and 16 MiB. Package-less held/incomplete entries remain in the manifest.

The writer verifies the private output directory ancestry, writes and flushes a same-volume temporary file, rechecks both original input byte streams, and atomically links to a new destination. Its output reports the full body SHA and `networkRequests:0`. Authentication, actual protected export and a fresh comparison read remain separate steps; this artifact does not authorize a delivery or claim synchronization.

An observed event with `visible:false` or `visible:null` always produces `receipt_unverified`, including events whose target list is empty. Missing stored events must be omitted from the authenticated comparison; an explicit unknown event is never interpreted as permission to stage new evidence.

## Signed comparison provenance and package states

Every comparison snapshot requires `signature:{algorithm:"Ed25519",keyId,signatureBase64}` from the protected server reader. The server passes `{keyId,privateKeyPem}` explicitly to `serializeComparisonExport`; absent signing configuration fails closed. This scripts lane neither generates production keys nor configures server secrets.

The verifier trusts only the explicit local settings `PROSPECT_ENRICHMENT_COMPARISON_TRUSTED_KEY_ID` and `PROSPECT_ENRICHMENT_COMPARISON_TRUSTED_PUBLIC_KEY_PEM`, or an explicit typed `{keyId,publicKeyPem}` argument. The PEM must be an Ed25519 public key. Missing configuration, unknown key IDs, invalid signatures and unsigned artifacts cannot authorize reconciliation or delivery. Do not copy a key from the untrusted snapshot, infer trust from its key ID, fetch replacement keys automatically, or treat `operatorAuthenticated:true` as proof.

Signed bytes are UTF-8 canonical protocol JSON of `{domain:"caseload-prospect-enrichment-comparison-signature/v1",algorithm:"Ed25519",keyId,snapshot}`, where `snapshot` contains every snapshot field including `snapshotSha256` but excludes `signature`. The signature is detached Base64 (exactly 64 decoded bytes); `snapshotSha256` separately hashes content excluding both `snapshotSha256` and `signature`. The domain and key ID are signed. Recomputing the public content hash after editing any content cannot recreate the signature. Freshness remains a separate maximum-15-minute requirement.

The local `reconcile --export-comparison` command only verifies and reserializes an already signed server artifact using `verifyAndSerializeComparisonExport`. It has no signing flag or private-key path and cannot turn a local reader claim into trusted provenance. Key rotation requires an explicitly configured replacement trusted key; unknown keys stop the run.

Package reconciliation is exhaustive: `received`, `identity_hold`, `evidence_hold` and `ready_for_review` are resumable and may return `reuse_existing_draft`; `applied` requires explicit visibility (`true` -> `verify_existing`, `false` -> `presentation_gap`, `null` -> `receipt_unverified`); `rejected` and `superseded` return `hold_terminal`; unrecognized persisted states return `hold_schema`. Duplicate current package records return `receipt_unverified`. Terminal/unknown holds clear stale linkage and never authorize a new import.
