---
doc-type: audit
scope: supabase-migration-lineage-phase0
auditor: Claude Sonnet 5, acting as data engineer per explicit operator instruction ("you are the data engineer... there's no one else coming for us")
date: 2026-07-27
status: Phase 0 (stop-the-bleeding) executed. The freeze from
  docs/audits/MIGRATION_LINEAGE_INCIDENT_2026-07-18.md remains in effect for
  Phase 1 (the 72-pair ledger cleanup) pending one explicit decision from the
  operator — see "Open decision" below. Nothing in Phase 1 has been executed.
related-docs:
  - docs/audits/MIGRATION_LINEAGE_INCIDENT_2026-07-18.md (the freeze)
  - docs/audits/MIGRATION_LINEAGE_REMEDIATION_DESIGN_2026-07-18.md (Option 1, the six-element proof standard Phase 1 must clear)
  - docs/audits/MIGRATION_LINEAGE_EVIDENCE_MATRIX_2026-07-18.csv (per-file evidence this phase re-verified, not superseded)
  - docs/audits/MIGRATION_LINEAGE_ZERO_SOURCE_INVESTIGATION_2026-07-18.md
---

# Migration lineage: Phase 0 executed, Phase 1 scoped and awaiting one decision

## Why this document exists

The 2026-07-18 freeze assumed the incident was static once documented. It was not: between 2026-07-18 and 2026-07-27, four migrations were applied to production **through the Supabase MCP tool**, which stamps its own apply-time version — bypassing the freeze's CLI-shaped assumptions and minting fresh file↔ledger mismatches of exactly the kind the freeze exists to stop. One of those four (`add_content_deliverable_published_at`) was applied with **no migration file ever committed to git at all**. A fifth prepared migration (`publishing_package_control_room`, the Weekly Package Control Room schema) was fully built, reviewed, and committed on 2026-07-23 but **never applied** — the feature has been silently broken in production for four days.

This is the real root cause going forward: not only the 72 historical duplicate pairs, but a process gap that keeps producing new ones. Phase 0 below fixes the four new problems and reasserts the process boundary. Phase 1 (below) is scoped, verified to the extent this environment allows, and stopped short of execution pending one operator decision.

## Phase 0 — executed 2026-07-27

**0a. Applied the Weekly Package Control Room migration.** `supabase/migrations/20260723120000_publishing_package_control_room.sql` was reviewed (no changes from the committed file), applied verbatim via a single transaction that also inserted its own ledger row at the file's own version (`20260723120000`), in the same statement batch — file and ledger row created together, no drift possible. Verified after: 4 tables created (`publishing_packages`, `publishing_package_assets`, `publishing_package_events`, `publishing_package_checks`), the append-only trigger attached, RLS enabled+forced on all four with zero policies (matching this schema's established convention), and the ledger row present.

**0b. Reconstructed the missing `published_at` migration file.** No file existed for ledger row `20260722180056|add_content_deliverable_published_at`. Reconstructed from live introspection of the column (`content_deliverables.published_at`: `date`, nullable, no default, no index, existing column comment preserved verbatim) at `supabase/migrations/20260722180056_add_content_deliverable_published_at.sql`. No database write — the column already existed; this file only gives the existing ledger row a source in git.

**0c. Renamed four local files to their true ledger versions**, all git renames, zero SQL content change, zero database writes:

| Old filename (synthetic version) | New filename (true ledger version) |
|---|---|
| `20260717030000_content_attribution_evidence.sql` | `20260717224806_content_attribution_evidence.sql` |
| `20260722000000_firm_onboarding_client_list.sql` | `20260723024820_firm_onboarding_client_list.sql` |
| `20260725000000_content_periods_week_number.sql` | `20260725134001_content_periods_week_number.sql` |
| `20260725130000_firm_onboarding_meta_business_verified.sql` | `20260725202440_firm_onboarding_meta_business_verified.sql` |

The first of these (`content_attribution_evidence`) predates the 2026-07-18 freeze and was already correctly classified in the existing evidence matrix as `B_LOCAL_VERSION_NOT_IN_LEDGER_SLUG_MATCHES_ELSEWHERE` — this phase only executed the rename the matrix already called for. The other three are new mismatches from the four post-freeze MCP applications.

**0d. Process rule, restated and now the operative one:** no `apply_migration` via any MCP tool, no raw DDL against this project going forward. The only path onto production is: a reviewed, committed file in `supabase/migrations/`, applied with its **own filename version** as the ledger version, in the same transaction as its SQL — exactly the pattern used in 0a. Once Phase 1 clears `db push --dry-run`, that command becomes the only path, full stop.

**Net effect of Phase 0:** ledger grew by one row (261, was 260) for the Control Room migration that should have existed already. Every other Phase 0 action was a file-only rename or a documentation reconstruction; zero rows were deleted, zero SQL ran against tables other than the four new Control Room ones.

