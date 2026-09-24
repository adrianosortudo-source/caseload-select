# Synthetic research fixtures

`createProspectEnrichmentFixtures()` returns exactly ten independent scenarios with fresh objects on every call. Each scenario supplies its validated envelope, fixed synthetic UUID and FIRM-ULID, required variants and expected behavior. Dates are fixed to September 23, 2026; all evidence hosts are reserved `.example` domains. These are test records, not live findings.

Use scenario 001 for a disposable local seed that needs source-bound new-core evidence. Scenarios 002/007/008/009/010 refer to their own synthetic existing UUIDs, which the seed must create through the supported core flow. Scenario 006 intentionally remains unresolved. Scenario 005 includes an original-only variant with no normalized items.

`createProspectEnrichmentLegacyCriteriaFixtures()` supplies 39 synthetic assessments: five with boolean-only criteria and 34 with rich criteria. The seed must supply a matching applied supplemental import batch before expecting these legacy rows in the authenticated dossier. Never hard-code the live row count as 39.

The pure tests validate all envelopes and variants, deterministic hashes, source-event replay/conflict, three-state values, date precision and preserved criteria. They do not apply migrations, establish a database receipt or prove rendered acceptance.

Rendered acceptance requires the separate disposable local database seed to produce `PROSPECT_ENRICHMENT_RENDERED_MANIFEST`, real operator/firm membership, and the stage-envelope file consumed by the browser tests. A missing manifest is an actionable gate failure. Do not hand-create production-looking IDs, intercept authentication, or claim browser acceptance from these fixture tests.
