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
