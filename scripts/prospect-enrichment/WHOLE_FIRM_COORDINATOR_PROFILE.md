# Whole-firm coordinator profile

This is the fixed offline delivery profile for future whole-firm research. It is separate from the legacy backfill profile. Implementation is in this folder; the active whole_firm_coordinator.mjs has not been changed or activated.

## Fixed identity and source contract

Use --profile whole-firm on every command in this workflow. The default stays legacy-backfill. Whole-firm constants are sourceSystem caseload-whole-firm-v1, sourceName whole-firm-qualification, adapterVersion whole-firm-adapter/v1. Every output must be below:

D:\00_Work\01_CaseLoad_Select\07_Prospects\Whole_Firm_Enrichment_v1

The coordinator supplies one immutable UTF-8 JSON export with this exact minimum shape:

~~~typescript
type WholeFirmCoordinatorExport = {
  schemaVersion: "prospect-whole-firm-coordinator-export/v1";
  snapshotAt: string; // actual UTC export capture time; preserve it on retry
  expectedRevisions: { revisionId: string; researchKey: string }[];
  revisions: (
    | {
        revisionId: string;
        originalRevision: JsonValue;
        standardEnvelope: ProspectEnrichmentEnvelope;
      }
    | null
  )[];
};
~~~

The arrays use the same order and length. Include every revision in the declared frozen batch, regardless of qualified, held, rejected, incomplete, archived or retracted status. A missing revision occupies its declared position as null. A malformed revision remains its exact original JSON at that position. Do not delete a slot because it cannot compile. Every revisionId must be unique and every researchKey must be explicit and immutable. Do not replace a researchKey after identity resolution.

The coordinator export boundary must enumerate all candidate revisions before any status filter or package validation. For each persisted result, preserve its resultId/workKey, complete record, worker verdict, computed missing gates, evidence, source dates, research failures, receipts, submittedAt and original digest. The current coordinator digest is SHA-256(JSON.stringify(value)); preserve it as historical provenance and never label it a protocol hash. Candidates in the frozen batch without any completed result require an explicit inventory slot and their retained raw candidate record; absent standard envelopes become package-less holds. The export must retain the whole source inventory used to prove coverage. No quota/qualified-only list may serve as the export input.

The producer must provide one explicit standard envelope for each immutable revision. originalResearch.content must equal that exact originalRevision. If an existing candidate has separate assessment/history envelopes, export each as a separate immutable revision with its explicit original assessment/history context retained in originalRevision; do not duplicate identical raw revisions under different revisionId values and then select one. Identical raw content plus researchKey within one snapshot yields the same package ID, so the compiler holds all such conflicts for correction. Evidence may be assigned to an assessment only through recorded links; unassigned evidence has its own null-assessment revision. Preserve retractions in the raw revision and explicit envelope fields. Do not invent source, observation, opportunity confidence, retrieval outcomes or historical selection decisions.

The offline adapter now converts the raw coordinator contract into this standard export. Use inventory --profile whole-firm --coordinator-state PATH, mutually exclusive with --file. The producer is pure and the snapshot reader never invokes inspect/refresh, writes a claim/state/sidecar, releases a slot, calls a network endpoint, or accesses credentials. The remaining cutover dependency is the approved active coordinator invocation/continuation boundary, not an unavailable mapper. Do not activate that boundary during offline preparation.

inventory archives the exact export bytes before parsing them, checks that the input did not change during capture, and creates the canonical source manifest. Unknown extra input fields remain in originalExport. Invalid outer JSON/schema is retained in the byte archive but produces no deliverable manifest. No originalCoordinatorRunId is required or inferred.

Use the shared protocolHash (canonical JSON, full SHA-256) for:

~~~typescript
runId = "run-" + protocolHash([
  "caseload-whole-firm-v1",
  sourceManifestSha256
]).slice(0, 48);

packageId = "pe-" + protocolHash([
  "caseload-whole-firm-v1",
  runId,
  researchKey,
  protocolHash(originalRevision)
]);
~~~

These supersede older coordinator-ID or wf- formulas. The same frozen manifest resumes with identical run/package IDs. A changed export, snapshot time or inventory creates a different run and requires new exact approval. Source/observation/assessment IDs and event semantic hashes remain independent of the new run/package identity. Never regenerate snapshotAt during a retry.

## Exact preparation sequence

Run commands from the feature repository root. Use new immutable output filenames/directories for comparisons and final compilation. Do not overwrite a prepared snapshot or edit queued bodies.

