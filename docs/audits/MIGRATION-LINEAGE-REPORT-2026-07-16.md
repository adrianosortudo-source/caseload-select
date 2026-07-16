---
doc-type: audit
scope: supabase-migration-lineage
auditor: Claude Sonnet 5 (corrective-release finding 8)
date: 2026-07-16
status: complete
---

# Migration lineage report, 2026-07-16

Comparison of the production Supabase migration ledger (`ssxryjxifwiivghglqer`,
queried live via `list_migrations`) against `supabase/migrations/*.sql` in this
repository, at repository tip `322de19` (origin/main after PR #36). Read-only
comparison; no repository file outside this report and the two trivial
stale-reference fixes below was modified as part of this check, and no
production schema was touched.

Method: for every ledger entry, checked for a repository file whose filename
prefix exactly equals the ledger's recorded `version`. The reconciliation
convention this repo already uses (established by PR #23 and PR #28,
"reconcile N migration filenames to their actual production versions") is
that the filename prefix must equal the full-precision applied version, with
the migration's original/authoring name preserved as a suffix where it
differs (e.g. `20260715191243_20260715130200_publication_receipts.sql` for
ledger version `20260715191243`, name `20260715130200_publication_receipts`).
Older migrations (pre-2026-06-05, short `YYYYMMDD_name` filenames) predate
that convention; Supabase's own tooling assigns them a full-precision applied
timestamp at push time that legitimately differs from the authoring-date
filename. That is expected, normal Supabase behavior, not drift, and is not
itemized below -- this report only surfaces cases where the exact-precision
convention was in effect (2026-07-01 onward, and any renamed/reconciled
migration explicitly) and still doesn't hold.

## Confirmed clean

Every migration from `20260702152906` (`promote_scoring_port_default_on`)
through `20260715231733` (`publication_receipt_hardening_supplement`) --
which is the entire lineage this corrective release's findings 1-6 actually
touch -- has an exact filename-prefix match in the repository. No drift in
the neighborhood this release modifies.

## Findings

### 1. Seven production-applied migrations have no repository file at all

Confirmed two ways: (a) no file anywhere under `supabase/migrations/` has a
matching filename prefix, and a full-text grep of the directory for the
migration's evident subject matter (`deliverable_suggestion`,
`fee_detail_fields`) found nothing; (b) for the two spot-checked cases, the
live schema was queried directly and the objects exist and are real:
`deliverable_suggestions` and `deliverable_suggestion_events` tables are
live in `public` (via `information_schema.tables`), and
`publication_artifacts_dedupe_idx` is a live unique index on
`publication_artifacts` (via `pg_indexes`) whose definition matches exactly
what its ledger name implies.

| Ledger version | Ledger name | Repo file |
|---|---|---|
| `20260712183638` | `add_firm_profile_fee_detail_fields` | none found |
| `20260713185849` | `pdf_artifact_integrity` | none found |
| `20260713234759` | `deliverable_suggestions` | none found |
| `20260713235455` | `deliverable_suggestion_atomic_workflow` | none found |
| `20260714001604` | `deliverable_suggestion_fk_indexes` | none found |
| `20260714011950` | `deliverable_suggestion_release_hardening` | none found |
| `20260715232702` | `20260715234500_publication_artifacts_dedupe_partial_index` | none found |

These seven are consecutive or near-consecutive in the ledger and sit
immediately before the `publication_metadata`/`publication_artifacts` series
that IS fully present (`20260714141535` onward), suggesting these were
applied directly (Supabase MCP `apply_migration` or the SQL editor) in a
session that never wrote the corresponding file to `supabase/migrations/`
and never committed it -- the same class of gap PR #23/#28 partially closed
for an earlier batch, recurring here for a later one.

### 2. One filename/version mismatch on a migration merged today

