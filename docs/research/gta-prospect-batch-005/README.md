# GTA public-roster prospect batch 005

Read-only, first-party public-web roster staging for GTA firms. Observed **2026-09-07**.

## Status and scope

- **25 candidates; 22 exact and 3 at-least roster observations; 0 accepted.** Every row has `workflow_status=candidate` and `accepted=false`.
- This package is not a CRM import, outreach list, contact list, priority ranking, legal-standing assessment, or authorization to contact a firm.
- Every source is a public first-party firm page. Search results were used only to discover sources; the URL recorded for each row is the evidence reviewed.
- `exact` means the page presents a bounded current roster that distinguishes lawyer roles from staff, clerks, students, paralegals, or retired people. `at_least` preserves a public roster with a role boundary or complete-roster boundary that needs later review. Neither status proves licence status, complete firm headcount, legal entity, contactability, or a right to contact the firm.
- No LSO page or automation, bot bypass, form, chat, scheduling control, contact action, CRM, import, paid source, or private data was used.

## Reconciliation

Every candidate was compared by canonical domain and firm name against the PR #231 20-record baseline and batches 001 through 004. No exact canonical-domain or firm-name match was found. The legacy crosswalk remains `unknown_no_stable_crosswalk` for every record; this batch makes no inferred legacy identity, count, or merge.

## Files

- `gta-prospect-batch-005.json` is the authoritative machine-readable staging record.
- `gta-prospect-batch-005.csv` is a compact review projection.

Before any separately authorized downstream action, re-check the live first-party roster and office facts, resolve identity and any legacy crosswalk, and obtain explicit approval. This batch does not claim acceptance, import readiness, contactability, or outreach authorization.
