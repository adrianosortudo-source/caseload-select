# Batch 013 reviewed cohort

This review classifies all 100 research candidates: **7 provisional import candidates, 17 excluded as existing, 11 excluded from the target cohort, and 65 held**. The generated manifest contains seven candidates. No import, database/CRM write, outreach, or identity merge has been performed or authorized.

The declared import target is an exact **3–20 lawyers**, with bands 3–5, 6–10, and 11–20. The 21–50 band is comparison-only. The seven candidates are `b013-007, 008, 018, 024, 041, 049, 077`; each has an original exact-count declaration, a clear static result, and a no-match result from the coordinating task's initial 2026-09-10 live review. Those retained results still require a fresh preflight before any apply.

**Bianchi Presta LLP (`b013-001`) is held for identity conflict.** A later, post-merge read-only preflight found exact firm-name matches in both `gta_prospect_firms` and `prospect_organizations`, with existing website `https://bianchipresta.com/`, while the candidate uses `https://www.vaughanlawyers.ca/`. This later evidence supersedes the initial live no-match report. The domain relationship remains unresolved; no import, survivor, alias, or identity merge is decided.

## Evidence and limits

- `review.json` preserves every raw record, source URL, count qualifier, and original uncertainty in `candidates[].sourceRecord`. Its separate decisions do not overwrite historical source observations.
- The original files contain count declarations and first-party roster URLs, but no retained enumeration of lawyer names/roles or captured roster-page evidence. This artifact review did not re-open those pages. An “exact” qualifier here preserves the original research declaration; it does not claim new independent roster verification.
- Identity/address supplements cover 58 candidates; 46 have street addresses, 12 covered candidates still lack addresses, and 42 have no supplement. These counts do not establish that 58 rosters are evidence-ready.
- The static comparison used 6,025 records at `bbeecdbe2fff29bda9b4491f4ecddc67723bdbd6`: 28 clear and 72 review-required. It lacked address/alias comparison and is not a complete current-live baseline.
- GSK (`b013-007`) uses the first-party supplemented **Toronto** office. The prior Burlington observation remains in the raw record and the correction is explicit.
- Adair Goldblatt Bieber (`b013-050`) is held for full-team verification. Its 17+ lower bound does not prove exclusion from 3–20.
- Leadership labels preserve their source roles without inferring ownership. Marc Kestenberg's observed email is linked only to Marc; no email is inferred for Michael. Unknown contacts remain unknown.

## Fresh live review metadata

The coordinating task supplied this initial read-only check on **2026-09-10**. These counts/checksums remain historical review metadata; there is no durable row-level live snapshot file, and the checksum algorithm was not supplied. The later Bianchi Presta preflight supplied exact-name match evidence in two tables, but no replacement global counts/checksums or matched row IDs. Its separate correction metadata is retained in `reviewMetadata.liveReview.postMergePreflight`.

| Baseline | Rows | Reported checksum |
| --- | ---: | --- |
| gta_prospect_firms | 141 | d33fad4228ca748f6300c3b92e4fce71 |
| Governed domains | 38 | da869fa1664d636db03cfdea105115dd |
| Aliases | 282 | eead854eb4e991d94d36d45a26967ff5 |
| prospect_organizations | 246 | 4f62f4115af42c79cf87b7ed39db3b02 |

Exact existing signals exclude `b013-003, 009, 025, 027, 028, 029, 038, 039, 046, 052, 056, 058, 061, 062, 066, 080, 088`. Bianchi Presta adds an eighteenth exact existing signal and remains on hold while the domain/firm relationship is reviewed. The other held candidates retain uncertain live outcomes. The current organization registry must be included in a future preflight, including the BA/AE records it contains.

## Files and validation

- `review.json`: pipeline-compatible review schema, all 100 source records, supplements, provenance hashes, and one disposition per candidate.
- `../../reconciliation/gta-prospect-batch-013/reviewed-resolution.json`: generated 100-record resolution.
- `../../reconciliation/gta-prospect-batch-013/reviewed-import-manifest.json`: generated seven-record candidate manifest.

The merged generic pipeline from `c0259a15727429c7d543b50d152b7f1c6278e4c2` generates and verifies the local artifacts without network or database access:

```powershell
node scripts/prepare-gta-prospect-batch-import.mjs --review docs/research/gta-prospect-batch-013/review.json --output-dir docs/reconciliation/gta-prospect-batch-013
node scripts/prepare-gta-prospect-batch-import.mjs --review docs/research/gta-prospect-batch-013/review.json --output-dir docs/reconciliation/gta-prospect-batch-013 --check
npm run prospects:test-batch-pipeline
```

Generation and `--check` passed with 7 imports, 28 excludes, and 65 holds. The corrected manifest omits Bianchi Presta and retains the other seven candidate records unchanged.

| Manifest hash | SHA-256 |
| --- | --- |
| Raw bytes: generated UTF-8/LF file and committed Git blob | `dac96ec4e10cbcadf91cc10135b1e18fe6a38de3662c11ef8f4434f0a5e72142` |
| Pipeline stable JSON: recursively sorted object keys, compact serialization | `f3ba690271a2f5670d5e1754a7fbbe60cdf4fb0b61819788ce11b77472347995` |

The raw hash is sensitive to file bytes, including line endings; a Windows CRLF checkout can have a different raw hash. The stable-JSON hash ignores JSON formatting and is the value printed by the generic pipeline.

Before any separately authorized apply: revalidate the seven current first-party rosters, perform a fresh read-only identity preflight across the current baselines, review any changed evidence, and obtain explicit approval for the resulting import scope. Bianchi Presta remains excluded from that manifest unless its identity conflict is resolved through a later reviewed correction. Opening or merging this review-only PR is not import authorization.
