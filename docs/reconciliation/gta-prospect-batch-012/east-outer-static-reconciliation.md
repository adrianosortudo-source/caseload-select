# Batch 012 EAST_OUTER static baseline reconciliation

Observation date: 2026-09-08

Normalizer contract: `src/lib/gta-prospect-baseline-reconciliation.ts` at fixed commit `337b5cf7`. Matching is deterministic exact normalized canonical domain, exact normalized firm name, and suite-preserving normalized street address with a city gate. No fuzzy matching or automatic merge is performed.

## Offline baseline

- Reviewed fixtures: 20
- Offline accepted-ledger projection: 103
- Historical legacy source: 5,902
- Total baseline records: 6,025
- Live ledger: `offline_pending`
- Automatic merge: `false` for every result

## Results

Six exact source-queue candidates remain non-accepted: KLF / Keliny Law, Spadafora and Murphy LLP, Findlay Personal Injury Lawyers, The Alam Law, Davidson Cahill Morrison LLP, Woitzik Polsinelli LLP.

Six records require review because the fixed normalizer found deterministic baseline matches:

- B012-EAST-09: legacy_source:legacy-gta-directory-2026-07:row-5791 [canonical_domain]
- B012-EAST-10: legacy_source:legacy-gta-directory-2026-07:row-15 [canonical_domain, firm_name]; legacy_source:legacy-gta-directory-2026-07:row-5757 [canonical_domain, firm_name]; legacy_source:legacy-gta-directory-2026-07:row-5758 [canonical_domain, firm_name]
- B012-EAST-13: legacy_source:legacy-gta-directory-2026-07:row-5774 [canonical_domain, firm_name]
- B012-EAST-16: legacy_source:legacy-gta-directory-2026-07:row-91 [canonical_domain]
- B012-EAST-18: legacy_source:legacy-gta-directory-2026-07:row-2059 [canonical_domain]
- B012-EAST-19: legacy_source:legacy-gta-directory-2026-07:row-1634 [canonical_domain, firm_name]; legacy_source:legacy-gta-directory-2026-07:row-1635 [canonical_domain, firm_name]

The remaining held records have no deterministic baseline match but retain their original evidence, scope, or minimum-count disposition:

- B012-EAST-07: clear static baseline; original held disposition retained
- B012-EAST-08: clear static baseline; original held disposition retained
- B012-EAST-11: clear static baseline; original held disposition retained
- B012-EAST-12: clear static baseline; original held disposition retained
- B012-EAST-14: clear static baseline; original held disposition retained
- B012-EAST-15: clear static baseline; original held disposition retained
- B012-EAST-17: clear static baseline; original held disposition retained
- B012-EAST-20: clear static baseline; original held disposition retained

No record is accepted or import-ready. The live operator-ledger join remains pending.
