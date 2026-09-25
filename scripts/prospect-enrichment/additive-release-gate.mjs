import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLI_VERSION,
  PROJECT_REF,
  findProjectEnvFiles,
  sha256 as sourceSha256,
  verifyDirectDatabaseUrl,
  verifyLedgerStatements,
} from "./migration-gate.mjs";

export { PROJECT_REF };

export const RELEASE_PATH = "scripts/prospect-enrichment/additive-release-review.json";
export const APPLIED_OPERATOR_RPC = Object.freeze({
  path: "supabase/migrations/20260924180541_restore_operator_membership_rpc.sql",
  filename: "20260924180541_restore_operator_membership_rpc.sql",
  version: "20260924180541",
  name: "restore_operator_membership_rpc",
});
export const MIGRATION_PATHS = Object.freeze([
  "supabase/migrations/20260921120000_prospect_qualification_evidence.sql",
  "supabase/migrations/20260921121500_prospect_qualification_profile_details.sql",
  "supabase/migrations/20260923161812_prospect_enrichment_v1.sql",
  "supabase/migrations/20260923174500_prospect_enrichment_identity_read_rpc.sql",
  "supabase/migrations/20260923182000_prospect_enrichment_operator_read_rpc.sql",
  "supabase/migrations/20260923221500_prospect_enrichment_gta_target_read_rpc.sql",
  "supabase/migrations/20260924071322_prospect_enrichment_manifest_hold_evidence.sql",
  "supabase/migrations/20260924093317_fix_gta_prospect_operator_projection_gaps.sql",
  "supabase/migrations/20260924172758_prospect_enrichment_candidate_profiles.sql",
  "supabase/migrations/20260924192549_prospect_enrichment_candidate_firm_coverage.sql",
]);