`supabase/migrations/20260716000000_firm_assist_corpus.sql` is the repo file
for the `firm_assist_corpus` migration (merged via PR #34/#36, "Firm
Assist"), but the ledger recorded its actual applied version as
`20260716022452` -- six digits different from the filename's `000000`
placeholder. Same defect class as #1, applied to a migration that landed
during this same release window (a live illustration that the gap in
finding #1 is an ongoing process risk, not only historical).

## What this report does NOT do

Per the corrective-release scope boundary: this is a read-only report, not a
fix. Reconstructing the seven missing migration files (from live schema
introspection, since their original authored SQL is not recoverable from
git history if it was never committed) and renaming
`20260716000000_firm_assist_corpus.sql` to its recorded version belong in a
**separate, non-applied migration-hygiene PR**, not in this corrective
release. No repository migration file's *content* was modified by this
report; the only files this corrective release touches are the stale
filename-reference comments fixed below (pure comment/documentation edits,
zero SQL change) and the new forward-only corrective migrations this release
adds for findings 1 and 4, whose filenames are set to their actual
Supabase-assigned versions from the moment they're applied (per the
requirement that new corrective migrations use their real production-recorded
version from the start).

## Incidental fixes bundled with this report (not migration reconstruction)

Three source comments referenced the pre-reconciliation filename
`20260715195701_content_periods_enforced_monotonic.sql` for a migration
whose real, currently-applied name is
`20260715210116_content_periods_enforced_monotonic.sql` (confirmed applied
to production via the ledger). Fixed as pure comment edits, no SQL changed:

- `scripts/verify-content-periods-enforced-monotonic.sql` (the specific file
  finding 6 asked to correct)
- `src/lib/deliverables.ts` (a docblock reference)
- `src/app/api/portal/[firmId]/periods/[periodId]/deactivate-readiness/route.ts`
  (a docblock reference)
- `src/lib/__tests__/deactivate-period-readiness.test.ts` (also corrected an
  now-inaccurate "NOT applied to production" claim in the same comment --
  the ledger confirms this migration IS applied)

## Update: concurrent-session activity during this same corrective release

Two things happened after this report was first written, both directly
relevant to it and both confirming its own thesis about this repo's
recurring apply-without-committing risk:

1. **Item #1's `20260715232702` gap was closed by a concurrent session,
   independently, before this report could recommend it.** PR #37
   ("chore(migrations): recover missing publication_artifacts dedupe
   partial-index migration") recovered
   `20260715232702_publication_artifacts_dedupe_partial_index.sql`
   byte-for-byte from the ledger's stored `statements` and merged it to
   `origin/main`. No DB change; the recovered file is a no-op on production
   (the version is already in the ledger) and self-healing on a fresh
   build. This item is now resolved; the remaining six items in the table
   above (`add_firm_profile_fee_detail_fields` through
   `deliverable_suggestion_release_hardening`) are still open.

2. **A live collision, in this exact same corrective release, over
   `validate_publication_receipt_scope()`.** While applying this release's
   own finding-1 migration (concurrency locking), a second, independent
   session applied `20260716144315` (`publication_receipt_verification_after_revision_fix`,
   a real, separate correctness fix) to the SAME function moments earlier.
   Because both migrations used `CREATE OR REPLACE FUNCTION` and this
   release's migration was authored from a pre-fetch of the function that
   predated the other session's fix, applying it silently reverted the
   other session's live production fix. Caught immediately (via
   `pg_get_functiondef` inspection right after applying), corrected within
   minutes by a third migration
   (`20260716144723_publication_receipt_reconcile_concurrency_lock_merge.sql`)
   that merges both fixes, and re-verified against production. See this
   release's final report for the full incident account.

   The other session subsequently committed its own fix as PR #39
   (`supabase/migrations/20260716120000_publication_receipt_verification_after_revision_fix.sql`,
   merged to `origin/main`). That file's own filename prefix
   (`20260716120000`) does not match its real, ledger-recorded applied
   version (`20260716144315`) -- **a third, live instance of exactly the
   drift class this report exists to catch, discovered while this very
   report was being written.** This corrective release's own byte-recovered
   copy of the same fix (originally filed at the correct
   `20260716144315_...` name) was removed once PR #39's officially-authored
   version landed, to avoid two files representing the same fix; PR #39's
   file is the one that should eventually be renamed to
   `20260716144315_publication_receipt_verification_after_revision_fix.sql`
   in the migration-hygiene follow-up below. This release's own
   `20260716144510` and `20260716144723` files were both correctly named
   from the moment they were applied and remain so.

This is the same underlying risk finding #1 above describes (apply now,
commit the file later, and meanwhile a second author touches the same
function) -- just observed live, twice, instead of only inferred from the
ledger. It reinforces the recommendation below, particularly the CI-check
item: a same-function collision window would have been far safer with an
`OR REPLACE`-aware CI check flagging "this migration redefines a function
another uncommitted, already-applied migration also touches."

