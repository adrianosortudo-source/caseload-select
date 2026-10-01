// A single reviewed hole in otherwise complete production history. No backfill or intake.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  PROJECT_REF, CLI_VERSION, sha256, verifyLedgerStatements, verifyFullMigrationLedger,
  stageProductionWorkdir, verifyProductionWorkdir, fullLedgerQuery,
  verifyDatabaseEnvironment, verifyDirectDatabaseUrl, findProjectEnvFiles,
} from "./migration-gate.mjs";
import {
  MIGRATION_PATHS, APPLIED_OPERATOR_RPC, CATALOG_EXPECTED, RELEASE_PATH,
  verifyReleaseReceipt, verifyLedgerState, ledgerQuery, catalogQuery,
} from "./additive-release-gate.mjs";
import {
  catalogQuery as readerCatalogQuery, verifyReaderCatalog, verifyTargetLedgerStatements,
  verifyReaderRepairReceipt,
} from "./candidate-reader-repair-gate.mjs";
import { CANDIDATE_READER_REPAIR_PATHS } from "./migration-gate.mjs";
import { validateBackfillStatus } from "./candidate-coverage-backfill-worker.mjs";

export const REGISTRATION_REPAIR_PATH = "supabase/migrations/20260924185000_prospect_enrichment_registration_rpc_reliability.sql";
export const REPAIR_CONFIRMATION = "APPLY-PROSPECT-REGISTRATION-RPC-REPAIR-V1";
export const REPAIR_ARTIFACT_NAME = "prospect-candidate-registration-repair-preflight";
export const EVIDENCE_FILES = Object.freeze([
  "scoped-ledger.json", "full-ledger.json", "operator-catalog.json", "reader-catalog.json",
  "reader-ledger.json", "registration-catalog.json", "coverage.json", "plan.json",
]);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const record = x => x !== null && typeof x === "object" && !Array.isArray(x);
const exact = (value, keys) => record(value) && same(Object.keys(value).sort(), [...keys].sort());
const fail = code => { throw new Error(code); };
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const normalize = bytes => Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
const identity = migrationPath => {
  const filename = path.posix.basename(migrationPath);
  return { path: migrationPath, filename, version: filename.slice(0, 14), name: filename.slice(15, -4) };
};
const identities = [...MIGRATION_PATHS, APPLIED_OPERATOR_RPC.path].map(identity).sort((a, b) => a.version.localeCompare(b.version));
function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (record(payload) && Array.isArray(payload.data)) return payload.data;
  if (record(payload) && Array.isArray(payload.rows)) return payload.rows;
  fail("candidate_registration_repair_query_shape_invalid");
}

export function verifyRegistrationRepairSourceGate(input) {
  const { environment: env, checkoutSha, mainSha, actualReceiptSha256 } = input;
  if (!record(env) || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_REPOSITORY !== "adrianosortudo-source/caseload-select" || env.GITHUB_RUN_ATTEMPT !== "1" ||
      !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "") || env.PROJECT_REF !== PROJECT_REF ||
      env.USE_TEMPORARY_DATABASE_CREDENTIAL !== "true" || env.REPAIR_CONFIRMATION !== REPAIR_CONFIRMATION ||
      !/^[a-f0-9]{40}$/.test(env.REVIEWED_SOURCE_SHA ?? "") || checkoutSha !== env.REVIEWED_SOURCE_SHA ||
      mainSha !== checkoutSha || env.GITHUB_SHA !== checkoutSha ||
      !/^[a-f0-9]{64}$/.test(env.REVIEWED_RECEIPT_SHA256 ?? "") || actualReceiptSha256 !== env.REVIEWED_RECEIPT_SHA256) {
    fail("candidate_registration_repair_source_or_confirmation_invalid");
  }
  verifyDatabaseEnvironment(env, input.projectEnvFiles ?? []);
  return { runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT,
    sourceSha: checkoutSha, projectRef: PROJECT_REF, receiptSha256: actualReceiptSha256 };
}

