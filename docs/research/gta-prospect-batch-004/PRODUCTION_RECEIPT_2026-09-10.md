# GTA prospect batch 004 production receipt

This receipt reconciles the immutable Batch 004 staging package with the governed research ledger. It does not amend, promote, or overwrite any historical source observation.

## Verified production state

- Import batch: `acd92724-97d1-4025-a4cc-02b12702d872`
- Source name: `reconciled_gta_prospect_records`
- Source SHA-256: `56d74f9c9bfa86eaedf3d8ec14ffe2a0f5054a9e5f89fc790f31f50e3f3f5d34`
- Batch size: 103 research records
- State: `applied`
- Applied at: 2026-09-07 22:13:05 UTC

The following Batch 004 source keys were accepted and created in that applied batch:

- `gta-prospect-004-b004-01` — Friedman Estate Litigation Professional Corporation
- `gta-prospect-004-b004-02` — Sondhi Defence
- `gta-prospect-004-b004-04` — W. Glen How & Associates LLP
- `gta-prospect-004-b004-05` — Boardwalk Law LLP
- `gta-prospect-004-b004-08` — Shariff & Associates
- `gta-prospect-004-b004-09` — Bortolussi Family Law
- `gta-prospect-004-b004-12` — Carson Law Office Professional Corporation
- `gta-prospect-004-b004-14` — Martin & Hillyer Associates

The following original source records were not part of that applied set and remain historical holds: B004-03, B004-06, B004-07, B004-10, B004-11, B004-13, and B004-15. Cass & Bishop (B004-13) was later represented separately in Batch 013; it must not be imported a second time.

## Current limits

The original eight applied records retain their historical roster observations. Their public contact observations are empty, and their `website_url` field is null. Owner/email enrichment, website/address refresh, and roster-count refresh are separate additive work. They require renewed first-party evidence and a versioned enrichment path; the existing generic importer must not be reused because it records a reused source key as a newly `created` audit action.

The operator projection should present historical review text as review-time provenance, not as a claim about current import authorization.
