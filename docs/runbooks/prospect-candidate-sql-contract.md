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
