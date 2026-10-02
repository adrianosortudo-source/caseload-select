# Public source evidence for future Luna runs

These tools implement public capture, additive verification and the offline compiler handoff for the future-run provenance contract. They produce private, immutable whole-firm exports and standard delivery artifacts using the existing enrichment compiler. They do not assign canonical firm IDs, change qualification, submit research to Admin, or establish that research is visible in Admin.

The active coordinator in the C: OneDrive tree has **not** been cut over to these tools. Do not add absolute D: artifact paths to that coordinator's relative `evidenceArtifacts`. Use the standalone commands below for separately governed additive verification runs. Producer cutover needs its own governed D: source and execution wiring.

Run commands from the repository's D: worktree. Private output defaults to:

```text
D:\00_Work\01_CaseLoad_Select\07_Prospects\Whole_Firm_Enrichment_v1\public-source
```

`--output-root` must stay beneath `WHOLE_FIRM_PROFILE.outputRoot`. Keep real page bodies, fact files, parent links, capture receipts and signed comparisons out of Git. The committed examples below are synthetic and are not research evidence.

## 1. Declare the exact public request

Create a private request JSON with exactly these keys:

```json
{
  "schemaVersion": "prospect-public-source-request/v1",
  "requestedUrl": "https://synthetic.example/services",
  "allowedOrigins": ["https://synthetic.example"]
}
```

Use the actual authorized public page and its exact HTTPS origin. URLs with credentials, fragments or blocked destinations are refused. The default capture is an unauthenticated HTTPS GET with no cookie jar or form interaction. Its limits are fixed: 20 seconds for retrieval, at most three redirects, at most 5 MiB of response-body bytes, and no change of origin.

Validate without a network request:

```powershell
node --import tsx scripts/prospect-enrichment/public-source-cli.ts capture --request 'D:\PRIVATE\public-request.json'
```

Execute an authorized public capture explicitly:

```powershell
node --import tsx scripts/prospect-enrichment/public-source-cli.ts capture --request 'D:\PRIVATE\public-request.json' --execute --confirm CAPTURE-PUBLIC-SOURCE
```

Save the emitted `receiptPath` and `receiptSha256` when `captured:true`. The exact response body is saved under `bodies/<bodySha256>.body`; the unchanged `prospect-public-source-capture/v1` receipt records its actual URL, status, retrieval times, content type and byte hash. `observationsVerified` remains `false`: retrieval success does not prove a factual claim.

If `captured:false`, preserve the emitted immutable attempt path/hash and its actual reason as a checkpoint hold. Do not substitute a different page, increase limits, repeat unchanged failures, or turn a bounded partial body into a successful capture. Continue the next independent authorized item.

## 2. Verify a fact against the saved body

Read the exact saved body. The researcher must confirm that the quoted content supports the entire proposed typed claim. A matching quote alone does not establish the claim's meaning. A service heading does not establish lawyer count, role, direct-contact deliverability, advertising activity, or qualification.

Create a private `prospect-public-facts/v1` JSON with exactly these top-level keys: `schemaVersion`, `researchKey`, `displayName`, `canonicalDomain`, `originalLinks`, `facts`. Preserve the established research key and recorded display/domain claims. Never insert a guessed Admin UUID or stable firm ID. A genuinely new candidate uses `originalLinks:[]`.

Each historical link has exactly `sourceManifestSha256`, `revisionId`, `packageId`, `payloadSha256`, `sourcePointer`. Populate them from the exact frozen parent artifacts; an unavailable binding stays `null`. Each link needs at least one recorded parent binding and the actual RFC 6901 pointer. These are retained source links, not a signed Admin identity match.

Each fact has exactly the following fields:

