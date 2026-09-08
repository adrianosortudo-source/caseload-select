# GTA public-roster prospect batch 008

Read-only, first-party public-web roster staging for GTA firms. Observed **2026-09-07**.

## Status and scope

- **25 candidates; 20 exact and 5 at-least roster observations; 0 accepted.** Every row has `workflow_status=candidate` and `accepted=false`.
- This package is not a CRM import, outreach list, contact list, priority ranking, legal-standing assessment, or authorization to contact a firm.
- Each recorded source is a public first-party firm page. Search was used only to discover sources; each URL in the data is the source reviewed.
- `exact` means the source presents a bounded lawyer roster, or expressly states the lawyer total, while distinguishing non-lawyer roles where applicable. `at_least` means the source supports the stated number but does not establish a reliable whole-firm roster boundary or needs a fresh roster check. Neither establishes licence status, total firm headcount, legal entity, contactability, advertising activity, or a right to contact a firm.
- No LSO page or automation, bot bypass, form, chat, scheduling control, contact action, CRM, import, paid source, or private data was used.

## Reconciliation

Every candidate was compared by canonical domain and firm name against the PR #231 20-record baseline and batches 001 through 007. No exact canonical-domain or firm-name match was found. The legacy crosswalk remains `unknown_no_stable_crosswalk` for every record; this batch makes no inferred legacy identity, count, or merge.

## Files

- `gta-prospect-batch-008.json` is the complete evidence-aware staging dataset.
- `gta-prospect-batch-008.csv` is a compact review/export view. It does not remove the source, uncertainty, or reconciliation obligations in the JSON.

Before any separately authorized downstream action, re-check the source page, candidate identity, roster count, scope fit, and any applicable terms. Do not treat candidate status as approval or initiate outreach from this batch.