1. For a prepared standard export run:
   node --import tsx scripts/prospect-enrichment/cli.ts inventory --profile whole-firm --file IMMUTABLE_EXPORT_FILE

   For the raw persisted coordinator state, the exact alternative is:
   node --import tsx scripts/prospect-enrichment/cli.ts inventory --profile whole-firm --coordinator-state "C:\Users\adria\OneDrive\Documentos\ChatGPT\CaseLoad Select\prospecting\Prospect_Qualification_DB_2026-09-21_v1\operations\luna_continuous_v1\control\whole_firm_state.json"

   Run only the input form authorized for this snapshot. Do not run either against real research as a test.

   Use the returned runDir and sourceManifestSha256. The exact byte archive is exports/RAW_EXPORT_SHA.json. The source manifest is runs/SOURCE_MANIFEST_SHA/source-manifest.json. All subsequent steps use that returned manifest; do not rescan the mutable research queue.

2. Run:
   node --import tsx scripts/prospect-enrichment/cli.ts compile --profile whole-firm --manifest SOURCE_MANIFEST --run-dir RUN_DIR/compiled-initial

   Verify coverage-report: expectedRevisionCount equals accountedRevisionCount. candidate-index retains every raw revision and original status. expected-run-manifest contains one entry per declared revision, including nonPackageHolds. All supplied identity claims begin unresolved unless already conflicting; fresh comparison must resolve them. Zero-source/assessment-only/raw-only packages remain evidence holds.

3. Obtain a real authenticated, read-only comparison from the supported Admin Prospects reader. Save the exact reader response privately, then:
   node --import tsx scripts/prospect-enrichment/cli.ts reconcile --profile whole-firm --export-comparison --file AUTHENTICATED_READER_RESULT --output RUN_DIR/comparison-initial.json

   Use the complete server-signed reader artifact. The CLI verifies Ed25519 provenance against explicitly configured PROSPECT_ENRICHMENT_COMPARISON_TRUSTED_KEY_ID and PROSPECT_ENRICHMENT_COMPARISON_TRUSTED_PUBLIC_KEY_PEM; missing trust configuration, unsigned data or unknown keys stop the run. operatorAuthenticated alone has no authority. No database-write fallback exists.

4. Run:
   node --import tsx scripts/prospect-enrichment/cli.ts reconcile --profile whole-firm --packages RUN_DIR/compiled-initial/normalized-packages.jsonl --snapshot RUN_DIR/comparison-initial.json --output RUN_DIR/actions-initial.jsonl
   node --import tsx scripts/prospect-enrichment/cli.ts compile --profile whole-firm --manifest SOURCE_MANIFEST --actions RUN_DIR/actions-initial.jsonl --run-dir RUN_DIR/compiled-final

   Rebinding requires exactly one action per package and unchanged complete original research and item semantic content. Existing verified evidence is linked/retained through the supported protected review; it is not re-imported. Contradictions stay explicit. Do not run the legacy 10-case pilot selector in this profile; its approval remains a prerequisite in the release plan, not permission for a new whole-firm run.

5. Use compiled-final/expected-run-manifest.json and expected-run-manifest-chunks.jsonl as the exact approval scope. Also retain compiled-final/held-candidate-evidence.jsonl; it contains every package-less revision's complete original content, structured gaps and manifest-bound digest. delivery-index.jsonl lists each package's immutable key, SHA and packageFile. packages/PE_PACKAGE_ID.json contains the exact envelope to enqueue. No handwritten envelope extraction is needed.

6. Obtain the specific whole-firm run staging approval. Record it in a private approval file using:
   schemaVersion prospect-whole-firm-delivery-approval/v1;
   scope whole-firm-run;
   targetOrigin https://admin.caseloadselect.ca;
   projectId ssxryjxifwiivghglqer;
   runId;
   sourceManifestSha256;
   runManifestSha256;
   expectedRevisionCount;
   approvalReference naming the real authorization;
   packages [{clientPackageId,payloadSha256}] containing every final manifest package exactly once.

   The package list is empty only when the manifest has zero packages. The exact source hash covers all package-less holds too. Creating this file is not approval. Hash the actual UTF-8 approval file bytes with SHA-256 and supply that hash during execute.

7. For every delivery-index row in ordinal clientPackageId order, run:
   node --import tsx scripts/prospect-enrichment/cli.ts validate --profile whole-firm --file PACKAGE_FILE
   node --import tsx scripts/prospect-enrichment/cli.ts enqueue --profile whole-firm --file PACKAGE_FILE --outbox RUN_DIR/outbox

   Enqueue is local and immutable. Compare the returned key/payload SHA with the delivery-index row. Any difference blocks that run. Do not substitute a package from another snapshot.

