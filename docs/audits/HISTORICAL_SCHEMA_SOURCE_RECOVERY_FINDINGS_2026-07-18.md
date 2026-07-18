# Historical Schema-Source Recovery — Investigation Findings (2026-07-18)

Read-only investigation. No new migration files, no renames, no `migration repair`, no `db pull`,
no push, no PR, no merge. This document is the only artifact produced.

## Summary

The `db push --dry-run` refusal (see `PHASE1_DB_PUSH_DRYRUN_2026-07-18.log`) listed 89 production
ledger versions with no local file match on this branch. Cross-referencing those 89 by name against
every local file (matched under any version, not just the exact one `db push` expected) shows:

- **72 of 89 matched an existing local file by name.** Correction, per review: this is *not*
  equivalent to "not missing content" and should not have been characterized as settled. Matching
  the ledger row's `name` string against a local file's base name is the same class of unverified
  inference already flagged as a mistake elsewhere in this investigation (the git-author case) and
  is exactly the shortcut this task's own Workstream 2 rule warns against: "never treat same-name as
  proof of equivalence — must compare bodies/constraints/defaults/RLS/grants directly." For the
  small number of these 72 already spot-checked with real content comparison earlier in this session
  (`firm_assist_corpus`, `seo_audit_runs`, `cadence_engine_shadow`, all in the schema-parity
  corrective audit), the duplicate-row explanation held up under that direct check. **The other
  ~69 have only been name-matched, not content-verified, and must not be treated as closed.** A
  correct disposition requires, per entry: either a direct definition-level comparison (columns/
  constraints/functions/RLS as elsewhere in this workstream) confirming the local file's resulting
  schema state matches what both ledger rows represent, or an explicit acknowledgment that no such
  comparison has been done yet. This document was wrong to summarize the 69 unverified ones as
  "ledger-history duplication artifact" alongside the 3 that were actually checked.
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
| `20260518193933` | `enable_required_extensions` | **Correction: not "likely trivial."** No dedicated source found, and re-checked with real evidence rather than assumption. Production has 8 extensions installed (`pg_cron`, `pg_net`, `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`, `vector` -- confirmed live via `pg_extension`). Of those, `pg_cron`/`pg_net` are covered by `20260506000003_pg_cron_pg_net_setup.sql` and `vector` by `20260716000000_firm_assist_corpus.sql` (both confirmed by direct file read). **`pgcrypto`, `uuid-ossp`, `supabase_vault`, and `pg_stat_statements` have zero tracked local source, under any casing, anywhere in this branch's migrations.** `pgcrypto` and `uuid-ossp` are load-bearing for `gen_random_uuid()`/`uuid_generate_v4()` defaults used across most tables' primary keys -- genuinely foundational, not cosmetic. `supabase_vault` is security-relevant (stores the `pg_cron_token` secret). Whether these are Supabase-platform auto-defaults (like `pg_graphql`, Finding 9) or something a migration must explicitly enable was not resolved by this investigation; that distinction matters and needs direct verification, not assumption, before any reconstruction decision. |

**Net: of 17 apparent gaps, 9 have real, locatable source (7 already recovered onto one branch or
another; 2 more need porting), and 8 remain genuinely unresolved** (3 content-studio items, the fee
fields, the notification-fix hotfix, and the extensions migration).

## Significant discovery: `chore/migration-baseline-reconciliation-2026-07-17` already exists

**Correction (2026-07-18, post-review): this branch's origin is unverified, not attributed.** An
earlier version of this document asserted the commit below was the operator's own manual work,
inferred solely from the git author name. That inference does not hold: this repository's local git
identity is configured once and any process committing through it -- a human running git directly,
or an agent session (this one or another) using the same configured identity -- produces an
identical author field. There is no evidence in the commit itself that distinguishes those cases.
Treat this branch as an **unverified candidate**, not attributed work, until its origin is confirmed
through an independent source (e.g. GitHub's own UI history, a PR description, or the operator's own
direct statement).

