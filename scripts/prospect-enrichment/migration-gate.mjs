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
export const PREVIEW_MIGRATION_PATHS = Object.freeze([
  "supabase/migrations/20260915183000_preview_qa_session_registry.sql",
  "supabase/migrations/20260916030440_preview_qa_registry_privilege_hardening.sql"
]);
export const QUALIFICATION_HISTORY = Object.freeze([
  { path: "supabase/migrations/20260921120000_prospect_qualification_evidence.sql", version: "20260921120000", name: "prospect_qualification_evidence", sha256: "c9fff7b8f0950be5ac9557e9ba7d40f6291829548f6ab9a7b6c313cd90b717f7" },
  { path: "supabase/migrations/20260921121500_prospect_qualification_profile_details.sql", version: "20260921121500", name: "prospect_qualification_profile_details", sha256: "ef14f2942a4db3da22080f8c6e09a0df47638af518d59e8a743183e92fef858a" }
]);
export const QUALIFICATION_HISTORY_CONFIRMATION = "RECONCILE-QUALIFICATION-HISTORY-V1";
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

const isCliMigration = (name) => /^[0-9]+_.+\.sql$/.test(name);
const isWithin = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
};

function sourceMigrationInventory(sourceRoot, { requirePreviewSources = true } = {}) {
  const root = fs.realpathSync(sourceRoot);
  const supabaseDir = path.join(root, "supabase");
  const supabaseStat = fs.lstatSync(supabaseDir);
  const migrationDir = path.join(supabaseDir, "migrations");
  const dirStat = fs.lstatSync(migrationDir);
  if (!supabaseStat.isDirectory() || supabaseStat.isSymbolicLink() || !dirStat.isDirectory() || dirStat.isSymbolicLink()) fail("migration_source_directory_invalid");
  const migrations = [];
  for (const name of fs.readdirSync(migrationDir).sort()) {
    if (!isCliMigration(name)) continue;
    const fullPath = path.join(migrationDir, name);
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink() || !stat.isFile()) fail("migration_source_file_invalid");
    const version = name.slice(0, name.indexOf("_"));
    const migrationName = name.slice(name.indexOf("_") + 1, -4);
    const bytes = fs.readFileSync(fullPath);
    if (!bytes.length || !Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes)) fail("migration_source_not_utf8");
    migrations.push({ path: "supabase/migrations/" + name, filename: name, version, name: migrationName, bytes: bytes.length, sha256: sha256(bytes) });
  }
  if (new Set(migrations.map(item => item.version)).size !== migrations.length) fail("duplicate_migration_version");
  if (requirePreviewSources) for (const excluded of PREVIEW_MIGRATION_PATHS) {
    if (!migrations.some(item => item.path === excluded)) fail("preview_migration_source_missing");
  }
  return { root, migrations };
}

