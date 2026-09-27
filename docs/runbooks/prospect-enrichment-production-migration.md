# Prospect enrichment production migration

This workflow first reconciles verified production migration history, then
prepares and, after its own production approval, applies only the six ordered
migrations in scripts/prospect-enrichment/migration-release.json to project
ssxryjxifwiivghglqer. It stages the complete production migration source history
in a temporary runner directory and excludes exactly two preview-only migrations
from that temporary directory. The repository migrations remain untouched. App
PR merge, schema activation, pilot, backfill and active research cutover remain
separate approvals. No real research is included here.

The reviewed allowlist is scripts/prospect-enrichment/migration-release.json.
It is mechanically generated from the exact migration filename and UTF-8 bytes:
version, name, byte count and full SHA-256 for each file. The closed ordered set is
20260923161812, 20260923174500, 20260923182000, 20260923221500, 20260924071322,
and 20260924093317. These provide the enrichment schema, identity/evidence/target
read RPCs, durable held-candidate evidence, and the operator RPC-v2 projection.
The guard rejects missing, extra, duplicate or reordered files, stale checksums
and changed targets. Do not edit the JSON to hide drift.
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

Run this workflow only from the reviewed main commit containing the production
migration gate and its exact migration sources. Record the exact main SHA, target,
release manifest checksum, deployment evidence and rollback/read-back steps in the
private release record. Each dispatch must use that same still-current reviewed
SHA; a changed main requires a fresh source review and protected environment SHA
configuration. This documentation does not assert that any production operation
has been run or that production was changed.

## Manual sequence after the appropriate authorization

1. Confirm the `Production prospect migrations` environment already has the reviewer protections and approved direct database URL described above. Configure `PROSPECT_ENRICHMENT_MIGRATION_REVIEWED_SHA` to the exact reviewed 40-character main SHA. Every dispatch's `reviewed_source_sha`, this configured value, checkout SHA and freshly fetched `origin/main` must match. Do not dispatch stale runs; a changed main requires renewed review/configuration.

2. Run the read-only qualification catalog preflight first. Dispatch **Reviewed prospect enrichment migration** from `main`, operation `qualification-preflight`, the reviewed SHA, and no confirmation/catalog SHA. The workflow stages byte-verified full production migration history, preserves `supabase/config.toml`, and excludes only these two preview migrations from the fresh temporary staging directory: `20260915183000_preview_qa_session_registry.sql` and `20260916030440_preview_qa_registry_privilege_hardening.sql`. Repository copies remain unchanged. Every other production migration source must be present and byte-identical. Full-ledger validation requires the only pending files to be the two qualification migrations plus the six enrichment migrations; unexpected/missing/remote-only versions or name mismatches fail closed.

   The workflow applies the exact qualification migration sources to a scratch PostgreSQL fixture, reads the production catalog contract, and compares all 14 tables and their columns/defaults, constraints, indexes, policies, triggers, owners, RLS flags, and table/column privileges for `anon`, `authenticated` and `service_role`. Review artifact `qualification-catalog-preflight-evidence`, including `qualification-catalog-check.json`, the full-ledger check and staged inventory. Confirm exact catalog match; record `productionCatalogSha256` (64 hex characters) from the reviewed check artifact. This operation reads production catalog/ledger only; it applies no production SQL and changes no production history.

3. Only after reviewing that artifact and explicitly approving the separate metadata repair, dispatch operation `qualification-repair` from the same reviewed SHA. Set `reviewed_catalog_sha256` to the exact `productionCatalogSha256` from the separately reviewed preflight artifact and confirmation to `RECONCILE-QUALIFICATION-HISTORY-V1`; protected environment approval is required. The workflow repeats source, full-ledger and scratch-vs-production catalog checks immediately before repair, and requires the reviewed catalog hash/confirmation. It runs only `supabase migration repair --db-url <protected-url> --status applied 20260921120000 20260921121500`. This is a metadata-only ledger repair: it does not execute those two SQL files or alter schema. It verifies the ledger delta is exactly those two versions and that exactly six enrichment migrations remain pending. Review/retain the repair delta and full-ledger evidence. Any discrepancy blocks release; do not broaden/retry repair or substitute schema changes.

