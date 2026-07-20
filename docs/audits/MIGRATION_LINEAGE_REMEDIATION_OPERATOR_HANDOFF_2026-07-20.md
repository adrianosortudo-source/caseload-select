---
doc-type: audit
scope: supabase-migration-lineage-remediation-handoff
auditor: Claude Sonnet 5 (operator-facing handoff pass)
date: 2026-07-20
status: HANDOFF ONLY — no migration, ledger, or production change was made or proposed for immediate execution by this document. The 2026-07-18 freeze remains fully in force.
related-docs:
  - docs/audits/MIGRATION_LINEAGE_INCIDENT_2026-07-18.md (the freeze and the full 73/7 reconciliation)
  - docs/audits/MIGRATION_LINEAGE_REMEDIATION_DESIGN_2026-07-18.md (the three options, Option 1 preferred-candidate, acceptance gates)
  - docs/audits/MIGRATION_LINEAGE_EVIDENCE_MATRIX_2026-07-18.csv (full per-file mapping)
  - docs/audits/MIGRATION_LINEAGE_ZERO_SOURCE_INVESTIGATION_2026-07-18.md (the 7-item three-way split)
  - docs/audits/PUBLICATION_OPERATOR_REOPENING_GATES_2026-07-18.md (Publication Operator consequences)
---

# Migration-lineage remediation: operator handoff, 2026-07-20

## What this document is

A condensed, action-oriented handoff over the four already-merged 2026-07-18 audit/design documents above, for an operator or data-engineer who needs to know exactly what has to happen before any migration-lineage remediation action touches production. It does not add new findings and does not change any conclusion in the source documents — it only re-sequences them into "what to decide" and "what to require," so a reader does not have to reconstruct that from four separate long-form documents. Where this handoff summarizes a number or a claim, the source document is cited; treat the source document as authoritative if the two ever appear to disagree.

**This document performs no remediation. It creates no migration, applies no schema change, and reverts no ledger row.** It exists on its own new branch, uncommitted-to-`main`, not pushed.

## 1. The freeze, restated

No `supabase db push` (non-dry-run), `migration repair`, `db pull`, new baseline application, or filename rename of an already-applied migration against project `ssxryjxifwiivghglqer`, until a human/data-engineer-approved remediation design is executed. Read-only investigation, local development, and `supabase start` against a fresh local/CI Postgres remain unrestricted. Source: `docs/audits/MIGRATION_LINEAGE_INCIDENT_2026-07-18.md` §1.

## 2. The 73 duplicate-ledger pairs

Production's ledger carries 256 rows for 180 local migration files. 73 of those local files each correspond to a ledger row that is a duplicate of another ledger row already carrying the same logical migration under a different (true) version — 72 pairs where the local file's own synthetic version also has its own ledger row, plus 1 pair where it does not (`20260626203055_20260626_screened_leads_consent.sql`, which is itself part of the separate Workstream C matter below, not an independent 74th pair). Full per-pair list: `docs/audits/MIGRATION_LINEAGE_INCIDENT_2026-07-18.md` §B and `docs/audits/MIGRATION_LINEAGE_EVIDENCE_MATRIX_2026-07-18.csv`.

**No pair may be included in an execution plan without all six of the following, individually, per pair — a batch-level disposable-database rehearsal (§5 below) is necessary but does not substitute for this:**

