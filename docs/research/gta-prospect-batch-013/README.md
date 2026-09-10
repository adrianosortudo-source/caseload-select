# Batch 013 reviewed cohort

This review classifies all 100 research candidates: **8 provisional import candidates, 17 excluded as existing, 11 excluded from the target cohort, and 64 held**. The generated manifest contains eight candidates. No import, database/CRM write, outreach, or identity merge has been performed or authorized.

The declared import target is an exact **3–20 lawyers**, with bands 3–5, 6–10, and 11–20. The 21–50 band is comparison-only. The eight candidates are `b013-001, 007, 008, 018, 024, 041, 049, 077`; each has an original exact-count declaration, a clear static result, and a no-match result from the coordinating task's 2026-09-10 fresh live review.

## Evidence and limits

- `review.json` preserves every raw record, source URL, count qualifier, and original uncertainty in `candidates[].sourceRecord`. Its separate decisions do not overwrite historical source observations.
- The original files contain count declarations and first-party roster URLs, but no retained enumeration of lawyer names/roles or captured roster-page evidence. This artifact review did not re-open those pages. An “exact” qualifier here preserves the original research declaration; it does not claim new independent roster verification.
- Identity/address supplements cover 58 candidates; 46 have street addresses, 12 covered candidates still lack addresses, and 42 have no supplement. These counts do not establish that 58 rosters are evidence-ready.
- The static comparison used 6,025 records at `bbeecdbe2fff29bda9b4491f4ecddc67723bdbd6`: 28 clear and 72 review-required. It lacked address/alias comparison and is not a complete current-live baseline.
- GSK (`b013-007`) uses the first-party supplemented **Toronto** office. The prior Burlington observation remains in the raw record and the correction is explicit.
- Adair Goldblatt Bieber (`b013-050`) is held for full-team verification. Its 17+ lower bound does not prove exclusion from 3–20.
- Leadership labels preserve their source roles without inferring ownership. Marc Kestenberg's observed email is linked only to Marc; no email is inferred for Michael. Unknown contacts remain unknown.

## Fresh live review metadata

The coordinating task supplied this read-only check on **2026-09-10**. The values are recorded as review metadata; there is no durable row-level live snapshot file, and the checksum algorithm was not supplied.

| Baseline | Rows | Reported checksum |
| --- | ---: | --- |
| gta_prospect_firms | 141 | d33fad4228ca748f6300c3b92e4fce71 |
| Governed domains | 38 | da869fa1664d636db03cfdea105115dd |
| Aliases | 282 | eead854eb4e991d94d36d45a26967ff5 |
| prospect_organizations | 246 | 4f62f4115af42c79cf87b7ed39db3b02 |

Fresh exact existing signals exclude `b013-003, 009, 025, 027, 028, 029, 038, 039, 046, 052, 056, 058, 061, 062, 066, 080, 088`. Other held candidates retain an uncertain live outcome; a static match is not silently promoted into a reviewed identity decision. The current organization registry must be included in a future preflight, including the BA/AE records it contains.

## Files and validation

- `review.json`: pipeline-compatible review schema, all 100 source records, supplements, provenance hashes, and one disposition per candidate.
- `../../reconciliation/gta-prospect-batch-013/reviewed-resolution.json`: generated 100-record resolution.
- `../../reconciliation/gta-prospect-batch-013/reviewed-import-manifest.json`: generated eight-record candidate manifest.

The merged generic pipeline from `c0259a15727429c7d543b50d152b7f1c6278e4c2` generates and verifies the local artifacts without network or database access:

```powershell
node scripts/prepare-gta-prospect-batch-import.mjs --review docs/research/gta-prospect-batch-013/review.json --output-dir docs/reconciliation/gta-prospect-batch-013
node scripts/prepare-gta-prospect-batch-import.mjs --review docs/research/gta-prospect-batch-013/review.json --output-dir docs/reconciliation/gta-prospect-batch-013 --check
npm run prospects:test-batch-pipeline
```

Generation, `--check`, and the existing pipeline fixture test passed with 8 imports, 28 excludes, and 64 holds. Focused checks confirmed GSK's Toronto city, named-email attribution, and the 17+ roster hold. The pipeline's stable-JSON manifest SHA-256 is `6d8f54b408adafa650d4bf70c5981ded8ebdd3a025378208fa979840d346876c`.

Before any separately authorized apply: revalidate the eight current first-party rosters, perform a fresh read-only identity preflight across the current baselines, review any changed evidence, and obtain explicit approval for the resulting import scope. Opening or merging this review-only PR is not import authorization.
