---
doc-type: audit
scope: supabase-migration-lineage
auditor: Claude Sonnet 5 (migration-lineage remediation-design task)
date: 2026-07-18
status: complete — investigation only, no remediation applied
revision: corrected 2026-07-18 (v2) — the original draft grouped all 7 items under a single "zero-source" label while its own findings showed 2 of the 7 have real, verifiable source artifacts. That was internally inconsistent: "no source exists" and "a source exists but is not correctly represented in the current migration lineage" are different, non-interchangeable claims, and this revision separates them explicitly throughout, per reviewer correction.
related-docs:
  - docs/audits/MIGRATION_LINEAGE_INCIDENT_2026-07-18.md (the freeze this investigation works under; its Category D list of 7 items is the starting point, independently re-verified below)
  - docs/audits/MIGRATION_LINEAGE_REMEDIATION_DESIGN_2026-07-18.md (the design doc this investigation feeds)
  - docs/audits/MIGRATION_LINEAGE_EVIDENCE_MATRIX_2026-07-18.csv (the full reconciliation this document's starting list was independently reproduced from; its orphan-rows section now carries a source_status column matching this document's three-way split)
---

# Ledger rows with no matching local file: individual investigation, 2026-07-18

## The three-way split (read this before the per-item detail below)

Seven production ledger rows have no local file that claims them by exact version or by name/slug match — that specific, narrow claim ("no local file matches this row in the reconciliation script's own matching logic") is CONFIRMED for all 7, independently reproduced in this investigation from scratch. But **"no file matches by version/slug" is not the same claim as "no source exists anywhere,"** and treating all 7 as one undifferentiated "zero-source" bucket was an error in this document's first draft. The 7 split three ways:

| Split | Count | Items |
|---|---|---|
| **A. Genuinely untraceable.** No file, on any branch, at any point in this repository's git history; no commit-message reference; no live-schema evidence beyond plausible shape. | 5 | `content_studio_format_taxonomy`, `content_studio_doctrine_p0`, `content_studio_compliance_formats`, `add_firm_profile_fee_detail_fields`, `standing_publishing_authorization_notification_pref_null_fix` |
| **B. Source exists on `main`, but its filename/version lineage is mismatched.** A real, already-committed, already-applied file exists on `main` whose content is verifiably equivalent to what this ledger row represents — it is simply not filed under this row's own version number, so the reconciliation script (matching on version and on name/slug) correctly does not pair them, but a source genuinely exists. | 1 | `enable_required_extensions` |
| **C. Verified source exists on an unmerged branch.** A real file, structurally confirmed against live production, sits on a branch that has never merged to `main` — it is not "no source," it is "source not yet in the lineage `main` tracks." | 1 | `pdf_artifact_integrity` |

**A fourth, separate matter — not part of this 7-item list at all — is the `screened_leads_consent` duplicate.** That is two files both already on `main`, both already correctly represented in the ledger via one of them; it is a source-control hygiene question (which of two committed files is stale), not a "does a source exist" question. It is investigated in the parent design document's Workstream C, not here, and is restated at the end of this document only to make the boundary explicit.

**Why the distinction matters for remediation design:** Split A items would need genuine reconstruction (new SQL, written now, from schema shape and any external memory, at the same evidentiary bar as the historical baseline file) if they are ever formally recovered — this is a materially riskier and more speculative operation than Split B/C. Split B and C items need no reconstruction at all: B needs a decision about whether the existing `main` file should additionally be filed/cross-referenced under this ledger row's version, and C needs a straightforward merge-or-cherry-pick-and-rename of a file that already exists, byte-for-byte, on a branch. Collapsing B and C into the same "zero-source" bucket as A overstates the amount of unrecoverable history in this repository and understates how close 2 of the 7 items actually are to fully resolved.

## Method, applied identically to all 7 items

For each item: (1) filename search across all 64 `origin/*` remote branches (`git fetch origin --prune`, then `git ls-tree -r --name-only <branch> -- supabase/migrations`); (2) content search across all branches for distinctive fragments of the migration's likely subject matter; (3) `git log --all` search for commit messages/subjects; (4) `git log --all` (full history, not just tips) search for the exact filename pattern, to catch anything committed and later deleted; (5) cross-reference against this repo's own doctrine registry (`00_System/01_Doctrine/DECISION_RECORDS.md`, outside this git repository, on the shared D: drive) and `CLAUDE.md`; (6) live production introspection (`information_schema`, `pg_constraint`, `pg_proc`, `list_extensions`) to establish what schema state actually exists, used only as corroborating context, never as a substitute for a real source file, per the incident report's own evidentiary bar. Every one of these six steps is reported per item below, including negative results — a step that found nothing is stated as such, not omitted.