| Field | Required content |
|---|---|
| `kind` | Existing observation kind: `firm_fit`, `service`, `contact`, `advertising`, `opportunity`, `website_intake`, `roster` or `research_attempt`. |
| `data` | Exact existing typed data for that kind from `src/lib/prospect-enrichment-contract.ts`; do not add invented defaults. |
| `disposition` | `supported` only after actual researcher verification; otherwise `held`. |
| `reason` | `null` for supported facts; the actual nonempty hold reason for held facts. |
| `verifiedAt` | Actual UTC content-verification time. Supported facts require retrieval completion <= verification time <= export snapshot; never substitute export time. Held facts may use `null`. |
| `excerpt` | Exact UTF-8 quote supporting this fact, at most 4,000 bytes. Held facts can retain an empty quote. |
| `contentLocator` | Exactly `{startByte,endByte}`: inclusive start, exclusive end in the captured response-body bytes. |
| `excerptExtractionMethod` | Exactly `utf8-byte-range/v1`; normalization and paraphrase are not accepted. |

The following example applies only to the synthetic body `<h1>Employment law</h1>` and illustrative times. Replace all values with actual evidence and actual verification times before preparing real research:

```json
{
  "schemaVersion": "prospect-public-facts/v1",
  "researchKey": "domain:synthetic.example",
  "displayName": "Synthetic firm",
  "canonicalDomain": "synthetic.example",
  "originalLinks": [],
  "facts": [
    {
      "kind": "service",
      "data": { "name": "Employment law", "matterFit": "unknown" },
      "disposition": "supported",
      "reason": null,
      "verifiedAt": "2026-10-02T12:01:00.000Z",
      "excerpt": "Employment law",
      "contentLocator": { "startByte": 4, "endByte": 18 },
      "excerptExtractionMethod": "utf8-byte-range/v1"
    }
  ]
}
```

Character positions are not byte positions for accented characters or other multibyte UTF-8 text. The builder rejects partial UTF-8 ranges, altered quotes, unsupported timestamps, unknown keys and invalid typed data. Contact-role source references that are not verified in this new capture remain held; the builder does not invent replacement links. Held facts remain unchanged in the complete original revision and produce no positive or negative assertion.

## 3. Prepare the additive export locally

`VERIFIED-PUBLIC-FACTS` is the researcher's explicit declaration that the saved body supports the typed claims. It is required even though preparation makes zero network requests:

```powershell
node --import tsx scripts/prospect-enrichment/public-source-cli.ts prepare --receipt 'D:\PRIVATE\receipts\<actual-receipt-sha256>.json' --receipt-sha256 '<actual-receipt-sha256>' --facts 'D:\PRIVATE\verified-facts.json' --confirm VERIFIED-PUBLIC-FACTS
```

Save the output `preparationPath`, `preparationSha256`, `exportPath`, `exportSha256`, `sourceManifestPath`, `sourceManifestSha256`, `supportedFactCount`, `heldFactCount` and `issueCodes`. The immutable preparation binds the exact loaded receipt and fact-file bytes. Replaying those same files reuses the saved `snapshotAt`, export, source manifest and semantic IDs; it does not create a fresh observation date. A genuinely new receipt or fact-file version produces a separate additive revision.

The export retains the full unchanged fact JSON, immutable receipt, parent links, per-fact verification records and exact response body. Response-body bytes are represented losslessly as base64 strings of at most 32,768 characters. `originalResearch.content` equals that complete `originalRevision` in every deliverable envelope. Qualification assessment is always `null`, all canonical identity fields remain `null`, identity state is `unresolved`, and `supersedesPackageId` is `null`.

Only verified supported facts generate standard observations and full source objects. This builder sets `publicationLabel:null`, `publicationPrecision:"unknown"` and `publisher:null`; it infers no publication metadata. Envelope validation uses the existing 2 MiB package, depth and string limits. Fact-schema and package-size failures produce a package-less revision retaining the full original evidence. The file loader refuses a mismatched or corrupted capture receipt/body before export; record that failed preparation as a hold in the execution checkpoint and preserve its files for diagnosis. It cannot claim a trusted export from unverified bytes. Never truncate a body or fact file to obtain a deliverable package.

