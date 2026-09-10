# Batch 013 reviewed cohort

This review classifies all 100 research candidates: **6 provisional import candidates, 17 excluded as existing, 11 excluded from the target cohort, and 66 held**. The generated manifest contains six candidates. No import, database/CRM write, outreach, or identity merge has been performed or authorized.

The declared import target is an exact **3–20 lawyers**, with bands 3–5, 6–10, and 11–20. The 21–50 band is comparison-only. The six candidates are `b013-007, 008, 018, 024, 049, 077`; each has first-party roster revalidation supplied by the coordinating task on 2026-09-10, a clear historical static result, and a no-match result from the initial live identity review. A fresh live preflight remains required before any apply.

**Bianchi Presta LLP (`b013-001`) is held for identity conflict.** A later, post-merge read-only preflight found exact firm-name matches in both `gta_prospect_firms` and `prospect_organizations`, with existing website `https://bianchipresta.com/`, while the candidate uses `https://www.vaughanlawyers.ca/`. This later evidence supersedes the initial live no-match report. The domain relationship remains unresolved; no import, survivor, alias, or identity merge is decided.

**Jewell Radimisis Jorge (`b013-041`) is held for active-roster and leadership ambiguity.** The [displayed roster](https://www.jrjlaw.com/our-lawyers/) has eight rows including Paul Jewell, whose [profile records his death in 2015](https://www.jrjlaw.com/our-lawyers/paul-r-jewell-qc/). Removing Paul leaves seven rows, while a cached first-party [Yusra Khalid profile](https://www.jrjlaw.com/our-lawyers/yusra-khalid-ll-m-ll-b-gpllm/) is absent from the displayed roster. The active count is unresolved between seven and eight. Current leadership is unset; Paul remains only in historical source evidence. The earlier no-match identity result does not clear this evidence gate, and the mediation-specific pgalway email is excluded.

## Evidence and limits

- `review.json` preserves every raw record, source URL, count qualifier, and original uncertainty in `candidates[].sourceRecord`. Its separate decisions do not overwrite historical source observations.
- Original research declarations remain unchanged in `sourceRecord`. The six retained candidates now include current first-party revalidation supplied by the coordinating task in `countEvidence` and `revalidation`; roster names are retained where the supplied payload enumerated them. This artifact amendment did not independently browse those pages, and no captured page files are stored here.
- Identity/address supplements cover 58 candidates; 46 have street addresses, 12 covered candidates still lack addresses, and 42 have no supplement. These counts do not establish that 58 rosters are evidence-ready.
- The static comparison used 6,025 records at `bbeecdbe2fff29bda9b4491f4ecddc67723bdbd6`: 28 clear and 72 review-required. It lacked address/alias comparison and is not a complete current-live baseline.
- GSK (`b013-007`) uses the first-party supplemented **Toronto** office. The prior Burlington observation remains in the raw record and the correction is explicit.
- Adair Goldblatt Bieber (`b013-050`) is held for full-team verification. Its 17+ lower bound does not prove exclusion from 3–20.
- Leadership labels preserve their exact source roles without inferring ownership. Named emails are linked only to their observed people; general inboxes remain nameless firm contacts. Original missing-evidence statements stay in the raw records as historical observations.

## Revalidated candidates and contacts

| Candidate | Lawyers | Source-backed role | Prospect contacts |
| --- | ---: | --- | --- |
| GSK (`007`) | 4 | Sandra Stephenson: Founder | `admin@gsklawyers.com`, general |
| Cass & Bishop (`008`) | 5 | Peter H. Cass: Partner & President | No usable prospect email; careers-only `opportunity@` excluded |
| Anthony Family Law (`018`) | 3 | David Anthony: Lead Counsel | `info@anthonylaw.ca`, general |
| Kestenberg Litigation (`024`) | 6 | Marc: Founding and Managing Partner; Michael: Founding Partner | Marc: `marc@kestenberglitigation.com`; Michael: `michael@kestenberglitigation.com`, both individual |
| Grosman Gale Fletcher Hopkins (`049`) | 8 | Owner/managing partner unknown; five listed partners do not establish ownership | `lawyers@grosman.com`, general |
| Addario (`077`) | 13 | Frank Addario: Founder, sourced to the About page | `faddario@addario.ca`, individual; `info@addario.ca`, general |

Each observed role and email retains its precise source URL in the review. The [Addario roster](https://www.addario.ca/lawyers) publishes both emails, while its [About page](https://www.addario.ca/about) supplies the 2012 founding statement. David Anthony is represented only as Lead Counsel; no founding or ownership claim is added. GSK's page body/contact supports Van Vliet and Toronto even though its HTML title still says Kennedy; that discrepancy is retained.

## Fresh live review metadata

The coordinating task supplied this initial read-only check on **2026-09-10**. These counts/checksums remain historical review metadata; there is no durable row-level live snapshot file, and the checksum algorithm was not supplied. The later Bianchi Presta preflight supplied exact-name match evidence in two tables, but no replacement global counts/checksums or matched row IDs. Its separate correction metadata is retained in `reviewMetadata.liveReview.postMergePreflight`.

| Baseline | Rows | Reported checksum |
| --- | ---: | --- |
| gta_prospect_firms | 141 | d33fad4228ca748f6300c3b92e4fce71 |
| Governed domains | 38 | da869fa1664d636db03cfdea105115dd |
| Aliases | 282 | eead854eb4e991d94d36d45a26967ff5 |
| prospect_organizations | 246 | 4f62f4115af42c79cf87b7ed39db3b02 |

Exact existing signals exclude `b013-003, 009, 025, 027, 028, 029, 038, 039, 046, 052, 056, 058, 061, 062, 066, 080, 088`. Bianchi Presta adds an eighteenth exact existing signal and remains on hold while the domain/firm relationship is reviewed. Jewell retains its earlier live no-match result but is held by the separate roster/leadership evidence gate; the remaining held candidates have uncertain live outcomes. The current organization registry must be included in a future preflight, including the BA/AE records it contains.

## Files and validation

- `review.json`: pipeline-compatible review schema, all 100 source records, supplements, provenance hashes, and one disposition per candidate.
- `../../reconciliation/gta-prospect-batch-013/reviewed-resolution.json`: generated 100-record resolution.
- `../../reconciliation/gta-prospect-batch-013/reviewed-import-manifest.json`: generated six-record candidate manifest.

The merged generic pipeline from `c0259a15727429c7d543b50d152b7f1c6278e4c2` generates and verifies the local artifacts without network or database access:

```powershell
node scripts/prepare-gta-prospect-batch-import.mjs --review docs/research/gta-prospect-batch-013/review.json --output-dir docs/reconciliation/gta-prospect-batch-013
node scripts/prepare-gta-prospect-batch-import.mjs --review docs/research/gta-prospect-batch-013/review.json --output-dir docs/reconciliation/gta-prospect-batch-013 --check
npm run prospects:test-batch-pipeline
```

Generation, `--check`, the existing pipeline fixture test, and focused integrity checks passed with 6 imports, 28 excludes, and 66 holds. The manifest omits Bianchi Presta and Jewell and incorporates the supplied roster/contact revalidation for the six retained candidates. All 100 original source records and historical unknowns remain unchanged; checks also verify GSK's Toronto city, individual/general email attribution, and no inferred owner.

| Manifest hash | SHA-256 |
| --- | --- |
| Raw bytes: generated UTF-8/LF file and committed Git blob | `c2a2341b47348e33f847b02136b958819b7aef389f875ff6a8823190df930202` |
| Pipeline stable JSON: recursively sorted object keys, compact serialization | `3e0962a92f7d75d207eab916be5f0b4fde2b2da52e25b4323c3d2a54b33a00e6` |

The raw hash is sensitive to file bytes, including line endings; a Windows CRLF checkout can have a different raw hash. The stable-JSON hash ignores JSON formatting and is the value printed by the generic pipeline.

Before any separately authorized apply: confirm the six first-party roster checks remain current, perform a fresh read-only identity preflight across the current baselines, review any changed evidence, and obtain explicit approval for the resulting import scope. Bianchi Presta and Jewell remain excluded from that manifest unless their respective identity and roster/leadership conflicts are resolved through a later reviewed correction. Opening or merging this review-only PR is not import authorization.
