import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const PROJECT_REF = "ssxryjxifwiivghglqer";
export const CLI_VERSION = "2.117.0";
export const MIGRATION_PATHS = Object.freeze([
  "supabase/migrations/20260923161812_prospect_enrichment_v1.sql",
  "supabase/migrations/20260923174500_prospect_enrichment_identity_read_rpc.sql",
  "supabase/migrations/20260923182000_prospect_enrichment_operator_read_rpc.sql",
  "supabase/migrations/20260923221500_prospect_enrichment_gta_target_read_rpc.sql",
  "supabase/migrations/20260924071322_prospect_enrichment_manifest_hold_evidence.sql",
  "supabase/migrations/20260924093317_fix_gta_prospect_operator_projection_gaps.sql"
]);
export const CONFIRMATION = "APPLY-PROSPECT-ENRICHMENT-V1";
export const RELEASE_PATH = "scripts/prospect-enrichment/migration-release.json";
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code) => { throw new Error(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasAsciiControl = (value, upper) => Array.from(value).some(char => char.charCodeAt(0) <= upper || char.charCodeAt(0) === 127);

function migrationIdentities() {
  return MIGRATION_PATHS.map(migrationPath => {
    const filename = path.posix.basename(migrationPath);
    const match = /^(\d{14})_(.+)\.sql$/.exec(filename);
    if (!match) fail("invalid_migration_path");
    return { path: migrationPath, filename, version: match[1], name: match[2] };
  });
}

function verifyManifestScope(manifest) {
  if (!isRecord(manifest) || !same(Object.keys(manifest).sort(), ["cliVersion", "migrations", "projectRef", "schemaVersion"]) ||
      manifest.schemaVersion !== "prospect-enrichment-migration-release/v1" || manifest.projectRef !== PROJECT_REF ||
      manifest.cliVersion !== CLI_VERSION || !Array.isArray(manifest.migrations) || manifest.migrations.length !== MIGRATION_PATHS.length) fail("invalid_release_scope");
  for (const [index, expected] of migrationIdentities().entries()) {
    const actual = manifest.migrations[index];
    if (!isRecord(actual) || !same(Object.keys(actual).sort(), ["bytes", "filename", "name", "path", "sha256", "version"]) ||
        Object.entries(expected).some(([key, value]) => actual[key] !== value) ||
        !Number.isSafeInteger(actual.bytes) || actual.bytes <= 0 || !/^[a-f0-9]{64}$/.test(actual.sha256 ?? "")) fail("invalid_release_scope");
  }
}

export function createReleaseManifest(sources) {
  if (!isRecord(sources) || !same(Object.keys(sources).sort(), [...MIGRATION_PATHS].sort())) fail("exact_migration_sources_required");
  const migrations = migrationIdentities().map(identity => {
    const source = sources[identity.path];
    if (!Buffer.isBuffer(source) || source.length === 0) fail("invalid_migration_source");
    if (!Buffer.from(source.toString("utf8"), "utf8").equals(source)) fail("migration_source_not_utf8");
    return { ...identity, bytes: source.length, sha256: sha256(source) };
  });
  return { schemaVersion: "prospect-enrichment-migration-release/v1", projectRef: PROJECT_REF, cliVersion: CLI_VERSION, migrations };
}

export function verifyReleaseManifest(manifest, sources) {
  const expected = createReleaseManifest(sources);
  if (!same(manifest, expected)) fail("release_manifest_source_mismatch");
  return expected;
}

export function verifyDirectDatabaseUrl(value, environment = {}, projectEnvFiles = []) {
  if (Object.keys(environment).some(key => (/^(?:PG|SUPABASE_|DOTENV_)/i.test(key) || ["DOCKER_HOST", "NODE_TLS_REJECT_UNAUTHORIZED"].includes(key.toUpperCase())) && environment[key] !== undefined)) fail("ambient_database_configuration_prohibited");
  if (!Array.isArray(projectEnvFiles) || projectEnvFiles.length) fail("project_database_env_files_prohibited");
  if (typeof value !== "string" || !value || value.trim() !== value || hasAsciiControl(value, 32)) fail("protected_environment_database_url_missing_or_invalid");
  let url;
  try { url = new URL(value); } catch { fail("protected_environment_database_url_missing_or_invalid"); }
  let username, password;
  try { username = decodeURIComponent(url.username); password = decodeURIComponent(url.password); }
  catch { fail("database_url_credentials_invalid"); }
  if (url.protocol !== "postgresql:" || url.hostname !== "db." + PROJECT_REF + ".supabase.co" ||
      url.port !== "5432" || url.pathname !== "/postgres" || url.hash || username !== "postgres" ||
      !password || hasAsciiControl(password, 31) ||
      !same([...url.searchParams], [["sslmode", "verify-full"]])) fail("database_url_target_or_options_prohibited");
  return { host: url.hostname, port: 5432, database: "postgres", user: "postgres", sslmode: "verify-full", connectionMode: "explicit-db-url" };
}

export function verifyExecutionGate({ event, ref, repository, operation, reviewedSourceSha, configuredReviewedSha, checkoutSha, githubSha, databaseUrl, environment, projectEnvFiles }) {
  if (event !== "workflow_dispatch" || ref !== "refs/heads/main" || repository !== "adrianosortudo-source/caseload-select") fail("manual_main_repository_required");
  if (!["dry-run", "apply"].includes(operation)) fail("invalid_operation");
  if (!/^[a-f0-9]{40}$/.test(reviewedSourceSha ?? "")) fail("reviewed_source_sha_required");
  if (!/^[a-f0-9]{40}$/.test(configuredReviewedSha ?? "") || configuredReviewedSha !== reviewedSourceSha) fail("protected_environment_reviewed_sha_missing_or_mismatch");
  if (checkoutSha !== reviewedSourceSha || githubSha !== reviewedSourceSha) fail("reviewed_source_sha_changed");
  const connection = verifyDirectDatabaseUrl(databaseUrl, environment, projectEnvFiles);
  return { reviewedSourceSha, operation, projectRef: PROJECT_REF, connection };
}

export function verifyConfirmation(operation, confirmation) {
  if (operation === "apply" && confirmation !== CONFIRMATION) fail("exact_apply_confirmation_required");
}

export function verifyMigrationPlan(plan, manifest, phase) {
  verifyManifestScope(manifest);
  if (!isRecord(plan) || !["pre", "apply", "post"].includes(phase)) fail("invalid_migration_plan");
  const empty = phase === "post";
  const expected = empty ? [] : manifest.migrations.map((m) => m.filename);
  if (plan.dryRun !== (phase !== "apply") || plan.upToDate !== empty ||
      !same(plan.migrations, expected) || !same(plan.seeds, []) || !same(plan.roles, [])) fail("unexpected_pending_migration_or_plan");
  return { phase, migrations: expected, dryRun: plan.dryRun, upToDate: plan.upToDate };
}

/**
 * CLI 2.117.0 records legacySplitAndTrim(source) in schema_migrations.statements.
 * Raw statement text survives; only outer whitespace and terminators are removed.
 * Verify exact ordered source coverage without implementing another SQL parser.
 * Comments, quotes, dollar bodies and every non-separator character must match.
 */
export function verifyLedgerStatements(source, statements) {
  if (!Array.isArray(statements) || statements.length === 0 ||
      statements.some((s) => typeof s !== "string" || !s || s.trim() !== s)) fail("ledger_statements_missing");
  const sql = source.toString("utf8");
  let offset = 0;
  const skipSeparators = () => {
    while (offset < sql.length && /[\s;]/u.test(sql[offset])) offset++;
  };
  skipSeparators();
  for (const [index, statement] of statements.entries()) {
    if (!sql.startsWith(statement, offset)) fail("ledger_statement_content_mismatch");
    offset += statement.length;
    if (offset < sql.length && !/[\s;]/u.test(sql[offset])) fail("ledger_statement_boundary_mismatch");
    const separatorStart = offset;
    skipSeparators();
    if (index < statements.length - 1 && !sql.slice(separatorStart, offset).includes(";")) {
      fail("ledger_statement_terminator_missing");
    }
  }
  skipSeparators();
  if (offset !== sql.length) fail("ledger_source_coverage_incomplete");
  return {
    statementCount: statements.length,
    sourceSha256: sha256(source),
    ledgerStatementsSha256: sha256(JSON.stringify(statements)),
    statementContentMatchesReviewedSource: true,
  };
}

export function verifyMigrationLedger(rows, manifest, sources) {
  verifyReleaseManifest(manifest, sources);
  if (!Array.isArray(rows) || rows.length !== MIGRATION_PATHS.length || rows.some(row => !isRecord(row))) fail("exact_ledger_rows_required");
  const migrations = manifest.migrations.map((expected, index) => {
    const row = rows[index];
    if (row.version !== expected.version || row.name !== expected.name) fail("ledger_version_or_name_mismatch");
    if (!same(Object.keys(row).sort(), ["name", "statements", "version"])) fail("unexpected_ledger_fields");
    return { path: expected.path, version: row.version, name: row.name, ...verifyLedgerStatements(sources[expected.path], row.statements) };
  });
  return { projectRef: PROJECT_REF, migrationCount: migrations.length, releaseManifestContentSha256: sha256(JSON.stringify(manifest)), migrations };
}

export function ledgerQuery(manifest) {
  verifyManifestScope(manifest);
  const versions = manifest.migrations.map(migration => "'" + migration.version + "'").join(", ");
  return "SELECT version, name, statements FROM supabase_migrations.schema_migrations WHERE version IN (" + versions + ") ORDER BY version;\n";
}

export function findProjectEnvFiles(exists = fs.existsSync) {
  // The pinned CLI loads these exact defaults from supabase/ and repo root.
  // SUPABASE_ENV overrides are prohibited above; never read their contents here.
  return ["supabase", "."].flatMap(dir => [".env.development.local", ".env.local", ".env.development", ".env"]
    .map(name => path.join(dir, name))).filter(file => exists(file));
}

function main(args) {
  const [command, ...rest] = args;
  const sources = Object.fromEntries(MIGRATION_PATHS.map(migrationPath => [migrationPath, fs.readFileSync(migrationPath)]));
  if (command === "generate" && rest.length === 0) {
    // Local release preparation only; generation grants no execution authority.
    fs.writeFileSync(RELEASE_PATH, JSON.stringify(createReleaseManifest(sources), null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ manifest: RELEASE_PATH, generated: true }));
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(RELEASE_PATH, "utf8"));
  verifyReleaseManifest(manifest, sources);
  if (command === "source" && rest.length === 0) {
    const gate = verifyExecutionGate({
      event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF,
      repository: process.env.GITHUB_REPOSITORY, operation: process.env.OPERATION,
      reviewedSourceSha: process.env.REVIEWED_SOURCE_SHA, configuredReviewedSha: process.env.CONFIGURED_REVIEWED_SHA,
      checkoutSha: process.env.CHECKOUT_SHA, githubSha: process.env.GITHUB_SHA,
      databaseUrl: process.env.MIGRATION_DATABASE_URL, environment: process.env, projectEnvFiles: findProjectEnvFiles(),
    });
    verifyConfirmation(gate.operation, process.env.CONFIRMATION);
    console.log(JSON.stringify({ ...gate, releaseManifestSha256: sha256(fs.readFileSync(RELEASE_PATH)), migrations: manifest.migrations }));
  } else if (command === "connection" && rest.length === 0) {
    console.log(JSON.stringify(verifyDirectDatabaseUrl(process.env.MIGRATION_DATABASE_URL, process.env, findProjectEnvFiles())));
  } else if (command === "query" && rest.length === 0) {
    process.stdout.write(ledgerQuery(manifest));
  } else if (command === "plan" && rest.length === 2) {
    console.log(JSON.stringify(verifyMigrationPlan(JSON.parse(fs.readFileSync(rest[1], "utf8")), manifest, rest[0])));
  } else if (command === "ledger" && rest.length === 1) {
    console.log(JSON.stringify(verifyMigrationLedger(JSON.parse(fs.readFileSync(rest[0], "utf8")), manifest, sources)));
  } else fail("usage_source_connection_query_generate_plan_phase_file_or_ledger_file");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    // Never print raw query output, environment values or command failure payloads.
    const message = error instanceof Error ? error.message : "migration_gate_failed";
    process.stderr.write(/^[a-z0-9_]+$/.test(message) ? message + "\n" : "migration_gate_failed\n");
    process.exitCode = 1;
  }
}