/** Copy a complete, byte-verified production CLI history into a fresh staging directory. */
export function stageProductionWorkdir(sourceRoot, destinationRoot) {
  const source = sourceMigrationInventory(sourceRoot);
  const requestedDestination = path.resolve(destinationRoot);
  let destinationExists = false;
  try { fs.lstatSync(requestedDestination); destinationExists = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!path.isAbsolute(destinationRoot) || destinationExists) fail("staging_destination_must_be_fresh_absolute_path");
  const parent = fs.realpathSync(path.dirname(requestedDestination));
  const destination = path.join(parent, path.basename(requestedDestination));
  if (!isWithin(parent, destination) || isWithin(source.root, destination) || isWithin(destination, source.root)) fail("staging_path_containment_failed");
  const excluded = new Set(PREVIEW_MIGRATION_PATHS);
  const included = source.migrations.filter(item => !excluded.has(item.path));
  if (included.length !== source.migrations.length - PREVIEW_MIGRATION_PATHS.length) fail("staging_exclusion_count_mismatch");
  const configSource = path.join(source.root, "supabase", "config.toml");
  const configStat = fs.lstatSync(configSource);
  if (configStat.isSymbolicLink() || !configStat.isFile()) fail("supabase_config_invalid");
  const configBytes = fs.readFileSync(configSource);
  fs.mkdirSync(destination);
  fs.mkdirSync(path.join(destination, "supabase"));
  fs.mkdirSync(path.join(destination, "supabase", "migrations"));
  fs.writeFileSync(path.join(destination, "supabase", "config.toml"), configBytes, { flag: "wx" });
  for (const item of included) {
    const target = path.join(destination, item.path);
    fs.writeFileSync(target, fs.readFileSync(path.join(source.root, item.path)), { flag: "wx" });
    const copied = fs.readFileSync(target);
    if (copied.length !== item.bytes || sha256(copied) !== item.sha256) fail("staged_migration_source_mismatch");
  }
  const stagedFiles = fs.readdirSync(path.join(destination, "supabase", "migrations")).sort();
  if (!same(stagedFiles, included.map(item => item.filename).sort())) fail("staged_migration_inventory_mismatch");
  const copiedConfig = fs.readFileSync(path.join(destination, "supabase", "config.toml"));
  if (!copiedConfig.equals(configBytes)) fail("staged_config_mismatch");
  return {
    stagedRoot: destination,
    migrationCount: included.length,
    inventorySha256: sha256(JSON.stringify(included.map(({ path, version, name, bytes, sha256: digest }) => ({ path, version, name, bytes, sha256: digest })))),
    configSha256: sha256(copiedConfig),
    exclusions: source.migrations.filter(item => excluded.has(item.path)).map(({ path, version, name, bytes, sha256: digest }) => ({ path, version, name, bytes, sha256: digest }))
  };
}

export function fullLedgerQuery() {
  return "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;\n";
}

export function verifyFullMigrationLedger(rows, sourceRoot, phase) {
  if (!Array.isArray(rows) || !["qualification-pending", "enrichment-pending", "complete"].includes(phase)) fail("invalid_full_ledger_input");
  const { migrations } = sourceMigrationInventory(sourceRoot, { requirePreviewSources: false });
  const localByVersion = new Map(migrations.filter(item => !PREVIEW_MIGRATION_PATHS.includes(item.path)).map(item => [item.version, item]));
  const remote = new Map();
  for (const row of rows) {
    if (!isRecord(row) || !same(Object.keys(row).sort(), ["name", "version"]) || typeof row.version !== "string" || typeof row.name !== "string" || remote.has(row.version)) fail("invalid_full_ledger_rows");
    remote.set(row.version, row.name);
  }
  if (!same([...remote.keys()], [...remote.keys()].sort())) fail("full_ledger_rows_not_ordered");
  for (const [version, name] of remote) {
    const local = localByVersion.get(version);
    if (!local || local.name !== name) fail("remote_migration_source_missing_or_mismatched");
  }
  const pending = [...localByVersion.values()].filter(item => !remote.has(item.version)).map(item => item.path).sort();
  const expected = phase === "qualification-pending"
    ? [...QUALIFICATION_HISTORY.map(item => item.path), ...MIGRATION_PATHS].sort()
    : phase === "enrichment-pending" ? [...MIGRATION_PATHS].sort() : [];
  if (!same(pending, expected)) fail("unexpected_full_history_delta");
  return { phase, remoteVersionCount: remote.size, stagedMigrationCount: localByVersion.size, pendingPaths: pending, completeSourceCoverage: true };
}