export function verifyRegistrationRepairLedger(ledgerRows, receipt, sources, phase = "pre") {
  verifyReleaseReceipt(receipt, sources);
  if (!["pre", "post"].includes(phase)) fail("candidate_registration_repair_phase_invalid");
  if (phase === "post") {
    const proof = verifyLedgerState(ledgerRows, receipt, sources);
    if (proof.appliedPrefixLength !== MIGRATION_PATHS.length || proof.pending.length !== 0) fail("candidate_registration_repair_post_ledger_incomplete");
    // This targeted repair began with complete statement history. Retain that
    // stricter prerequisite instead of accepting a new baseline-history gap.
    const operatorRow = ledgerRows.find(row => row.version === identity(APPLIED_OPERATOR_RPC.path).version);
    verifyLedgerStatements(sources[APPLIED_OPERATOR_RPC.path], operatorRow?.statements);
    return proof;
  }
  const expected = identities.filter(item => item.path !== REGISTRATION_REPAIR_PATH);
  if (!Array.isArray(ledgerRows) || ledgerRows.length !== expected.length) fail("candidate_registration_repair_prerequisite_ledger_invalid");
  const checks = expected.map((item, index) => {
    const row = ledgerRows[index];
    if (!exact(row, ["version", "name", "statements"]) || row.version !== item.version || row.name !== item.name) {
      fail("candidate_registration_repair_prerequisite_ledger_invalid");
    }
    return { ...item, ...verifyLedgerStatements(sources[item.path], row.statements) };
  });
  return { projectRef: PROJECT_REF, verified: true, pending: [REGISTRATION_REPAIR_PATH], appliedMigrations: checks };
}

export function verifyRegistrationRepairPlan(plan, phase = "pre") {
  const pending = phase === "pre" ? [path.posix.basename(REGISTRATION_REPAIR_PATH)] : [];
  if (!["pre", "post"].includes(phase) || !record(plan) || plan.dryRun !== true ||
      plan.upToDate !== (phase === "post") || !same(plan.migrations, pending) || !same(plan.seeds, []) || !same(plan.roles, [])) {
    fail("candidate_registration_repair_exact_singleton_plan_required");
  }
  return { phase, dryRun: true, upToDate: phase === "post", migrations: pending };
}

function functionBody(source, functionName) {
  const sql = source.toString("utf8").replace(/\r\n/g, "\n");
  const marker = "CREATE OR REPLACE FUNCTION public." + functionName + "(";
  const start = sql.indexOf(marker);
  if (start < 0 || sql.indexOf(marker, start + marker.length) >= 0) fail("candidate_registration_repair_function_source_invalid");
  const bodyStart = sql.indexOf("AS $$", start), bodyEnd = sql.indexOf("$$;", bodyStart + 5);
  if (bodyStart < 0 || bodyEnd < 0) fail("candidate_registration_repair_function_source_invalid");
  return sql.slice(bodyStart + 5, bodyEnd);
}

export function registrationCatalogQuery() {
  return `SELECT p.proname AS "functionName", oidvectortypes(p.proargtypes) AS "identityArguments",
  l.lanname AS "languageName", p.prosecdef AS "securityDefiner", p.proconfig AS "settings", p.prosrc AS "body",
  has_function_privilege('service_role',p.oid,'EXECUTE') AS "serviceRoleExecute",
  has_function_privilege('anon',p.oid,'EXECUTE') AS "anonExecute",
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS "authenticatedExecute",
  has_table_privilege('service_role','public.prospect_enrichment_run_manifest_items','UPDATE') AS "manifestUpdateAllowed",
  EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS "publicExecute",
  coalesce((SELECT json_agg(r.rolname ORDER BY r.rolname) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner AND a.grantee<>0 AND a.privilege_type='EXECUTE'),'[]'::json) AS "nonOwnerExecuteGrantees"
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
  WHERE n.nspname='public' AND ((p.proname='register_prospect_enrichment_manifest_chunk_v1' AND oidvectortypes(p.proargtypes)='text, jsonb, boolean')
    OR (p.proname='record_prospect_enrichment_manifest_hold_evidence_v1' AND oidvectortypes(p.proargtypes)='text, text, text, jsonb'))
  ORDER BY p.proname;\n`;
}