**Independent starting point.** The 7-item list itself was re-derived independently in this investigation (see the Evidence Matrix), not copied from the incident report: a from-scratch SHA-256 hash of a freshly-checked-out `origin/main` worktree, cross-referenced against a freshly-pulled production ledger via a purpose-built reconciliation script, produced the identical 7-row list. That is CONFIRMED agreement on which 7 ledger rows have no local file claiming them by version or by name/slug match — a statement about the reconciliation script's own matching methodology, not a claim about whether a source exists anywhere in any other form. Steps (1)-(6) above go beyond that script's matching logic specifically to test the stronger claim, and that is where the three-way split above comes from.

---

## SPLIT B — 1. `20260518193933` — `enable_required_extensions`

**Confidence: STRONG EVIDENCE that a source exists on `main`, with its lineage mismatched, plus one unresolved discrepancy in that source's own effect.**

- Filename search, all 64 branches: no match.
- Content search: `supabase/migrations/20260506000003_pg_cron_pg_net_setup.sql` (on `main`, Category A exact match in the Evidence Matrix, applied 2026-05-06) contains exactly two `create extension if not exists` statements: `pg_cron with schema extensions` and `pg_net with schema extensions`. This is the only file anywhere in this repository's git history (checked across all branches) that issues any `create extension` statement.
- `git log --all --grep`: no commit message references "enable_required_extensions" or "required_extensions."
- Doctrine registry / `CLAUDE.md`: not separately documented as its own gap; the July 16 report (`docs/audits/MIGRATION-LINEAGE-REPORT-2026-07-16.md`, third-pass supplement) already classified this exact item `content_equivalent_source` pointing at the same file, independently confirming this investigation's own finding via a different, earlier pass.
- Live production introspection: `mcp__supabase__list_extensions` confirms both `pg_net` (installed_version 0.20.0) and `pg_cron` (installed_version 1.6.4) are installed. `pg_net`'s live schema is `extensions`, matching the file's statement exactly. **`pg_cron`'s live schema is `pg_catalog`, not `extensions`** — this does not match what the file's own statement (`with schema extensions`) would produce if it ran as the sole cause of `pg_cron`'s installation. Two explanations are equally plausible from evidence alone: (a) `pg_cron` was already present in `pg_catalog` before this statement ever ran (some Supabase platform configurations pre-install `pg_cron` at the platform level, independent of user migrations, which would make the file's statement a no-op for `pg_cron` specifically while still being the real cause of `pg_net`), or (b) a later, separate operation moved `pg_cron` to a different schema. No evidence distinguishes these two.

**Verdict:** this is not a Split A item. A genuine, content-verified source exists on `main`, already applied, in Category A — it is simply not filed under `enable_required_extensions`'s own ledger version, so it does not show up as a match in a version/slug-matching pass. The correct framing is "source exists, lineage mismatched," not "no source." **Evidence still required before this pair is treated as fully closed:** an authoritative account of why `pg_cron`'s live schema is `pg_catalog` rather than `extensions` — most likely resolved by checking whether Supabase's own platform-level bootstrap creates `pg_cron` in `pg_catalog` by default on this plan/region, which is a Supabase-support or Supabase-docs question, not a git-history question. This open question is about one column of live evidence (a schema-placement detail), not about whether a source file exists at all.

---

## SPLIT A — 2. `20260626100000` — `content_studio_format_taxonomy`

**Confidence: UNKNOWN. Genuinely untraceable — no source found within the searched universe.**

- Filename search, all 64 branches: no match.
- Content search across all branches' migration files for `content_pieces_format_check`, `paid_traffic_landing`, `review_response` (distinctive strings plausibly related to a "format taxonomy" migration): zero matches outside what's already accounted for on `main`.
- `git log --all --grep`: no commit message references "format_taxonomy" or "content_studio_format."
- `git log --all` for the filename itself, including deleted files: zero results — this filename was never committed to this repository under any ref, at any point in its history.
- Corroboration (not a source): `docs/CONTENT_STUDIO_SEO_AEO_SPEC.md` line 20 lists `supabase/migrations/20260626100000_content_studio_format_taxonomy.sql` as a "source artifact read" for that spec document's own authoring pass. That citation is itself unverifiable: the cited file does not exist anywhere in this repository's git history now, and neither do the two runbook documents the same citation list also names (`supabase/TASK_12_RECONCILIATION_PLAN.md`, `RUNBOOK_20260626_content_studio_apply.md` — both independently searched via `git log --all --full-history` for their exact filenames and near-variants; zero results for either, anywhere). This means the citation trail itself terminates in uncommitted, unrecoverable working files from a prior session, not a second independent piece of evidence.
- Live schema: `content_pieces_format_check` currently allows 10 formats; the local, already-committed `20260624000003_content_studio_foundation.sql` (applied 2026-06-24, two days before this ledger entry) only creates 4 (`counsel_note`, `clause_in_the_margin`, `decision_tool`, `counsel_letter`). The other 6 were added by some combination of this item, item 3, item 4 below, and possibly other already-accounted migrations (e.g., `canonical_service_page` is documented elsewhere as a Ses.15 addition). Present-day schema shape alone cannot attribute which of the 6 new formats this specific ledger entry added, versus item 3 or item 4 — per this investigation's own instruction, that inference is not made.

