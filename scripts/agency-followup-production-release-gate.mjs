// Fixed, source-pinned production release gate for the Agency follow-up migration set.
// No arbitrary SQL, migration list, target project, or migration-history repair is accepted.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  CLI_VERSION,
  HISTORICAL_LEDGER_NAME_ALIASES,
  PREVIEW_MIGRATION_PATHS,
  PROJECT_REF,
  TEMPORARY_DATABASE_HOST,
  verifyDatabaseEnvironment,
  findProjectEnvFiles,
  fullLedgerQuery,
  sha256,
  sourceMigrationInventory,
  stageProductionWorkdir,
  verifyDirectDatabaseUrl,
  verifyLedgerStatements,
  verifyProductionWorkdir,
} from "./prospect-enrichment/migration-gate.mjs";
import { DATABASE_CA_SHA256 } from "./prospect-enrichment/database-ca.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const APPLY_CONFIRMATION = "APPLY-AGENCY-FOLLOWUP-MIGRATIONS-V1";
export const TEMPORARY_CREDENTIAL_CONFIRMATION = "CREATE-TEMPORARY-AGENCY-DATABASE-ACCESS";
export const AGENCY_MIGRATIONS = Object.freeze([
  Object.freeze({ path: "supabase/migrations/20261013230354_agency_crm_service_role_grants.sql", filename: "20261013230354_agency_crm_service_role_grants.sql", version: "20261013230354", name: "agency_crm_service_role_grants", sha256: "0dce15f75e20ea8d170b862a7a5075e675570e23f1dca53c4ed76bc531d41568" }),
  Object.freeze({ path: "supabase/migrations/20261020025251_agency_followup_resend_events_and_shared_suppression.sql", filename: "20261020025251_agency_followup_resend_events_and_shared_suppression.sql", version: "20261020025251", name: "agency_followup_resend_events_and_shared_suppression", sha256: "e0a7a24d5750b20c32e1fdec20abd8ce84237f3dc7eced8a2182e22b61681a3e" }),
  Object.freeze({ path: "supabase/migrations/20261020141945_agency_followup_provider_event_row_lock_privilege.sql", filename: "20261020141945_agency_followup_provider_event_row_lock_privilege.sql", version: "20261020141945", name: "agency_followup_provider_event_row_lock_privilege", sha256: "c7eb4e334bcac6751b89d43157c556dee38d7ebbb7d35529195e2c0ddca549eb" }),
  Object.freeze({ path: "supabase/migrations/20261021040000_agency_followup_opt_in_events.sql", filename: "20261021040000_agency_followup_opt_in_events.sql", version: "20261021040000", name: "agency_followup_opt_in_events", sha256: "be0c6bd951f85b1d98f8a4cbb85bf73b5f808e987003608db05d7992754b0f13" }),
  Object.freeze({ path: "supabase/migrations/20261021050000_agency_followup_opt_in_operator_read_grant.sql", filename: "20261021050000_agency_followup_opt_in_operator_read_grant.sql", version: "20261021050000", name: "agency_followup_opt_in_operator_read_grant", sha256: "8b56817fbf20089c4048cc6d33f38622b1461ec86446ec00a4232647733655d9" }),
  Object.freeze({ path: "supabase/migrations/20261021173939_agency_followup_test_message_claim.sql", filename: "20261021173939_agency_followup_test_message_claim.sql", version: "20261021173939", name: "agency_followup_test_message_claim", sha256: "5b138039b1b18c5062c1396af3905d337d969598d1ac6481046f5b231f1ed3a5" }),
  Object.freeze({ path: "supabase/migrations/20261022172352_agency_followup_webhook_replay_quarantine_guard.sql", filename: "20261022172352_agency_followup_webhook_replay_quarantine_guard.sql", version: "20261022172352", name: "agency_followup_webhook_replay_quarantine_guard", sha256: "2e232ef63c0c946f12f1be27f8c0aef56ab67402d4ecb34aa6e52ada4bb9e8ed" }),
  Object.freeze({ path: "supabase/migrations/20261022222611_agency_followup_provider_event_least_privilege.sql", filename: "20261022222611_agency_followup_provider_event_least_privilege.sql", version: "20261022222611", name: "agency_followup_provider_event_least_privilege", sha256: "c92bfdf08f351c3c35ece9a47bdec71810b9a16002f3f036d30b96b269c996c3" }),
  Object.freeze({ path: "supabase/migrations/20261023170628_agency_followup_template_approval_atomic.sql", filename: "20261023170628_agency_followup_template_approval_atomic.sql", version: "20261023170628", name: "agency_followup_template_approval_atomic", sha256: "dbe94ab0cf2611213d74070e73fb34faab0d5aff7df9c62a82e981b397c9a165" }),
  Object.freeze({ path: "supabase/migrations/20261023185535_agency_followup_live_message_claim.sql", filename: "20261023185535_agency_followup_live_message_claim.sql", version: "20261023185535", name: "agency_followup_live_message_claim", sha256: "080b1faae5c7fe0ca6cc9184a07e48135b12ba264571da1613b63322b39414e3" }),
  Object.freeze({ path: "supabase/migrations/20261023185615_agency_followup_provider_idempotency_fence.sql", filename: "20261023185615_agency_followup_provider_idempotency_fence.sql", version: "20261023185615", name: "agency_followup_provider_idempotency_fence", sha256: "c61b1e7ea13443e47f69b0a5524ba364bf82b1815a36f5423501ad2737ce909d" }),
  Object.freeze({ path: "supabase/migrations/20261024054520_agency_followup_resend_suppressed_status.sql", filename: "20261024054520_agency_followup_resend_suppressed_status.sql", version: "20261024054520", name: "agency_followup_resend_suppressed_status", sha256: "83f2cde60d46efbc55326eba6fc7b331b652b29e3e6ca67df46c5725cf50ccc1" }),
  Object.freeze({ path: "supabase/migrations/20261024171116_agency_followup_serialized_provider_handoff_gate.sql", filename: "20261024171116_agency_followup_serialized_provider_handoff_gate.sql", version: "20261024171116", name: "agency_followup_serialized_provider_handoff_gate", sha256: "09d8d9948fdf9d825adde4629afccc2a149dd9e2992fb5f35d0576bd6f41031f" }),
  Object.freeze({ path: "supabase/migrations/20261024175302_agency_followup_resend_unknown_reconciliation.sql", filename: "20261024175302_agency_followup_resend_unknown_reconciliation.sql", version: "20261024175302", name: "agency_followup_resend_unknown_reconciliation", sha256: "f2456849f9651e5c38788e779ac71e0e00e78e13c04f99059de02caa461574b7" }),
  Object.freeze({ path: "supabase/migrations/20261024213806_agency_followup_handoff_clock_recheck_and_contact_suppression.sql", filename: "20261024213806_agency_followup_handoff_clock_recheck_and_contact_suppression.sql", version: "20261024213806", name: "agency_followup_handoff_clock_recheck_and_contact_suppression", sha256: "9b7e1fbdade7a72b44053a426dc23b65f38b9ad78476cf6de58c1e3c45aae58f" }),
  Object.freeze({ path: "supabase/migrations/20261024233611_agency_followup_activity_lock_order_fix.sql", filename: "20261024233611_agency_followup_activity_lock_order_fix.sql", version: "20261024233611", name: "agency_followup_activity_lock_order_fix", sha256: "8d6917c174f2943e1370f65a31a98768899188c31f19d98acc411232210a8754" }),
  Object.freeze({ path: "supabase/migrations/20261026124659_agency_followup_ambiguous_recipient_suppression.sql", filename: "20261026124659_agency_followup_ambiguous_recipient_suppression.sql", version: "20261026124659", name: "agency_followup_ambiguous_recipient_suppression", sha256: "0b0bdb0e51efb3536026f83d0f5f5af22fb418c6bc5c7fd6a81de1a622ab315d" }),
  Object.freeze({ path: "supabase/migrations/20261026180704_agency_followup_recipient_unsubscribe.sql", filename: "20261026180704_agency_followup_recipient_unsubscribe.sql", version: "20261026180704", name: "agency_followup_recipient_unsubscribe", sha256: "76fb95399d57ad53e2ff3ae78e62ee61aa7bd49a6ab4aaffb839ed7b9f9323c5" }),
]);
export const PREFLIGHT_EVIDENCE_FILES = Object.freeze([
  "source-check.json",
  "staged-inventory.json",
  "database-tls-check.json",
  "connection-check.json",
  "full-ledger-before.json",
  "ledger-before-check.json",
  "plan.json",
  "plan-check.json",
]);
export const APPLY_EVIDENCE_FILES = Object.freeze([
  "source-check-apply.json",
  "staged-inventory-apply.json",
  "stage-match-check.json",
  "database-tls-check-apply.json",
  "connection-check-apply.json",
  "full-ledger-immediate.json",
  "ledger-immediate-check.json",
  "ledger-recheck-check.json",
  "plan-immediate.json",
  "plan-immediate-check.json",
  "plan-recheck-check.json",
  "apply-authorization.json",
  "apply.json",
  "staged-inventory-post.json",
  "stage-post-match-check.json",
  "full-ledger-after.json",
  "ledger-after-check.json",
  "agency-ledger-after.json",
  "ledger-delta-check.json",
  "plan-after.json",
  "plan-after-check.json",
]);
const PREVIEW_SET = new Set(PREVIEW_MIGRATION_PATHS);
const FAIL = code => { throw new Error(code); };
const SAME = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const IS_RECORD = value => value !== null && typeof value === "object" && !Array.isArray(value);
const EXACT_KEYS = (value, keys) => IS_RECORD(value) && SAME(Object.keys(value).sort(), [...keys].sort());
const READ_JSON = file => JSON.parse(fs.readFileSync(file, "utf8"));
const WRITE_JSON = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const MIGRATION_IDENTITIES = AGENCY_MIGRATIONS.map(({ path: itemPath, filename, version, name, sha256: digest }) => ({ path: itemPath, filename, version, name, sha256: digest }));
const RESULT_FILES = Object.freeze([...PREFLIGHT_EVIDENCE_FILES, "preflight-manifest.json", ...APPLY_EVIDENCE_FILES]);

