# GTA Prospect Batch 001 (staging only)

Observed: 2026-09-07. This is an internal, read-only public-web research batch. It is not an outreach list, CRM-import file, ranking, or authorization to contact any firm. `accepted` is `false` for every record.

## Evidence standard

Each row has a first-party roster or team source URL. A count marked `exact` was visibly separable from staff/non-lawyer sections on the reviewed first-party page. A `minimum` count is a lower bound supported by distinct first-party lawyer/profile evidence. `uncertain` means that the page established a plausible firm and public team/roster source but did not cleanly establish which displayed people were lawyers or the complete total. Those rows are deliberately not accepted.

No LSO page was accessed, automated, or scraped. No form, chat, scheduling control, email, phone number, advertising surface, or GBP listing was used. The batch contains only firm-level public website evidence and no private data.

## Reconciliation boundary

The comparison baseline is the 20-record set merged in PR #231 (`src/app/admin/prospects/reconciled-prospects.ts`) and its documented historical 5,902-row address-cluster corpus. None of these rows shares an exact canonical-domain match with the 20-record set. The historical corpus has no stable row-level ID/count crosswalk in the merged baseline, so every legacy assessment is deliberately `unresolved_no_stable_crosswalk`; no row may be automatically merged or imported.

## Files

- `gta-prospect-batch-001.json` is the authoritative, source-controlled staging record.
- `gta-prospect-batch-001.csv` is a flat review projection of the same 25 records.

Before any future promotion, independently re-check the live roster, office, lawyer-only count, legal/trade-name identity, and a stable legacy crosswalk. Separate approval is required for any audit delivery, import, contact, or send.
