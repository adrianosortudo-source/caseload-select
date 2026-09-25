# Candidate SQL and RPC contract

Status: prepared for disposable PostgreSQL CI. No local, remote, or production database execution has been performed by this lane.

Migration: `supabase/migrations/20260924172758_prospect_enrichment_candidate_profiles.sql`. Its filename was allocated by the pinned official Supabase CLI 2.117.0 using `migration new prospect_enrichment_candidate_profiles`. This migration is separate from the six-file production release allowlist; that allowlist is unchanged.

## Immutable model and ingestion

Seven new public tables are forced-RLS, deny direct access to PUBLIC, anon, authenticated and service_role, and reject UPDATE/DELETE:

- `prospect_research_candidates`: independent candidate UUID; exact source-system namespace and research key, or run UUID plus manifest entry fallback. SHA-256 keys narrow uniqueness; exact originals are checked before reuse. A claimed firm UUID never establishes identity.
- `prospect_research_candidate_coverage`: immutable projection journal. A transaction advisory lock serializes sequence allocation through commit. A bare sequence would allow a later commit to appear below an earlier page cutoff; the lock prevents that.
- `prospect_research_candidate_history`: research/provenance revisions, lifecycle events, identity links and profile choices are separate immutable items.
- `prospect_research_candidate_fields`: exact RFC 6901 pointer, JSON scalar type/value, empty container presence, source references, original date text and parsed UTC date index. Pointer digests prevent wide-key btree failures; exact pointers/values remain unchanged.
- `prospect_research_candidate_search_chunks`: bounded overlapping full-text documents, covering the entire retained scalar text, including multi-megabyte original JSON strings. Terms can match different retained fields of one candidate.
- `prospect_research_candidate_content_chunks`: immutable canonical full-history content, split into 65,536 Unicode codepoint chunks, with a full UTF-8 SHA-256 and total character count.
- `prospect_research_candidate_projection_issues`: explicit raw-review fallback when an already accepted artifact exceeds structured projection limits.

Narrow triggers project every governed run, manifest item, held-evidence row, package, item, lifecycle event, item target and profile choice in the original write transaction. Existing stored rows are projected by the additive migration; no active research file is read, and no intake, review, apply, import or qualification procedure is replayed. A replayed source produces no duplicate history or typed field rows.

Held evidence retains both its exact envelope (including originalJson text) and parsed research. A malformed/deep original remains raw provenance with `held_original_json_requires_raw_review`; depth above 32 containers is deliberately held for raw review. Index engine resource limits preserve the raw revision with `field_projection_requires_raw_review`, and raw text remains searchable. Neither condition silently reports a complete structured index.

Candidate original statuses are taken only from explicit candidate locations: held research root, package originalResearch.content root, and explicitly recorded assessment legacy originalStatus. Nested source status is ordinary research. Selection, qualification and processing dispositions stay independent. Blank source statuses remain raw typed fields and emit `blank_status_retained`; missing values stay null. Original date text is never fabricated or discarded. Invalid dates remain text with `invalid_source_date`; date filters use parsed UTC dates and unknown is a separate choice.

An identity link requires an applied package, the exact package/payload/review/firm values in its receipt, a compatible reviewed identity choice, and a matching recorded operator review event. Links append. Two distinct confirmed firm UUIDs produce identityState conflict and verifiedFirmId null. Profile choices stay tied to operator-reviewed source records and are also retained in history.

## Frozen read boundary

Only four public SECURITY INVOKER wrappers are granted to service_role. Their private-schema readers use fixed search paths; no private write/projection routine is publicly callable. GET performs no writes.

- `list_prospect_research_candidates_v1(p_filters jsonb,p_limit integer,p_after_id uuid,p_coverage_revision bigint)`
- `get_prospect_research_candidate_v1(p_candidate_id uuid,p_coverage_revision bigint)`
- `list_prospect_research_candidate_history_v1(p_candidate_id uuid,p_limit integer,p_after_id uuid,p_coverage_revision bigint)`
- `get_prospect_research_candidate_revision_chunk_v1(p_candidate_id uuid,p_revision_id uuid,p_offset integer,p_coverage_revision bigint)`

List: `{items,nextAfterId,inventoryCount,filteredCount,coverageRevision,readWarnings,complete}`.
Summary: `{id,identityNamespace,identityKey,displayName,verifiedFirmId,identityState,revisionCount,originalStatuses,selectionDispositions,processingDispositions,qualificationStates,latestRecordedAt,readWarnings}`.
Detail: `{candidate,profileChoices,coverageRevision,readWarnings,complete}`.
History: `{items,nextAfterId,coverageRevision,readWarnings,complete}`.

History items retain:
`id,candidateId,itemKind,runId,entryId,packageId,originalStatus,selectionDisposition,processingDisposition,qualificationState,sourceRoot,relativePath,sourcePointer,sourceFileSha256,payloadSha256,originalJsonSha256,originalJson,unmappedPaths,observedAt,retrievedAt,recordedAt,readWarnings,fields,contentDeferred`.
runId and entryId may be null for firm profile choices without an originating run. itemKind is research_revision, provenance_revision, package_event, identity_link or profile_choice. revisionCount counts research_revision/provenance_revision.