export const CATALOG_EXPECTED = Object.freeze({
  schemaName: "public",
  functionName: "revalidate_operator_membership_v1",
  identityArguments: "uuid, uuid, boolean",
  languageName: "plpgsql",
  securityDefiner: true,
  searchPathSetting: "search_path=\"\"",
  definitionMd5: "625afed49f4c9cde1084c1acd175ef47",
  anonExecute: false,
  authenticatedExecute: false,
  publicExecute: false,
  nonOwnerExecuteGrantees: ["service_role"],
});
const fail = (code) => { throw new Error(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const migrationIdentity = (migrationPath) => {
  const filename = path.posix.basename(migrationPath);
  const match = /^(\d{14})_(.+)\.sql$/.exec(filename);
  if (!match) fail("invalid_migration_path");
  return { path: migrationPath, filename, version: match[1], name: match[2] };
};
const RELEASE_IDENTITIES = Object.freeze(MIGRATION_PATHS.map(migrationIdentity));
const BASELINE_IDENTITY = Object.freeze(migrationIdentity(APPLIED_OPERATOR_RPC.path));
const ALL_IDENTITIES = Object.freeze([...RELEASE_IDENTITIES, BASELINE_IDENTITY].sort((a, b) => a.version.localeCompare(b.version)));

function expectedSourceKeys() {
  return [...MIGRATION_PATHS, APPLIED_OPERATOR_RPC.path].sort();
}

function exactSources(sources) {
  if (!isRecord(sources) || !same(Object.keys(sources).sort(), expectedSourceKeys())) fail("exact_release_sources_required");
  for (const source of Object.values(sources)) {
    if (!Buffer.isBuffer(source) || source.length === 0 || !Buffer.from(source.toString("utf8"), "utf8").equals(source)) fail("invalid_migration_source");
  }
}

export function createReleaseReceipt(sources) {
  exactSources(sources);
  const describe = (identity) => ({
    ...identity,
    bytes: sources[identity.path].length,
    sha256: sourceSha256(sources[identity.path]),
  });
  return {
    schemaVersion: "prospect-candidate-additive-release-review/v1",
    projectRef: PROJECT_REF,
    cliVersion: CLI_VERSION,
    reviewOnly: true,
    productionApplicationApproved: false,
    migrationOrder: "ascending-version; interrupted runs may apply only an exact ordered prefix",
    appliedPrerequisite: {
      ...describe(BASELINE_IDENTITY),
      expectedCatalog: CATALOG_EXPECTED,
    },
    migrations: RELEASE_IDENTITIES.map(describe),
    exclusions: [
      "No seeds or roles",
      "No migration outside the ten exact ordered entries above",
      "The already-applied operator membership RPC is verified as a prerequisite and is never reapplied",
      "No data intake, import, identity linking, qualification change, or research-process cutover",
    ],
  };
}

export function verifyReleaseReceipt(receipt, sources) {
  const expected = createReleaseReceipt(sources);
  if (!same(receipt, expected)) fail("release_receipt_source_mismatch");
  return expected;
}

export function verifySourceGate({ event, ref, repository, operation, reviewedSourceSha, configuredReviewedSha, checkoutSha, githubSha, databaseUrl, environment, projectEnvFiles }) {
  if (event !== "workflow_dispatch" || ref !== "refs/heads/main" || repository !== "adrianosortudo-source/caseload-select") fail("manual_main_repository_required");
  if (operation !== "dry-run") fail("read_only_dry_run_required");
  if (!/^[a-f0-9]{40}$/.test(reviewedSourceSha ?? "") || configuredReviewedSha !== reviewedSourceSha) fail("protected_environment_reviewed_sha_missing_or_mismatch");
  if (checkoutSha !== reviewedSourceSha || githubSha !== reviewedSourceSha) fail("reviewed_source_sha_changed");
  const connection = verifyDirectDatabaseUrl(databaseUrl, environment, projectEnvFiles);
  return { reviewedSourceSha, operation, projectRef: PROJECT_REF, connection };
}

export function ledgerQuery(receipt) {
  verifyReleaseReceipt(receipt, loadSources());
  const versions = ALL_IDENTITIES.map((m) => "'" + m.version + "'").join(", ");
  return "SELECT version, name, statements FROM supabase_migrations.schema_migrations WHERE version IN (" + versions + ") ORDER BY version;\n";
}

export function verifyLedgerState(rows, receipt, sources) {
  verifyReleaseReceipt(receipt, sources);
  if (!Array.isArray(rows) || rows.some(row => !isRecord(row))) fail("ledger_rows_invalid");
  const releaseRows = new Map();
  let baselineRow;
  for (const row of rows) {
    if (!same(Object.keys(row).sort(), ["name", "statements", "version"])) fail("unexpected_ledger_fields");
    if (row.version === BASELINE_IDENTITY.version) {
      if (baselineRow) fail("duplicate_baseline_ledger_row");
      baselineRow = row;
    } else {
      if (releaseRows.has(row.version)) fail("duplicate_release_ledger_row");
      releaseRows.set(row.version, row);
    }
  }
  if (!baselineRow) fail("applied_operator_rpc_ledger_missing");
  const baselineSource = sources[APPLIED_OPERATOR_RPC.path];
  if (baselineRow.name !== BASELINE_IDENTITY.name) fail("applied_operator_rpc_ledger_name_mismatch");
  const baselineProof = verifyLedgerStatements(baselineSource, baselineRow.statements);
  const appliedPrefixLength = RELEASE_IDENTITIES.findIndex(identity => !releaseRows.has(identity.version));
  const prefixLength = appliedPrefixLength === -1 ? RELEASE_IDENTITIES.length : appliedPrefixLength;
  const expectedApplied = RELEASE_IDENTITIES.slice(0, prefixLength);
  const expectedVersions = new Set(expectedApplied.map(m => m.version));
  if (releaseRows.size !== expectedVersions.size || [...releaseRows.keys()].some(version => !expectedVersions.has(version))) fail("release_ledger_not_ordered_prefix");
  const releaseProofs = expectedApplied.map(identity => {
    const row = releaseRows.get(identity.version);
    if (!row || row.name !== identity.name) fail("release_ledger_version_or_name_mismatch");
    return { path: identity.path, version: identity.version, ...verifyLedgerStatements(sources[identity.path], row.statements) };
  });
  const orderedExpected = [...expectedApplied, BASELINE_IDENTITY].sort((a, b) => a.version.localeCompare(b.version));
  if (!same(rows.map(r => r.version), orderedExpected.map(m => m.version))) fail("ledger_rows_missing_extra_or_reordered");
  return {
    projectRef: PROJECT_REF,
    appliedPrefixLength: prefixLength,
    pending: RELEASE_IDENTITIES.slice(prefixLength).map(m => m.filename),
    appliedPrerequisite: { ...BASELINE_IDENTITY, ...baselineProof },
    appliedMigrations: releaseProofs,
  };
}

export function verifyMigrationPlan(plan, ledgerProof, phase) {
  if (!isRecord(plan) || !["pre", "post"].includes(phase) || !isRecord(ledgerProof)) fail("invalid_migration_plan");
  const pending = phase === "post" ? [] : ledgerProof.pending;
  if (!Array.isArray(pending) || (phase === "post" && ledgerProof.pending.length !== 0) || plan.dryRun !== true || plan.upToDate !== (phase === "post" || pending.length === 0) ||
      !same(plan.migrations, pending) || !same(plan.seeds, []) || !same(plan.roles, [])) fail("unexpected_pending_migration_or_plan");
  return { phase, migrations: pending, dryRun: plan.dryRun, upToDate: plan.upToDate };
}

export function verifyOperatorRpcCatalog(rows, receipt) {
  if (!Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0]) || !isRecord(receipt)) fail("operator_rpc_catalog_ambiguous");
  const actual = rows[0];
  if (!same(Object.keys(actual).sort(), Object.keys(CATALOG_EXPECTED).sort()) || !same(actual, CATALOG_EXPECTED) ||
      !same(receipt.appliedPrerequisite.expectedCatalog, CATALOG_EXPECTED)) fail("operator_rpc_catalog_mismatch");
  return { prerequisite: "verified_applied_operator_rpc", catalog: CATALOG_EXPECTED };
}