export function verifyRegistrationRepairCatalog(catalogRows, migrationSource, phase = "post", sources) {
  if (!["pre", "post"].includes(phase) || !Array.isArray(catalogRows) || catalogRows.length !== 2) fail("candidate_registration_repair_catalog_invalid");
  const heldName = "record_prospect_enrichment_manifest_hold_evidence_v1";
  const chunkName = "register_prospect_enrichment_manifest_chunk_v1";
  const expected = [heldName, chunkName];
  for (const [index, row] of catalogRows.entries()) {
    if (!exact(row, ["functionName", "identityArguments", "languageName", "securityDefiner", "settings", "body", "serviceRoleExecute", "anonExecute", "authenticatedExecute", "publicExecute", "nonOwnerExecuteGrantees", "manifestUpdateAllowed"]) ||
        row.functionName !== expected[index] || row.identityArguments !== (index === 0 ? "text, text, text, jsonb" : "text, jsonb, boolean") ||
        row.languageName !== "plpgsql" || row.securityDefiner !== false || row.serviceRoleExecute !== true || row.anonExecute !== false ||
        row.authenticatedExecute !== false || row.publicExecute !== false || row.manifestUpdateAllowed !== false || !same(row.nonOwnerExecuteGrantees, ["service_role"]) ||
        !Array.isArray(row.settings) || !same([...row.settings].sort(), (phase === "post" ? ['search_path=""', "statement_timeout=30s"] : ['search_path=""']).sort()) || typeof row.body !== "string") {
      fail("candidate_registration_repair_catalog_invalid");
    }
  }
  const held = catalogRows[0].body.replace(/\r\n/g, "\n");
  const expectedHeld = phase === "post" ? functionBody(migrationSource, heldName)
    : sources && functionBody(sources["supabase/migrations/20260924071322_prospect_enrichment_manifest_hold_evidence.sql"], heldName);
  if (!expectedHeld || held !== expectedHeld ||
      !/SELECT \* INTO run_row FROM public\.prospect_enrichment_runs[^;]+FOR UPDATE;/s.test(held)) fail("candidate_registration_repair_held_body_invalid");
  if (phase === "post" && /SELECT \* INTO entry_row FROM public\.prospect_enrichment_run_manifest_items[^;]+FOR UPDATE;/s.test(held)) {
    fail("candidate_registration_repair_immutable_manifest_lock_present");
  }
  if (sources && catalogRows[1].body.replace(/\r\n/g, "\n") !== functionBody(sources["supabase/migrations/20260923161812_prospect_enrichment_v1.sql"], chunkName)) {
    fail("candidate_registration_repair_chunk_body_changed");
  }
  return { verified: true, phase, functions: expected, invoker: true, emptySearchPath: true, timeoutSeconds: phase === "post" ? 30 : null,
    heldBodySha256: sha256(held), chunkBodySha256: sha256(catalogRows[1].body.replace(/\r\n/g, "\n")) };
}

