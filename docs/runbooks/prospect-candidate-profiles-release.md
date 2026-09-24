# Candidate profiles: implementation and release boundary

This follow-on is based on merged PR #313, main commit 2b6952a3639e15835e62a34a48363e464224cade. It adds candidate profiles for the complete governed enrichment inventory, including manifest-only holds and missing research keys. Archive files that have not passed the protected inventory/intake remain outside database coverage. A database count never proves archive-wide synchronization.

## Stored identities and evidence

The additive migration is 20260924172758_prospect_enrichment_candidate_profiles.sql. It does not change any of the six original enrichment migrations or their release allowlist.

The candidate UUID identifies a research record, not a verified firm. The namespace is source:<source_system> plus the original research key. Missing keys use run:<database_run_uuid> plus the exact manifest entry ID. Names, domains and claimed firm IDs never establish a verified identity. An append-only verified link requires an applied package, matching reviewed identity, matching receipt and operator review event. Conflicting verified links remain conflict with no selected firm UUID.

Original research, provenance-only entries, package lifecycle events, verified identity links and profile choices remain independent immutable history items. Each accepted manifest entry is projected transactionally with its sources. Original source paths, file hashes, pointers, envelope/evidence digests and JSON survive. The additional originalJsonSha256 covers the actual stored JSON representation, including the held-evidence wrapper. Missing dates stay null; date-only observations keep date precision. Invalid date text remains raw evidence with an explicit warning.

Original status, selection disposition, qualification state and processing disposition are independent. No selection value grants qualification. Only explicit candidate status paths govern disposition filters; unrelated source or retrieval statuses remain searchable ordinary facts.

## Operator read contract

Operator-only GET endpoints are:

- /api/admin/prospect-enrichment/candidates
- /api/admin/prospect-enrichment/candidates/<candidateId>
- /api/admin/prospect-enrichment/candidates/<candidateId>/history
- /api/admin/prospect-enrichment/candidates/<candidateId>/history/<revisionId>/content

Every endpoint authenticates before parsing query details or reading the database and returns Cache-Control: private, no-store. They export no mutation method. Data access uses a closed service-only RPC set; anon and authenticated database roles cannot query the candidate corpus. Private projection internals have no public execute permission.

The list has bounded keyset pages and inventory/filtered counts under one immutable coverageRevision. Cursors bind exact filters and coverage. History retains the same cutoff and returns bounded metadata pages. Complete original JSON, indexed fields and unmapped paths load in fixed 65,536-codepoint chunks through the protected revision-content endpoint. Every chunk binds candidate, revision, coverage, offset, total length and complete-content SHA256; the browser verifies the assembled bytes before rendering. This keeps each response below the hosting payload limit while retaining large historical bodies. Incomplete run, entry, source or item accounting is returned as complete=false with explicit readWarnings. A failed RPC or malformed response returns503, never an empty successful list.

Filters are text, originalStatus, selectionDisposition, processingDisposition, qualificationState, identityState, fieldPointer, fieldValue, fieldRefRevision/fieldRefPointerSha256, sourceUrl, observedFrom/observedTo, retrievedFrom/retrievedTo, observedUnknown and retrievedUnknown. Date bounds are inclusive UTC calendar days. __unknown__ selects absent disposition metadata. fieldPointer is an exact escaped RFC6901 pointer; fieldValue is serialized JSON in the URL and a typed JSON value at the RPC. False, null, "false", empty string, [] and {} remain distinct. Empty containers have indexed presence. Values or pointers too large for a query URL use an immutable revision UUID plus the SHA256 of the exact UTF8 pointer; the database resolves the referenced field within the coverage cutoff and compares the complete original pointer/value. The digest narrows lookup and never substitutes for exact equality. A source/date filter combines across a candidate's retained findings; it does not assert that all matching facts share the same source. The profile exposes individual source links and dates to establish that relationship.

The list is integrated into /admin/prospects and has its own /admin/prospects/candidates page. Every candidate has /admin/prospects/candidates/<candidateId>, including unresolved and malformed records. Verified firm links remain separate. URL query parameters use cr_ prefixes; browser back restores the filters. Profile fields provide exact-value filter links. Complete original JSON is expandable. Historic contradictory and retracted observations remain readable beside explicit current profile choices.

## Verification and release sequence

1. Run candidate contract/reader/actual-GET tests and static migration-contract tests with the focused enrichment suite. Run TypeScript, lint and diff checks. Review exact source lineage, all disposition fixtures, RLS and RPC grants.
2. Commit and push the isolated branch. Only the pushed PR's CI disposable Supabase may apply the new SQL. No local, preview or production database is authorized for this task.
Local pre-commit candidate contract/content/actual-GET/static migration checks passed 58/58; TypeScript passed on the pre-commit implementation; CI rechecks the exact pushed head. Scoped lint has 0 errors and 2 React effect warnings. Independent source review found no remaining concrete blocker after the preservation/size fixes. Exact-head CI results belong in the PR validation receipt.

3. CI must run the candidate PostgreSQL integration file in vitest.prospect-enrichment.integration.config.mjs. It verifies source projection, typed filters, immutable replay, unknowns, identity rules and coverage snapshots. The test requires CI=true, PROSPECT_ENRICHMENT_REQUIRE_DATABASE_URL=1 and an explicit numeric-loopback Postgres URL; missing guards do not authorize a database connection.
4. The existing disposable browser job runs candidate-profiles.spec.ts. Fixed fixtures cover selected, held, rejected, incomplete, not_selected, malformed, missing-key and conflicting identity, with legacy/structured channels, source-only facts, null dates, unknown fields and retractions. Verify 1440/1024/768/640/375/320 CSS pixels, source links, exact false/null facets, deep links/back navigation, copy width and overflow. A separate authenticated UI test reads the actual transactional candidate projection through the API against the disposable database.
5. Obtain independent review and all exact-head required checks. Keep the PR draft until reviewed; no merge is authorized by this implementation task.
6. Before any future production release, prepare a separately reviewed additive release allowlist and byte/hash receipt for the new migration plus its prerequisite six-migration ledger. The existing six-migration production workflow deliberately rejects this extra pending migration; do not dispatch it with this seven-migration tree or silently extend its allowlist. A separately reviewed workflow/release contract must authorize the exact additive migration and existing prerequisite ledger before application. Main-only manual dispatch, protected environment approval, reviewed source SHA, explicit TLS DB URL and post-apply exact ledger/checksum readback remain mandatory.
7. After separately authorized release and intake, reconcile every approved in-scope manifest candidate, package/item identity and hash to the authenticated candidate profile. Preserve the existing exclusion-screened snapshot approval scope. Do not resubmit accepted evidence. Keep qualification DB and Admin receipt/readback separate. Missing readback or coverage warning means pending.

Production state during preparation: PR #313 code has merged; parent is handling the protected six-migration preflight separately. The missing revalidate_operator_membership_v1 RPC is supplied by the first existing migration. This follow-on does not grant or execute production migration authority and does not claim operator access or Admin readback is repaired.

No real research payload, credentials, private exclusion inventory or production data is added to this branch. Candidate endpoints expose only operator-authorized retained research/provenance DTOs and reviewed profile choices, never arbitrary table rows or authentication sessions.