8. Obtain and export a new authenticated comparison immediately before delivery. Give it a new filename. Run the dry-run first:
   node --import tsx scripts/prospect-enrichment/cli.ts submit --profile whole-firm --manifest SOURCE_MANIFEST --manifest-chunks RUN_DIR/compiled-final/expected-run-manifest-chunks.jsonl --held-evidence RUN_DIR/compiled-final/held-candidate-evidence.jsonl --snapshot FRESH_COMPARISON --outbox RUN_DIR/outbox --key EXACT_KEY

   For a manifest with zero packages, replace --key EXACT_KEY with --manifest-only. This option is rejected if any package exists. It still validates complete source coverage and still requires exact run approval for execute.

## Approved submission, bounded resume and verification

Only after the real scoped staging approval, append these flags to the exact successful dry-run command:

--approval APPROVAL_FILE --approval-sha256 APPROVAL_FILE_SHA --token-file APPROVED_AGENT_TOKEN_FILE --execute --confirm SUBMIT-APPROVED-PROSPECT-RESEARCH

The origin/project are fixed. The token is read only at execution and is never printed or saved. No generic URL, RPC or DML option exists. Comparison age must be <=15 minutes before any network request, including every manifest request and package POST; stale input fails closed before a request and does not consume an attempt.

submit registers every manifest chunk sequentially with finalize:false, uploads each held-candidate evidence artifact with an exact idempotency key and verifies its receipt, then replays the identical last manifest chunk with finalize:true. The database refuses finalization unless each package-less candidate entry has its exact source-linked evidence digest stored. It validates source/run hashes, runId/runKey and every expected chunk/entry/package count. Only a finalized/already_finalized receipt with state finalized permits package staging. The CLI also recompiles the frozen source manifest to verify exact full revision/item coverage; manually shortened chunks cannot pass.

For each package, inspect the returned delivery state. If received, continue to the next ordinal package. If retry_pending, retain its key/body, nextAttemptAt and snapshot/approval references; resume the same command after nextAttemptAt with a newly authenticated comparison. If manual_review, retry_exhausted, receipt mismatch, approval mismatch or coverage/hash conflict occurs, stop that run's delivery and retain the precise reason and files; continue independent authorized code/review work. Never skip a failed package and claim the whole run complete.

Each request has at most five attempts. Retryable outcomes are timeouts/network failures and HTTP 429/502/503/504, with 5/30/120/600-second minimum delays and any larger Retry-After. The tool records nextAttemptAt and does not sleep. Non-retryable responses require review. All resumes reuse identical canonical bytes/idempotency keys. Manifest request/state/receipt files are under outbox/manifests/RUN_MANIFEST_SHA; package bodies, states and receipts have separate durable directories. submission.lock prevents concurrent delivery. If a process dies, verify its recorded owner is no longer running before removing that exact stale lock; never steal the lock automatically.

After a received package:
node --import tsx scripts/prospect-enrichment/cli.ts status --profile whole-firm --outbox RUN_DIR/outbox --key EXACT_KEY
node --import tsx scripts/prospect-enrichment/cli.ts receipt --profile whole-firm --outbox RUN_DIR/outbox --key EXACT_KEY --token-file APPROVED_AGENT_TOKEN_FILE --execute

Receipt is a read-only transport check. It never sets visibilityVerified=true. Obtain a new authenticated Admin comparison, export it to a new artifact, and reconcile the final normalized-packages against it. Run detail must account for every manifest revision and every client item. Protected operator review/apply and actual Admin read-back remain separate required steps. A received package, finalized manifest, qualification-database receipt or held record is not a synced record.

## Coordinator continuation boundary

The delivery profile never changes current research slots, quota counters, qualified counts, candidate dispositions or governed qualification receipts. A research worker's existing completion and slot-release rules stay intact. Record enrichment delivery as a separate state with runId, both manifest hashes, expectedRevisionCount, final package hashes/keys, exact approval reference/file SHA, current phase, pending key/nextAttemptAt, receipt paths, comparison hash/capturedAt, every unresolved hold, and next authorized action.

There is no blanket authorization for subsequent snapshots. After one snapshot reaches its actual review/read-back result, the producer may prepare the next immutable export; the new source manifest defines a new run/approval cycle. A later process resumes the old immutable run from its durable outbox, never by recompiling a fresh mutable source under the old key.

Active coordinator cutover, deployment/PR merge and database migration remain separate gates in the private handoff. This profile has been tested only with synthetic fixtures and mocked transport; no real inventory, staging or production change was performed by this lane.

