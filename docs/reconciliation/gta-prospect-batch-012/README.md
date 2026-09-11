# Batch 012 static baseline reconciliation

- Records: 32
- Static baseline: 6,025
- Clear: 17
- Review required: 15
- Cross-lane duplicate domains: 0
- Live ledger: `offline_pending`
- Automatic merge: `false`
- Accepted/import-ready: 0/0

## Live reconciliation — 2026-09-10

The authenticated operator projection returned 124 identities and was compared
read-only against all 32 Batch 012 candidates. The resulting artifacts are:

- `live-identity-snapshot-2026-09-10.json` — identity fields only, with a
  deterministic SHA-256 checksum.
- `baseline-reconciliation.live-2026-09-10.json` — 14 clear comparison
  results and 18 review signals across the live and preserved baselines.
- `import-dry-run-2026-09-10.json` — an explicit zero-write manifest.

This is evidence for human review, not import authority. Every record remains
`accepted=false`, `import_ready=false`, and `automatic_merge=false`; the dry
run contains no proposed database mutations.

## Reviewed import cohort — 2026-09-10

The 32 candidates were resolved individually against the authenticated
124-record operator baseline and the preserved legacy signals:

- Import: 17 firms, all with exact observed rosters of 3–20 lawyers.
- Exclude: 15 firms because they are already represented, have only two
  lawyers, lack an exact count, or could not be corroborated as an Ontario firm.
- Public-contact evidence: 28 attributable owner, founder, principal,
  named-lawyer, or general-firm inbox observations. Unknowns remain null.
- Automatic identity merge: `false`.
- Outreach, form submission, CRM writes, and CRM contact creation: `false`.

`reviewed-resolution-2026-09-10.json` records every decision and its basis.
`reviewed-import-manifest-2026-09-10.json` is the exact importer payload. Run
the importer without `--apply` first and retain its reported source SHA-256;
an apply is permitted only when the live baseline is still 124 and the same
SHA-256 is supplied through the importer's confirmation flag.

## Production result — 2026-09-10

The hash-confirmed manifest was applied after a fresh 124-record preflight
found no planned ID or domain collisions. The read-only operator projection
then returned 141 unique records, including all 17 Batch 012 firms and all 28
public-contact evidence observations. The detailed counts and immutable source
hash are recorded in `production-import-receipt-2026-09-10.json`.
