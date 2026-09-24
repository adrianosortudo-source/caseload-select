# Private exclusion scope for offline legacy compilation

This is a conservative scope filter for database preparation. It does not qualify firms, resolve identity, create a research assignment, contact Admin, or grant submission authority. The existing compiler, lineage hashes, signed comparison, exact approval, protected review, receipt and read-back gates remain in force.

## Fixed inputs and fail-closed prerequisite

Use only the existing `legacy-backfill` profile. `--exclusions` on any other command/profile fails before file or network use.

The private rule file must resolve inside `D:\00_Work\01_CaseLoad_Select\07_Prospects\Prospect_Enrichment_Backfill_2026-09-23_v1`; never add it or actual exclusion identities to Git. It refers to a whole, stable, content-addressed cohort inventory already present exactly once in the original frozen source manifest. Its archive must resolve inside that root's `artifacts` directory. The original manifest, original archive bytes and previous run directories remain immutable.

The independent inventory must already be an authoritative governed export whose schema establishes a closed membership set. A locally invented list, a count of qualified firms, an open coordinator manifest or `complete:true` cannot establish closure. Do not rewrite/relabel an existing open artifact to satisfy this contract. The frozen `luna-q50-manifest-v1` schema does not establish the required closure; it fails with `exclusion_coverage_unproven`. Obtaining a proper governed closed-membership export is a separate unresolved prerequisite, not an instruction to execute research or query production.

The supported exact inventory shape is `ClosedCohortInventory` in `private-exclusions.ts`:

- `schemaVersion: "prospect-exclusion-cohort-inventory/v1"`
- `cohortId`: nonempty immutable cohort identifier.
- `provenance`: exactly `kind: "governed-closed-cohort-export"`, immutable `exportId`, recorded UTC `exportedAt`, `membershipScope: "all-cohort-members-all-statuses"`, and `membershipPolicyVersion: "closed-cohort-membership/v1"`.
- `declaredMemberCount`: exact positive number of unique members.
- `membersSha256`: full protocol hash of the canonical `members` array.
- `members`: the complete membership, including every held/rejected/incomplete subject belonging to the excluded cohort. Each member is exactly `{memberKey, identities}`. Members are ordinal-sorted by unique memberKey. Identities are ordinal-sorted by canonical JSON and globally unique; duplicate identities across members are ambiguous and rejected. Each member requires one databaseFirmId and one-or-more valid normalized domains, retaining every listed alias. A domain identity shared across subjects is ambiguous and rejected. Every alias participates in the rule/scope hashes; any matching alias excludes a candidate. The candidate still requires exactly one canonical domain.

The exact private rule document is `PrivateExclusions`:

- `schemaVersion: "prospect-private-exclusions/v1"`.
- `sourceManifestSha256`: original frozen source manifest's canonical hash.
- `cohortInventory`: exactly `{sourceRoot, relativePath, fileSha256, schemaVersion, declaredMemberCount}`; source location/hash must match the frozen artifact and its complete independent inventory.
- `members`: byte-equivalent canonical membership/identity data from that independent inventory; no omitted, added, duplicate, substituted or unrepresented subject/alias.
- `rulesSha256`: full protocol hash of that members array.

Each identity is exactly `{namespace, sourceSystem, value}`. Allowed namespaces are `databaseFirmId`, `stableFirmId`, `legacyFirmId`, `sourceRecordKey`, `researchKey`, `domain`, and `firmName`. The three legacy/source/research key namespaces require the exact recorded sourceSystem; all other namespaces require null. Database IDs use valid UUIDs; stable IDs use the compiler's FIRM identifier form. Domains are lowercase DNS names without www/trailing dot, port, credentials or URL path. Names use NFKC, lowercase and collapsed whitespace. Other IDs preserve exact case and content. All rules must already be normalized; the validator does not silently rewrite them.

## Fixed filtering and accounting

For every original candidate occurrence:

1. Inspect source claims recursively across candidate content and parent metadata, including nested identity/aliases. A recorded sourceSystem is used when unique; otherwise the existing source-root namespace is the fixed legacy fallback. Multiple/malformed systems are uncertain.
2. Any exact namespaced exclusion match excludes that occurrence, even if another part of its identity is incomplete or conflicting.
3. Otherwise require exactly one distinct valid databaseFirmId and exactly one normalized canonical domain. Multiple/conflicting IDs, domains, names, aliases, source keys or research keys, unsupported alias structures, and explicit identity conflicts are uncertain. Unknown identity never means outside the excluded set.
4. Scan every string and key in the complete retained candidate, source pointer/path and parent metadata, using case-insensitive NFKC token matching. Any exclusion token in another namespace, a note, a reference URL or an unknown field holds the occurrence as uncertain. This intentionally prefers false holds over false eligibility.
5. Only eligible candidates reach the unchanged compiler. The source-claimed database ID may remain in the envelope as a claim; `identityState` remains unresolved. The filter never converts the claim into verified identity.
6. Scan generated compiler output again; generated/retained contamination becomes a count-only uncertain hold. Scan the final package, candidate, issue, expected-manifest and held-evidence transports after any reconciliation action binding. Any remaining token fails the entire command before output writes.

