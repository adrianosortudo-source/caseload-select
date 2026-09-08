# GTA public-roster prospect batch 011 — reconciled research

This is a read-only, public first-party research package observed on **2026-09-08**. It is not an import manifest, CRM list, outreach plan, or ranking.

The versioned lane artifacts contain 100 retained source records: 50 Toronto-core and 50 west/north. Four west/north records duplicate Toronto canonical domains (Black Sutherland, Loopstra Nixon, Miller Thomson, and McCague Borlack). They remain in the source record count with `held_cross_lane_duplicate` provenance, leaving 96 distinct domains. West/north therefore has 46 net-new-by-domain records before any baseline reconciliation; that is a reconciliation fact, not an approval.

Every record is explicitly `accepted=false`, `import_ready=false`, and carries the shared reconciliation guard with `automatic_merge=false`. The generator reads all repository-available baselines: 20 reviewed fixtures, 103 offline import-fixture records, and 5,902 preserved legacy-source rows. It does not open a live ledger connection; `live_ledger_state=offline_pending` makes that missing normalized join explicit. A guard match never selects a survivor or authorizes a merge.

The schema keeps source URLs, city-level office evidence, count rationale, and published leadership-role provenance. It deliberately excludes contact details and street/suite addresses. Each record and evidence item retains `observed_on`. `exact` is a bounded roster count; `at_least` is a lower bound and cannot satisfy the capped 3–20 band; `unknown` carries no numeric count. Every recorded roster or office URL must be non-empty HTTPS. DeRusha Law Firm is explicitly held because the previous source had no first-party roster URL; no replacement has been invented.

The current read-only reconciliation snapshot reports 100 raw records, 96 domains, four duplicate domains across eight rows, 17 exact in-band observations, 14 lower-bound-only observations, 12 below-band, eight above-band, and 49 unknown. Priority dispositions are eight duplicate rows, nine fixture/checked-ledger collisions, 18 out-of-band, three proxy candidates, and 62 unresolved. The live RPC reported 124 records; Bianchi Presta is a confirmed live collision, while Vector Law and GZ Legal remain only provisional candidates pending a full normalized live join. Those findings do not change any record's research-only gate.

Only public first-party sources are in scope. No login, LSO automation, bot bypass, form/chat action, email, contact enrichment, CRM write, paid source, or private data was used. A subsequent independent reviewer must complete access and baseline checks before any separate staging decision.

Regenerate and verify the deterministic artifacts with `npm run prospects:generate-batch-011` and `npm run prospects:validate-batch-011`.