export function registrationRepairCoverageInventory(coverageSource) {
  const source = coverageSource.toString("utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("CREATE FUNCTION prospect_candidate_private.legacy_inventory()");
  const end = source.indexOf(") inventory(name,kind,columns,excluded)", start);
  if (start < 0 || end < 0) fail("candidate_registration_repair_coverage_inventory_invalid");
  const tableNames = [...source.slice(start, end).matchAll(/^\s*\('([a-z][a-z0-9_]{0,62})','/gm)].map(match => match[1]).sort();
  if (tableNames.length !== 33 || new Set(tableNames).size !== 33) fail("candidate_registration_repair_coverage_inventory_invalid");
  return tableNames;
}

export function verifyRegistrationRepairCoverage(statusRows, coverageSource = committedFile("supabase/migrations/20260924192549_prospect_enrichment_candidate_firm_coverage.sql")) {
  const status = validateBackfillStatus(statusRows);
  const expectedTables = registrationRepairCoverageInventory(coverageSource);
  if (!same(status.map(row => row.table_name), expectedTables) || status.some(row => row.complete !== true)) fail("candidate_registration_repair_complete_coverage_required");
  return { complete: true, totalTables: 33, rowsProjected: status.reduce((sum, row) => sum + row.rows_projected, 0), status };
}

export function verifyRegistrationRepairLiveState(reviewed, live) {
  if (!record(reviewed) || !record(live) || !exact(reviewed, Object.keys(live)) ||
      !same(Object.fromEntries(Object.entries(reviewed).filter(([key]) => key !== "coverage")),
        Object.fromEntries(Object.entries(live).filter(([key]) => key !== "coverage")))) {
    fail("candidate_registration_repair_live_state_changed");
  }
  const before = reviewed.coverage, after = live.coverage;
  if (!record(before) || !record(after) || before.complete !== true || after.complete !== true ||
      before.totalTables !== 33 || after.totalTables !== 33 || !Array.isArray(before.status) || !Array.isArray(after.status) ||
      before.status.length !== 33 || after.status.length !== 33 || after.rowsProjected < before.rowsProjected) {
    fail("candidate_registration_repair_coverage_regressed");
  }
  for (const [index, row] of before.status.entries()) {
    const current = after.status[index];
    if (!current || current.table_name !== row.table_name || row.complete !== true || current.complete !== true ||
        current.rows_projected < row.rows_projected || (row.last_id !== null &&
          (current.last_id === null || current.last_id.toLowerCase() < row.last_id.toLowerCase()))) {
      fail("candidate_registration_repair_coverage_regressed");
    }
  }
  return { verified: true, coverageProgressMonotonic: true };
}

function verifyOperatorCatalog(payload, receipt) {
  const actual = rows(payload);
  if (actual.length !== 1 || !exact(actual[0], Object.keys(CATALOG_EXPECTED)) ||
      Object.entries(CATALOG_EXPECTED).some(([key, value]) => !same(actual[0][key], value)) ||
      !same(receipt.appliedPrerequisite.expectedCatalog, CATALOG_EXPECTED)) fail("candidate_registration_repair_operator_catalog_invalid");
  return { verified: true, catalog: CATALOG_EXPECTED };
}

function verifyFiles(files, phase = "pre", sourceRoot = ROOT, sourceMaterial = loadSourceMaterial()) {
  if (!exact(files, EVIDENCE_FILES) || Object.values(files).some(bytes => !Buffer.isBuffer(bytes))) fail("candidate_registration_repair_evidence_files_invalid");
  const data = name => JSON.parse(files[name].toString("utf8"));
  const { receipt, sources } = sourceMaterial;
  const ledger = verifyRegistrationRepairLedger(rows(data("scoped-ledger.json")), receipt, sources, phase);
  const fullLedger = verifyFullMigrationLedger(rows(data("full-ledger.json")), sourceRoot,
    phase === "pre" ? "candidate-registration-repair-pending" : "complete", phase === "pre" ? [REGISTRATION_REPAIR_PATH] : undefined);
  const operator = verifyOperatorCatalog(data("operator-catalog.json"), receipt);
  verifyReaderRepairReceipt(read(path.join(sourceRoot, "scripts/prospect-enrichment/candidate-reader-repair-review.json")), sourceRoot);
  const reader = verifyReaderCatalog(data("reader-catalog.json"));
  const readerLedger = verifyTargetLedgerStatements(data("reader-ledger.json"), sourceRoot);
  const registration = verifyRegistrationRepairCatalog(rows(data("registration-catalog.json")), sources[REGISTRATION_REPAIR_PATH], phase, sources);
  const coverage = verifyRegistrationRepairCoverage(rows(data("coverage.json")), sources["supabase/migrations/20260924192549_prospect_enrichment_candidate_firm_coverage.sql"]);
  const plan = verifyRegistrationRepairPlan(data("plan.json"), phase);
  return { ledger, fullLedger, operator, reader, readerLedger, registration, coverage, plan };
}

export function createRegistrationRepairEvidence(binding, files, now = Date.now(), options = {}) {
  if (!exact(binding, ["runId", "runAttempt", "sourceSha", "projectRef", "receiptSha256"]) ||
      !/^[1-9][0-9]*$/.test(binding.runId ?? "") || binding.runAttempt !== "1" || !/^[a-f0-9]{40}$/.test(binding.sourceSha ?? "") ||
      binding.projectRef !== PROJECT_REF || !/^[a-f0-9]{64}$/.test(binding.receiptSha256 ?? "") || !Number.isSafeInteger(now)) fail("candidate_registration_repair_evidence_binding_invalid");
  const current = verifyFiles(files, "pre", options.sourceRoot, options.sourceMaterial);
  return { schemaVersion: "prospect-candidate-registration-repair-evidence/v1", binding,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString(),
    files: Object.fromEntries(EVIDENCE_FILES.map(name => [name, sha256(files[name])])), current };
}

export function verifyRegistrationRepairEvidence(evidence, binding, files, now = Date.now(), options = {}) {
  if (!exact(evidence, ["schemaVersion", "binding", "createdAt", "expiresAt", "files", "current"]) ||
      evidence.schemaVersion !== "prospect-candidate-registration-repair-evidence/v1" || !same(evidence.binding, binding)) fail("candidate_registration_repair_evidence_binding_invalid");
  const created = Date.parse(evidence.createdAt), expires = Date.parse(evidence.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || created > now || expires <= now || expires - created !== 86400000) fail("candidate_registration_repair_evidence_expired");
  if (!exact(files, EVIDENCE_FILES) || !same(evidence.files, Object.fromEntries(EVIDENCE_FILES.map(name => [name, sha256(files[name])])))) fail("candidate_registration_repair_evidence_changed");
  const current = verifyFiles(files, "pre", options.sourceRoot, options.sourceMaterial);
  if (!same(current, evidence.current)) fail("candidate_registration_repair_evidence_state_invalid");
  return { verified: true, binding, expiresAt: evidence.expiresAt, current };
}

export function verifyRegistrationRepairArtifactMetadata(metadata, environment) {
  if (String(metadata?.id) !== environment.EXPECTED_ARTIFACT_ID || metadata?.name !== REPAIR_ARTIFACT_NAME ||
      metadata?.expired !== false || metadata?.digest !== "sha256:" + environment.EXPECTED_ARTIFACT_DIGEST ||
      String(metadata?.workflow_run?.id) !== environment.GITHUB_RUN_ID || metadata?.workflow_run?.head_sha !== environment.REVIEWED_SOURCE_SHA) {
    fail("candidate_registration_repair_artifact_identity_invalid");
  }
  return { verified: true, artifactId: String(metadata.id) };
}

function run(command, args, operation, options = {}) {
  try { return execFileSync(command, args, { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024, timeout: 120000, ...options }); }
  catch (error) { fail("candidate_registration_repair_" + operation + "_exit_" + (Number.isInteger(error.status) ? Math.abs(error.status) : "timeout_or_signal")); }
}
function committedFile(relative) {
  const absolute = path.join(ROOT, relative), stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("candidate_registration_repair_source_file_invalid");
  const bytes = run("git", ["show", "HEAD:" + relative], "source_blob");
  if (!normalize(fs.readFileSync(absolute)).equals(normalize(bytes))) fail("candidate_registration_repair_uncommitted_source");
  return normalize(bytes);
}
function loadSourceMaterial() {
  const sources = Object.fromEntries([...MIGRATION_PATHS, APPLIED_OPERATOR_RPC.path].map(relative => [relative, committedFile(relative)]));
  for (const relative of CANDIDATE_READER_REPAIR_PATHS) committedFile(relative);
  committedFile("scripts/prospect-enrichment/candidate-reader-repair-review.json");
  const receiptBytes = committedFile(RELEASE_PATH), receipt = JSON.parse(receiptBytes);
  verifyReleaseReceipt(receipt, sources);
  return { sources, receipt, receiptBytes };
}
function checkSource() {
  const checkoutSha = run("git", ["rev-parse", "HEAD"], "source_head").toString().trim();
  run("git", ["fetch", "--no-tags", "origin", "main"], "source_fetch");
  const mainSha = run("git", ["rev-parse", "origin/main"], "source_main").toString().trim();
  const source = loadSourceMaterial();
  return verifyRegistrationRepairSourceGate({ environment: process.env, checkoutSha, mainSha,
    actualReceiptSha256: sha256(source.receiptBytes), projectEnvFiles: findProjectEnvFiles() });
}
function ensureConnection(minimumRemainingMs = 30000) {
  const issued = Number(process.env.TEMPORARY_DATABASE_ISSUED_AT), expires = Number(process.env.TEMPORARY_DATABASE_EXPIRES_AT);
  if (!Number.isSafeInteger(issued) || !Number.isSafeInteger(expires) || issued > Date.now() || expires - Date.now() < minimumRemainingMs) {
    fail("candidate_registration_repair_credential_budget_insufficient");
  }
  verifyDirectDatabaseUrl(process.env.MIGRATION_DATABASE_URL, process.env, findProjectEnvFiles());
}
function query(sql, operation) {
  ensureConnection();
  const sqlFile = path.join(tempRoot(), operation + ".sql"); fs.writeFileSync(sqlFile, sql);
  const bytes = run("supabase", ["db", "query", "--file", sqlFile, "--output-format", "json", "--agent", "no", "--db-url", process.env.MIGRATION_DATABASE_URL], operation, { timeout: 60000 });
  retainDiagnostic(operation, bytes);
  return bytes;
}
function retainDiagnostic(operation, bytes) {
  const directory = path.join(tempRoot(), "diagnostics"); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, operation + ".json"), bytes);
}
function tempRoot() {
  if (!process.env.RUNNER_TEMP) fail("candidate_registration_repair_runner_temp_required");
  const dir = path.join(path.resolve(process.env.RUNNER_TEMP), "registration-repair"); fs.mkdirSync(dir, { recursive: true }); return dir;
}
function filesAt(directory) {
  if (!same(fs.readdirSync(directory).sort(), [...EVIDENCE_FILES, "repair-evidence.json"].sort())) fail("candidate_registration_repair_evidence_files_invalid");
  const manifestStat = fs.lstatSync(path.join(directory, "repair-evidence.json"));
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) fail("candidate_registration_repair_evidence_files_invalid");
  return Object.fromEntries(EVIDENCE_FILES.map(name => {
    const file = path.join(directory, name), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) fail("candidate_registration_repair_evidence_files_invalid");
    return [name, fs.readFileSync(file)];
  }));
}
function dryRun(stage, label) {
  ensureConnection();
  const bytes = run("supabase", ["db", "push", "--dry-run", "--include-all", "--skip-vault", "--output-format", "json", "--db-url", process.env.MIGRATION_DATABASE_URL], label + "_dry_run", { cwd: stage });
  retainDiagnostic(label + "_dry_run", bytes);
  return bytes;
}
function snapshot(stage, phase, label) {
  const source = loadSourceMaterial();
  const readerVersions = CANDIDATE_READER_REPAIR_PATHS.map(relative => "'" + identity(relative).version + "'").join(",");
  const files = {
    "scoped-ledger.json": query(ledgerQuery(source.receipt), label + "_scoped_ledger"),
    "full-ledger.json": query(fullLedgerQuery(), label + "_full_ledger"),
    "operator-catalog.json": query(catalogQuery(), label + "_operator_catalog"),
    "reader-catalog.json": query(readerCatalogQuery + "\n", label + "_reader_catalog"),
    "reader-ledger.json": query("SELECT version,name,statements FROM supabase_migrations.schema_migrations WHERE version IN (" + readerVersions + ") ORDER BY version;\n", label + "_reader_ledger"),
    "registration-catalog.json": query(registrationCatalogQuery(), label + "_registration_catalog"),
    "coverage.json": query("SELECT * FROM prospect_candidate_private.coverage_backfill_status();\n", label + "_coverage"),
    "plan.json": dryRun(stage, label),
  };
  const current = verifyFiles(files, phase, ROOT, source);
  return { files, current };
}
function stage(label) {
  const directory = path.join(tempRoot(), "stage-" + label);
  if (fs.existsSync(directory)) fail("candidate_registration_repair_stage_exists");
  const proof = stageProductionWorkdir(ROOT, directory);
  verifyProductionWorkdir(ROOT, directory, proof);
  return { directory, proof };
}
function verifyEvidence(directory) {
  const binding = checkSource(), evidenceBytes = fs.readFileSync(path.join(directory, "repair-evidence.json"));
  if (!/^[a-f0-9]{64}$/.test(process.env.EXPECTED_MANIFEST_SHA256 ?? "") || sha256(evidenceBytes) !== process.env.EXPECTED_MANIFEST_SHA256) fail("candidate_registration_repair_manifest_hash_invalid");
  const evidence = JSON.parse(evidenceBytes);
  verifyRegistrationRepairEvidence(evidence, binding, filesAt(directory));
  return { binding, evidence };
}
function preflight(directory) {
  const binding = checkSource();
  if (run("supabase", ["--version"], "cli_version").toString().trim() !== CLI_VERSION) fail("candidate_registration_repair_cli_version_invalid");
  const staged = stage("preflight"), { files } = snapshot(staged.directory, "pre", "preflight");
  verifyProductionWorkdir(ROOT, staged.directory, staged.proof);
  const evidence = createRegistrationRepairEvidence(binding, files);
  fs.mkdirSync(directory, { recursive: true });
  if (fs.readdirSync(directory).length) fail("candidate_registration_repair_evidence_destination_not_empty");
  for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), bytes);
  save(path.join(directory, "repair-evidence.json"), evidence);
  const manifestSha256 = sha256(fs.readFileSync(path.join(directory, "repair-evidence.json")));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `manifest_sha256=${manifestSha256}\n`);
  return { binding, manifestSha256, verified: true, pending: [REGISTRATION_REPAIR_PATH], coverageComplete: true };
}
function apply(directory) {
  const { binding, evidence } = verifyEvidence(directory);
  if (run("supabase", ["--version"], "cli_version").toString().trim() !== CLI_VERSION) fail("candidate_registration_repair_cli_version_invalid");
  const staged = stage("apply"), before = snapshot(staged.directory, "pre", "immediate");
  verifyRegistrationRepairLiveState(evidence.current, before.current);
  verifyRegistrationRepairEvidence(evidence, binding, filesAt(directory));
  checkSource(); verifyProductionWorkdir(ROOT, staged.directory, staged.proof); ensureConnection(150000);
  const receiptFile = path.join(tempRoot(), "writer-receipt.json");
  if (fs.existsSync(receiptFile)) fail("candidate_registration_repair_blind_retry_prohibited");
  // Persist uncertainty BEFORE the only database writer starts. Never erase it on failure.
  const receipt = { binding, migrations: [REGISTRATION_REPAIR_PATH], state: "started_unverified",
    replayAllowed: false, readOnlyReconciliationRequired: true, manifestSha256: process.env.EXPECTED_MANIFEST_SHA256 };
  save(receiptFile, receipt);
  run("supabase", ["db", "push", "--yes", "--include-all", "--skip-vault", "--output-format", "json", "--db-url", process.env.MIGRATION_DATABASE_URL], "singleton_apply", { cwd: staged.directory, timeout: 60000 });
  const after = snapshot(staged.directory, "post", "post");
  checkSource(); verifyProductionWorkdir(ROOT, staged.directory, staged.proof);
  const postDir = path.join(tempRoot(), "post-readback"); fs.mkdirSync(postDir, { recursive: true });
  for (const [name, bytes] of Object.entries(after.files)) fs.writeFileSync(path.join(postDir, name), bytes);
  save(path.join(postDir, "verified-state.json"), after.current);
  save(receiptFile, { ...receipt, state: "verified", readOnlyReconciliationRequired: false, readback: after.current });
  return { binding, state: "verified", migrations: [REGISTRATION_REPAIR_PATH], coverage: after.current.coverage };
}