function runGit(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 4 * 1024 * 1024 }).trim();
  } catch {
    FAIL("agency_followup_git_source_check_failed");
  }
}

function getFileSha(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) FAIL("agency_followup_evidence_file_invalid");
  return sha256(fs.readFileSync(file));
}

function parseRows(payload) {
  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : parsed?.rows;
  if (!Array.isArray(rows)) FAIL("agency_followup_migration_rows_invalid");
  return rows;
}

function validateLedgerRows(rows) {
  if (!Array.isArray(rows)) FAIL("agency_followup_migration_rows_invalid");
  const map = new Map();
  let previous = "";
  for (const row of rows) {
    if (!EXACT_KEYS(row, ["name", "version"]) || typeof row.version !== "string" || typeof row.name !== "string" ||
        row.version <= previous || map.has(row.version)) FAIL("agency_followup_migration_rows_invalid");
    previous = row.version;
    map.set(row.version, row.name);
  }
  return map;
}

function currentAgencyManifest(sourceRoot, migrationIdentities = MIGRATION_IDENTITIES) {
  const root = fs.realpathSync(sourceRoot);
  const inventory = sourceMigrationInventory(root);
  const byPath = new Map(inventory.migrations.map(item => [item.path, item]));
  const manifest = [];
  const versions = migrationIdentities.map(item => item.version);
  if (!Array.isArray(migrationIdentities) || migrationIdentities.length !== AGENCY_MIGRATIONS.length ||
      !SAME(versions, [...versions].sort()) || new Set(versions).size !== versions.length) {
    FAIL("agency_followup_migration_pin_order_invalid");
  }
  for (const expected of migrationIdentities) {
    const actual = byPath.get(expected.path);
    if (!actual || actual.filename !== expected.filename || actual.version !== expected.version ||
        actual.name !== expected.name || actual.bytes <= 0) {
      FAIL("agency_followup_pinned_migration_source_mismatch");
    }
    let committed;
    try {
      committed = execFileSync("git", ["show", "HEAD:" + expected.path], {
        cwd: root, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 4 * 1024 * 1024,
      });
    } catch {
      FAIL("agency_followup_migration_git_blob_unavailable");
    }
    const workingRaw = fs.readFileSync(path.join(root, expected.path));
    const working = Buffer.from(workingRaw.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
    if (!working.equals(committed)) FAIL("agency_followup_working_migration_differs_from_git_blob");
    if (sha256(committed) !== expected.sha256) FAIL("agency_followup_pinned_migration_source_mismatch");
    manifest.push({ ...expected, bytes: committed.length });
  }
  return { root, inventory, migrations: manifest };
}

export function verifyAgencyMigrationSources(sourceRoot, expectedMigrations = AGENCY_MIGRATIONS) {
  if (!Array.isArray(expectedMigrations)) FAIL("agency_followup_migration_pin_order_invalid");
  const identities = expectedMigrations.map(({ path: itemPath, filename, version, name, sha256: digest }) => ({ path: itemPath, filename, version, name, sha256: digest }));
  return currentAgencyManifest(sourceRoot, identities).migrations;
}

export function verifyAgencyWorkflowBinding({
  event, ref, repository, reviewedSourceSha, checkoutSha, githubSha, originMainSha,
  runId, runAttempt, worktreeStatus,
}) {
  if (event !== "workflow_dispatch" || ref !== "refs/heads/main" || repository !== "adrianosortudo-source/caseload-select") {
    FAIL("agency_followup_manual_main_repository_required");
  }
  if (!/^[a-f0-9]{40}$/.test(reviewedSourceSha ?? "") || reviewedSourceSha !== checkoutSha ||
      reviewedSourceSha !== githubSha || reviewedSourceSha !== originMainSha) FAIL("agency_followup_reviewed_source_sha_changed");
  if (!/^[1-9][0-9]*$/.test(runId ?? "") || runAttempt !== "1") FAIL("agency_followup_workflow_replay_prohibited");
  if (typeof worktreeStatus !== "string" || worktreeStatus !== "") FAIL("agency_followup_checkout_not_clean");
  return { schemaVersion: "agency-followup-source-check/v1", projectRef: PROJECT_REF, sourceSha: reviewedSourceSha, runId, runAttempt };
}


function credentialModeFromEnvironment(env) {
  if (env.USE_TEMPORARY_DATABASE_CREDENTIAL !== undefined &&
      !["true", "false"].includes(env.USE_TEMPORARY_DATABASE_CREDENTIAL)) FAIL("agency_followup_credential_mode_invalid");
  return env.USE_TEMPORARY_DATABASE_CREDENTIAL === "true" ? "temporary-write-capable" : "saved-password";
}

export function verifyAgencyTemporaryCredentialAuthorization(env, context) {
  if (credentialModeFromEnvironment(env) !== "temporary-write-capable" ||
      env.CREDENTIAL_GATE !== "agency-followup" ||
      env.TEMPORARY_CREDENTIAL_CONFIRMATION !== TEMPORARY_CREDENTIAL_CONFIRMATION ||
      !["preflight", "apply"].includes(env.GITHUB_JOB)) FAIL("agency_followup_temporary_access_confirmation_required");
  const binding = verifyAgencyWorkflowBinding({
    event: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF, repository: env.GITHUB_REPOSITORY,
    reviewedSourceSha: env.REVIEWED_SOURCE_SHA, githubSha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT,
    checkoutSha: context.checkoutSha, originMainSha: context.originMainSha, worktreeStatus: context.worktreeStatus,
  });
  verifyDatabaseEnvironment(env, context.projectEnvFiles ?? []);
  if (env.GITHUB_JOB === "apply" && env.APPLY_CONFIRMATION !== APPLY_CONFIRMATION) {
    FAIL("agency_followup_exact_apply_confirmation_required");
  }
  return { ...binding, job: env.GITHUB_JOB, credentialMode: "temporary-write-capable", temporaryAccessConfirmed: true };
}

export function verifyAgencyConnectionEvidence(connection, credentialMode = "saved-password") {
  const temporary = credentialMode === "temporary-write-capable";
  const keys = ["host", "port", "database", "user", "sslmode", "connectionMode", "certificateTrust"];
  if (temporary) keys.push("credentialMode");
  if (!["saved-password", "temporary-write-capable"].includes(credentialMode) || !EXACT_KEYS(connection, keys) ||
      connection.host !== (temporary ? TEMPORARY_DATABASE_HOST : "db." + PROJECT_REF + ".supabase.co") ||
      connection.port !== 5432 || connection.database !== "postgres" || connection.sslmode !== "verify-full" ||
      connection.connectionMode !== "explicit-db-url" || connection.certificateTrust !== "pinned-supabase-root-2021") {
    FAIL("agency_followup_database_connection_evidence_invalid");
  }
  if (temporary) {
    const suffix = "." + PROJECT_REF;
    if (connection.credentialMode !== credentialMode || typeof connection.user !== "string" ||
        !connection.user.endsWith(suffix) || !/^cli_login_[a-z0-9_]{1,53}$/.test(connection.user.slice(0, -suffix.length))) {
      FAIL("agency_followup_database_connection_evidence_invalid");
    }
  } else if (connection.user !== "postgres") FAIL("agency_followup_database_connection_evidence_invalid");
  return connection;
}

function sourceCheckFromEnvironment() {
  const checkoutSha = runGit(ROOT, ["rev-parse", "HEAD"]);
  const originMainSha = runGit(ROOT, ["rev-parse", "origin/main"]);
  const worktreeStatus = runGit(ROOT, ["status", "--porcelain"]);
  const binding = verifyAgencyWorkflowBinding({
    event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    repository: process.env.GITHUB_REPOSITORY,
    reviewedSourceSha: process.env.REVIEWED_SOURCE_SHA,
    checkoutSha,
    githubSha: process.env.GITHUB_SHA,
    originMainSha,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    worktreeStatus,
  });
  return { ...binding, migrations: verifyAgencyMigrationSources(ROOT), excludedPreviewMigrations: [...PREVIEW_MIGRATION_PATHS] };
}

function expectedPreviewExclusions(sourceRoot) {
  const inventory = sourceMigrationInventory(sourceRoot);
  const excluded = inventory.migrations.filter(item => PREVIEW_SET.has(item.path))
    .map(({ path: itemPath, version, name, bytes, sha256: digest }) => ({ path: itemPath, version, name, bytes, sha256: digest }));
  if (!SAME(excluded.map(item => item.path), [...PREVIEW_MIGRATION_PATHS])) FAIL("agency_followup_preview_migration_exclusion_mismatch");
  return excluded;
}

function stageEvidenceFromProof(sourceRoot, sourceSha, proof) {
  const migrations = verifyAgencyMigrationSources(sourceRoot);
  const exclusions = expectedPreviewExclusions(sourceRoot);
  if (!SAME(proof.exclusions, exclusions) || proof.migrationCount !== sourceMigrationInventory(sourceRoot).migrations.length - PREVIEW_MIGRATION_PATHS.length ||
      !/^[a-f0-9]{64}$/.test(proof.inventorySha256 ?? "") || !/^[a-f0-9]{64}$/.test(proof.configSha256 ?? "")) {
    FAIL("agency_followup_stage_inventory_mismatch");
  }
  return {
    schemaVersion: "agency-followup-stage-proof/v1",
    projectRef: PROJECT_REF,
    sourceSha,
    migrations,
    stage: {
      migrationCount: proof.migrationCount,
      inventorySha256: proof.inventorySha256,
      configSha256: proof.configSha256,
      exclusions,
    },
  };
}

export function stageAgencyProductionWorkdir(sourceRoot, destinationRoot, sourceSha) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha ?? "")) FAIL("agency_followup_reviewed_source_sha_required");
  verifyAgencyMigrationSources(sourceRoot);
  const proof = stageProductionWorkdir(sourceRoot, destinationRoot);
  verifyProductionWorkdir(sourceRoot, destinationRoot, proof);
  return { proof, evidence: stageEvidenceFromProof(sourceRoot, sourceSha, proof) };
}

