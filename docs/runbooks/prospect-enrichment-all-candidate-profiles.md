# All researched candidates: profile and discovery acceptance

Status: the original #313 slice is merged. The isolated all-candidate follow-on now implements steps1–5 below; exact-head CI/review and production release/readback remain pending. See [candidate release contract](prospect-candidate-profiles-release.md). Historical slice scope: partial preparation. The current slice restores structured intake evidence and makes every field returned by the existing reconciled read route visible, searchable and filterable. It does not claim that every archived or manifest-only candidate is already a firm profile.

## Implemented read-model slice

- src/lib/gta-prospect-supplemental-evidence-reader.ts retains ordered legacy channel strings and structured channel objects. The closed object shape is kind (nonblank string), sourceUrl (absolute HTTP(S), no credentials/control whitespace) and optional visibleFields (ordered nonblank strings). Source text, order and duplicates remain intact.
- Unrecognized channel JSON remains bounded by the existing JSON depth/size/forbidden-key controls. It is returned as websiteIntake.readWarning.rawChannels, with code unsupported_intake_evidence, outside validated channels. UI calls it held for review. The original qualification is preserved, never recomputed by this display correction.
- src/lib/gta-prospect-profile.ts walks the entire returned record for scalar facets using escaped RFC 6901 paths and JSON scalar values. False, the string "false", null and an absent field remain distinct. Search includes all returned research field names/values, evidence URLs and dates. No value grants an identity, qualification or import permission.
- ReconciledResearchProfile.tsx supplies a lazily expanded research profile for every returned row, including rows with no stable firm ID. ReconciledProspects.tsx exposes channel kinds, exact research-field/value filters, actual cohort labels and all retained data regardless of qualification. Dossier and supplemental channels both remain visible.
- The protected GET route retains the same authorization, no-store behavior, stable-registry authority and source-key attachment. It still does not synthesize a firm from an unmatched supplemental row.

The profile currently contains only the latest supplemental summary and other existing read-model fields. It is not the complete immutable historical research revision corpus. Manifest-only candidates are not included. Do not describe this slice as complete all-candidate enrichment or synchronized production data.

The current synthetic GET, profile-search/facet and six-width browser coverage explicitly includes not_selected as retained original status while qualification remains needs_evidence. No selection status is promoted into a qualification state. The expanded profile renders only the existing operator-authorized ReconciledGtaProspect read DTO; it does not serialize sessions, credentials or arbitrary database rows. Public/owner contact summaries already returned by the protected route remain operator-only.

## Required next implementation, in order

Use a separate reviewed follow-on change after this slice. Do not extend the six-migration release allowlist silently. Add a new immutable migration with a newly allocated filename and update the protected release manifest only in that separately reviewed release.

1. **Candidate identity and immutable revision projection.**
   Add candidate read-model definitions in src/lib/prospect-enrichment-candidate-contract.ts and an additive supabase/migrations/<new-version>_prospect_enrichment_candidate_profiles.sql.
   Existing source tables are prospect_enrichment_runs, prospect_enrichment_run_manifest_items, prospect_enrichment_manifest_hold_evidence, prospect_enrichment_packages, prospect_enrichment_items and prospect_enrichment_item_targets. Preserve them and their append-only rules.
   Define candidate identity separately from database firm identity. Use a namespaced source research key when recorded; otherwise use run ID plus entry ID as an unresolved candidate identity. Persist original keys verbatim. Never derive a firm UUID from a domain, name, array position, hash or merely claimed source ID.
   Candidate records require candidate_id, identity_namespace, identity_key, nullable verified_firm_id, identity_state, created_at. An identity attachment is append-only, operator-reviewed and evidenced, not an overwrite of original research.
   Revision records require candidate_id, run_id, entry_id, nullable package_id, original_status, selection_disposition, processing_disposition, qualification_state, source_root, relative_path, source_pointer, source_file_sha256, payload_sha256, original_json, unmapped_paths, observed_at, retrieved_at and recorded_at. Missing historical dates remain null with explicit unknown semantics. Keep original statuses separate from mapped selection, processing and qualification states.
   One immutable revision per original revision/envelope is required; an existing package ID or held-evidence hash is an exact reference, not an instruction to re-import evidence. An unavailable/malformed source gets a retained provenance revision with its error and raw artifact reference, never fabricated facts.
   Acceptance: selected, held, rejected, incomplete, not-selected and unlinked candidates all have a readable candidate identity; every run manifest entry has exactly one accounted disposition and linkage to package/revision/hold evidence. A missing research key cannot drop a manifest item. No UUID is guessed.

2. **Source-preserving field and evidence index.**
   Add an append-only revision field projection keyed by candidate_id, revision_id and exact JSON pointer. Keep scalar_type, exact value_json, searchable_text, source/item references, observed_at, retrieved_at, original status and validation_state. Derive this projection mechanically from retained immutable JSON, including untyped original fields. It must never replace original_json or govern a selected profile value by itself.
   Use the existing prospect_enrichment_profile_choices and evidence provenance for explicit selected values; expose conflicting/historical observations independently. Build server-side full-text and exact typed-value indexes plus keyset pagination. Do not rely on loading the entire inventory into browser memory.
   Acceptance: source URLs, source dates, nested facts, false/null/empty values and unknown fields remain retrievable and searchable. Empty containers have explicit indexed presence. Two conflicting dated values are both shown. Rejected/held evidence stays searchable. All indexed fields resolve back to an exact stored revision pointer/hash.