export function safeRegistrationRepairFailureCode(error) {
  const code = error instanceof Error ? error.message : "";
  if (/^candidate_registration_repair_[a-z0-9_]+$/.test(code)) return code;
  const safeShared = new Set(["ledger_statements_missing", "ledger_statement_content_mismatch", "ledger_statement_boundary_mismatch",
    "ledger_statement_terminator_missing", "ledger_source_coverage_incomplete", "unexpected_full_history_delta",
    "remote_migration_source_missing_or_mismatched", "invalid_full_ledger_rows", "reader_catalog_contract_mismatch",
    "reader_repair_target_ledger_invalid", "release_receipt_source_mismatch", "candidate_backfill_status_invalid"]);
  return safeShared.has(code) ? "candidate_registration_repair_" + code : "candidate_registration_repair_unexpected_failure";
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    let result;
    if (command === "source-authorization" && args.length === 0) result = checkSource();
    else if (command === "preflight" && args.length === 1) result = preflight(args[0]);
    else if (command === "verify-evidence" && args.length === 1) result = verifyEvidence(args[0]);
    else if (command === "verify-artifact" && args.length === 1) result = verifyRegistrationRepairArtifactMetadata(read(args[0]), process.env);
    else if (command === "apply" && args.length === 1) result = apply(args[0]);
    else fail("candidate_registration_repair_command_invalid");
    console.log(JSON.stringify(result));
  } catch (error) {
    const failure = { error: safeRegistrationRepairFailureCode(error) };
    // Persist only the sanitized stage code. Child stderr and database source values are never retained.
    if (process.env.RUNNER_TEMP) save(path.join(tempRoot(), "failure.json"), failure);
    console.error(JSON.stringify(failure)); process.exitCode = 1;
  }
}