export function verifyAgencyStageEvidence(evidence, sourceRoot, sourceSha) {
  if (!EXACT_KEYS(evidence, ["schemaVersion", "projectRef", "sourceSha", "migrations", "stage"]) ||
      evidence.schemaVersion !== "agency-followup-stage-proof/v1" || evidence.projectRef !== PROJECT_REF ||
      evidence.sourceSha !== sourceSha || !EXACT_KEYS(evidence.stage, ["migrationCount", "inventorySha256", "configSha256", "exclusions"])) {
    FAIL("agency_followup_stage_evidence_invalid");
  }
  const migrations = verifyAgencyMigrationSources(sourceRoot);
  if (!SAME(evidence.migrations, migrations)) FAIL("agency_followup_stage_source_manifest_mismatch");
  const exclusions = expectedPreviewExclusions(sourceRoot);
  const sourceInventory = sourceMigrationInventory(sourceRoot);
  if (evidence.stage.migrationCount !== sourceInventory.migrations.length - PREVIEW_MIGRATION_PATHS.length ||
      !/^[a-f0-9]{64}$/.test(evidence.stage.inventorySha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(evidence.stage.configSha256 ?? "") ||
      !SAME(evidence.stage.exclusions, exclusions)) FAIL("agency_followup_stage_inventory_mismatch");
  return evidence;
}

export function verifyAgencyFullLedger(rowsInput, sourceRoot, phase) {
  if (!["preflight", "immediate", "post"].includes(phase)) FAIL("agency_followup_ledger_phase_invalid");
  const { inventory } = currentAgencyManifest(sourceRoot);
  const local = inventory.migrations.filter(item => !PREVIEW_SET.has(item.path));
  const localByVersion = new Map(local.map(item => [item.version, item]));
  const rows = parseRows(rowsInput);
  const remote = validateLedgerRows(rows);
  for (const [version, name] of remote) {
    const source = localByVersion.get(version);
    const alias = HISTORICAL_LEDGER_NAME_ALIASES[version];
    const expectedName = alias && source?.filename === alias.filename ? alias.name : source?.name;
    if (!source || name !== expectedName) FAIL("agency_followup_remote_migration_source_missing_or_mismatched");
  }
  const pending = local.filter(item => !remote.has(item.version)).map(item => item.path).sort();
  const expected = phase === "post" ? [] : AGENCY_MIGRATIONS.map(item => item.path);
  if (!SAME(pending, expected)) FAIL("agency_followup_unexpected_pending_migrations");
  return {
    schemaVersion: "agency-followup-full-ledger-check/v1",
    projectRef: PROJECT_REF,
    phase,
    remoteVersionCount: remote.size,
    sourceMigrationCount: local.length,
    excludedPreviewMigrations: [...PREVIEW_MIGRATION_PATHS],
    pendingPaths: pending,
    pendingVersions: phase === "post" ? [] : AGENCY_MIGRATIONS.map(item => item.version),
    exactPendingSet: true,
  };
}

export function agencyFollowupLedgerQuery() {
  const versions = AGENCY_MIGRATIONS.map(item => "'" + item.version + "'").join(", ");
  return "SELECT version, name, statements FROM supabase_migrations.schema_migrations WHERE version IN (" + versions + ") ORDER BY version;\n";
}

export function verifyAgencyPlan(plan, phase) {
  if (!["pre", "post"].includes(phase) || !IS_RECORD(plan) ||
      !EXACT_KEYS(plan, ["dryRun", "upToDate", "migrations", "seeds", "roles", "message"])) FAIL("agency_followup_migration_plan_invalid");
  const post = phase === "post";
  const expected = post ? [] : AGENCY_MIGRATIONS.map(item => item.filename);
  const expectedMessage = post ? "Remote database is up to date." : "Finished supabase db push.";
  if (plan.dryRun !== true || plan.upToDate !== post || !SAME(plan.migrations, expected) ||
      !Array.isArray(plan.seeds) || plan.seeds.length !== 0 || !Array.isArray(plan.roles) || plan.roles.length !== 0 ||
      plan.message !== expectedMessage) {
    FAIL("agency_followup_migration_plan_mismatch");
  }
  return { schemaVersion: "agency-followup-migration-plan-check/v1", phase, migrations: expected, dryRun: true, upToDate: post, seeds: [], roles: [], message: expectedMessage };
}

export function verifySameAgencyLedger(beforeInput, immediateInput) {
  const before = parseRows(beforeInput), immediate = parseRows(immediateInput);
  validateLedgerRows(before);
  validateLedgerRows(immediate);
  if (!SAME(before, immediate)) FAIL("agency_followup_ledger_changed_since_preflight");
  return { schemaVersion: "agency-followup-ledger-recheck/v1", rowCount: before.length, unchangedSincePreflight: true };
}

export function verifySameAgencyPlan(preflightInput, immediateInput) {
  const preflight = verifyAgencyPlan(preflightInput, "pre");
  const immediate = verifyAgencyPlan(immediateInput, "pre");
  if (!SAME(preflight, immediate)) FAIL("agency_followup_plan_changed_since_preflight");
  return { schemaVersion: "agency-followup-plan-recheck/v1", migrations: immediate.migrations, unchangedSincePreflight: true };
}

export function verifyAgencyLedgerDeltaRecords(beforeInput, afterInput) {
  const beforeRows = parseRows(beforeInput), afterRows = parseRows(afterInput);
  const before = validateLedgerRows(beforeRows), after = validateLedgerRows(afterRows);
  for (const [version, name] of before) if (after.get(version) !== name) FAIL("agency_followup_full_ledger_changed_outside_allowlist");
  const added = [...after.keys()].filter(version => !before.has(version)).sort();
  const expected = AGENCY_MIGRATIONS.map(item => item.version).sort();
  if (!SAME(added, expected)) FAIL("agency_followup_ledger_delta_mismatch");
  return { addedVersions: added, beforeCount: before.size, afterCount: after.size, exactDelta: true };
}

function verifyAgencyTargetLedger(rowsInput, sourceRoot) {
  const rows = parseRows(rowsInput);
  if (rows.length !== AGENCY_MIGRATIONS.length) FAIL("agency_followup_target_ledger_count_mismatch");
  const sourceRootReal = fs.realpathSync(sourceRoot);
  const statementEvidence = [];
  for (const [index, expected] of AGENCY_MIGRATIONS.entries()) {
    const row = rows[index];
    if (!EXACT_KEYS(row, ["name", "statements", "version"]) || row.version !== expected.version ||
        row.name !== expected.name || !Array.isArray(row.statements)) FAIL("agency_followup_target_ledger_identity_mismatch");
    statementEvidence.push({
      path: expected.path,
      version: expected.version,
      ...verifyLedgerStatements(fs.readFileSync(path.join(sourceRootReal, expected.path)), row.statements),
    });
  }
  return { schemaVersion: "agency-followup-target-ledger-check/v1", projectRef: PROJECT_REF, migrationCount: rows.length, statementEvidence };
}

export function verifyAgencyLedgerDelta(beforeInput, afterInput, targetInput, sourceRoot) {
  const beforeCheck = verifyAgencyFullLedger(beforeInput, sourceRoot, "preflight");
  const afterCheck = verifyAgencyFullLedger(afterInput, sourceRoot, "post");
  const delta = verifyAgencyLedgerDeltaRecords(beforeInput, afterInput);
  const target = verifyAgencyTargetLedger(targetInput, sourceRoot);
  return { schemaVersion: "agency-followup-ledger-delta-check/v1", beforeCheck, afterCheck, delta, target };
}

function workflowBindingFromEnvironment(env = process.env) {
  const binding = {
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    sourceSha: env.REVIEWED_SOURCE_SHA,
    projectRef: PROJECT_REF,
    credentialMode: credentialModeFromEnvironment(env),
  };
  if (!/^[1-9][0-9]*$/.test(binding.runId ?? "") || binding.runAttempt !== "1" ||
      !/^[a-f0-9]{40}$/.test(binding.sourceSha ?? "")) FAIL("agency_followup_workflow_binding_invalid");
  return binding;
}

function evidenceFileBytes(directory, names) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) FAIL("agency_followup_evidence_directory_invalid");
  const actual = fs.readdirSync(directory).sort();
  if (!SAME(actual, [...names].sort())) FAIL("agency_followup_evidence_files_invalid");
  return Object.fromEntries(names.map(name => {
    const full = path.join(directory, name);
    const fileStat = fs.lstatSync(full);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) FAIL("agency_followup_evidence_file_invalid");
    const bytes = fs.readFileSync(full);
    if (!bytes.length) FAIL("agency_followup_evidence_file_empty");
    return [name, bytes];
  }));
}