1. **Same logical migration.** The local file (at its synthetic version) and the true-version ledger row represent the same authored change, not two different changes sharing a name.
2. **Same SQL hash or equivalent schema effect.** Hash-compared where original SQL text is available; where it is not (Supabase's ledger does not retain submitted SQL text), the resulting schema effect — columns, constraints, indexes, triggers, functions — is independently confirmed equivalent via live introspection.
3. **No unique production effect represented only by the synthetic row.** Confirms the synthetic version's ledger row is a genuine duplicate, not a second distinct operation that happens to share a name.
4. **No later migration, script, or doc depends on the synthetic version number specifically.**
5. **Rehearsed against an isolated copy / disposable database**, individually or as part of a full-batch rehearsal — never assumed correct by analogy to other pairs.
6. **Independently captured before/after ledger snapshots for that pair specifically** — not only a single before/after snapshot of the whole 256-row table, which would show the aggregate change but not prove any one pair's revert was individually correct.

As of the source documents' authoring date, ~59 of the 73 true versions were already independently verified by the separate `migration-lineage-normalization` investigation via direct `schema_migrations` cross-check; the remaining ~14 need the same individual confirmation before Option 1's rename step touches them. None of the six-element proof has been completed for any of the 73 pairs as of this handoff. Source: `docs/audits/MIGRATION_LINEAGE_REMEDIATION_DESIGN_2026-07-18.md` §5 (Option 1) and §6 (Workstream F).

## 3. The seven unresolved historical entries

Seven production ledger rows have no local file matching them by version or slug. That single matching fact is not one uniform claim — the seven split three ways (full per-item evidence: `docs/audits/MIGRATION_LINEAGE_ZERO_SOURCE_INVESTIGATION_2026-07-18.md`):

**Genuinely untraceable (5) — no file on any branch, no commit-message trace, no historical commit anywhere in this repository's git history:**
- `content_studio_format_taxonomy` (20260626100000) — UNKNOWN, no reconstruction candidate beyond an unverifiable spec-doc citation.
- `content_studio_doctrine_p0` (20260626100100) — UNKNOWN, no reconstruction candidate.
- `content_studio_compliance_formats` (20260626100200) — INFERENCE only; a maintained code comment in `src/app/api/admin/content-studio/pieces/route.ts` names this migration as the source of a live CHECK constraint's format list, but that is corroboration of intent, not the original DDL text.
- `add_firm_profile_fee_detail_fields` (20260712183638) — INFERENCE only; 3 unaccounted nullable-text columns on `firm_onboarding_intake` are a plausible but unconfirmed candidate.
- `standing_publishing_authorization_notification_pref_null_fix` (20260717231158) — UNKNOWN. **Correction to the incident report:** the incident report's claim that this gap is "already documented in `CLAUDE.md` as a known, deliberately-unreconstructed gap" could not be independently verified; a live full-text search of `CLAUDE.md` found no such note. Do not repeat that claim as fact without re-checking `CLAUDE.md` at the time.

All 5 would require genuine reconstruction (new SQL, written now, from schema shape and any recovered external memory) at the same evidentiary bar the historical baseline file used — cross-referencing two independent sources, never schema shape alone — if they are ever formally recovered. None should be reconstructed without new evidence surfacing first.

**Source exists on `main`, lineage mismatched (1):**
- `enable_required_extensions` (20260518193933) — STRONG EVIDENCE. `20260506000003_pg_cron_pg_net_setup.sql` (already committed, already applied, Category A) contains the content-equivalent `create extension` statements. One open detail: `pg_cron`'s live schema is `pg_catalog`, not the `extensions` schema the file's statement would produce — most likely a Supabase platform-level pre-install, but this is a Supabase-support/docs question, not a git-history question, and remains unresolved. Needs a lineage/cross-reference decision, not reconstruction.

**Verified source on an unmerged branch (1):**
- `pdf_artifact_integrity` (20260713185849) — STRONG EVIDENCE, near-CONFIRMED. `origin/feat/deliverable-suggestions-release:supabase/migrations/20260713185808_pdf_artifact_integrity.sql` matches live production structurally (columns, constraints, and index all byte-identical by introspection). Needs a merge-or-cherry-pick-and-rename, not reconstruction.

**Do not describe all seven as "zero-source."** That characterization is what the source zero-source investigation document itself corrected from its own first draft — 2 of the 7 are much closer to resolved than that phrase implies.

## 4. `screened_leads_consent` — a source-control decision, not a ledger operation

Two committed files on `main` both claim the same logical migration, with contradictory status headers:
- `20260626000004_screened_leads_consent.sql` — header says `STATUS: DRAFT. NOT APPLIED TO PROD` (stale — this file's own subsequent git history is only mechanical rename passes, never a status correction).
- `20260626203055_20260626_screened_leads_consent.sql` — header says `STATUS: APPLIED TO PROD` (credible — correct version-matching filename against the true ledger-recorded version, a dedicated fix commit correcting the header, and independent corroboration via DR-075 in the doctrine registry and a live schema check).

The production ledger already has exactly one correct row for this content, at `20260626203055`. **Resolving this is a git-history hygiene decision — which committed file is deleted — never a `migration repair`, `db pull`, or any other production-ledger operation.** No ledger change is required or appropriate to fix this. Source: `docs/audits/MIGRATION_LINEAGE_REMEDIATION_DESIGN_2026-07-18.md` §3.

## 5. Required authority before any production action

Every item below must be independently satisfied and recorded — not assumed because a prior item was satisfied — before the first production-touching command (including a metadata-only `migration repair --status reverted`) runs. Full checklist: `docs/audits/MIGRATION_LINEAGE_REMEDIATION_DESIGN_2026-07-18.md` §6 (Workstream F).

- **A named data-engineer or the operator**, not "the team" or an implicit approval, has read this handoff plus the four source documents and explicitly approved a specific remediation option (Option 1, a documented alternative, or an explicit decision to leave the ledger as-is) in writing.
- The specific person and exact date of that approval is recorded in the eventual execution's own commit/PR — the same standard `BASELINE_MIGRATION_DECISION_RECORD.md` already used ("Fix, authorized by the operator via explicit prompt").
- A fresh, verified Supabase project backup/export exists, dated after this handoff, before any ledger-write command runs — do not assume the existing weekly backup cadence already covers it; confirm a run from on or after the execution date.
- All 73 pairs have individually-confirmed true versions (§2) and the six-element proof (§2) completed and recorded per pair — not a sample.
- Branch-protection state (`enforce_admins: true` as of 2026-07-18) is re-verified immediately before execution, not assumed unchanged from this handoff's citation of it.
- An explicit rollback boundary is stated in advance for whatever the final execution plan actually is, not inherited unmodified from this handoff or the design document if the plan changes between now and execution.

## 6. Isolated disposable-Postgres rehearsal requirement

Before any ledger-write command runs against production, the full proposed command sequence (rename + revert, for whichever pairs are in scope) must be rehearsed end-to-end against a disposable Postgres instance whose `schema_migrations` table has been seeded to mirror production's actual current duplicate state — not a generic fresh-bootstrap replay. A generic "run all 180 migrations against an empty database" rehearsal (already performed once, 2026-07-17, 87/87 table match) proves the migrations replay cleanly; it does not by itself prove the repair/rename sequence behaves correctly starting from today's duplicated ledger state, which is the actual production starting condition. Source: `docs/audits/MIGRATION_LINEAGE_REMEDIATION_DESIGN_2026-07-18.md` §5 (Option 1) and §6.

## 7. Before/after snapshots required for any future production operation

Two independent forms of evidence, both required, neither a substitute for the other:

- **An independent production schema snapshot** (`information_schema` + `pg_constraint` + `pg_indexes` + `pg_policies`), taken immediately before remediation begins and stored alongside the execution's evidence artifacts, so any post-remediation drift is detectable by diff rather than by memory.
- **Post-change verification via two independent methods**: (a) `select count(*) from supabase_migrations.schema_migrations` matches an exact expected new total, computed and stated in advance of running the command, then checked, not assumed correct after the fact; (b) `supabase migration list --linked` and `supabase db push --dry-run` both run cleanly against production afterward, with their actual output — not just exit code — captured and attached as evidence.

Per-pair, not only aggregate: §2's six-element proof already requires an independently captured before/after snapshot for each of the 73 pairs individually, since an aggregate 256-row snapshot would show the total change but not prove any single pair's revert was correct in isolation.

## 8. CI real-Postgres tests do not validate production

**Stated explicitly, because it is easy to conflate:** this repository's CI job "Publication concurrency integration tests (real Postgres)" runs `supabase start` against a fresh, disposable Postgres instance inside the CI runner's own Docker environment. It never connects to `ssxryjxifwiivghglqer`, never reads the real `supabase_migrations.schema_migrations` table, and cannot observe any Supabase-platform-specific behavior — connection pooling, platform-level extension pre-installs (see §3's `pg_cron` schema-placement finding for a concrete example of exactly this kind of platform behavior going unobserved by a disposable rehearsal), Supabase Auth/Storage internals, or real `pg_cron` scheduling. It proves migration replay correctness and application-code correctness against a genuine, but throwaway, local Postgres server. **"CI's real-Postgres job passed" is necessary evidence and is not sufficient evidence that a production ledger operation is safe.** Treat it as one of several required preconditions (§5, §6), never as the acceptance gate on its own.

Separately, noted because it affects how much weight this specific CI job's green status can carry at all: one of the four real-Postgres-gated integration test files in this repository, `content-attribution-scope.integration.test.ts`, is not currently run in that CI job — not locally (missing `pg` package / `DIRECT_DATABASE_URL`) and not in CI either. Confirm this gap is closed, or is confirmed irrelevant to whatever remediation execution touches, before relying on that job's green status for anything involving that code path. Source: `docs/audits/MIGRATION_LINEAGE_REMEDIATION_DESIGN_2026-07-18.md` §1 and §6.

## 9. What this handoff explicitly does not do

It does not select a remediation option — Option 1 (targeted per-row rename + revert) is the source design document's preferred candidate pending independent data-engineer approval, not a decision this handoff makes or ratifies. It does not perform, schedule, or partially execute any part of the six-element per-pair proof, the disposable-database rehearsal, or the snapshot requirements it describes. It does not resolve the `screened_leads_consent` file duplication. It does not touch production schema, data, or the migration ledger. It does not unblock the Publication Operator's two proposed migrations or the constrained Publishing Agent build — both remain gated on this exact remediation being executed and independently re-verified afterward, per `docs/audits/PUBLICATION_OPERATOR_REOPENING_GATES_2026-07-18.md`.
