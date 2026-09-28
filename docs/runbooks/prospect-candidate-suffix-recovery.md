# Prospect candidate suffix recovery

This is a one-time continuation path for the failed complete release run `36460908921`. It does not restart the completed qualification repair, the six enrichment migrations, or the candidate-profile migration. It accepts only the verified nine-migration prefix and the exact remaining suffix:

1. `20260924192549_prospect_enrichment_candidate_firm_coverage.sql`
2. `20260925200000_gta_prospect_operator_database_firm_profile_link.sql`

The failed run's receipts artifact is pinned to artifact `10987967959`, digest `sha256:95cb334af8de26f2ad40ec77175470632016917d191473a08240909818777a6f`, source commit `d3c2b06428fbc6925809a4f1edde60cbdba0da78`, and release receipt `1de623aecc380e6cf6d182637178fd5df2ee3eed33d3375d2225e188f7777ae7`. The workflow verifies the artifact metadata and its internal phase, ledger, catalog and plan evidence. Any changed artifact, migration source, receipt, ledger prefix, catalog prerequisite, or plan stops recovery before a write.

## One run, two protected reviews

Dispatch `.github/workflows/prospect-candidate-suffix-recovery.yml` from the current `main` commit. Enter that exact SHA and the SHA-256 of `scripts/prospect-enrichment/additive-release-review.json`, opt into temporary database credentials, and enter `RESUME-CANDIDATE-SUFFIX-36460908921-V1`.

The first `Production prospect migrations` review authorizes only read-only reconciliation. That job verifies the previous failed-run artifact, confirms the live prefix is exactly nine, confirms both remaining source statements against the database ledger, verifies the operator RPC prerequisite, and dry-runs exactly the two pending candidate migrations. It uploads immutable evidence bound to the new run, source SHA, receipt SHA, project, artifact ID and artifact digest.

After that artifact exists, a second review is required for the dependent writer job. Review its artifact and job summary before approval. The writer rechecks the exact live prefix and dry-run after approval. Any drift from the reviewed evidence exits before migration execution.

## Ordered writes and recovery state

The writer stages each pending migration separately. Before the coverage write it persists `started_unverified`, applies only the coverage migration, and requires the ledger prefix to advance from nine to ten, the final link migration to remain the sole pending item, source statements to match, the coverage catalog objects to exist, and the coverage-only dry-run to be empty. It also resets and verifies the temporary login role's timeout override. Only then does it mark coverage `verified` and request a fresh credential for the final link migration.

The final migration can start only when the local state says coverage is verified. It must then verify the exact eleven-migration release prefix, an empty pending plan, complete source/ledger agreement and the candidate-complete gate. A failure or read-back mismatch leaves the phase `started_unverified`, emits a recovery marker, exits nonzero, and uses GitHub's default step-success dependency so later writes do not run. Do not rerun this workflow after a failed or uncertain write; reconcile the new receipts and live ledger and prepare a new narrowly bound recovery if needed.

The coverage backfill timed out at PostgreSQL's two-minute statement limit. On its temporary Supavisor session-mode login (port 5432), the writer first proves there is no existing role timeout override, sets a role-scoped 180-second statement timeout, confirms it on a new connection, and allows up to 210 seconds for the CLI. It requires at least 270 seconds of credential life before that write, reserving 60 seconds for ledger/catalog/plan read-back and resetting the role default in a `finally` path. The final profile-link write similarly reserves at least 60 seconds for read-back. If budget or reset cannot be proven, the workflow fails closed; the login itself is temporary and expires. Supabase documents session-level settings for Supavisor session mode and role-level settings at [Postgres timeouts](https://supabase.com/docs/guides/database/postgres/timeouts); PostgreSQL documents that ordinary roles may change their own defaults at [ALTER ROLE](https://www.postgresql.org/docs/17/sql-alterrole.html).

Schema completion is still not the project completion condition. After the recovery job succeeds, continue with authenticated Admin Prospects read-back, existing-firm pilot/replay, all-candidate states and filters, full backlog plus delta reconciliation, producer cutover, and A1–A7 acceptance in [the finish plan](prospect-enrichment-finish-plan.md). Do not report a firm as synced until its Admin read-back and import receipt reconcile.