function validatePreflightContent(binding, files, sourceRoot) {
  const sourceCheck = JSON.parse(files["source-check.json"].toString("utf8"));
  if (sourceCheck.schemaVersion !== "agency-followup-source-check/v1" || sourceCheck.sourceSha !== binding.sourceSha ||
      sourceCheck.runId !== binding.runId || sourceCheck.runAttempt !== binding.runAttempt || sourceCheck.projectRef !== PROJECT_REF ||
      !SAME(sourceCheck.migrations, verifyAgencyMigrationSources(sourceRoot)) ||
      !SAME(sourceCheck.excludedPreviewMigrations, [...PREVIEW_MIGRATION_PATHS])) FAIL("agency_followup_preflight_source_evidence_invalid");
  const stage = JSON.parse(files["staged-inventory.json"].toString("utf8"));
  verifyAgencyStageEvidence(stage, sourceRoot, binding.sourceSha);
  const tls = JSON.parse(files["database-tls-check.json"].toString("utf8"));
  const { certificateSha256, validTo, ...tlsConnection } = tls;
  if (certificateSha256 !== DATABASE_CA_SHA256 || !Number.isFinite(Date.parse(validTo)) || Date.parse(validTo) <= Date.now()) {
    FAIL("agency_followup_tls_evidence_invalid");
  }
  verifyAgencyConnectionEvidence(tlsConnection, binding.credentialMode);
  const connection = JSON.parse(files["connection-check.json"].toString("utf8"));
  verifyAgencyConnectionEvidence(connection, binding.credentialMode);
  if (!SAME(tlsConnection, connection)) FAIL("agency_followup_tls_evidence_invalid");
  const ledgerRows = parseRows(files["full-ledger-before.json"].toString("utf8"));
  const ledgerCheck = verifyAgencyFullLedger(ledgerRows, sourceRoot, "preflight");
  if (!SAME(JSON.parse(files["ledger-before-check.json"].toString("utf8")), ledgerCheck)) FAIL("agency_followup_preflight_ledger_evidence_invalid");
  const plan = JSON.parse(files["plan.json"].toString("utf8"));
  const planCheck = verifyAgencyPlan(plan, "pre");
  if (!SAME(JSON.parse(files["plan-check.json"].toString("utf8")), planCheck)) FAIL("agency_followup_preflight_plan_evidence_invalid");
  return { ledgerCheck, planCheck, stage };
}

