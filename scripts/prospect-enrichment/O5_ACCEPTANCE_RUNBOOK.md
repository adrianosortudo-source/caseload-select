# O5 offline acceptance evidence runner

This runner validates a frozen whole-firm source manifest and its normalized package set, then validates the separate immutable A4 five-case selection and its candidate-index source. It writes one local JSON report. It performs no network requests, Admin reads, database queries, imports, identity linking, or production writes. Every live gate remains `pending`; `syncStatus` remains `not_verified` and `synced` is always `false`.

Each normalized envelope must match the exact package compiled from the frozen source, including all subject identity claims, `mode`, and every observation/assessment `existingRecord` link. This runner has no signed-comparison input, so it reports an explicit unverified error if any of those fields differ. Do not resolve identity or switch to `link_existing` by editing a local package; wait for the protected signed-comparison reconciliation procedure.

The A4 file hash is pinned in `acceptance-evidence.ts`. The runner also requires the exact source-index bytes named inside that file and verifies the source file SHA, row count, five unique categories, exact row locations, line hashes, revision/research identifiers, package references, the package-less schema hold, and zero production action counters. A corrected or changed selection requires a new reviewed version of the artifact and code; do not edit the existing frozen file.

The ten-case pilot is a separate gate. It still requires two exact cases in each of Identity, Qualified, Held, Rejected, and Incomplete. A valid five-case A4 selection does not replace or reduce that requirement. If the current source does not provide the full ten, the report says `pilot10.status: pending`; preserve that status and do not select substitutes manually.

## Run against the current offline handoff

Run from the `caseload-select-app` repository root. Use a new, nonexistent output path for every run; the CLI uses exclusive file creation and will not overwrite a report.

```powershell
node --import tsx scripts/prospect-enrichment/acceptance-evidence-cli.ts acceptance `
  --manifest 'D:\00_Work\01_CaseLoad_Select\07_Prospects\Whole_Firm_Enrichment_v1\runs\52ede3bc75b3e9d91000e580b9519e226922bbe24ebaaa4491b503715c425656\source-manifest.json' `
  --packages 'D:\00_Work\01_CaseLoad_Select\07_Prospects\Whole_Firm_Enrichment_v1\runs\52ede3bc75b3e9d91000e580b9519e226922bbe24ebaaa4491b503715c425656\prepared-handoff\normalized-packages.jsonl' `
  --frozen-five 'D:\00_Work\01_CaseLoad_Select\07_Prospects\Admin_Enrichment_Completion_20260927\A4_FROZEN_CASE_SELECTION_20260930.json' `
  --frozen-index 'D:\00_Work\01_CaseLoad_Select\07_Prospects\Whole_Firm_Enrichment_v1\runs\69e88dfa2b897f37e05602f9183b8f7d6c0f0511481876a40d8b3136eeeff2bb\candidate-index.jsonl' `
  --output 'D:\00_Work\01_CaseLoad_Select\07_Prospects\Admin_Enrichment_Completion_20260927\O5_OFFLINE_ACCEPTANCE_REPORT_<new-UTC-stamp>.json'
```

Replace only `<new-UTC-stamp>` with a fresh timestamp before running. Do not add credentials, API keys, connection strings, live evidence flags, or source facts. The CLI rejects unknown flags, including `--live-evidence`.

Read the JSON report, not only the one-line CLI result. `canonicalInput` and `frozenFiveCase` must pass; `sourceAccounting.expectedRevisionCount` must equal `accountedRevisionCount`; `pilot10` must remain `pending` or `pass` based on the existing selector; every `liveGates` entry must remain `pending`. `sourceRevisionDispositionCounts` counts all source revisions by recorded disposition and is not a count of pilot-eligible research keys. `packageBackedResearchKeyCount` counts distinct keys represented by packages. `pilotPartitionAvailability` is derived from `selectPilot`: a partition with `exact: true` has its exact shortfall count from the selector’s structured issue; `exact: false` means the selector returned the required first two ordinal keys, so the number shown is only a lower bound. Do not interpret those two selected cases as the total available count. A `pass` for the offline checks proves only local artifact integrity and consistency. It does not prove an Admin profile, receipt, search result, read-back, or sync.

After Supabase/Admin recovery, execute the separately protected live acceptance procedure from the project plan. Capture authenticated reader results, exact UUID/comparison evidence, import receipts, same-profile fact/date/source/history read-backs, search/filter results, exact replay counts, complete backlog accounting, and two later producer deltas. This offline report cannot consume those artifacts or change its pending live gates.