## Raw coordinator adapter contract

whole-firm-producer.ts maps the frozen whole-firm-coordinator-v1 state. It enumerates every candidate and each results[] entry before any filtering. Candidates without results, malformed/null result slots and malformed candidates remain explicit non-package holds. Each valid result is retained in originalRevision with schemaVersion whole-firm-producer-revision/v1, original disposition, candidateContext (all candidate fields except the separately enumerated results array), exact stored result, and explicit assessmentPointer/unassigned split. The export also retains the entire source state and artifact inventory. Bad references add separate manifest hold revisions; they are counted once and never silently disappear.

The immutable research key is the first available nonempty string result.researchKey, result.workKey or candidate.key. Object-valued researchKey packets remain raw identity claims. A missing key gets a snapshot-addressed archive-candidate identity solely to register a schema hold; it never receives a typed envelope or resolved identity. Source/event IDs use whole-firm-adapter/v1 and caseload-whole-firm-v1; full-file hash, current state timestamp and array position are excluded from event semantics. Supplied original immutable event IDs retain their namespace, and conflicting reuse holds the original revision.

Sources preserve sourceUrl/url/pageUrl, actual date precision, retrieval fields, HTTP status, body/capture SHA and explicit excerpt. Missing retrieval facts remain legacy-unknown; submittedAt/reconciledAt/export time never become observation or assessment time. record.office/independence map to firm_fit, services to service, lawyerCount to roster, separate email/generalInbox to separate contacts, eligible tags and explicit recent-ad/historical-ad to advertising. Configured/fired/attribution are never inferred. Unknown roster count qualification retains the number in original research and emits a null/unknown typed count. Complete is a worker completion label, not a qualified/selected decision. Assessment dimensions and historical researchOutcome remain unknown unless explicitly recorded. Both missingGates and computedMissingGates survive, with their ordinal union in the typed assessment.

Opportunity requires recorded observation, interpretation/implication, recommendation and high/medium/low confidence; absent confidence retains opportunity_confidence_not_recorded with its exact RFC 6901 path. Explicit websiteIntake/websiteIntakeFindings map only with recorded page URL, fields/channels, state, summary, observation and interpretation. Research failures always remain in raw content/assessment; research_attempt requires recorded provider, query/URL, outcome and coverage. Unknown unsupported fields remain navigable through unmappedPaths. Retractions require a recorded reason; absent retraction source linkage stays explicit missing provenance. No source or finding is invented to satisfy validation.

For one ordinary worker result, its record observations belong to that result assessment. With explicit qualificationAssessments, only nested criteria ownership or recorded observationIds/findingIds assigns a finding to an assessment. Remaining observations and sources receive a separate null-assessment revision. The split selector is retained in originalRevision so package identities do not collide. Existing candidate receipts stay raw context and are treated as a persistence claim during reconciliation; without exact accepted visible lineage they cause receipt_unverified instead of a duplicate import. No newest-receipt or newest-file shortcut exists.

The snapshot input must end with operations/luna_continuous_v1/control/whole_firm_state.json. Relative references resolve only against that prospect root. Only explicit evidenceArtifacts[], receipt queryArtifact, and deferral.evidence references are followed; allowed resolved roots are operations/luna_continuous_v1/workers, operations/luna_continuous_v1/control/evidence, and data/qualification. Supported original-file suffixes are JSON, JSONL, HTML, HTM, TXT, MD, CSV, PDF, PNG, JPG, JPEG and WEBP. Other references are retained as out-of-scope holds, never fetched or executed. Missing/unreadable files, invalid required receipt/deferral SHA values and mismatching hashes have separate hold codes. State/capture changes during capture fail the snapshot before a deliverable export is created. Output cannot overlap the source tree.

Exact state/capture bytes are stored below coordinator-artifacts/sha256; standard export bytes are stored under exports; source-manifest.json and coordinator-inventory.json are in runs/SOURCE_MANIFEST_SHA. The latter records source SHA/archive path, candidate/revision counts, every declared reference and issue, export hash and source-manifest hash. No failed input is repaired in place. Resume via the completed saved export/manifest, not by creating another state snapshot with a new timestamp.

Every comparison event now includes required primaryTarget, equal to exactly one targets member or null. Null is preserved when no deterministic primary proof exists. Neither target array ordering nor an auxiliary capture/audit row can supply typed existingRecord. Accepted evidence with visible=null or visible=false is receipt_unverified; the reasons distinguish an unknown/read failure from a known omission. The guard also clears stale linkage metadata and runs before reusing an applied package receipt. A comparison file alone cannot manufacture authenticated visibility.