History list items have contentDeferred true, originalJson null and empty fields/unmappedPaths. Metadata scalars above 2,048 characters become null with an oversized_metadata_deferred warning; full originals remain in the verified content chunks. History page maximum is 20 and the serialized page budget is below 1 MiB. Candidate list pages use a 1 MiB budget and stable UUID keyset cursors. Summary labels are bounded, with at most 16 values per disposition category; omissions are explicit deferred warnings and do not change server filter matches. Detail current profile choices use a 256 KiB budget and explicit history-deferred warnings.

Chunk: `{candidateId,revisionId,coverageRevision,offset,nextOffset,chunk,totalCharacters,contentSha256}`.
Content is canonical JSON of the complete history item with contentDeferred false. Offsets count Unicode codepoints, are aligned to 65,536 except the terminal offset, and have no caller-controlled size. The RPC checks candidate/revision ownership and cutoff. The client must concatenate all chunks, check full character count and UTF-8 SHA-256, then parse. No partially assembled content may be shown as complete.

payloadSha256 is the original package or held-envelope digest; originalJsonSha256 hashes the exact retained originalJson; contentSha256 hashes the complete history item including field projections. These are distinct and must not be relabelled.

Each field is `{pointer,scalarType,value,sourceItemId,sourceIds,observedAt,retrievedAt,validationState}`. scalarType is string, number, boolean, null, array or object; array/object represent empty containers only. All fields resolve to the stored originalJson plus originalJsonSha256 and exact pointer.

## Filtering, coverage, and pagination

Allowed filters: text, originalStatus, selectionDisposition, processingDisposition, qualificationState, identityState, fieldPointer, fieldValue, fieldRefRevision, fieldRefPointerSha256, sourceUrl, observedFrom, observedTo, retrievedFrom, retrievedTo, observedUnknown, retrievedUnknown.

fieldValue is a JSON scalar or empty container, not stringified JSON at the RPC boundary. The paired immutable field-reference filters are an alternative to pointer/value URLs for large/private source values; the revision and pointer SHA-256 must exist at the cutoff, and matching rechecks exact pointer, scalar type and JSON value. Unknown references fail closed. Field references cannot be mixed with pointer/value filters.

Unknown disposition uses __unknown__. Date ranges are inclusive ISO UTC days. Date unknown filters are booleans and cannot coexist with ranges for that date. Facets are candidate-level AND: different retained observations may satisfy separate source/date/field facets, which does not assert that those observations describe one selected fact. Exact status filtering uses complete stored metadata, not bounded display arrays. Long source URLs are indexed by bounded hash tokens and full-string equality is always rechecked.

Every continuation cursor carries the original coverageRevision. Candidates, revisions, identities, summaries and profile choices use that cutoff. Count values do not change when new evidence arrives. Missing source projection, open/incomplete manifests, absent required held bodies, missing packages and mismatched expected item counts produce explicit readWarnings and complete false. A missing source does not become an empty successful inventory. Unexpected newly detected unregistered source rows remain an immediate safety warning even on an older cursor.

## Acceptance and release boundary

`prospect-candidate.migration-contract.test.ts` checks unique function declarations, paired dollar delimiters, append-only/RLS boundaries, service-only readers, immutable source lineage, source coverage, bounded chunks and exact wide-field indexing.

`prospect-candidate.integration.test.ts` is gated by CI=true, PROSPECT_ENRICHMENT_REQUIRE_DATABASE_URL=1 and a direct disposable loopback PostgreSQL URL. It does not connect merely because a database URL exists. Fixtures include all five original selection outcomes, missing-key/UUID-less manifests, held evidence/replay, source-only and malformed/deep raw artifacts, null/invalid dates, structured channels, unknown fields, empty containers, source retractions, independent statuses, applied identity conflicts, frozen pagination, RLS denial and multi-MiB content reconstruction with long keys/URLs and exact field references.

Real PostgreSQL execution belongs only to the pushed-branch CI lane authorized for this change. No production migration, import, merge or cutover is authorized by this document.

## Additive firm coverage contract

Licensee/person candidates remain unlinked as firm identities. A confirmed affiliation retains the exact allowlisted licensee row as separate provenance via its explicit `licensee_id` FK, with the source snapshot in its proof dependencies. Licensee updates refresh only referencing affiliations. This makes regulator display/status/source-snapshot facts searchable within a proven firm's group without assigning a potentially multi-firm person to a single firm identity.

`20260924192549_prospect_enrichment_candidate_firm_coverage.sql` was allocated with the pinned CLI after restoration migration `20260924180541`. It adds no public write route, changes no original source rows, and does not widen the existing six-migration production allowlist. Typed field-pointer/value filters select the exact source candidate rows containing that field value; they must not widen to every source candidate in the same firm group. Firm grouping remains available for firm-level facets and the full profile inventory. It must run after the first candidate migration in disposable CI before release review.

