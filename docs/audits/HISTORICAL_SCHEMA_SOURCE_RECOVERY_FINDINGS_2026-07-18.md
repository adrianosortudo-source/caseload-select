# Historical Schema-Source Recovery — Investigation Findings (2026-07-18)

Read-only investigation. No new migration files, no renames, no `migration repair`, no `db pull`,
no push, no PR, no merge. This document is the only artifact produced.

## Summary

The `db push --dry-run` refusal (see `PHASE1_DB_PUSH_DRYRUN_2026-07-18.log`) listed 89 production
ledger versions with no local file match on this branch. Cross-referencing those 89 by name against
every local file (matched under any version, not just the exact one `db push` expected) shows:

- **72 of 89 are not missing content at all.** They are duplicate ledger rows: production has two
  ledger entries with the *same name* for the *same content*, at two different versions (the same
  pattern already documented for `firm_assist_corpus`, `seo_audit_runs`, and `cadence_engine_shadow`
  in the schema-parity corrective audit). This branch has one local file matching one of the two
  rows; the other row shows up as "not found" purely because nothing targets its specific version
  number. Not a content gap, a ledger-history duplication artifact.
- **17 of 89 are genuinely not covered by any local file on this branch, under any name.** These are
  the real subject of this investigation.

Full classification: `discrepancy-classified.json` (not committed, working data; the 17-item list is
reproduced below with disposition).

## The 17 genuinely uncovered items, by disposition