function fileHashMap(files) {
  return Object.fromEntries(Object.keys(files).sort().map(name => [name, sha256(files[name])]));
}

export function createPreflightManifest(evidenceDirectory, { sourceRoot = ROOT, env = process.env, now = Date.now() } = {}) {
  const files = evidenceFileBytes(evidenceDirectory, PREFLIGHT_EVIDENCE_FILES);
  const binding = workflowBindingFromEnvironment(env);
  const validation = validatePreflightContent(binding, files, sourceRoot);
  const manifest = {
    schemaVersion: "agency-followup-production-preflight/v2",
    binding,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 86400000).toISOString(),
    migrations: verifyAgencyMigrationSources(sourceRoot),
    excludedPreviewMigrations: [...PREVIEW_MIGRATION_PATHS],
    stageInventorySha256: validation.stage.stage.inventorySha256,
    files: fileHashMap(files),
  };
  const manifestFile = path.join(evidenceDirectory, "preflight-manifest.json");
  WRITE_JSON(manifestFile, manifest);
  const manifestSha256 = getFileSha(manifestFile);
  if (env.GITHUB_OUTPUT) {
    fs.appendFileSync(env.GITHUB_OUTPUT, "manifest_sha256=" + manifestSha256 + "\n");
  }
  return { manifestSha256, manifest };
}