export function verifyQualificationHistorySources(sourceRoot) {
  const root = fs.realpathSync(sourceRoot);
  return QUALIFICATION_HISTORY.map(expected => {
    const fullPath = path.join(root, expected.path);
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink() || !stat.isFile()) fail("qualification_source_file_invalid");
    const checkoutBytes = fs.readFileSync(fullPath);
    const bytes = Buffer.from(checkoutBytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
    if (sha256(bytes) !== expected.sha256) fail("qualification_source_hash_mismatch");
    return { path: expected.path, version: expected.version, name: expected.name, bytes: bytes.length, sha256: expected.sha256 };
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
}

function readCatalogContract(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  let value = raw;
  if (Array.isArray(value)) {
    if (value.length !== 1) fail("catalog_query_result_shape_invalid");
    value = value[0];
  }
  if (isRecord(value) && value.data !== undefined) {
    if (!Array.isArray(value.data) || value.data.length !== 1) fail("catalog_query_result_shape_invalid");
    value = value.data[0];
  }
  if (isRecord(value) && value.rows !== undefined) {
    if (!Array.isArray(value.rows) || value.rows.length !== 1) fail("catalog_query_result_shape_invalid");
    value = value.rows[0];
  }
  const contract = isRecord(value) && value.catalog_contract !== undefined ? value.catalog_contract : value;
  const parsed = typeof contract === "string" ? JSON.parse(contract) : contract;
  if (!isRecord(parsed) || !Array.isArray(parsed.tables) || parsed.tables.length !== 14) fail("catalog_contract_incomplete");
  const tableNames = parsed.tables.map(table => table?.name);
  const expectedNames = [
    "prospect_advertising_observations", "prospect_decision_maker_contacts", "prospect_diagnostic_ready_profiles",
    "prospect_diagnostic_reservations", "prospect_export_runs", "prospect_firm_affiliations",
    "prospect_firm_fit_observations", "prospect_lso_licensees", "prospect_opportunity_observations",
    "prospect_qualification_decisions", "prospect_research_attempts", "prospect_service_observations",
    "prospect_source_captures", "prospect_source_record_map"
  ];
  if (!same(tableNames, expectedNames)) fail("catalog_contract_table_inventory_mismatch");
  for (const table of parsed.tables) {
    if (!isRecord(table) || table.present !== true || !Array.isArray(table.columns) || !Array.isArray(table.constraints) || !Array.isArray(table.indexes) ||
        !Array.isArray(table.policies) || !isRecord(table.anon) || !isRecord(table.authenticated) || !isRecord(table.serviceRole) || !Array.isArray(table.triggers) ||
        typeof table.owner !== "string" || typeof table.rlsEnabled !== "boolean" || typeof table.forceRls !== "boolean") fail("catalog_contract_facet_missing");
    for (const column of table.columns) {
      if (!isRecord(column) || !isRecord(column.anonPrivileges) || !isRecord(column.authenticatedPrivileges) || !isRecord(column.serviceRolePrivileges)) fail("catalog_contract_column_privileges_missing");
    }
    for (const constraint of table.constraints) if (!isRecord(constraint) || typeof constraint.name !== "string" || typeof constraint.definition !== "string") fail("catalog_contract_constraint_incomplete");
    for (const index of table.indexes) if (!isRecord(index) || typeof index.name !== "string" || typeof index.definition !== "string") fail("catalog_contract_index_incomplete");
  }
  return canonicalJson(parsed);
}

export function compareQualificationCatalogs(scratchFile, productionFile, sourceRoot) {
  const scratch = readCatalogContract(scratchFile);
  const production = readCatalogContract(productionFile);
  if (!same(scratch, production)) fail("production_qualification_catalog_does_not_match_source");
  return {
    schemaVersion: "qualification-catalog-contract/v1",
    tableCount: production.tables.length,
    qualificationMigrationSources: verifyQualificationHistorySources(sourceRoot),
    productionCatalogSha256: sha256(JSON.stringify(production)),
    scratchAndProductionCatalogsMatch: true
  };
}

export function verifyQualificationRepairAuthorization({ confirmation, reviewedCatalogSha256, currentCatalogSha256 }) {
  if (confirmation !== QUALIFICATION_HISTORY_CONFIRMATION) fail("exact_qualification_history_confirmation_required");
  if (!/^[a-f0-9]{64}$/.test(reviewedCatalogSha256 ?? "") || reviewedCatalogSha256 !== currentCatalogSha256) fail("reviewed_catalog_evidence_missing_or_changed");
  return { operation: "qualification-repair", catalogEvidenceSha256: currentCatalogSha256 };
}

export function verifyLedgerDelta(beforeRows, afterRows, expectedVersions) {
  if (!Array.isArray(expectedVersions) || !same([...expectedVersions].sort(), QUALIFICATION_HISTORY.map(item => item.version).sort())) fail("qualification_history_delta_scope_invalid");
  const toMap = rows => {
    if (!Array.isArray(rows)) fail("invalid_full_ledger_rows");
    const map = new Map();
    for (const row of rows) {
      if (!isRecord(row) || !same(Object.keys(row).sort(), ["name", "version"]) || typeof row.version !== "string" || typeof row.name !== "string" || map.has(row.version)) fail("invalid_full_ledger_rows");
      map.set(row.version, row.name);
    }
    return map;
  };
  const before = toMap(beforeRows), after = toMap(afterRows);
  for (const [version, name] of before) if (after.get(version) !== name) fail("full_ledger_changed_outside_allowlist");
  const added = [...after.keys()].filter(version => !before.has(version)).sort();
  if (!same(added, [...expectedVersions].sort())) fail("full_ledger_delta_mismatch");
  return { addedVersions: added, beforeCount: before.size, afterCount: after.size, exactDelta: true };
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
  if (!["dry-run", "apply", "qualification-preflight", "qualification-repair"].includes(operation)) fail("invalid_operation");
  if (!/^[a-f0-9]{40}$/.test(reviewedSourceSha ?? "")) fail("reviewed_source_sha_required");
  if (!/^[a-f0-9]{40}$/.test(configuredReviewedSha ?? "") || configuredReviewedSha !== reviewedSourceSha) fail("protected_environment_reviewed_sha_missing_or_mismatch");
  if (checkoutSha !== reviewedSourceSha || githubSha !== reviewedSourceSha) fail("reviewed_source_sha_changed");
  const connection = verifyDirectDatabaseUrl(databaseUrl, environment, projectEnvFiles);
  return { reviewedSourceSha, operation, projectRef: PROJECT_REF, connection };
}

export function verifyConfirmation(operation, confirmation) {
  if (operation === "apply" && confirmation !== CONFIRMATION) fail("exact_apply_confirmation_required");
  if (operation === "qualification-repair" && confirmation !== QUALIFICATION_HISTORY_CONFIRMATION) fail("exact_qualification_history_confirmation_required");
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
  if (command === "stage" && rest.length === 2) {
    console.log(JSON.stringify(stageProductionWorkdir(rest[0], rest[1])));
    return;
  }
  if (command === "full-query" && rest.length === 0) {
    process.stdout.write(fullLedgerQuery());
    return;
  }
  if (command === "full-ledger" && rest.length === 3) {
    const payload = JSON.parse(fs.readFileSync(rest[0], "utf8"));
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : payload?.rows;
    console.log(JSON.stringify(verifyFullMigrationLedger(rows, rest[1], rest[2])));
    return;
  }
  if (command === "ledger-delta" && rest.length === 4) {
    const beforePayload = JSON.parse(fs.readFileSync(rest[0], "utf8"));
    const afterPayload = JSON.parse(fs.readFileSync(rest[1], "utf8"));
    const beforeRows = Array.isArray(beforePayload) ? beforePayload : Array.isArray(beforePayload?.data) ? beforePayload.data : beforePayload?.rows;
    const afterRows = Array.isArray(afterPayload) ? afterPayload : Array.isArray(afterPayload?.data) ? afterPayload.data : afterPayload?.rows;
    console.log(JSON.stringify(verifyLedgerDelta(beforeRows, afterRows, rest.slice(2))));
    return;
  }
  if (command === "catalog-compare" && rest.length === 2) {
    console.log(JSON.stringify(compareQualificationCatalogs(rest[0], rest[1], process.cwd())));
    return;
  }
  if (command === "repair-authorization" && rest.length === 1) {
    console.log(JSON.stringify(verifyQualificationRepairAuthorization({ confirmation: process.env.CONFIRMATION, reviewedCatalogSha256: process.env.REVIEWED_CATALOG_SHA256, currentCatalogSha256: rest[0] })));
    return;
  }
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
  } else fail("usage_source_connection_query_generate_plan_phase_file_or_ledger_file_stage_full_query_full_ledger_catalog_compare_ledger_delta_or_repair_authorization");
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