| Version | Name | Disposition |
|---|---|---|
| `20260412235959` | `historical_baseline_pre_cutover` | **Real source exists, on other branches** (`chore/supabase-fresh-schema-baseline-2026-07-17` / `71587bb`, and now also merged into `chore/migration-baseline-reconciliation-2026-07-17`). Deliberately out of scope for this branch's design (Phase 1 was filename-only on `origin/main`, which never had this file). |
| `20260611000000` | `voice_turn_sessions` | **Real source exists**, found at `supabase/migrations/20260611000000_voice_turn_sessions.sql` on `chore/migration-baseline-reconciliation-2026-07-17` (see below), exact true version. |
| `20260626000000` | `screened_conflict_checks` | **Real source exists**, same branch, `supabase/migrations/20260626000000_screened_conflict_checks.sql`, exact true version. Also present as a long-lived draft (`supabase/migrations-draft/20260626_screened_conflict_checks.sql`) on many branches including this one. |
| `20260628234330` | `20260626_screened_conflict_checks` | Duplicate ledger row for the same content as above (name carries the date prefix, a `migration repair` artifact). Resolved by the same source. |
| `20260628235155` | `20260611_voice_turn_sessions` | Duplicate ledger row for `voice_turn_sessions` above. Resolved by the same source. |
| `20260626100000` `20260626100100` `20260626100200` | `content_studio_format_taxonomy`, `content_studio_doctrine_p0`, `content_studio_compliance_formats` | **No source found anywhere** (already searched exhaustively in the schema-parity corrective audit's Finding 14/15). Not present on the reconciliation branch either. Genuinely open. |
| `20260712183638` | `add_firm_profile_fee_detail_fields` | **No source found anywhere.** Already documented (Finding 3/15): resulting schema state independently verified via production introspection, but no committed migration text recoverable. Genuinely open. |
| `20260713185849` | `pdf_artifact_integrity` | **Real source exists**, on unmerged branch `fix/restore-marketing-homepage` (commit `1306662`), already ported verbatim onto the schema-parity-corrective branch. Not on this branch or on `chore/migration-baseline-reconciliation-2026-07-17`. |
| `20260713234759` `20260713235455` `20260714001604` `20260714011950` | `deliverable_suggestions` + 3 siblings | **Real source exists**, on `chore/supabase-fresh-schema-baseline-2026-07-17` (`71587bb`) and now also on `chore/migration-baseline-reconciliation-2026-07-17` (merged from the same commit). |
| `20260706200052` | `20260707b_operator_preview_log` | Not a gap. Already-understood mechanism (Finding 12): this branch's local file was deliberately named to match production's *other*, pre-existing ledger row for the same content; this specific row's own historical name was intentionally left untouched, per the corrective task's own instruction not to force name equality. |
| `20260717231158` | `standing_publishing_authorization_notification_pref_null_fix` | **No source found anywhere in the repo**, on any branch. Reads as an in-flight hotfix applied directly to production minutes after the main authorization migration (see below). Deliberately left unreconstructed. |
| `20260518193933` | `enable_required_extensions` | **No dedicated source found.** Very likely trivial (production's ledger inception version; probably just formalizes `CREATE EXTENSION` statements that Supabase's own platform bootstrap already applies by default locally regardless of migration content, similar to `pg_graphql` in Finding 9). Not chased further; low apparent stakes, but unverified. |

**Net: of 17 apparent gaps, 9 have real, locatable source (7 already recovered onto one branch or
another; 2 more need porting), and 8 remain genuinely unresolved** (3 content-studio items, the fee
fields, the notification-fix hotfix, and the extensions migration).

## Significant discovery: `chore/migration-baseline-reconciliation-2026-07-17` already exists

This branch, present both locally and on `origin` (i.e., already pushed to GitHub), was not
something this session created. It is based on current `origin/main` (through PR #55) with exactly
one additional commit:

```
0f8ed29 Merge commit '71587bb' into chore/migration-baseline-reconciliation-2026-07-17
Author: Adriano Domingues <adriano@caseloadselect.ca>
Date:   Fri Jul 17 21:46:30 2026 -0400
```

That single commit merges the schema-parity-corrective workstream's base commit (`71587bb`, the
same commit both this Phase 1 branch and the earlier corrective audit descend from) directly into a
fresh branch off current main. It resolves 7 of the 17 gap items above by virtue of that merge alone
(`historical_baseline_pre_cutover`, `voice_turn_sessions`, `screened_conflict_checks`, and the 4
`deliverable_suggestions` files) plus the two duplicate-ledger-row entries tied to those same
objects.

The author and timestamp indicate this is the operator's own, independent work, done directly via
git, in parallel with the corrective task in this conversation and not something Claude Code did.
Flagging it prominently because it is directly relevant to the next-workstream question and appears
to already be a step ahead of what this investigation would otherwise recommend building.

This document does not evaluate whether that branch's merge was done cleanly (conflict-free) or
whether it introduces its own issues -- that inspection was not in this investigation's scope and
the branch is not this session's to assess uninvited.

## What remains genuinely open regardless of that branch

Even accounting for `chore/migration-baseline-reconciliation-2026-07-17`'s apparent head start, these
are not resolved by it:

1. **3 Content Studio migrations** (`content_studio_format_taxonomy`, `content_studio_doctrine_p0`,
   `content_studio_compliance_formats`) -- no source anywhere, would need reconstruction from
   production introspection following the same evidentiary standard as the schema-parity corrective
   audit's Finding 3/3b.
2. **`add_firm_profile_fee_detail_fields`** -- same, no source anywhere.
3. **`standing_publishing_authorization_notification_pref_null_fix`** -- no source anywhere, reads as
   someone else's in-flight hotfix; should not be reconstructed by inference per the standing
   instruction in this task.
4. **`enable_required_extensions`** -- unverified, likely trivial, not chased to a conclusion.
5. **The ~90-version discrepancy set as a whole has not been individually triaged for
   `migration repair` purposes.** This investigation classified all 89 by name-match only (covered
   vs. not covered by an existing local file); it did not determine, version by version, what a
   correct `migration repair --status ...` disposition would be for each. That triage, plus a
   decision on how to treat the 72 duplicate-ledger-row entries, is still undone.
6. **`pdf_artifact_integrity` and the 2 already-located-but-not-yet-ported items** (the 4
   `deliverable_suggestions` files, `historical_baseline_pre_cutover`) exist on other branches but
   have not been brought onto `origin/main` or this Phase 1 branch.

## No action taken

No file was created, renamed, or modified in `supabase/migrations/` on any branch during this
investigation. No `migration repair`, `db pull`, push, PR, or merge was performed. This report is
the only output.
