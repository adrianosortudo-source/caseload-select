# GTA public-roster prospect batch 003

Read-only, first-party public-web roster staging for Toronto proper/downtown/midtown, North York, Etobicoke and Scarborough. Observed **2026-09-07**.

## Status and scope

- **25 candidates; 25 exact roster observations; 0 accepted.** Every row has `workflow_status=candidate` and `accepted=false`.
- This package is not a CRM import, outreach list, priority ranking, contact list, legal-standing assessment, or authorization to contact a firm.
- All evidence is a public first-party page on the named firm's canonical domain. Search results were discovery aids only; the linked roster page is the row evidence.
- No LSO pages or automation, bot bypass, form, chat, scheduling control, contact action, CRM, import, paid-data source, or private data was used.
- `count_qualifier=exact` means the roster visibly separated current lawyer roles (for example, lawyer, partner, counsel, or associate) from staff, clerks, students, paralegals, consultants, retired/former people, or other non-lawyer roles. This is a public-site snapshot, not proof of licence status, complete firm headcount, current legal entity, or contactability.

## Reconciliation

Each record was compared by canonical domain and firm name against:

1. the 20-record PR #231 baseline in `src/app/admin/prospects/reconciled-prospects.ts`;
2. `gta-prospect-batch-001.json`; and
3. `gta-prospect-batch-002.json`.

There are no exact canonical-domain or firm-name matches with those three source-controlled baselines. Each row records that result explicitly.

Legacy-row reconciliation is deliberately `unknown_no_stable_crosswalk` for every row. The source-controlled baseline does not provide a stable row-level ID/count crosswalk to the legacy corpus, so no legacy identity, count, or match is inferred and no candidate can be silently merged or promoted.

## Files

- `gta-prospect-batch-003.json` is the authoritative, machine-readable staging record.
- `gta-prospect-batch-003.csv` is a flat review projection of the same 25 records.

Before any later, separately authorized action, re-check the live first-party roster and office facts, resolve the legal/trade-name identity and any legacy crosswalk, and obtain an explicit approval for the specific downstream action. This batch does not claim acceptance.