The pure builder API accepts the trusted result of `loadPublicCapture` plus the exact fact-file digest. Its digest authenticity depends on the loader/file CLI, which verifies actual immutable file bytes; it cannot reconstruct a raw file's formatting hash from parsed JSON. It independently rehashes the captured body and checks receipt schema, safe same-origin URLs, capture limits, verification times and quote bytes.

## 4. Publish the offline handoff

After verifying the facts, use `handoff` to prepare the export and publish all standard compiler artifacts together. It also accepts the same exact receipt and fact inputs previously used by `prepare`, reusing that preparation's recorded snapshot time. This command makes zero network requests and needs no Supabase access:

```powershell
node --import tsx scripts/prospect-enrichment/public-source-cli.ts handoff --receipt 'D:\PRIVATE\receipts\<actual-receipt-sha256>.json' --receipt-sha256 '<actual-receipt-sha256>' --facts 'D:\PRIVATE\verified-facts.json' --confirm VERIFIED-PUBLIC-FACTS
```

`handoff` refuses `--execute` and `--request`; it never captures another page or contacts Admin automatically. The required `VERIFIED-PUBLIC-FACTS` confirmation declares actual researcher verification of the saved facts, and grants no import approval.

On success, save `handoffDir`, `checkpointPath`, `checkpointSha256`, `preparationPath`, `preparationSha256`, `sourceManifestPath`, `sourceManifestSha256`, `sourceManifestFileSha256`, `snapshotAt`, `runId`, `runManifestSha256`, `artifacts` and `counts`. The checkpoint has schema `prospect-public-source-handoff/v1` and state `prepared-pending-admin`. Its `networkRequests`, `submitted`, `applied` and `visibleVerified` values are all zero. Supported evidence may still need identity review; an all-held fact revision remains a valid prepared handoff containing its complete package-less evidence.

The separate directory `handoffs/<preparationSha256>` contains:

- `source-manifest.json`, copied byte for byte from the frozen preparation.
- `expected-run-manifest.json` and `expected-run-manifest-chunks.jsonl`.
- `candidate-index.jsonl` and `held-candidate-evidence.jsonl`.
- `normalized-packages.jsonl`, `comparison-packages.json` and immutable `packages/<packageId>.json` files.
- `delivery-index.jsonl`, `validation-errors.jsonl` and `coverage-report.json`.
- `comparison-request.json`, built by the existing whole-firm comparison serializer, including zero-package runs.
- `checkpoint.json`, written last after every declared artifact and original input has been checked.

The checkpoint records each artifact's exact relative and absolute path, file-byte SHA-256 and byte count. It separately binds the preparation file, source-manifest semantic and file hashes, and run-manifest hash. `counts` records declared/accounted revisions, packages, package-less holds, retained held-candidate bodies, supported/held facts and validation issues. Read the coverage and evidence artifacts before continuing; `supportedFactCount` counts accepted fact-verification records, and identical typed observations may be deduplicated. It does not count destination imports or qualified firms.

Replay the identical handoff command to validate the exact checkpoint and complete file set. A successful replay preserves every file's bytes and modification time and reuses the original `snapshotAt`; it does not refresh observation dates. Missing files, changed bytes, altered checkpoints, undeclared files, or redirected directories and files cannot produce a successful replay. Original captures, facts, exports and frozen manifests are retained unchanged. A genuinely new input revision receives a separate preparation and handoff directory.

If the result is `held:true` with state `technical-hold`, preserve `reason`, `holdPath`, `holdSha256` and the partial artifact directory. The executable exits with a nonzero code. The immutable hold is kept separately beneath `handoff-holds/<preparationSha256>` and contains a safe technical code, never arbitrary error messages or source contents. An existing partial directory without its completed checkpoint is not regenerated or overwritten. A durable technical hold remains held on later invocations even if someone edits the artifacts afterward. Do not delete a hold or replace its evidence to force success; continue the next independent authorized candidate and resolve that preparation through an explicit repair procedure. Invalid receipt, fact or preparation inputs retain their existing loader failures and cannot be claimed as a trusted handoff.