## Recommendation

Open a dedicated migration-hygiene PR (separate from any corrective release)
that: (a) introspects the live schema for the seven objects above and
reconstructs equivalent, idempotent migration files under their correct
ledger-recorded filenames; (b) renames
`20260716000000_firm_assist_corpus.sql` to
`20260716022452_firm_assist_corpus.sql` with identical content; (c) renames
`20260716120000_publication_receipt_verification_after_revision_fix.sql`
(PR #39) to `20260716144315_publication_receipt_verification_after_revision_fix.sql`
with identical content; (d) adds a CI check (or extends an existing one)
that fails a PR introducing a new `supabase/migrations/*.sql` file whose
filename prefix doesn't match what `apply_migration` actually recorded, to
stop this class of drift recurring a fourth time.

## Supplement, 2026-07-16 (second corrective pass): exhaustive full-ledger sweep

Everything above was authored against a targeted window (the range this
corrective release's findings 1-6 actually touch, plus items already known
from PR #23/#28). This supplement, written from a fresh session picking up
this release's remaining findings, instead walks the **entire** live ledger
(114 entries as of repository tip `e91b769c616263fab8636af3948fd90d0dffc3ae`)
against every file under `supabase/migrations/` (165 files), mechanically,
one ledger entry at a time. The full per-entry result is the durable
machine-readable mapping finding 8 (this release's finding 9 in the second
corrective pass) asked for:
`docs/audits/migration-lineage-mapping-2026-07-16.json`.

**Method, precisely.** For each ledger entry: (1) does a repo file's
filename start with the exact recorded `version`? If so, `exact_match` --
this is authoritative by construction, since that version string is what
Supabase itself assigned this file when it was pushed. (2) If not, does a
repo file's name (after its own prefix) equal the ledger's `name`? A match
under a short (8-digit `YYYYMMDD`, or `YYYYMMDD` + a disambiguating
letter) prefix is `legacy_pre_tracking` -- the established, confirmed-normal
pattern this report's own body already documents: Supabase assigns the
real applied timestamp at push time, and an authoring-date filename
legitimately never matches it. A match under a **14-digit** prefix that
still doesn't equal the ledger version is `wrong_prefix_unreconciled` --
that is real, actionable drift (a full-precision timestamp was typed by
hand rather than recorded from the push), not an instance of the
short-form convention. (3) No candidate found by prefix or name anywhere
in the tree: `production_only_no_repository_source`.

**Confirms the existing findings, one now independently closed mid-sweep.**
This report originally named two `wrong_prefix_unreconciled` cases:
`20260716000000_firm_assist_corpus.sql` (recorded version `20260716022452`)
and `20260716120000_publication_receipt_verification_after_revision_fix.sql`
(recorded version `20260716144315`, PR #39). While this supplement was
being written, a concurrent session closed the second one directly (PR
#42, a pure rename to `20260716144315_publication_receipt_verification_after_revision_fix.sql`,
zero content change, citing this report's own finding as the reason). This
supplement's entry for that migration reflects that rename (`exact_match`)
rather than the stale `wrong_prefix_unreconciled` state; only
`firm_assist_corpus` remains open. No new instance of this category was
found beyond what was already known. The six `production_only_no_repository_source`
entries in the `20260712`-`20260714` range are the same six this report
already found (the seventh, `20260715232702`, is now `exact_match`, PR #37
having recovered it, exactly as this report's update section already
notes).

**Extends the existing findings: six additional production-only gaps,
outside the window this report's original sweep covered.** All six are
confirmed by two independent negative searches (no filename-prefix match,
no whole-tree substring match on any plausible fragment of the name) --
not merely "not found by this script," but re-checked by hand:

| Ledger version | Ledger name |
|---|---|
| `20260518193933` | `enable_required_extensions` |
| `20260626100000` | `content_studio_format_taxonomy` |
| `20260626100100` | `content_studio_doctrine_p0` |
| `20260626100200` | `content_studio_compliance_formats` |
| `20260628234330` | `20260626_screened_conflict_checks` |
| `20260628235155` | `20260611_voice_turn_sessions` |

The first is notable: it is the **very first** migration in the entire
production ledger (enabling required Postgres extensions), with no
repository file at all. Consistent with finding 1's own thesis (apply now,
commit the file later) recurring at the very start of this project's
history, not only in its most recent week. These six join the existing
table's seven (now six, post-PR-#37) as `production_only_no_repository_source`
-- reconstruction, per this release's scope boundary, belongs in the same
separate, non-applied migration-hygiene PR already recommended above, not
in this corrective release or its docs-only follow-up.

**Repository-only files: a real regional-cutover explanation for most, eleven
genuinely unaccounted for.** 165 repository files map to only 114 ledger
entries; 63 files have no ledger match at all. Fifty-two of those are
every migration dated `20260413` through `20260516` -- entirely explained
by PR #9 ("chore(supabase): post-migration hygiene after ca-central-1
cutover") and confirmed via `list_projects`: this production project
(`ssxryjxifwiivghglqer`, region `ca-central-1`, created 2026-05-18) is
**not** the project these files were originally applied to. An earlier
project (`qpzopweonveumvuqkqgw`, region `us-east-2`, status `INACTIVE`)
predates it; these 52 files' applied history lives in that now-inactive
project's own ledger, not this one's. They are `legacy_pre_tracking` in
the fullest sense -- pre-dating this production ledger's own existence --
not a gap in this repository.

Eleven files remain genuinely unaccounted for after that explanation, all
dated within this ledger's own active window (`20260617` through
`20260626`), plus one non-timestamped operator script:

```
20260617_firm_onboarding_customer_base.sql
20260623_deliverables_article_meta.sql
20260623_deliverables_review_notified_at.sql
20260623_firm_analytics_config.sql
20260624_content_studio_foundation.sql
20260624_deliverables_kicker.sql
20260625_firm_onboarding_v2_phase1_bing_apple_fees.sql
20260625_screened_leads_contact_postal_code.sql
20260626_fix_cron_health_http_correlation.sql
20260626_screened_leads_consent.sql
OPERATOR_APPLY_supabase_admin_default_acl.sql
```

Per finding 9's own instruction ("if historical equivalence cannot be
proven, report the exact unresolved entries rather than guessing"), no
claim is made about these: they may be committed-but-never-pushed files, a
name divergent enough from its own ledger entry's recorded name that this
sweep's matching missed a real pairing, or (for the `OPERATOR_APPLY_`
script specifically, whose name itself signals a manually-run, ledger-
untracked action) legitimately outside the migration-ledger's own scope.
Resolving which is which needs the same live-schema introspection the
migration-hygiene PR above already has to do for the
`production_only_no_repository_source` rows, and belongs there, not here.

**What this supplement does not do**, for the same reason the original
report didn't: no repository migration file's SQL content was modified,
no file was renamed, and no production schema was touched. Everything
above is read-only comparison of two things that already exist: the live
ledger and the repository tree.