## Phase 1 — scoped, independently verified, NOT executed

The evidence matrix's 72 `B_DUPLICATE_LEDGER_ROWS` entries were re-verified today, 9 days after the original investigation, three ways:

1. **File integrity.** All 72 local files re-hashed (SHA-256) and compared against the matrix's recorded hashes. Zero missing, zero mismatches — no file has drifted since 2026-07-18.
2. **Ledger presence.** For every pair, both the version matching the local file's current name and the "other" ledger version the matrix recorded were confirmed still present in today's live ledger. Zero gaps.
3. **Direction of the fix, derived independently and cross-checked against the remediation design doc's own worked description.** For 70 of the 72 pairs, the version matching the local file's current name follows a synthetic pattern (either a bare date with no time component, or a 14-digit timestamp ending in a sequential counter suffix `...000001`–`...000009`), while the second ledger version is a realistic apply-timestamp. This was derived from the raw version strings alone, then cross-checked word-for-word against `MIGRATION_LINEAGE_REMEDIATION_DESIGN_2026-07-18.md`'s own Option 1 description — it names the exact same direction: rename local files to their "true, ledger-recorded version," leaving that row untouched, and revert only "the erroneous duplicate rows... matching the RENAMED local files' OLD, SYNTHETIC version numbers." The two derivations agree on all 70 pairs.

**2 of the 72 rows are one anomaly, not two ordinary pairs:** `screened_leads_consent`. Two separate committed files both claim this migration (`20260626000004_screened_leads_consent.sql` and `20260626203055_20260626_screened_leads_consent.sql`), each one's own version matching the *other* file's "duplicate" ledger row. This is the file-duplication problem the 2026-07-18 investigation flagged separately as "a source-control cleanup, not a database operation." **Excluded from the Phase 1 batch below**; needs its own resolution (read both files, determine which is stale, per the existing investigation's own findings) before touching those two ledger rows.

**Not touched, per the existing investigation's own split, unchanged by this phase:**
- 5 ledger rows genuinely untraceable after exhaustive search (`content_studio_format_taxonomy`, `content_studio_doctrine_p0`, `content_studio_compliance_formats`, and two others) — no local file exists to reconcile against; requires a human decision (accept as permanently orphaned bookkeeping, or reconstruct from schema introspection the way 0b did).
- 1 row (`enable_required_extensions`, `20260518193933`) with a real source on `main` filed under a different version — same B-class problem as the four Phase 0 renames, not yet resolved.
- 1 row (`pdf_artifact_integrity`, `20260713185849`) with its source sitting on an unmerged branch (`feat/deliverable-suggestions-release`) — needs a cherry-pick or merge decision, not a rename.

### The gap this document is explicit about

`MIGRATION_LINEAGE_REMEDIATION_DESIGN_2026-07-18.md` sets a six-element proof standard per pair before any row may be touched. This phase's verification clears elements 1, 3, 4 and 6 in substance (same logical migration; no independent effect on the synthetic row beyond what the true row also has, confirmed via the pattern-and-doc cross-check; no other file/script references the synthetic version numbers by exact string, checked by search; and a full ledger snapshot was captured before any write — see `ledger_backup_2026-07-27.txt`, kept outside the repo in the session scratchpad, not committed).

**Elements 2 and 5 are not fully cleared in this environment.** Element 2 (SQL-hash or independent schema-effect comparison per pair) was not performed individually for all 70 remaining pairs — only file-hash stability since the last investigation. Element 5 (rehearsal against an isolated/disposable database) could not be performed: this environment has no Supabase CLI installed and the Docker daemon is not running, so no local Postgres replay was possible. Phase 0's file changes get partial coverage of element 5 for free once this branch's PR runs CI's existing "Publication concurrency integration tests (real Postgres)" job, which replays every file in `supabase/migrations/` into a disposable Postgres — but that job validates that local replay still *succeeds*, not that reverting the 72 specific ledger rows in Phase 1 produces the *same production state*, since ledger deletion is not a file-content change CI can exercise.

## Open decision

Phase 1 (delete 70 duplicate ledger rows, per the mapping fully derived and captured in this session's scratchpad) is ready to execute — backed by a full pre-change ledger snapshot, metadata-only, reversible by re-insertion — but stops short of the design document's own stated bar on elements 2 and 5. Proceeding now means accepting that gap in exchange for the strong indirect evidence above (byte-identical files, ledger rows unchanged in 9 days, direction independently derived twice and agreeing exactly with the design document's own worked example). Waiting means acquiring Supabase-CLI or Docker-daemon access first and performing elements 2 and 5 properly before any of the 70 rows are touched.

This is a risk-tolerance call, not a technical one — recorded here rather than decided unilaterally.
