# Prospect enrichment production migration

This workflow prepares and, after its own production approval, applies only
supabase/migrations/20260923161812_prospect_enrichment_v1.sql to project
ssxryjxifwiivghglqer. App PR merge, schema activation, pilot, backfill and active
research cutover remain separate approvals. No real research is included here.

The reviewed allowlist is scripts/prospect-enrichment/migration-release.json.
It is mechanically generated from the exact migration filename and UTF-8 bytes:
version, name, byte count and full SHA-256. The guard rejects stale checksums,
changed targets and extra migrations. Do not edit the JSON to hide drift.
After an authorized migration-file change, regenerate the manifest through a
reviewed local change and rerun its tests; never change an applied migration.

## Preparation and owner setup

The existing .github/workflows/ci.yml remains the migration/browser TEST gate:
enrichment deterministic and CLI tests, fresh local Supabase migration bootstrap,
PostgreSQL contract, and synthetic rendered acceptance. The manual
prospect-enrichment-migration-gate.yml is the separate production APPLICATION gate.

The repository owner must configure the existing GitHub environment named
Production prospect migrations before dispatch:

- Restrict deployments to main and require an authorized reviewer. Disable self
  approval and administrative bypass where the account supports those controls.
- Configure CASELOAD_PRODUCTION_SUPABASE_MIGRATOR_DB_URL in that environment using
  an existing, explicitly approved database credential. The guard requires a
  postgresql URL with host db.ssxryjxifwiivghglqer.supabase.co, explicit port 5432,
  database postgres, user postgres, a nonempty password, and exactly the query
  parameter sslmode=verify-full. No other host, pooler, database, user, query
  parameter or implicit credential source is accepted. Never put the value in
  source, workflow inputs, logs or a review artifact. This task neither reads nor
  creates that credential. Missing or invalid configuration stops before CLI
  connectivity.
- Set environment variable PROSPECT_ENRICHMENT_MIGRATION_REVIEWED_SHA to the exact
  reviewed 40-character main commit SHA for this release. A missing or different
  value stops the workflow before any Supabase request. This explicit
  configuration records the reviewed source; it does not replace real approval.

The workflow rejects PG*, SUPABASE_* and DOTENV_* environment overrides,
DOCKER_HOST and NODE_TLS_REJECT_UNAUTHORIZED. It also
rejects the exact project .env files loaded by the pinned CLI, checking names
without reading contents. Both repository root and supabase/ must have no .env,
.env.local, .env.development or .env.development.local. The URL must pass the guard
before every connectivity step. There is no token-only, linked, passwordless,
service-file, .pgpass or alternate endpoint fallback.

The direct endpoint must be reachable from the protected runner and its TLS
certificate must validate with hostname checking. Connection, IPv6, certificate
or authentication failure remains a blocked release. Do not weaken TLS, switch
to a pooler, rotate credentials or create a role to bypass it; an alternate
connection arrangement requires its own reviewed change and explicit approval.

This task does not inspect or configure secrets/environment protection. GitHub
can create an unprotected environment when a name is first referenced, so an
environment name alone is not proof that owner-side protections exist.

Merge PR #312 only after its named approval. Retarget stacked PR #313 to main,
rerun required checks and obtain its separate named approval before its merge.
Then prepare the private release manifest with the merged main SHA, migration
checksum, deployment evidence, exact target and rollback/read-back steps.

## Manual sequence after the appropriate authorization

1. Dispatch Reviewed prospect enrichment migration from main with operation
   dry-run and reviewed_source_sha equal to the current reviewed main SHA.
   The environment's reviewed SHA, dispatch SHA, checkout SHA and freshly fetched
   origin/main must all match. The default dry-run applies no migrations, seeds,
   custom roles or vault changes. It uses only the guarded direct connection.
