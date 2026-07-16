---
doc-type: runbook
scope: release-process
status: active
---

# Release checklist

Applies to every release that touches production: schema migrations,
application deploys, or any direct production data operation. This is the
first checklist of its kind in this repo (added by the 2026-07-16
corrective release, finding 7); extend it, do not replace it silently.

## Scope declaration (mandatory)

Every release report or PR description that touches production must
distinguish these four categories explicitly, and must never collapse them
into a single blanket claim like "no production data updates" when any of
the first three occurred:

1. **Migrations / schema deployment.** DDL applied to production
   (`CREATE`, `ALTER`, new functions/triggers/constraints). List the exact
   migration versions and confirm them against the production ledger
   (`list_migrations`).
2. **Rollback-only verification.** Any `BEGIN ... ROLLBACK`-wrapped script
   run against production to prove a migration or invariant works. State
   that it left zero residue (verify row counts after, as this release's
   own verify scripts do).
3. **Read-only production inspection.** Any `SELECT` against production
   used to check state, count rows, or confirm a live schema object. No
   write occurred; say so plainly.
4. **Append-only production reconciliation writes.** Any INSERT of real
   rows into production outside a rollback -- e.g. the Founder Vesting
   validation run that inserted 9 real `publication_artifact_validations`
   rows (`docs/reconciliation/founder-vesting-artifact-validation-2026-07-15.md`).
   These are real, permanent history. Never describe a release that
   contains one as having made "no production data updates."

## Any future production reconciliation write requires

- **Explicit scope declaration**, before the write, in the durable record
  for that release: which table(s), how many rows, why.
- **A durable receipt** after the write: exact row count inserted, the
  query used to confirm it, and a link to (or inline copy of) the
  verification query's result. The existing reconciliation docs under
  `docs/reconciliation/` are the model to follow.
- Sign-off from whoever is doing the release that the write is genuinely
  append-only (no UPDATE, no DELETE) and matches the schema/insert shape
  the application itself would have produced, not a hand-shaped
  approximation.

## Standard sequence for a corrective/security release

1. Fetch `origin/main`; audit current code against the intended findings.
   Concurrent sessions may have already resolved some -- verify against
   actual code, not stale findings text.
2. Implement on an isolated worktree/branch.
3. For each new migration: verify with a rollback-wrapped script against
   production BEFORE treating it as final, then apply for real, then
   confirm its real assigned version in the ledger, then name the
   repository file to match that version exactly (never a placeholder or
   guessed timestamp left uncorrected).
4. Run targeted tests, then the full suite, typecheck, lint, and a
   production build.
5. Push, open a PR, review adversarially, address findings.
6. Merge only after required checks pass.
7. Deploy the application.
8. Read-only, authenticated production smoke test.
9. Report using the four-category scope declaration above.

## Known gap this checklist does not yet close

Migration-lineage drift (a production-applied migration with no matching
repository file) has recurred at least twice in this repo's history
(`20260605_security_lockdown_anon_authenticated.sql`, recovered 2026-06-09;
`publication_artifacts_dedupe_partial_index`, recovered via PR #37;
six further gaps open as of `docs/audits/MIGRATION-LINEAGE-REPORT-2026-07-16.md`).
A CI check that fails a PR introducing a migration whose filename doesn't
match its actual `apply_migration`-recorded version would close this
structurally rather than relying on each release to notice it by hand --
tracked as a recommendation in that report, not yet implemented.