function verifyArtifactMetadata(metadata, expected, workflowRunId, sourceSha) {
  const expectedDigest = String(expected.digest ?? "").replace(/^sha256:/, "");
  const metadataDigest = String(metadata?.digest ?? "");
  if (!IS_RECORD(metadata) || Number(metadata.id) !== Number(expected.artifactId) || metadata.name !== expected.name ||
      metadataDigest !== `sha256:${expectedDigest}` || metadata.expired !== false ||
      !IS_RECORD(metadata.workflow_run) || String(metadata.workflow_run.id) !== workflowRunId ||
      metadata.workflow_run.head_sha !== sourceSha || metadata.workflow_run.head_branch !== "main" ||
      !/^[a-f0-9]{64}$/.test(expectedDigest)) FAIL("agency_followup_preflight_artifact_metadata_mismatch");
}

export function verifyPreflightArtifact(artifactDirectory, metadataInput, {
  sourceRoot = ROOT, env = process.env, now = Date.now(),
} = {}) {
  const binding = workflowBindingFromEnvironment(env);
  const expectedName = "agency-followup-production-preflight-" + binding.runId + "-" + binding.runAttempt;
  const expected = {
    artifactId: env.EXPECTED_ARTIFACT_ID,
    digest: env.EXPECTED_ARTIFACT_DIGEST,
    name: env.EXPECTED_ARTIFACT_NAME || expectedName,
  };
  if (!/^[1-9][0-9]*$/.test(expected.artifactId ?? "")) FAIL("agency_followup_preflight_artifact_id_invalid");
  verifyArtifactMetadata(typeof metadataInput === "string" ? JSON.parse(metadataInput) : metadataInput, expected, binding.runId, binding.sourceSha);
  const files = evidenceFileBytes(artifactDirectory, [...PREFLIGHT_EVIDENCE_FILES, "preflight-manifest.json"]);
  const manifestBytes = files["preflight-manifest.json"];
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (getFileSha(path.join(artifactDirectory, "preflight-manifest.json")) !== env.EXPECTED_MANIFEST_SHA256 ||
      !/^[a-f0-9]{64}$/.test(env.EXPECTED_MANIFEST_SHA256 ?? "")) FAIL("agency_followup_preflight_manifest_digest_mismatch");
  if (!EXACT_KEYS(manifest, ["schemaVersion", "binding", "createdAt", "expiresAt", "migrations", "excludedPreviewMigrations", "stageInventorySha256", "files"]) ||
      manifest.schemaVersion !== "agency-followup-production-preflight/v2" || !SAME(manifest.binding, binding) ||
      manifest.stageInventorySha256 !== JSON.parse(files["staged-inventory.json"].toString("utf8")).stage.inventorySha256 ||
      !SAME(manifest.migrations, verifyAgencyMigrationSources(sourceRoot)) ||
      !SAME(manifest.excludedPreviewMigrations, [...PREVIEW_MIGRATION_PATHS]) ||
      !SAME(manifest.files, fileHashMap(Object.fromEntries(PREFLIGHT_EVIDENCE_FILES.map(name => [name, files[name]]))))) {
    FAIL("agency_followup_preflight_manifest_invalid");
  }
  const created = Date.parse(manifest.createdAt), expires = Date.parse(manifest.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || created > now || expires <= now || expires - created !== 86400000) {
    FAIL("agency_followup_preflight_evidence_expired");
  }
  const validation = validatePreflightContent(binding, Object.fromEntries(PREFLIGHT_EVIDENCE_FILES.map(name => [name, files[name]])), sourceRoot);
  return { schemaVersion: "agency-followup-preflight-artifact-check/v1", binding, artifactId: expected.artifactId, artifactDigest: expected.digest, stageInventorySha256: validation.stage.stage.inventorySha256, migrations: AGENCY_MIGRATIONS.map(item => item.version), verified: true };
}

