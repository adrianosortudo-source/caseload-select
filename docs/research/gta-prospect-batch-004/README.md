# GTA public-roster prospect batch 004

Read-only, first-party public-web roster staging from a targeted north-GTA/Halton search. The resulting candidates publish offices in Newmarket, Aurora, Thornhill, Whitchurch-Stouffville, Richmond Hill, Markham, Vaughan, Georgetown, Brampton, Burlington, Oakville, and nearby areas. Observed **2026-09-07**.

## Status and scope

- **15 candidates; 12 exact, 2 at-least, and 1 uncertain roster observations; 0 accepted.** Every row has `workflow_status=candidate` and `accepted=false`.
- This package is not a CRM import, outreach list, priority ranking, contact list, legal-standing assessment, or authorization to contact a firm.
- All evidence is a public first-party page associated with the named firm. Search results were discovery aids only; the linked roster page is the row evidence. Where a firm publishes a roster on a distinct hosted domain, the canonical firm domain and the observed roster URL remain separate fields.
- No LSO pages or automation, bot bypass, form, chat, scheduling control, contact action, CRM, import, paid-data source, or private data was used.
- `exact` means a public roster visibly separated current lawyer roles from staff, clerks, students, paralegals, consultants, retired/former people, or other non-lawyer roles. `at_least` preserves a public roster whose lawyer-role boundary is incomplete or includes counsel. `uncertain` preserves an observed public team count where the older surviving first-party team article should be revalidated before later review. These observations are not proof of licence status, complete firm headcount, current legal entity, or contactability.

## Reconciliation

Each record was compared by canonical domain and firm name against:

1. the 20-record PR #231 baseline in `src/app/admin/prospects/reconciled-prospects.ts`;
2. `gta-prospect-batch-001.json`;
3. `gta-prospect-batch-002.json`; and
4. `gta-prospect-batch-003.json`.

There are no exact canonical-domain or firm-name matches with those source-controlled baselines. Each row records that result explicitly.

Legacy-row reconciliation is deliberately `unknown_no_stable_crosswalk` for every row. The inspected source-controlled material does not provide a stable row-level ID/count crosswalk to the historical legacy corpus, so no legacy identity, count, or match is inferred and no candidate can be silently merged or promoted.

## Files

- `gta-prospect-batch-004.json` is the authoritative, machine-readable staging record.
- `gta-prospect-batch-004.csv` is a flat review projection of the same 15 records.

Before any later, separately authorized action, re-check the live first-party roster and office facts, resolve the legal/trade-name identity and any legacy crosswalk, and obtain explicit approval for the specific downstream action. This batch does not claim acceptance.
