# Batch 012 live-baseline gate

This gate compares Batch 012 research candidates with a fresh, sanitized snapshot of the operator research ledger. It is read-only. It never imports, updates, merges, contacts, or authorizes a prospect.

## Dependency

The implementation is stacked on PR #247 at commit `337b5cf7` because it deliberately reuses that PR's exact suite-aware baseline normalizer. Do not merge this branch before PR #247. After PR #247 merges, rebase this branch onto `origin/main` and open its own PR.

## Snapshot contract

While signed in as an operator, download:

`/admin/prospects/reconciled/identity-snapshot`

The response contains only record ID, normalized firm name, and canonical domain. It contains a deterministic SHA-256 over the sorted records, record count, and UTC generation date. The route returns 401 without an operator session and 503 rather than substituting fixtures when the live ledger is unavailable or empty.

## Verify Batch 012

```powershell
npm run prospects:verify-batch-012-live-baseline -- `
  --snapshot C:\path\to\gta-prospect-identity-snapshot-2026-09-09.json `
  --expected-count 124 `
  --batch C:\path\to\west-north.json `
  --batch C:\path\to\east-outer.json
```

The command writes only a sanitized reconciliation report to standard output. It exits nonzero for a missing or stale snapshot, unexpected schema, record-count mismatch, hash mismatch, noncanonical identity, or an accepted/import-ready research row. The report never includes public contacts, CRM fields, or outreach data, and `automatic_merge` is always false.