**Exact evidence required before recovery:** the original authored `.sql` text (from a working copy, an editor's local history, a chat/session transcript that captured it verbatim, or an operator's own memory of the exact statements run), or, failing that, an explicit, reviewed decision to treat this as evidence-based reconstruction from live introspection alone — which the incident report's own methodology note explicitly says needs the same rigor as the historical baseline file (cross-referencing two independent sources, not schema shape alone), and no second independent source exists here.

---

## SPLIT A — 3. `20260626100100` — `content_studio_doctrine_p0`

**Confidence: UNKNOWN. Genuinely untraceable — no source found within the searched universe.**

Same six-step search as item 2, same result: no branch, no content match, no commit-message match, no historical commit under this filename anywhere. Same corroboration-without-source citation in `docs/CONTENT_STUDIO_SEO_AEO_SPEC.md` line 21. "Doctrine P0" as a name suggests this migration may have added columns/constraints enforcing the Article IV "No Invention" sourcing doctrine described elsewhere in this repo's Content Studio work (e.g. `source_brief`, `direct_answer` fields referenced in later, already-accounted Content Studio migrations) — but this is a naming inference, not evidence, and is not treated as one.

**Exact evidence required before recovery:** same as item 2.

---

## SPLIT A — 4. `20260626100200` — `content_studio_compliance_formats`

**Confidence: INFERENCE only. Genuinely untraceable as a file — no source found anywhere; a plausible schema-level candidate exists.**

- Filename/content/commit-message/full-history search: identical negative result to items 2 and 3.
- Corroboration: `docs/CONTENT_STUDIO_SEO_AEO_SPEC.md` line 22 cites the same non-existent file. More substantively, `src/app/api/admin/content-studio/pieces/route.ts` (live, on `main`) carries an explicit code comment: `// Mirrors the content_pieces_format_check CHECK constraint (supabase/migrations/20260626100200_content_studio_compliance_formats.sql).` This is application code asserting, in its own comment, that this specific migration is the source of the live `content_pieces_format_check` constraint's format list. This is a stronger corroboration than items 2/3 have (a maintained code comment, not just a spec-doc citation), but it is still not the migration file itself, and it does not establish the constraint's exact original DDL (only that a later constraint mirrors it).
- Live schema: `content_pieces_format_check` = `counsel_note, clause_in_the_margin, decision_tool, counsel_letter, checklist, landing_page, paid_traffic_landing, canonical_service_page, review_request, review_response` (10 values, confirmed via `pg_get_constraintdef`).

**Exact evidence required before recovery:** the original DDL text. Given the code comment's specificity, if an operator or a prior session's tool output/transcript retains the exact `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT` statement that was run, that would resolve this at CONFIRMED confidence. Absent that, reconstruction from the current constraint definition is possible but would need the same explicit "this is a reconstruction, not a recovery" labeling the historical baseline file uses, and independent confirmation of which formats specifically trace to this migration versus adjacent, already-documented additions (Ses.15's `canonical_service_page`, Ses.17 WP-5's `paid_traffic_landing`/`review_request`/`review_response`) before claiming the reconstructed list is complete or correctly scoped to only this migration's own delta.

---

## SPLIT A — 5. `20260712183638` — `add_firm_profile_fee_detail_fields`

**Confidence: INFERENCE only. Genuinely untraceable as a file — no source found anywhere; a plausible schema-level candidate exists but is not confirmed provenance.**