export function verifyAgencyApplyAuthorization(env = process.env, context = {}) {
  const binding = verifyAgencyWorkflowBinding({
    event: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    repository: env.GITHUB_REPOSITORY,
    reviewedSourceSha: env.REVIEWED_SOURCE_SHA,
    checkoutSha: context.checkoutSha,
    githubSha: env.GITHUB_SHA,
    originMainSha: context.originMainSha,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    worktreeStatus: context.worktreeStatus,
  });
  if (env.APPLY_CONFIRMATION !== APPLY_CONFIRMATION) FAIL("agency_followup_exact_apply_confirmation_required");
  return { ...binding, confirmation: APPLY_CONFIRMATION, explicitApplyConfirmation: true };
}

export function createResultManifest(evidenceDirectory, env = process.env) {
  const stat = fs.lstatSync(evidenceDirectory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) FAIL("agency_followup_evidence_directory_invalid");
  const names = fs.readdirSync(evidenceDirectory).sort();
  const allowed = [...RESULT_FILES].sort();
  if (names.some(name => !allowed.includes(name)) || names.includes("release-result-manifest.json")) FAIL("agency_followup_result_files_invalid");
  const files = {};
  for (const name of names) {
    const file = path.join(evidenceDirectory, name);
    const fileStat = fs.lstatSync(file);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) FAIL("agency_followup_evidence_file_invalid");
    const bytes = fs.readFileSync(file);
    if (!bytes.length) FAIL("agency_followup_evidence_file_empty");
    files[name] = sha256(bytes);
  }
  const binding = workflowBindingFromEnvironment(env);
  const manifest = {
    schemaVersion: "agency-followup-production-result/v1",
    binding,
    preflightArtifactId: env.EXPECTED_ARTIFACT_ID || null,
    preflightArtifactDigest: env.EXPECTED_ARTIFACT_DIGEST || null,
    applyStarted: env.APPLY_STARTED === "true",
    applyOutcome: env.APPLY_STEP_OUTCOME || "unknown",
    verificationOutcome: env.VERIFICATION_STEP_OUTCOME || "unknown",
    files,
  };
  const file = path.join(evidenceDirectory, "release-result-manifest.json");
  WRITE_JSON(file, manifest);
  const digest = getFileSha(file);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, "result_manifest_sha256=" + digest + "\n");
  return { resultManifestSha256: digest, manifest };
}