This branch, present both locally and on `origin` (i.e., already pushed to GitHub), was not created
by any action in this conversation -- no `git merge`, `git push`, or branch-creation command was run
against it in this session. It is based on current `origin/main` (through PR #55) with exactly one
additional commit:

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

What can be said with confidence: this session did not create the branch or run the merge. What
cannot be said from the commit alone: who or what did. Flagging it prominently regardless, because
it is directly relevant to the next-workstream question and its content is a step ahead of what a
fresh investigation would otherwise need to build from scratch -- but its provenance, whether the
merge was done cleanly (conflict-free), and whether it introduces its own issues are all unverified.
See the follow-up audit below.

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

## Addendum (2026-07-18, same session, following further review): PR #57 confirmed real and independently evidenced

Two follow-ups closed the authorship question this document originally got wrong, and surfaced
material new evidence.

**`chore/migration-baseline-reconciliation-2026-07-17` is PR #57**, open on GitHub right now
(`gh pr view 57`), titled "chore(migrations): reconcile fresh-schema baseline gap and filename
collisions," base `main`, 126 files changed, `MERGEABLE`. Its own body is written in first person as
an agent describing its actions ("I did not re-author it from scratch... I independently re-verified
its central claim before merging... rather than trusting the branch on its word") and carries the
standard `🤖 Generated with [Claude Code]` footer. The PR references its own evidence document,
`docs/BASELINE_MIGRATION_DECISION_RECORD.md`, which states its own authorship directly: **"Author:
Claude (autonomous baseline workstream), 2026-07-17."** This is a different Claude Code session than
this one (no merge, push, or PR-open action was taken by this session at any point) -- not
attributed to the operator manually, and not this session's work either. Treat as: a separate agent
session's output, real and pushed to GitHub, provenance now confirmed via the PR's own content
rather than inferred from git author metadata.

**The decision record substantially overlaps with and extends this investigation's own findings.**
It independently arrives at the same root cause (production was migrated from an older Supabase
project via dump/restore on 2026-05-18, not by replaying this repo's migrations) and identifies the
same `screened_conflict_checks` / `voice_turn_sessions` gap this investigation found, plus a third
table in the same class this investigation had not separately identified: **`screened_conflict_parties`**.
It also documents 13 additional tables (`firm_lawyers`, `conflict_register`, `screened_leads`, and
others) that have a local `CREATE TABLE` file but no production ledger entry -- explained there as
pre-cutover files that applied to the old project and carried over in the dump/restore, not
divergent content. That explanation is evidenced (dated file provenance, cross-checked against the
cutover timeline) but was not independently re-verified by this investigation.

**PR #57's own required CI check currently fails, on a different and more specific defect than this
session's local Docker issues.** `Publication concurrency integration tests (real Postgres)`: all
three integration test files failed within 795ms with `Error: getaddrinfo EAI_AGAIN base` -- a DNS
hostname resolution failure on the literal string `base`, not the storage-container health flakiness
documented throughout this session's local attempts. Every assertion skipped. The PR's own body
states its merge criterion explicitly: "If (and only if) the ... check goes green on this PR, I'll
add it to main's required status checks." By that stated criterion, PR #57 does not yet meet its own
bar. The other 5 checks (typecheck, full vitest suite, engine sync, DR-039 eval, Vercel deploy) pass.

**What this changes about the "8 unresolved" list above:** none of the 8 items in this
investigation's table are resolved by PR #57 -- the 3 Content Studio migrations, the fee-fields
migration, the notification-fix hotfix, and the extensions migration are absent from PR #57 too (it
predates all of them; its `71587bb` base commit and its own merge commit both predate the
`content_studio_format_taxonomy`/`add_firm_profile_fee_detail_fields`/notification-fix ledger
versions, which are all dated 2026-06-26 through 2026-07-17). The notification-fix hotfix
specifically was searched for directly on GitHub (`gh search prs`, `gh search commits`, full PR
listing back through #43): **no PR, branch, or commit anywhere in the remote repository references
it.** It remains untraced to any author or origin, on GitHub or in local git history.

## Final source-recovery plan (three categories, per review)

**1. Verified source, ready to incorporate.**
- `pdf_artifact_integrity` -- confirmed on `fix/restore-marketing-homepage` (commit `1306662`),
  already ported verbatim onto the schema-parity-corrective branch.
- `historical_baseline_pre_cutover`, `voice_turn_sessions`, `screened_conflict_checks`,
  `screened_conflict_parties`, `deliverable_suggestions` + 3 siblings -- present as real committed
  files on both `71587bb` and PR #57 (`chore/migration-baseline-reconciliation-2026-07-17`), each
  with a stated evidence source in `docs/BASELINE_MIGRATION_DECISION_RECORD.md` (old-project
  introspection cross-checked against production, or a named git commit). Evidenced, but PR #57
  itself is not yet mergeable by its own stated criterion (failing required check).

**2. Duplicate-ledger anomalies -- reclassified from "requiring no action" to "requiring
verification before any action."** The 72-item name-matched set from the top of this document. 3 of
72 (`firm_assist_corpus`, `seo_audit_runs`, `cadence_engine_shadow`) have already been content-
verified elsewhere in this workstream and can stay in this category. The remaining ~69 have not, and
per review, must not be presumed safe to exclude from a reconciliation plan on name-match alone. This
requires either a direct definition-level comparison per entry, or an explicit decision to fund that
comparison pass as its own scoped piece of work before treating any of them as resolved.

**3. Unresolved historical production changes requiring evidence or a deliberate reconstruction
decision.** The 8-item list above, unchanged by PR #57's existence: `content_studio_format_taxonomy`,
`content_studio_doctrine_p0`, `content_studio_compliance_formats`, `add_firm_profile_fee_detail_fields`,
`standing_publishing_authorization_notification_pref_null_fix` (untraceable to any origin, GitHub
included), and the `enable_required_extensions` gap (now known to cover at minimum `pgcrypto`,
`uuid-ossp`, and `supabase_vault`, none of which are confirmed as Supabase platform auto-defaults).

## No action taken

No file was created, renamed, or modified in `supabase/migrations/` on any branch during this
investigation. No `migration repair`, `db pull`, push, PR, or merge was performed. This report is
the only output.