4. After that exact repair delta is reviewed, dispatch operation `dry-run` from the same still-current SHA. Review `prospect-enrichment-migration-evidence`: staged inventory, full-ledger check and plan check. The full history must now show precisely the six allowlisted enrichment migrations pending, in exact order; seeds and roles must be empty. Missing, applied, duplicate, reordered or additional migrations fail closed. A partial set blocks release. This dry-run applies no migrations, seeds, roles or vault changes.

5. Obtain separate explicit approval to activate the scoped enrichment schema and operator views. Dispatch operation `apply`, same current reviewed SHA, confirmation `APPLY-PROSPECT-ENRICHMENT-V1`; protected environment approval is required again. A changed main restarts source review/configuration.
6. The apply step rechecks source/configuration/checksums and a fresh exact plan
   immediately before the single db push. It records that the guarded apply
   attempt started, verifies the apply result, reads exactly the expected
   six ledger rows with one fixed, version-scoped SELECT, and verifies a final
   empty pending plan. Once apply starts, verification also runs after an uncertain apply error. Its SQL
   action is read-only; the connection still requires the protected, explicitly
   authorized database URL. It never retries apply or converts a failed apply
   step into success.
   A failure before the guarded apply attempt does not start this read-back.
7. Retain source-check, plan-check, apply-check, ledger-check and post-apply-check
   from the artifact. Ledger verification requires exactly six ordered unique rows,
   checks each version/name and complete stored SQL text against that file's
   reviewed source bytes, and rejects omitted or substituted rows. The pinned CLI
   removes only
   outer whitespace and statement terminators; comments, literals, function
   bodies and remaining text must match. The evidence contains the reviewed
   source SHA and a separate full SHA for the returned statement array.
   The ledger proof contains six per-file source/statement hashes and
   releaseManifestContentSha256, which hashes compact JSON.stringify(manifest).
   source-check separately records releaseManifestSha256 for the exact saved
   manifest-file bytes. These are distinct hash domains, not interchangeable
   checksums.
8. If apply succeeds but subsequent verification fails, treat the result as
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

The focused suite covers all six committed feature migrations, source/hash
coverage, omitted/extra/reordered plans, six-row identity/content read-back,
per-file statement tampering and all original connection/approval protections.
On Windows, its source-coverage fixture compares the unchanged CRLF checkout to
the exact LF Git blobs; production verification hashes the checked-out bytes
without normalization. The Ubuntu workflow uses the committed LF bytes.
The tests use synthetic source/plan/ledger data and inspect the workflow contract.
They do not run Supabase, access credentials, contact production or execute SQL.

The pinned statement/read-query behavior was verified against:
https://github.com/supabase/cli/blob/v2.117.0/apps/cli/src/command-internal/legacy-sql-split.ts
https://github.com/supabase/cli/blob/v2.117.0/apps/cli/src/command-internal/legacy-migration-apply.ts
https://github.com/supabase/cli/blob/v2.117.0/apps/cli/src/commands/db/query/query.handler.ts
https://github.com/supabase/cli/blob/v2.117.0/apps/cli/src/command-internal/legacy-db-config.layer.ts
https://github.com/supabase/cli/blob/v2.117.0/apps/cli/src/command-internal/legacy-db-config.parse.ts
https://github.com/supabase/cli/blob/v2.117.0/apps/cli/src/command-internal/legacy-db-connection.sql-pg.layer.ts

## All-candidate profile scope

The current read-shape/profile search correction does not complete manifest-only candidate enrichment. Follow [the exact all-candidate implementation and acceptance sequence](./prospect-enrichment-all-candidate-profiles.md). Its new candidate projection requires a separately reviewed additive migration and release manifest; it is not part of this six-file allowlist or an authorization to import research.