The closed `legacy_inventory()` contains 33 source tables. It includes all 22 legacy sources in the canonical firm reader, the canonical GTA firm and two import-batch tables, identity adjudications, regulator licensees and affiliations, queue items and attempts, worker draft/reconciliation tables, and agent import drafts. The original eight enrichment projections continue unchanged. Operational CRM, inbound submissions, conversations, outreach, export reservations, and credentials are outside this research inventory.

Every table has an explicit research/provenance column allowlist. Authentication actor columns and queue lease mechanics are deliberately excluded; any new unreviewed database column generates `legacy_columns_not_projected:<table>:<count>` instead of becoming automatically exposed. Unknown fields inside existing governed research JSON are preserved exactly. Current source versions missing their immutable journal entry produce `legacy_source_rows_unprojected:<table>:<count>` and `complete=false`, including on an older cursor.

Legacy candidates use `legacy:<table>` plus the exact source row UUID. Agent draft candidates use the row UUID and original `/records/<ordinal>` pointer. Each retains its own research record, matching review records by exact source record key, and its original envelope metadata. Unmatched review records remain separate held candidates at `/review_records/<ordinal>`. The complete allowlisted draft row remains in the immutable source journal. No draft candidate adopts a claimed firm ID or an identity from a matching name/domain. Drafts explicitly carry `draft_research_requires_operator_review`.

Legacy firm links require an actual typed firm FK and governed applied core-import provenance, or an already verified enrichment identity receipt. Batch-owned rows additionally require their own batch to be applied. Source mappings require confirmed status, a decision reference and review time. Worker evidence requires a linked reconciliation whose firm, stable ID and confirmed source domain match the authoritative registry; a later hold invalidates the current link. Unproven rows remain searchable unlinked candidates and raise `legacy_identity_unverified`. Source updates append revisions; consecutive A-to-B-to-A source changes remain three revisions, while retries of the current snapshot deduplicate. An immutable identity assessment also records lost linkage. Readers require the latest assessment and unchanged authority-dependency snapshots at the cutoff, so a changed applied batch, mapping or reconciliation cannot leave a stale verified link. Applied-batch or reviewed-reconciliation arrival refreshes related typed-FK rows transactionally. Write-side authority helpers are VOLATILE to see their trigger's newly inserted rows; read-side cutoff functions remain STABLE.

`firmId` is the only additional list filter. It must be a UUID. All field, text, source, status and date predicates are evaluated against the entire group whose candidates each resolve to the same single verified firm UUID at the cutoff. Different producers may satisfy different predicates. Membership is materialized once per list query. Text search includes the original producer namespace and source table/root/path/pointer. Returned rows and counts remain individual candidates, each with its own identity and history. Unresolved/conflicting candidates form singleton search groups and are excluded when `firmId` is supplied. No UUID is inferred from a UI projection with null identity fields.

Candidate profile choices retain every original column and append `evidenceState: retained|retracted` and `retractions: []`. Retraction matching uses exact target table/ID, the parent package's firm at the same coverage cutoff, and retained `evidence_retracted` events. Each event also includes `replacementSources` and `replacementSourceState: not_recorded|available|incomplete`, matching the canonical reader. Retraction never deletes or silently replaces the selected historical value. Existing response-size limits and history fallback remain in force.

Additional static checks live in `prospect-candidate-firm.migration-contract.test.ts`. The existing CI-only candidate integration file now includes cross-producer group matching, null/provisional/claimed identity holds, draft original statuses and unknown fields, mapping changes with frozen history, missing source projection, and retracted selected values. This lane performs source/static checks only; runtime PostgreSQL verification is reserved for pushed-branch disposable CI.

### Bounded read acceptance

The firm-coverage list computes identity groups once and builds expensive retained summaries only for the requested page. Counts and filters use bounded identity metadata; text names remain searchable through their retained field index, with candidate namespace/key checked directly. Exact candidate lookup requires both `identityNamespace` and `identityKey`; the pair is matched against the candidate source identity on the same Admin read, so candidates attached to one firm remain independently addressable. Partial pairs fail closed before the database call. Coverage warnings retain exact current-source comparisons across the closed 33-table inventory; an indexed latest snapshot lookup and one grouped identity count replace per-candidate full summaries.

CI must execute `prospect-candidate-performance.integration.test.ts` against disposable PostgreSQL. It creates 6,500 ordinary source firms through their real triggers and 1,000 further source updates. It also registers an applied synthetic import batch and 6,000 accepted source audits through ordinary triggers, producing at least 12,500 source candidates and 12,000 verified identity links while retaining 500 unresolved firms. Synthetic setup uses 500-audit batches with refreshed planner statistics, a 60-second statement limit and a 600-second total audit-setup cap; these allowances do not apply to measured reads. It reports actual candidate/history/field/source/identity-link counts, five unfiltered reads, indexed text and exact-field reads, unresolved and verified-firm filtering and a profile read. CI also executes `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for the firm audit lookup and asserts the full `(firm_id,id)` index is selected. Each measured SQL statement has a 5-second timeout; the observed nearest-rank p95 across those ten read timings must also be below 5 seconds. This is a bounded synthetic regression, not a production latency guarantee. Production-size row counts and query plans still require the separately authorized release read-back. No benchmark result is claimed until the exact pushed-head CI passes.