- Filename search, all branches: no match.
- Content search for `fee_detail`, `firm_profile` (all branches, migration files): zero matches.
- `git log --all --grep` for "fee_detail," "firm_profile," "notification_pref" (batched with item 7's search): zero commit-message matches.
- No table named `firm_profile` or `firm_profiles` exists anywhere in this repository's schema or history — consistent with the July 16 report's own prior finding on this exact item ("no table named firm_profile(s) exists in this repository's history at all").
- Live schema: `firm_onboarding_intake` (the closest analog to a "firm profile" record in this schema) has 9 columns matching `%fee%`. Of those, 6 are already accounted for by the local, already-committed `20260625000004_firm_onboarding_v2_phase1_bing_apple_fees.sql` (`fees_upload_storage_path`, `fees_upload_original_name`, `fees_upload_size_bytes`, `fees_upload_mime_type`, `fees_freetext`, `fees_structured` — confirmed by reading that file's own `ADD COLUMN` list directly). The remaining 3 — `fee_deal_variation`, `fee_exclusions`, `fee_publish_preference` — are not covered by that file or by any other local file found in this investigation. All 3 are nullable `text`, no default, no dedicated constraint found referencing them by name.

**This is stated as inference, not confirmed provenance, per this task's own instruction not to infer a source from present-day schema alone:** these 3 columns are a plausible candidate for what this ledger entry added (timing fits — applied 2026-07-12, 17 days after the accounted-for fee fields), but shape alone does not prove these 3 specific columns, in this exact form, with no other side effects (no other table changes, no function changes, no index), constitute the migration's full and exact original content.

**Exact evidence required before recovery:** the original DDL text from a retained source (working copy, session transcript, editor history), or an explicit, reviewed reconstruction decision scoped only to these 3 columns with their exact live-observed types/nullability, labeled as reconstruction, cross-referenced against a second independent source if one can be found (none was, in this investigation).

---

## SPLIT C — 6. `20260713185849` — `pdf_artifact_integrity`

**Confidence: STRONG EVIDENCE, approaching CONFIRMED, that a verified source exists on an unmerged branch.**

- Filename search, all branches: found. `origin/feat/deliverable-suggestions-release:supabase/migrations/20260713185808_pdf_artifact_integrity.sql` — an unmerged branch, still present as of this investigation (`git branch -r` confirms it exists; last independently confirmed present in the July 16 report's third pass as well, so it has persisted at least 2 days without being deleted).
- Content read directly (`git show <branch>:<path>`, not checked out or merged): the file adds `asset_sha256 text` and `asset_validation jsonb` to `public.deliverable_versions`, with two named CHECK constraints (`deliverable_versions_asset_sha256_format_check`, `deliverable_versions_asset_validation_object_check`) and one partial index (`deliverable_versions_asset_sha256_idx`).
- Live production introspection, this investigation, independently: both columns exist with the exact names and types the branch file specifies (`asset_sha256 text`, `asset_validation jsonb`); both named constraints exist live with `pg_get_constraintdef()` output byte-identical to what the branch file's own CHECK clauses would produce; the partial index exists live with `pg_get_indexdef()` output byte-identical to the branch file's `CREATE INDEX` statement. This is a full, independent, three-way structural match (columns + constraints + index), not a partial or name-only match.
- Timing: branch file's own embedded timestamp (`20260713185808`) is 41 seconds before the ledger's recorded applied version (`20260713185849`) — consistent with "authored locally, applied 41 seconds later," the same pattern this repo's own reconciliation convention (PR #23/#28) already documents for other migrations.

**Verdict:** this is not a Split A item. A specific, unmerged branch carries what is, by structural comparison, almost certainly the exact original file. The only reason this remains unresolved is that the branch has not been merged and the file has not been renamed to its true ledger version — a lineage/merge problem, not an absence-of-source problem.

**Exact evidence still needed before treating this as fully CONFIRMED (not just STRONG EVIDENCE) for a rename-only reconciliation:** none, practically — a rename-only reconciliation (merge or cherry-pick this file, rename it to `20260713185849_pdf_artifact_integrity.sql`, zero content change) is defensible on the evidence already gathered. The residual gap between STRONG EVIDENCE and CONFIRMED is only that this investigation compared live schema effects, not the byte-for-byte original file hash against a ledger-stored SQL text (Supabase's ledger does not retain the original submitted SQL text for comparison the way `list_migrations`/`schema_migrations` is structured, so a hash-level CONFIRMED is not obtainable through read-only means for this or any other item in this investigation).

---

## SPLIT A — 7. `20260717231158` — `standing_publishing_authorization_notification_pref_null_fix`

**Confidence: UNKNOWN for the file itself. Genuinely untraceable. The incident report's specific claim about this item is corrected below.**

- Filename/content/commit-message/full-history search: identical negative result to items 2, 3, and 5 — no branch, no file, no commit anywhere.
- **Correction:** the incident report states this item "is already documented in `CLAUDE.md` as a known, deliberately-unreconstructed gap." This investigation searched the current `CLAUDE.md` on `origin/main` directly (full-text grep for "null_fix," for "deliberately" near "gap," and for "notification_preference") and found no such note. `CLAUDE.md`'s Standing Publishing Authorization section (added the same day, 2026-07-17) describes the `notification_preference` column and its accepted values as part of the feature's normal schema description, with no acknowledgment that a follow-up fix exists or was left unreconstructed. Either the incident report's claim was inaccurate when written, or `CLAUDE.md` has since been edited in a way that dropped the note. Either way, **this investigation could not independently verify that claim as it stands**, and the claim should not be repeated as fact in future summaries without re-checking `CLAUDE.md` at the time.
- Timing: applied `20260717231158`, exactly 2 minutes 2 seconds after `20260717230956_standing_publishing_authorization` (the parent migration, local, Category A exact match, applied the same session). This tight gap is the same "apply now, commit later, and it never got committed" pattern the incident report's own thesis describes for the other items, just observed at a much shorter timescale.
- Live schema: a constraint named `standing_publishing_authorization_notification_preference_check` exists on `public.standing_publishing_authorizations`, functionally identical in its logic (`notification_preference IS NULL OR notification_preference = ANY(['per_publication','weekly_digest'])`) to the column-level inline CHECK already present in the local, committed parent file's own `CREATE TABLE` statement. The live constraint's name (singular "authorization," no trailing table-name pluralization) does not match this table's own established naming convention for every one of its other constraints (all of which use the plural `standing_publishing_authorizations_*` prefix, confirmed by direct inspection of all 8 other constraints on this table). This is consistent with — though not proof of — the "fix" having dropped and explicitly re-added this specific constraint under a new name, rather than leaving Postgres's own default auto-generated name in place. The table's own primary enabled-fields CHECK (`standing_publishing_authorizations_enabled_fields_check`) still requires `notification_preference IS NOT NULL` when `event = 'enabled'`, unchanged from the local file — so whatever this fix did, it did not relax that top-level requirement.

**Exact evidence required before recovery:** the original DDL text (same class of requirement as items 2-5), or, if the actual defect was in the `set_standing_publishing_authorization` RPC function's handling of a null/omitted `notification_preference` parameter on the `'disabled'` event path rather than the table's CHECK constraints at all, the live function body via `pg_get_functiondef()` compared against the local file's own version — this investigation did not perform that specific comparison, since it would begin approaching reconstruction of application logic rather than establishing whether a source file exists, which was this item's actual scope.

---

## `screened_leads_consent` — a separate matter, not part of this 7-item list

Investigated in full in the parent design document's Workstream C. Restated here only to make the boundary explicit, since it is easy to mentally group it with the items above: this is two files, both already committed to `main`, both already correctly represented in the production ledger via exactly one of them. It requires zero source recovery — the source already exists, twice, on disk. It requires a source-control decision (which file is stale), not a provenance investigation. It is not counted in the 5/1/1 split above and should not be cited alongside those 7 items as if it shares their evidentiary profile.

## Summary

| Split | Version | Ledger name | Confidence | Real source found? |
|---|---|---|---|---|
| B | 20260518193933 | enable_required_extensions | STRONG EVIDENCE (1 unexplained detail) | Yes — content-equivalent, already on `main`, lineage mismatched |
| A | 20260626100000 | content_studio_format_taxonomy | UNKNOWN | No |
| A | 20260626100100 | content_studio_doctrine_p0 | UNKNOWN | No |
| A | 20260626100200 | content_studio_compliance_formats | INFERENCE only | No (app-code corroboration only) |
| A | 20260712183638 | add_firm_profile_fee_detail_fields | INFERENCE only | No (schema-shape candidate only) |
| C | 20260713185849 | pdf_artifact_integrity | STRONG EVIDENCE, near-CONFIRMED | Yes — verified on an unmerged branch |
| A | 20260717231158 | standing_publishing_authorization_notification_pref_null_fix | UNKNOWN | No |

**5 of 7 (Split A) are genuinely untraceable and should not be reconstructed without new evidence surfacing. 2 of 7 (Split B, Split C) have real, verifiable sources already sitting in this repository's own git history — one on `main` under a mismatched lineage, one on an unmerged branch — and need a lineage/merge fix, not a reconstruction.** Calling all 7 "zero-source" understates how much of this gap is actually recoverable without inventing any SQL.