function writeCommandResult(file, value) {
  if (file) WRITE_JSON(file, value);
  else process.stdout.write(JSON.stringify(value) + "\n");
}

function main(args) {
  const [command, ...rest] = args;
  if (command === "source-check" && rest.length === 0) {
    process.stdout.write(JSON.stringify(sourceCheckFromEnvironment()) + "\n");
  } else if (command === "credential-authorization" && rest.length === 0) {
    const context = {
      checkoutSha: runGit(ROOT, ["rev-parse", "HEAD"]),
      originMainSha: runGit(ROOT, ["rev-parse", "origin/main"]),
      worktreeStatus: runGit(ROOT, ["status", "--porcelain"]),
      projectEnvFiles: findProjectEnvFiles(),
    };
    const authorization = verifyAgencyTemporaryCredentialAuthorization(process.env, context);
    verifyAgencyMigrationSources(ROOT);
    process.stdout.write(JSON.stringify(authorization) + "\n");
  } else if (command === "stage" && rest.length === 3) {
    const { proof, evidence } = stageAgencyProductionWorkdir(rest[0], rest[1], process.env.REVIEWED_SOURCE_SHA);
    verifyProductionWorkdir(rest[0], rest[1], proof);
    WRITE_JSON(rest[2], evidence);
    process.stdout.write(JSON.stringify({ migrationCount: evidence.stage.migrationCount, inventorySha256: evidence.stage.inventorySha256, previewExclusions: evidence.stage.exclusions.map(item => item.path) }) + "\n");
  } else if (command === "full-ledger-query" && rest.length === 0) {
    process.stdout.write(fullLedgerQuery());
  } else if (command === "agency-ledger-query" && rest.length === 0) {
    process.stdout.write(agencyFollowupLedgerQuery());
  } else if (command === "connection-check" && rest.length === 0) {
    writeCommandResult(null, verifyDirectDatabaseUrl(process.env.MIGRATION_DATABASE_URL, process.env, findProjectEnvFiles()));
  } else if (command === "check-ledger" && rest.length === 3) {
    writeCommandResult(rest[2], verifyAgencyFullLedger(READ_JSON(rest[1]), ROOT, rest[0]));
  } else if (command === "check-plan" && rest.length === 3) {
    writeCommandResult(rest[2], verifyAgencyPlan(READ_JSON(rest[1]), rest[0]));
  } else if (command === "check-ledger-same" && rest.length === 3) {
    writeCommandResult(rest[2], verifySameAgencyLedger(READ_JSON(rest[0]), READ_JSON(rest[1])));
  } else if (command === "check-plan-same" && rest.length === 3) {
    writeCommandResult(rest[2], verifySameAgencyPlan(READ_JSON(rest[0]), READ_JSON(rest[1])));
  } else if (command === "check-delta" && rest.length === 4) {
    writeCommandResult(rest[3], verifyAgencyLedgerDelta(READ_JSON(rest[0]), READ_JSON(rest[1]), READ_JSON(rest[2]), ROOT));
  } else if (command === "preflight-manifest" && rest.length === 1) {
    process.stdout.write(JSON.stringify(createPreflightManifest(rest[0])) + "\n");
  } else if (command === "verify-preflight" && rest.length === 2) {
    process.stdout.write(JSON.stringify(verifyPreflightArtifact(rest[0], READ_JSON(rest[1]))) + "\n");
  } else if (command === "verify-stage-match" && rest.length === 2) {
    const expected = verifyAgencyStageEvidence(READ_JSON(rest[0]), ROOT, process.env.REVIEWED_SOURCE_SHA);
    const actual = verifyAgencyStageEvidence(READ_JSON(rest[1]), ROOT, process.env.REVIEWED_SOURCE_SHA);
    if (!SAME(expected, actual)) FAIL("agency_followup_preflight_stage_changed");
    process.stdout.write(JSON.stringify({ stageInventorySha256: actual.stage.inventorySha256, unchangedSincePreflight: true }) + "\n");
  } else if (command === "apply-authorization" && rest.length === 0) {
    const checkoutSha = runGit(ROOT, ["rev-parse", "HEAD"]);
    const originMainSha = runGit(ROOT, ["rev-parse", "origin/main"]);
    const worktreeStatus = runGit(ROOT, ["status", "--porcelain"]);
    process.stdout.write(JSON.stringify(verifyAgencyApplyAuthorization(process.env, { checkoutSha, originMainSha, worktreeStatus })) + "\n");
  } else if (command === "result-manifest" && rest.length === 1) {
    process.stdout.write(JSON.stringify(createResultManifest(rest[0])) + "\n");
  } else {
    FAIL("agency_followup_release_gate_usage_invalid");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : "agency_followup_production_gate_failed";
    process.stderr.write(message + "\n");
    process.exitCode = 1;
  }
}