export function catalogQuery() {
  return `SELECT n.nspname AS "schemaName", p.proname AS "functionName", oidvectortypes(p.proargtypes) AS "identityArguments", l.lanname AS "languageName", p.prosecdef AS "securityDefiner", (SELECT setting FROM unnest(p.proconfig) AS setting WHERE setting LIKE 'search_path=%') AS "searchPathSetting", md5(pg_get_functiondef(p.oid)) AS "definitionMd5", has_function_privilege('anon', p.oid, 'EXECUTE') AS "anonExecute", has_function_privilege('authenticated', p.oid, 'EXECUTE') AS "authenticatedExecute", EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') AS "publicExecute", coalesce((SELECT json_agg(r.rolname ORDER BY r.rolname) FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl JOIN pg_roles r ON r.oid = acl.grantee WHERE acl.grantee <> p.proowner AND acl.grantee <> 0 AND acl.privilege_type = 'EXECUTE'), '[]'::json) AS "nonOwnerExecuteGrantees" FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'public' AND p.proname = 'revalidate_operator_membership_v1' AND oidvectortypes(p.proargtypes) = 'uuid, uuid, boolean';\n`;
}

function loadSources() {
  return Object.fromEntries([...MIGRATION_PATHS, APPLIED_OPERATOR_RPC.path].map(p => [p, fs.readFileSync(p)]));
}

function safeJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function main(args) {
  const [command, ...rest] = args;
  const sources = loadSources();
  const receipt = safeJson(RELEASE_PATH);
  verifyReleaseReceipt(receipt, sources);
  if (command === "source" && rest.length === 0) {
    const result = verifySourceGate({
      event: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF,
      repository: process.env.GITHUB_REPOSITORY,
      operation: process.env.OPERATION,
      reviewedSourceSha: process.env.REVIEWED_SOURCE_SHA,
      configuredReviewedSha: process.env.CONFIGURED_REVIEWED_SHA,
      checkoutSha: process.env.CHECKOUT_SHA,
      githubSha: process.env.GITHUB_SHA,
      databaseUrl: process.env.MIGRATION_DATABASE_URL,
      environment: process.env,
      projectEnvFiles: findProjectEnvFiles(),
    });
    console.log(JSON.stringify({ ...result, receiptSha256: sourceSha256(fs.readFileSync(RELEASE_PATH)), migrations: receipt.migrations.map(m => ({ path: m.path, version: m.version, bytes: m.bytes, sha256: m.sha256 })) }));
  } else if (command === "connection" && rest.length === 0) {
    console.log(JSON.stringify(verifyDirectDatabaseUrl(process.env.MIGRATION_DATABASE_URL, process.env, findProjectEnvFiles())));
  } else if (command === "ledger-query" && rest.length === 0) {
    process.stdout.write(ledgerQuery(receipt));
  } else if (command === "catalog-query" && rest.length === 0) {
    process.stdout.write(catalogQuery());
  } else if (command === "ledger" && rest.length === 1) {
    console.log(JSON.stringify(verifyLedgerState(safeJson(rest[0]), receipt, sources)));
  } else if (command === "catalog" && rest.length === 1) {
    console.log(JSON.stringify(verifyOperatorRpcCatalog(safeJson(rest[0]), receipt)));
  } else if (command === "plan" && rest.length === 3) {
    console.log(JSON.stringify(verifyMigrationPlan(safeJson(rest[1]), safeJson(rest[2]), rest[0])));
  } else fail("usage_source_connection_ledger_query_catalog_query_ledger_catalog_or_plan");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    const message = error instanceof Error ? error.message : "additive_release_gate_failed";
    process.stderr.write(/^[a-z0-9_]+$/.test(message) ? message + "\n" : "additive_release_gate_failed\n");
    process.exitCode = 1;
  }
}