3. **Protected ingestion and read API.**
   Extend src/lib/prospect-enrichment-store.ts and manifest registration/held-evidence routines to populate candidate revisions transactionally from accepted manifest/package/held evidence. Retain existing exact manifest hashes, approval scope, replay/idempotency checks, review and receipts. Do not reread or mutate active research files.
   Add src/lib/prospect-enrichment-candidate-reader.ts and protected GET routes:
   src/app/api/admin/prospect-enrichment/candidates/route.ts,
   candidates/[candidateId]/route.ts and candidates/[candidateId]/history/route.ts.
   List contract must return items, nextCursor, inventoryCount, filteredCount, coverageRevision and readWarnings. Filters must independently support original status, selection disposition, processing disposition, qualification, identity state, research field/value, source URL, observation/retrieval date, and text. Null/unknown must be explicit choices. A failed section emits a warning and completeness=false; never report an empty successful section.
   Acceptance: auth checked before every read, private/no-store responses, bounded cursors, service-only DB access, protected preview mutation denial, no arbitrary table/pointer execution, stable counts under a frozen coverage revision, and zero writes from GET.

4. **Universal list and profile UI.**
   Add CandidateResearchList.tsx and CandidateResearchProfile.tsx under src/app/admin/prospects and a candidates/[candidateId]/page.tsx.
   Integrate the candidate list into Admin Prospects beside the existing firm/source list. Provide candidate profile links for every candidate, even without a verified firm UUID. Preserve verified firm links separately. Do not reuse a source key as the UUID required by ProspectResearchDetail.
   Show current explicit profile choices, every retained research revision, sources and observation/retrieval dates, original status, current selection, qualification and processing disposition as separate fields. Display held/read-warning/identity-conflict states. Add typed facet controls for all indexed fields and all dispositions.
   Acceptance: every fixture candidate is discoverable from the default all-candidates view; changing selection never deletes or hides research; profile/URL/source links work for an unresolved candidate; source dates remain attached to their own evidence. Deep links and browser back restore filters.

5. **Synthetic end-to-end acceptance before release.**
   Add candidate contract/reader/store tests, migration-contract and real disposable PostgreSQL tests, authenticated route tests, and six-width Playwright profile/search/filter tests in tests/prospect-enrichment.
   Fixed fixtures: selected, held, rejected, incomplete, not-selected; manifest-only malformed candidate; missing research key; UUID-less candidate; conflicting identity; duplicate/replayed envelope; source-only revision; null dates; structured and legacy channels; unknown raw fields; repeated dated contradictory findings; source retrieval failure; revoked/retracted evidence.
   Assert complete manifest candidate/item accounting, immutable old evidence, exact replay receipts, no duplicate typed rows, strict auth/RLS, no public data access, typed facet equality, URL safety and no inferred qualification/UUID. Test 1440, 1024, 768, 640, 375 and 320 CSS pixels, full-width copy and retained long evidence. CI must pass on the exact reviewed head.

6. **Protected release and real read-back.**
   Prepare the exact new migration allowlist/checksums and reviewed source SHA, then obtain the required specific release/migration approvals. Use only the guarded main-only manual application workflow and approved direct TLS database URL path; linked passwordless commands remain prohibited.
   Prepare a fresh frozen, exclusion-screened inventory under its existing scope approval. Preserve manifest-only held evidence with the same authenticated intake/review/receipt boundary. Do not broaden the old backfill approval or resubmit accepted evidence.
   After authorized intake, verify candidate counts/dispositions and exact package/item IDs, hashes, source pointers, source dates and independently authenticated Admin read-back. Qualification database receipt and Admin receipt are separate. A failed or incomplete read-back stays pending.
   Completion requires every in-scope manifest candidate accounted, every retained revision readable/searchable/filterable, all unknowns visible, and exact receipt/hash reconciliation. No production step is authorized by this document.

## Current release boundaries

PR #313 has merged separately. This all-candidate follow-on remains unapproved for merge, migration application, production import and cutover. The existing source-shaped intake failure can be fixed by the reader change; it does not require rewriting the four valid source-evidence objects. The optional downtown geography boundary-source error is a separate unresolved read concern and is not repaired here.

Tests for this slice are synthetic only. Local dependency limitations and the exact CI result must be recorded with the pushed head; syntax transpilation is not a substitute for TypeScript semantic checking or rendered acceptance.


## Follow-on acceptance refinement

The original universal-candidate implementation did not by itself aggregate independently linked producers into the canonical firm page or index legacy governed research outside enrichment manifests. The additive firm-coverage migration and candidate UI now address that scope. See the closed source inventory, exact identity authority, source/date aggregation semantics, retraction handling, and required tests in [candidate release contract](prospect-candidate-profiles-release.md). Completion still requires the separately approved schema release and authenticated readback; source files outside governed intake remain explicitly pending. Neither a rendered list count nor an unresolved legacy row is proof of canonical firm enrichment.