Known candidate collections are `records/candidates/firms/packages/items/results`. Identity-less objects and malformed scalar members in these collections remain counted uncertain occurrences. Nested container metadata is preserved under `__exclusionAncestorMetadata`; a source collision with this reserved metadata key fails closed. Standalone unrecognized provenance/files remain original source-manifest issues rather than guessed firms.

Excluded and identity-uncertain occurrences are absent from the uploadable expected run inventory and from held-candidate-evidence. They are accounted only in the separate private count audit; no raw details, member identities or matched rules are emitted there. Eligible candidates with ordinary schema errors continue to use the existing lossless held-evidence path. Original complete evidence remains in the original immutable source archive. Source file errors containing excluded tokens fail the run rather than being sanitized.

The deterministic `prospect-private-exclusion-audit/v1` includes original/derived source hashes, rules hash, independent inventory hash, total candidate occurrences, excluded count, identityUncertainHoldCount, eligibleCount, compiledPackageCount, eligibleCompilerHoldCount, tokenScan, source-claims-only identity authority, zero networkRequests, and its full auditSha256. Assert:

`candidateOccurrenceCount = excludedCount + identityUncertainHoldCount + eligibleCount`.

Counts are occurrences, not unique firms or qualifications. The independent membership artifact is governance metadata and is never compiled as candidate research.

## Scope identity and output

The original manifest is retained unchanged. The derived compile manifest retains all original artifact rows/hashes/pointers and adds:

```json
{
  "exclusionScope": {
    "schemaVersion": "prospect-exclusion-compile-scope/v1",
    "originalSourceManifestSha256": "<full original canonical hash>",
    "rulesSha256": "<full private membership/rules hash>",
    "cohortInventorySha256": "<full independent artifact byte hash>"
  }
}
```

Its `manifestSha256` is the canonical protocol hash of all fields except manifestSha256. That derived hash feeds the existing `backfill-` run formula and existing package hash tuple without changing compiler/event identity algorithms. Exact replay is stable; any changed original inventory or exclusion scope obtains a different registration scope. A previously derived manifest is rejected as an original input.

Use a new empty private run directory; never overwrite the existing inventory run:

```powershell
node --import tsx scripts/prospect-enrichment/cli.ts compile --manifest "<ORIGINAL_RUN>\source-manifest.json" --run-dir "<NEW_PRIVATE_RUN>" --exclusions "<PRIVATE_ROOT>\exclusions.json"
```

This command is documented for later authorized use only. The implementation task runs synthetic tests and does not compile actual research.

Alongside the standard compile outputs, this writes `original-source-manifest.json`, `compile-source-manifest.json`, and `exclusion-audit.json`. The first two are private source provenance, not upload transports; unchanged archived filenames may contain excluded identities. Do not upload those provenance manifests or the private rule/cohort inventory as candidate evidence. The transport manifest references the derived source hash. Original IDs and source pointers in eligible research remain unchanged.

Generate comparison-request from the new expected-run-manifest and complete comparison-packages files. Obtain the protected signed comparison and required fresh identity/read-back proof. A reconciliation recompile must use the same original manifest and same private exclusions plus the matching `--actions`, into another new directory. The final token scan also covers rebound existing-record metadata. Register/send only with a separately authorized exact derived run/package scope. Prior approvals for an unfiltered run or another exclusion set do not cover this run. No cohort repair, production read, real compilation, submission, migration or release is authorized by this document.

## Synthetic validation

`node --import tsx --test scripts/prospect-enrichment/__tests__/private-exclusions.node-test.ts`

The cases cover a proven independent membership binding, open/self-declared coverage rejection, missing/duplicate/substituted members, source/hash/schema mismatch, incomplete/colliding/nested identities, namespace mismatch, raw/parent/generated token leakage, source-claim retention without identity promotion, immutable source/pointer preservation, malformed-member accounting, deterministic audit and CLI scope rejection. The standard CI Node suite includes these tests automatically.
