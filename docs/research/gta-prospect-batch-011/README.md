# GTA public-roster prospect batch 011 — reconciled research

This is a read-only, public first-party research package observed on **2026-09-08**. It is not an import manifest, CRM list, outreach plan, or ranking.

The versioned lane artifacts contain 100 retained source records: 50 Toronto-core and 50 west/north. Four west/north records duplicate Toronto canonical domains (Black Sutherland, Loopstra Nixon, Miller Thomson, and McCague Borlack). They remain in the source record count with `held_cross_lane_duplicate` provenance, leaving 96 distinct domains. West/north therefore has 46 net-new-by-domain records before any baseline reconciliation; that is a reconciliation fact, not an approval.

Every record is explicitly `accepted=false`, `import_ready=false`, and carries a `pending_operator_baseline` guard with `automatic_merge=false`. The shared baseline reconciliation module can flag a fixture, ledger, or legacy-source collision, but never selects a survivor or authorizes a merge.

The schema keeps source URLs, city-level office evidence, count rationale, and published leadership-role provenance. It deliberately excludes contact details and street/suite addresses. `exact` is a bounded roster count; `at_least` is a lower bound and cannot establish an upper band; `unknown` carries no numeric count.

Only public first-party sources are in scope. No login, LSO automation, bot bypass, form/chat action, email, contact enrichment, CRM write, paid source, or private data was used. A subsequent independent reviewer must complete access and baseline checks before any separate staging decision.

Regenerate and verify the deterministic artifacts with `npm run prospects:generate-batch-011` and `npm run prospects:validate-batch-011`.