2. Review the resulting prospect-enrichment-migration-evidence artifact.
   The only pending migration must be the allowlisted enrichment file; seeds
   and roles must both be empty. An already-applied file or an additional pending
   migration fails closed. Do not repair history or widen the allowlist ad hoc.
3. Obtain explicit approval for activation of the scoped enrichment schema and
   operator views. Dispatch again with operation apply, the same still-current
   reviewed source SHA and confirmation APPLY-PROSPECT-ENRICHMENT-V1.
   The protected environment approval is required again. A moved main requires
   fresh source review and configuration, not an arbitrary SHA substitution.
4. The apply step rechecks source/configuration/checksums and a fresh exact plan
   immediately before the single db push. It records that the guarded apply
   attempt started, verifies the apply result, reads exactly the expected migration
   ledger row with a fixed SELECT, and verifies a final empty pending plan. Once
   apply starts, verification also runs after an uncertain apply error. Its SQL
   action is read-only; the connection still requires the protected, explicitly
   authorized database URL. It never retries apply or converts a failed apply
   step into success.
   A failure before the guarded apply attempt does not start this read-back.
5. Retain source-check, plan-check, apply-check, ledger-check and post-apply-check
   from the artifact. Ledger verification checks version/name and complete stored
   SQL text in order against reviewed source bytes. The pinned CLI removes only
   outer whitespace and statement terminators; comments, literals, function
   bodies and remaining text must match. The evidence contains the reviewed
   source SHA and a separate full SHA for the returned statement array.
   These are distinct hash domains, not interchangeable checksums.
6. If apply succeeds but subsequent verification fails, treat the result as
   applied-but-unverified. Do not rerun apply, repair history, delete objects or
   claim success. Retain evidence and resolve through reviewed checks whose SQL
   actions are read-only and whose database connectivity is separately protected
   and authorized.
   Then verify authenticated Admin loading and existing research; this workflow
   alone does not prove application visibility or authorize pilot/backfill.

The workflow shares gta-prospect-migrations-production concurrency with the
historical production migration gates. Historical workflows remain unchanged.
Supabase CLI 2.117.0 and the existing checkout/setup-cli/upload action SHAs are
pinned. Passwordless linked commands are prohibited, including db push --linked,
migration list --linked and db query --linked. In CLI 2.117.0 their shared resolver
can create a write-capable temporary login role; on repeated pooler failures it
can delete the project\'s listed IPv4 network bans. Therefore a linked dry-run or
linked SELECT must never be described or approved as strictly read-only.

Every command in this workflow uses an explicit --db-url. The pinned resolver
returns from its direct-URL branch before building the linked Management API
runtime, so this path cannot call its temporary-role creation or network-ban
deletion helpers. Explicit postgres authentication also avoids temporary-role
step-down. No interactive login, linked/passwordless fallback, direct deployment
or generic SQL execution input exists. Raw CLI/database payloads are not uploaded; only validated
scope/hash evidence is retained.

## Focused local validation

node --test scripts/prospect-enrichment/__tests__/migration-gate.node-test.mjs

The tests use synthetic source/plan/ledger data and inspect the workflow contract.
They do not run Supabase, access credentials, contact production or execute SQL.

The pinned statement/read-query behavior was verified against:
https://github.com/supabase/cli/blob/v2.117.0/apps/cli/src/command-internal/legacy-sql-split.ts
https://github.com/supabase/cli/blob/v2.117.0/apps/cli/src/command-internal/legacy-migration-apply.ts
https://github.com/supabase/cli/blob/v2.117.0/apps/cli/src/commands/db/query/query.handler.ts
https://github.com/supabase/cli/blob/v2.117.0/apps/cli/src/command-internal/legacy-db-config.layer.ts
https://github.com/supabase/cli/blob/v2.117.0/apps/cli/src/command-internal/legacy-db-config.parse.ts
https://github.com/supabase/cli/blob/v2.117.0/apps/cli/src/command-internal/legacy-db-connection.sql-pg.layer.ts