For the protected next stage, set `$publicRunDir` to the successful `handoffDir` and `$publicManifestPath` to its exact source-manifest copy:

```powershell
$publicRunDir = '<actual handoffDir from successful handoff>'
$publicManifestPath = Join-Path $publicRunDir 'source-manifest.json'
```

Keep the returned preparation, its original source manifest, checkpoint and handoff directory together. Do not compile again into the completed handoff directory or mix artifacts from another preparation. The existing `compile` and `comparison-request` commands remain available for separately governed manual workflows; the handoff already performs those steps with the same compiler and serializers.

## 5. Resume protected delivery after Admin recovery

The new tool does not bypass the existing signed comparisons, real task authorization, registration, review or destination read-back. During a Supabase outage, retain each successful `prepared-pending-admin` handoff and stop only its dependent Admin action. Continue independent authorized preparation. This standalone D: companion does not edit or run the active C: coordinator.

After recovery, follow the current whole-firm runbook with the exact prepared request:

1. Obtain a fresh authenticated signed Admin bootstrap comparison for `comparison-request.json`; verify its reader, signature, pinned trust and exact request binding. Reconcile identities and events. Any conflicting or absent identity remains held.
2. Run existing `reconcile --profile whole-firm --packages <normalized-packages.jsonl> --snapshot <verified-comparison.json> --output <actions.jsonl>`. If those actions bind final packages, compile into a new final output directory with `--actions <actions.jsonl>` and preserve the previous artifacts.
3. Generate the exact final comparison request and real standing-task approval record. Obtain a fresh comparison for that final request. Run `register-manifest` dry-run, then execute unchanged only through supported intake. Registration submits inventory/held bodies and **zero packages**; require its actual finalized receipt.
4. Obtain a fresh finalized-run comparison for the exact same final request. Enqueue exact package files using `enqueue --profile whole-firm --file <package.json> --outbox <private-outbox>`. Run `submit` dry-run, then execute the same immutable payload/key. A zero-package run uses `--manifest-only` instead of `--key`.
5. Use the protected Admin review/apply path for any canonical fact. Then read back the run/candidate/evidence/history, exact firm profile and relevant search/filter result. Record retained-only, staged, applied and visible-verified counts separately. Mark synced only after actual destination proof.

Exact registration flags are:

```text
register-manifest --profile whole-firm --manifest <source-manifest.json>
  --manifest-chunks <expected-run-manifest-chunks.jsonl> --held-evidence <held-candidate-evidence.jsonl>
  --packages <comparison-packages.json> --snapshot <fresh-bound-comparison.json>
  --approval <real-approval.json> --approval-sha256 <actual-file-digest>
  --outbox <private-outbox> --token-file <protected-token-file>
```

Exact package submission flags are:

```text
submit --profile whole-firm --key <immutable-enqueued-key> --outbox <private-outbox>
  --manifest <source-manifest.json> --manifest-chunks <expected-run-manifest-chunks.jsonl>
  --held-evidence <held-candidate-evidence.jsonl> --packages <comparison-packages.json>
  --snapshot <fresh-finalized-comparison.json> --approval <real-approval.json>
  --approval-sha256 <actual-file-digest> --token-file <protected-token-file>
```

Those commands default to dry-run. Their guarded execution adds `--execute --confirm SUBMIT-APPROVED-PROSPECT-RESEARCH` only after the current runbook's required evidence passes. Preserve actual receipts and keep credentials out of output. Do not use the preparation confirmation as an Admin import approval.

Continue the finite expected inventory after each minor milestone until every revision has a verified destination result or a reconciled explicit hold. Public capture, local compilation and a received import receipt are distinct checkpoints; none alone completes the enrichment goal.

Future-run acceptance still requires two genuine subsequent research deltas using their actual capture and verification inputs, followed by protected intake, receipts, and destination profile/search/filter read-backs. Offline handoff tests and local checkpoints establish preparation behavior; they do not replace those live acceptance runs.
