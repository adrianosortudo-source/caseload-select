# Batch 012 EAST_OUTER research

Observation date: 2026-09-08

## Scope and method

This bounded source queue covers private-practice firms with a public first-party presence in Durham/east and approved outer-GTA municipalities. Discovery used public search. The canonical artifact retains five evidence types for every record: roster, office, practice, relationship, and public email. Every evidence item has an HTTPS source and `observed_on`; unknown evidence stays explicit. Published names and relationship titles are preserved exactly, without inferring owner, decision authority, or an email pattern.

No forms, chats, logins, outreach, ads, GBP, CRM, database, production import, or anti-bot bypass was used. Every record remains `accepted: false`, `import_ready: false`, and `automatic_merge: false`. The live ledger remains `offline_pending`.

## Disposition

- Records screened: 20
- Exact source-queue candidates: 6
- Held: 14
- Static review required: 6
- Static clear: 14
- Accepted: 0
- Import-ready: 0

The six source-queue candidates are KLF / Keliny Law, Spadafora and Murphy LLP, Findlay Personal Injury Lawyers, The Alam Law, Davidson Cahill Morrison LLP, Woitzik Polsinelli LLP. A clear static result is not an approval: independent review and the live-ledger check remain required before any separate staging decision.

## Reconciliation controls

The reproducible static check compares all records with 20 reviewed fixtures, 103 offline accepted-ledger records, and 5,902 preserved legacy rows using the corrected suite-safe normalizer contract at `337b5cf7`. It never performs fuzzy matching, survivor selection, or automatic merging. Run `npx tsx scripts/generate-gta-prospect-batch-012-east-outer.ts --check` to validate the committed artifacts.
