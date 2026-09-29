// Narrow recovery for the single failed candidate suffix in run 36460908921.
// It cannot replay qualification, enrichment, or candidate-profile migrations.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sha256, PROJECT_REF, CANDIDATE_RELEASE_PATHS, verifyDirectDatabaseUrl, findProjectEnvFiles } from "./migration-gate.mjs";

export const FAILED_RUN_ID = "36460908921";
export const FAILED_RECEIPTS_ARTIFACT_ID = "10987967959";
export const FAILED_RECEIPTS_ARTIFACT_SHA256 = "95cb334af8de26f2ad40ec77175470632016917d191473a08240909818777a6f";
export const FAILED_SOURCE_SHA = "d3c2b06428fbc6925809a4f1edde60cbdba0da78";
export const FAILED_RECEIPT_SHA256 = "1de623aecc380e6cf6d182637178fd5df2ee3eed33d3375d2225e188f7777ae7";
export const RECOVERY_CONFIRMATION = "RESUME-CANDIDATE-SUFFIX-36460908921-V1";
export const COVERAGE = "supabase/migrations/20260924192549_prospect_enrichment_candidate_firm_coverage.sql";
export const PROFILE_LINK = "supabase/migrations/20260925200000_gta_prospect_operator_database_firm_profile_link.sql";
export const REMAINING = Object.freeze([COVERAGE, PROFILE_LINK]);
export const RECOVERY_FILES = Object.freeze([
  "complete-release/phase-state.json",
  "release-evidence/candidate-recovery.json",
  "release-evidence/qualification-receipt.json",
  "release-evidence/enrichment-receipt.json",
  "release-evidence/candidate-post-ledger-check.json",
  "release-evidence/candidate-post-full-ledger-check.json",
  "release-evidence/candidate-post-rpc-catalog-check.json",
  "release-evidence/candidate-recovery-plan-check.json",
]);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const exact = (a, b) => JSON.stringify(Object.keys(a ?? {}).sort()) === JSON.stringify([...b].sort());
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = code => { throw Error(code); };
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const save = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n");
const filesAt = dir => Object.fromEntries(RECOVERY_FILES.map(name => {
  const file = path.join(dir, name), stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("candidate_recovery_evidence_file_invalid");
  return [name, fs.readFileSync(file)];
}));

export function verifyFailureArtifactMetadata(metadata) {
  if (String(metadata?.id) !== FAILED_RECEIPTS_ARTIFACT_ID || metadata?.name !== "prospect-complete-release-receipts" ||
      metadata?.expired !== false || metadata?.digest !== "sha256:" + FAILED_RECEIPTS_ARTIFACT_SHA256 ||
      String(metadata?.workflow_run?.id) !== FAILED_RUN_ID || metadata?.workflow_run?.head_sha !== FAILED_SOURCE_SHA) {
    fail("candidate_recovery_prior_artifact_mismatch");
  }
  return true;
}

export function verifyRecoveryArtifactMetadata(metadata, environment) {
  if (String(metadata?.id) !== environment.EXPECTED_ARTIFACT_ID || metadata?.name !== "prospect-candidate-suffix-recovery-preflight" ||
      metadata?.expired !== false || metadata?.digest !== "sha256:" + environment.EXPECTED_ARTIFACT_DIGEST ||
      String(metadata?.workflow_run?.id) !== environment.GITHUB_RUN_ID || metadata?.workflow_run?.head_sha !== environment.REVIEWED_SOURCE_SHA) fail("candidate_recovery_artifact_identity_mismatch");
  return true;
}

export function verifyFailureReceipts(dir) {
  const expectedPaths = [
    "complete-release/phase-state.json", "release-evidence/candidate-recovery.json",
    "release-evidence/qualification-receipt.json", "release-evidence/enrichment-receipt.json",
    "release-evidence/candidate-post-ledger-check.json", "release-evidence/candidate-post-full-ledger-check.json",
    "release-evidence/candidate-post-rpc-catalog-check.json", "release-evidence/candidate-recovery-plan-check.json",
  ];
  const state = read(path.join(dir, expectedPaths[0]));
  if (!exact(state, ["qualification", "enrichment", "candidate"]) || !same(state, { qualification: "verified", enrichment: "verified", candidate: "started" })) fail("candidate_recovery_phase_state_mismatch");
  const recovery = read(path.join(dir, expectedPaths[1]));
  if (!same(recovery, { phase: "candidate", state: "started_unverified", replayAllowed: false, readOnlyReconciliationRequired: true })) fail("candidate_recovery_marker_mismatch");
  const binding = { runId: FAILED_RUN_ID, runAttempt: "1", sourceSha: FAILED_SOURCE_SHA, projectRef: PROJECT_REF, receiptSha256: FAILED_RECEIPT_SHA256 };
  for (const [index, phase] of [[2, "qualification"], [3, "enrichment"]]) {
    const receipt = read(path.join(dir, expectedPaths[index]));
    if (!exact(receipt, ["binding", "phase", "state"]) || receipt.phase !== phase || receipt.state !== "verified" || !same(receipt.binding, binding)) fail("candidate_recovery_verified_phase_receipt_invalid");
  }
  const ledger = read(path.join(dir, expectedPaths[4]));
  if (ledger.projectRef !== PROJECT_REF || ledger.appliedPrefixLength !== 9 || !same(ledger.pending, REMAINING.map(p => path.posix.basename(p))) ||
      !Array.isArray(ledger.appliedMigrations) || ledger.appliedMigrations.length !== 9 || ledger.appliedMigrations.some(m => m.statementContentMatchesReviewedSource !== true) ||
      !same(ledger.appliedMigrations.map(m => m.path), CANDIDATE_RELEASE_PATHS.slice(0, 9))) fail("candidate_recovery_prior_ledger_invalid");
  const full = read(path.join(dir, expectedPaths[5]));
  if (full.phase !== "candidate-pending" || full.remoteVersionCount !== 254 || full.stagedMigrationCount !== 256 ||
      !full.completeSourceCoverage || !same(full.pendingPaths, REMAINING.map(p => p.replaceAll("\\", "/")))) fail("candidate_recovery_prior_full_ledger_invalid");
  const catalog = read(path.join(dir, expectedPaths[6]));
  if (catalog.prerequisite !== "verified_applied_operator_rpc" || catalog.ledgerStatementVerification !== "ledger_statements_match_reviewed_source" || catalog.catalog?.functionName !== "revalidate_operator_membership_v1") fail("candidate_recovery_prior_catalog_invalid");
  const plan = read(path.join(dir, expectedPaths[7]));
  if (plan.phase !== "pre" || plan.dryRun !== true || plan.upToDate !== false || !same(plan.migrations, REMAINING.map(p => path.posix.basename(p)))) fail("candidate_recovery_prior_plan_invalid");
  return { verified: true, failedRunId: FAILED_RUN_ID, appliedPrefixLength: 9, pending: [...REMAINING] };
}

export function createRecoveryEvidence(binding, receiptsDir, current, now = Date.now()) {
  verifyFailureReceipts(receiptsDir);
  if (!exact(binding, ["runId", "runAttempt", "sourceSha", "projectRef", "receiptSha256", "priorArtifactId", "priorArtifactSha256"]) ||
      !/^[1-9][0-9]*$/.test(binding.runId) || binding.runAttempt !== "1" || !/^[a-f0-9]{40}$/.test(binding.sourceSha) ||
      binding.projectRef !== PROJECT_REF || !/^[a-f0-9]{64}$/.test(binding.receiptSha256) || binding.priorArtifactId !== FAILED_RECEIPTS_ARTIFACT_ID || binding.priorArtifactSha256 !== FAILED_RECEIPTS_ARTIFACT_SHA256) fail("candidate_recovery_binding_invalid");
  verifyRecoveryCoverageTimeout(fs.readFileSync(path.join(ROOT, COVERAGE), "utf8"));
  verifyRecoveryObservedState(current);
  const files = filesAt(receiptsDir);
  return { schemaVersion: "prospect-candidate-suffix-recovery/v1", binding, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString(),
    priorFiles: Object.fromEntries(RECOVERY_FILES.map(name => [name, sha256(files[name])])), current };
}

export function verifyRecoveryEvidence(evidence, binding, receiptsDir, now = Date.now()) {
  if (!exact(evidence, ["schemaVersion", "binding", "createdAt", "expiresAt", "priorFiles", "current"]) || evidence.schemaVersion !== "prospect-candidate-suffix-recovery/v1" || !same(evidence.binding, binding)) fail("candidate_recovery_evidence_binding_mismatch");
  const created = Date.parse(evidence.createdAt), expires = Date.parse(evidence.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || created > now || expires <= now || expires - created !== 86400000) fail("candidate_recovery_evidence_expired");
  const files = filesAt(receiptsDir), hashes = Object.fromEntries(RECOVERY_FILES.map(name => [name, sha256(files[name])]));
  if (!same(hashes, evidence.priorFiles)) fail("candidate_recovery_prior_evidence_changed");
  verifyRecoveryCoverageTimeout(fs.readFileSync(path.join(ROOT, COVERAGE), "utf8"));
  verifyRecoveryObservedState(evidence.current);
  return true;
}

function run(command, args, options = {}) {
  try { return execFileSync(command, args, { cwd: options.cwd ?? ROOT, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024, timeout: 180000, ...options }); }
  catch (e) { const status = Number.isInteger(e.status) ? String(Math.abs(e.status)) : "timeout_or_signal"; fail("candidate_recovery_" + (path.basename(command).replace(/[^a-z0-9]+/gi, "_").toLowerCase() || "command") + "_exit_" + status); }
}
function runNode(script, args, output) { const bytes = run(process.execPath, [path.join(ROOT, "scripts/prospect-enrichment", script + ".mjs"), ...args]); if (output) fs.writeFileSync(output, bytes); return bytes; }
function query(sql, output, { timeout = 180000 } = {}) { ensureConnection(); const bytes = run("supabase", ["db", "query", "--file", sql, "--output-format", "json", "--agent", "no", "--db-url", process.env.MIGRATION_DATABASE_URL], { timeout }); if (output) fs.writeFileSync(output, bytes); return bytes; }
function gate(which, args, output) { return runNode(which, args, output); }
function rootTemp(label) {
  if (!process.env.RUNNER_TEMP) fail("candidate_recovery_runner_temp_missing");
  const dir = path.join(path.resolve(process.env.RUNNER_TEMP), "candidate-recovery", label); fs.mkdirSync(dir, { recursive: true }); return dir;
}
function checkSource() {
  const checkout = run("git", ["rev-parse", "HEAD"]).toString().trim(); run("git", ["fetch", "--no-tags", "origin", "main"]);
  if (checkout !== run("git", ["rev-parse", "origin/main"]).toString().trim() || checkout !== process.env.REVIEWED_SOURCE_SHA || checkout !== process.env.GITHUB_SHA ||
      process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" || process.env.GITHUB_REF !== "refs/heads/main" || process.env.GITHUB_REPOSITORY !== "adrianosortudo-source/caseload-select" ||
      process.env.GITHUB_RUN_ATTEMPT !== "1" || process.env.PROJECT_REF !== PROJECT_REF || process.env.RECOVERY_CONFIRMATION !== RECOVERY_CONFIRMATION ||
      process.env.USE_TEMPORARY_DATABASE_CREDENTIAL !== "true") fail("candidate_recovery_source_or_confirmation_invalid");
  const receipt = path.join(ROOT, "scripts/prospect-enrichment/additive-release-review.json"), actual = sha256(fs.readFileSync(receipt));
  if (actual !== process.env.REVIEWED_RECEIPT_SHA256 || actual !== process.env.CONFIGURED_RECEIPT_SHA256 || checkout !== process.env.CONFIGURED_REVIEWED_SHA) fail("candidate_recovery_reviewed_binding_mismatch");
  return { runId: process.env.GITHUB_RUN_ID, runAttempt: "1", sourceSha: checkout, projectRef: PROJECT_REF, receiptSha256: actual, priorArtifactId: FAILED_RECEIPTS_ARTIFACT_ID, priorArtifactSha256: FAILED_RECEIPTS_ARTIFACT_SHA256 };
}
function ensureConnection() {
  const issued = Number(process.env.TEMPORARY_DATABASE_ISSUED_AT), expires = Number(process.env.TEMPORARY_DATABASE_EXPIRES_AT);
  if (!Number.isSafeInteger(issued) || !Number.isSafeInteger(expires) || expires <= Date.now() + 30000) fail("candidate_recovery_credential_expired");
  verifyDirectDatabaseUrl(process.env.MIGRATION_DATABASE_URL, process.env, findProjectEnvFiles());
}
function snapshot(raw, label, pendingPaths = REMAINING, expectedPrefix = 9, queryOptions = {}) {
  const out = name => path.join(raw, label + name);
  const ledgerSql = path.join(raw, label + "ledger.sql"), catalogSql = path.join(raw, label + "catalog.sql"), fullSql = path.join(raw, label + "full.sql");
  gate("additive-release-gate", ["ledger-query"], ledgerSql); query(ledgerSql, out("ledger.json"), queryOptions);
  gate("additive-release-gate", ["ledger-summary", out("ledger.json")], out("summary.json"));
  gate("additive-release-gate", ["ledger", out("ledger.json")], out("ledger-check.json"));
  const ledger = read(out("ledger-check.json"));
  const livePending = pendingPaths ?? (ledger.appliedPrefixLength === 9 ? REMAINING : ledger.appliedPrefixLength === 10 ? [PROFILE_LINK] : fail("candidate_recovery_ledger_not_exact"));
  const livePrefix = expectedPrefix ?? (ledger.appliedPrefixLength === 9 || ledger.appliedPrefixLength === 10 ? ledger.appliedPrefixLength : fail("candidate_recovery_ledger_not_exact"));
  gate("additive-release-gate", ["catalog-query"], catalogSql); query(catalogSql, out("rpc.json"), queryOptions);
  gate("migration-gate", ["full-query"], fullSql); query(fullSql, out("full.json"), queryOptions);
  gate("additive-release-gate", ["catalog-bound", out("rpc.json"), out("ledger.json")], out("catalog-check.json"));
  gate("migration-gate", ["full-ledger", out("full.json"), ROOT, "candidate-pending", JSON.stringify(livePending)], out("full-ledger-check.json"));
  const full = read(out("full-ledger-check.json"));
  if (ledger.appliedPrefixLength !== livePrefix || !same(ledger.pending, livePending.map(p => path.posix.basename(p))) || full.phase !== "candidate-pending" || !full.completeSourceCoverage || !same(full.pendingPaths, livePending)) fail("candidate_recovery_ledger_not_exact");
  return { ledger: out("ledger.json"), full: out("full.json"), ledgerCheck: out("ledger-check.json"), fullCheck: out("full-ledger-check.json"), catalogCheck: out("catalog-check.json"), pending: livePending, prefix: livePrefix };
}
export function verifyRecoveryObservedState(current) {
  if (!exact(current, ["appliedPrefixLength", "pending", "planUpToDate", "fullLedgerMatchesSource", "operatorRpcVerified", "coverageTimeoutControlVerified", "coverageReadbackVerified"]) ||
      current.planUpToDate !== false || current.fullLedgerMatchesSource !== true || current.operatorRpcVerified !== true || current.coverageTimeoutControlVerified !== true) fail("candidate_recovery_live_state_invalid");
  if (current.appliedPrefixLength === 9 && same(current.pending, REMAINING) && current.coverageReadbackVerified === false) return { coverageWriteRequired: true };
  if (current.appliedPrefixLength === 10 && same(current.pending, [PROFILE_LINK]) && current.coverageReadbackVerified === true) return { coverageWriteRequired: false };
  fail("candidate_recovery_live_state_invalid");
}
export function verifyRecoveryPlan(plan, expected) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan) || plan.dryRun !== true ||
      plan.upToDate !== (expected.length === 0) || !same(plan.migrations, expected.map(p => path.posix.basename(p))) ||
      !same(plan.seeds, []) || !same(plan.roles, [])) fail("candidate_recovery_dry_run_suffix_invalid");
  return { dryRun: true, upToDate: plan.upToDate, migrations: [...plan.migrations] };
}
export function verifyRecoveryPhaseTransition(state, next) {
  if (!exact(state, ["coverage", "profileLink"])) fail("candidate_recovery_phase_state_invalid");
  if (next === "coverage" && state.coverage === "pending" && state.profileLink === "pending") return true;
  if (next === "profile-link" && state.coverage === "verified" && state.profileLink === "pending") return true;
  fail("candidate_recovery_prior_phase_unverified");
}
function exactDryRun(raw, label, stage, expected, timeout = 120000) {
  const planJson = path.join(raw, label + "plan.json"), checked = path.join(raw, label + "plan-check.json");
  ensureConnection();
  const bytes = run("supabase", ["db", "push", "--dry-run", "--include-all", "--skip-vault", "--output-format", "json", "--db-url", process.env.MIGRATION_DATABASE_URL], { cwd: stage, timeout });
  fs.writeFileSync(planJson, bytes);
  const verified = verifyRecoveryPlan(read(planJson), expected);
  save(checked, verified);
  return verified;
}

function stage(step, name = step) {
  if (!process.env.RUNNER_TEMP) fail("candidate_recovery_runner_temp_missing");
  const base = path.join(path.resolve(process.env.RUNNER_TEMP ?? ""), "candidate-recovery");
  fs.mkdirSync(base, { recursive: true });
  const dir = path.join(base, "stage-" + name), proofFile = path.join(base, "proofs", name + ".json");
  if (fs.existsSync(dir)) fail("candidate_recovery_stage_exists");
  const bytes = run(process.execPath, [path.join(ROOT, "scripts/prospect-enrichment/migration-gate.mjs"), "candidate-recovery-stage", ROOT, dir, step]);
  fs.mkdirSync(path.dirname(proofFile), { recursive: true }); fs.writeFileSync(proofFile, bytes);
  run(process.execPath, [path.join(ROOT, "scripts/prospect-enrichment/migration-gate.mjs"), "candidate-recovery-verify-stage", ROOT, dir, proofFile, step]);
  return { dir, proof: proofFile };
}
function freshCredential(minimumRemaining) {
  const issued = Number(process.env.TEMPORARY_DATABASE_ISSUED_AT), expires = Number(process.env.TEMPORARY_DATABASE_EXPIRES_AT);
  if (!Number.isSafeInteger(issued) || !Number.isSafeInteger(expires) || issued > Date.now() || expires - Date.now() < minimumRemaining) fail("candidate_recovery_credential_expired");
  verifyDirectDatabaseUrl(process.env.MIGRATION_DATABASE_URL, process.env, findProjectEnvFiles());
}
export function verifyRecoveryTimeoutBudget(remainingMs, processTimeoutMs, readbackAndCleanupReserveMs) {
  if (!Number.isSafeInteger(remainingMs) || !Number.isSafeInteger(processTimeoutMs) || !Number.isSafeInteger(readbackAndCleanupReserveMs) ||
      remainingMs < 0 || processTimeoutMs <= 0 || readbackAndCleanupReserveMs < 0 || remainingMs < processTimeoutMs + readbackAndCleanupReserveMs)
    fail("candidate_recovery_credential_budget_insufficient");
  return true;
}
export function verifyRecoveryCoverageReadbackTransition(state) {
  if (!exact(state, ["coverage", "profileLink"]) || state.coverage !== "started_unverified" || state.profileLink !== "pending")
    fail("candidate_recovery_coverage_readback_not_pending");
  return true;
}
export function beginRecoveryCoverageWrite(state) {
  verifyRecoveryPhaseTransition(state, "coverage");
  return { ...state, coverage: "started_unverified" };
}
export function completeRecoveryCoverageReadback(state, checks) {
  verifyRecoveryCoverageReadbackTransition(state);
  if (!exact(checks, ["ledger", "fullLedger", "dryRun", "catalog"]) || Object.values(checks).some(value => value !== true))
    fail("candidate_recovery_coverage_readback_invalid");
  return { ...state, coverage: "verified" };
}
export function verifyRecoveryCoverageTimeout(migration) {
  if (typeof migration !== "string" || /pg-delta:\s*transaction=false/i.test(migration)) fail("candidate_recovery_coverage_timeout_control_invalid");
  const begin = /^\s*BEGIN;\s*$/gim, commit = /^\s*COMMIT;\s*$/gim, timeout = /^\s*SET LOCAL statement_timeout = '240s';\s*$/gim;
  const begins = [...migration.matchAll(begin)], commits = [...migration.matchAll(commit)], timeouts = [...migration.matchAll(timeout)];
  if (begins.length !== 1 || commits.length !== 1 || timeouts.length !== 1 ||
      !(begins[0].index < timeouts[0].index && timeouts[0].index < commits[0].index) ||
      !/^\s*BEGIN;\s*SET LOCAL statement_timeout = '240s';/im.test(migration)) fail("candidate_recovery_coverage_timeout_control_invalid");
  return true;
}
function applyCoverage(recoveryDir, priorDir) {
  const binding = checkSource(), manifest = read(path.join(recoveryDir, "recovery-evidence.json"));
  verifyFailureArtifactMetadata(read(path.join(priorDir, "artifact-metadata.json"))); verifyFailureReceipts(priorDir);
  verifyRecoveryEvidence(manifest, binding, priorDir);
  const stateFile = path.join(rootTemp("state"), "phase-state.json"); fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const state = fs.existsSync(stateFile) ? read(stateFile) : { coverage: "pending", profileLink: "pending" };
  try { verifyRecoveryPhaseTransition(state, "coverage"); } catch { fail("candidate_recovery_replay_prohibited"); }
  const staged = stage("coverage"), raw = rootTemp("coverage");
  verifyRecoveryCoverageTimeout(fs.readFileSync(path.join(ROOT, COVERAGE), "utf8"));
  const before = snapshot(raw, "coverage-before-");
  if (before.ledgerCheck && !same(read(before.ledgerCheck).pending, REMAINING.map(p => path.posix.basename(p)))) fail("candidate_recovery_coverage_prefix_changed");
  const dry = exactDryRun(raw, "coverage-before-", staged.dir, [COVERAGE]);
  run(process.execPath, [path.join(ROOT, "scripts/prospect-enrichment/migration-gate.mjs"), "candidate-recovery-verify-stage", ROOT, staged.dir, staged.proof, "coverage"]);
  freshCredential(250000);
  verifyRecoveryTimeoutBudget(Number(process.env.TEMPORARY_DATABASE_EXPIRES_AT) - Date.now(), 240000, 10000);
  const startedState = beginRecoveryCoverageWrite(state); save(stateFile, startedState);
  try {
    run("supabase", ["db", "push", "--yes", "--include-all", "--skip-vault", "--output-format", "json", "--db-url", process.env.MIGRATION_DATABASE_URL], { cwd: staged.dir, timeout: 240000 });
    save(path.join(raw, "coverage-writer-receipt.json"), { binding, migration: COVERAGE, state: "write_command_succeeded_readback_pending", dryRun: dry, sessionStatementTimeoutMs: 240000, processTimeoutMs: 240000, credentialMode: "temporary-write-capable" });
  } catch (error) {
    save(path.join(raw, "recovery-marker.json"), { phase: "candidate-coverage", state: "started_unverified", replayAllowed: false, readOnlyReconciliationRequired: true });
    throw error;
  }
}

function verifyCoverageReadback(recoveryDir, priorDir) {
  const binding = checkSource(), manifest = read(path.join(recoveryDir, "recovery-evidence.json"));
  verifyFailureArtifactMetadata(read(path.join(priorDir, "artifact-metadata.json"))); verifyFailureReceipts(priorDir);
  verifyRecoveryEvidence(manifest, binding, priorDir);
  const stateFile = path.join(rootTemp("state"), "phase-state.json"), state = read(stateFile);
  verifyRecoveryCoverageReadbackTransition(state);
  const raw = rootTemp("coverage"), writerReceiptPath = path.join(raw, "coverage-writer-receipt.json"), resumeReceiptPath = path.join(raw, "coverage-resume-receipt.json");
  if (fs.existsSync(writerReceiptPath)) {
    const receipt = read(writerReceiptPath);
    if (!exact(receipt, ["binding", "migration", "state", "dryRun", "sessionStatementTimeoutMs", "processTimeoutMs", "credentialMode"]) || !same(receipt.binding, binding) || receipt.migration !== COVERAGE || receipt.state !== "write_command_succeeded_readback_pending" || receipt.sessionStatementTimeoutMs !== 240000 || receipt.processTimeoutMs !== 240000 || receipt.credentialMode !== "temporary-write-capable") fail("candidate_recovery_coverage_writer_receipt_invalid");
  } else {
    const receipt = read(resumeReceiptPath);
    if (!exact(receipt, ["binding", "migration", "state", "source"]) || !same(receipt.binding, binding) || receipt.migration !== COVERAGE || receipt.state !== "read_only_observed_pending_verification" || receipt.source !== "reviewed_live_reconciliation") fail("candidate_recovery_coverage_resume_receipt_invalid");
  }
  freshCredential(250000);
  verifyRecoveryTimeoutBudget(Number(process.env.TEMPORARY_DATABASE_EXPIRES_AT) - Date.now(), 200000, 50000);
  try {
    const readbackTimeouts = { timeout: 20000 };
    const staged = stage("coverage", "coverage-readback");
    const after = snapshot(raw, "coverage-after-", [PROFILE_LINK], 10, readbackTimeouts);
    if (!same(read(after.ledgerCheck).pending, [path.posix.basename(PROFILE_LINK)]) || !same(read(after.fullCheck).pendingPaths, [PROFILE_LINK])) fail("candidate_recovery_coverage_readback_invalid");
    const plan = exactDryRun(raw, "coverage-after-", staged.dir, [], 120000);
    if (!plan.upToDate) fail("candidate_recovery_coverage_plan_not_empty");
    const check = path.join(raw, "coverage-catalog-check.sql");
    fs.writeFileSync(check, "SELECT to_regprocedure('prospect_candidate_private.list_candidates(jsonb,integer,uuid,bigint)') IS NOT NULL AS list_candidates_present, EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='candidate_legacy_projection' AND NOT tgisinternal) AS legacy_projection_trigger_present;\n");
    query(check, path.join(raw, "coverage-catalog-check.json"), readbackTimeouts);
    const catalog = read(path.join(raw, "coverage-catalog-check.json")), rows = Array.isArray(catalog) ? catalog : catalog.data ?? catalog.rows;
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].list_candidates_present !== true || rows[0].legacy_projection_trigger_present !== true) fail("candidate_recovery_coverage_catalog_invalid");
    const verifiedState = completeRecoveryCoverageReadback(state, { ledger: true, fullLedger: true, dryRun: true, catalog: true });
    save(stateFile, verifiedState);
    save(path.join(raw, "coverage-receipt.json"), { binding, migration: COVERAGE, state: "verified", dryRun: plan, sessionStatementTimeoutMs: 240000, processTimeoutMs: 240000, readbackCredentialTtlBounded: true });
  } catch (error) {
    save(path.join(raw, "recovery-marker.json"), { phase: "candidate-coverage-readback", state: "started_unverified", replayAllowed: false, readOnlyReconciliationRequired: true });
    throw error;
  }
}
function applyProfileLink(recoveryDir, priorDir) {
  const binding = checkSource(), manifest = read(path.join(recoveryDir, "recovery-evidence.json"));
  verifyFailureArtifactMetadata(read(path.join(priorDir, "artifact-metadata.json"))); verifyFailureReceipts(priorDir); verifyRecoveryEvidence(manifest, binding, priorDir);
  const stateFile = path.join(rootTemp("state"), "phase-state.json"), state = read(stateFile);
  verifyRecoveryPhaseTransition(state, "profile-link");
  const staged = stage("profile-link"), raw = rootTemp("profile-link"), before = snapshot(raw, "link-before-", [PROFILE_LINK], 10);
  if (!same(read(before.ledgerCheck).pending, [path.posix.basename(PROFILE_LINK)])) fail("candidate_recovery_profile_link_prefix_changed");
  exactDryRun(raw, "link-before-", staged.dir, [PROFILE_LINK]);
  run(process.execPath, [path.join(ROOT, "scripts/prospect-enrichment/migration-gate.mjs"), "candidate-recovery-verify-stage", ROOT, staged.dir, staged.proof, "profile-link"]);
  freshCredential(185000); verifyRecoveryTimeoutBudget(Number(process.env.TEMPORARY_DATABASE_EXPIRES_AT) - Date.now(), 120000, 60000);
  state.profileLink = "started_unverified"; save(stateFile, state);
  try {
    run("supabase", ["db", "push", "--yes", "--include-all", "--skip-vault", "--output-format", "json", "--db-url", process.env.MIGRATION_DATABASE_URL], { cwd: staged.dir, timeout: 120000 });
    const after = snapshot(raw, "link-after-", [], 11);
    if (read(after.ledgerCheck).appliedPrefixLength !== 11 || !same(read(after.ledgerCheck).pending, []) || !same(read(after.fullCheck).pendingPaths, [])) fail("candidate_recovery_final_ledger_invalid");
    const plan = exactDryRun(raw, "link-after-", staged.dir, []); if (!plan.upToDate) fail("candidate_recovery_final_plan_not_empty");
    const rpcSql = path.join(raw, "profile-link-rpc-check.sql");
    fs.writeFileSync(rpcSql, "SELECT to_regprocedure('public.list_gta_prospect_supplemental_evidence_for_operator_v3()') IS NOT NULL AS profile_link_reader_present;\n");
    query(rpcSql, path.join(raw, "profile-link-rpc-check.json"));
    const rpc = read(path.join(raw, "profile-link-rpc-check.json")), rpcRows = Array.isArray(rpc) ? rpc : rpc.data ?? rpc.rows;
    if (!Array.isArray(rpcRows) || rpcRows.length !== 1 || rpcRows[0].profile_link_reader_present !== true) fail("candidate_recovery_profile_link_catalog_invalid");
    gate("additive-release-gate", ["candidate-complete", after.ledgerCheck]);
    state.profileLink = "verified"; save(stateFile, state); save(path.join(raw, "profile-link-receipt.json"), { binding, migration: PROFILE_LINK, state: "verified" });
  } catch (error) { save(path.join(raw, "recovery-marker.json"), { phase: "candidate-profile-link", state: "started_unverified", replayAllowed: false, readOnlyReconciliationRequired: true }); throw error; }
}

function coverageCatalog(raw, label) {
  const check = path.join(raw, label + "coverage-catalog-check.sql");
  fs.writeFileSync(check, "SELECT to_regprocedure('prospect_candidate_private.list_candidates(jsonb,integer,uuid,bigint)') IS NOT NULL AS list_candidates_present, EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='candidate_legacy_projection' AND NOT tgisinternal) AS legacy_projection_trigger_present;\n");
  query(check, path.join(raw, label + "coverage-catalog-check.json"));
  const catalog = read(path.join(raw, label + "coverage-catalog-check.json")), rows = Array.isArray(catalog) ? catalog : catalog.data ?? catalog.rows;
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0].list_candidates_present !== "boolean" || typeof rows[0].legacy_projection_trigger_present !== "boolean" || rows[0].list_candidates_present !== rows[0].legacy_projection_trigger_present) fail("candidate_recovery_coverage_catalog_invalid");
  return rows[0].list_candidates_present;
}
function currentReadOnly(dir, label) {
  verifyRecoveryCoverageTimeout(fs.readFileSync(path.join(ROOT, COVERAGE), "utf8"));
  const staged = stage("profile-link", label);
  const snapshotFiles = snapshot(dir, label, null, null);
  const plan = exactDryRun(dir, label, staged.dir, snapshotFiles.pending);
  const ledger = read(snapshotFiles.ledgerCheck), full = read(snapshotFiles.fullCheck), catalog = read(snapshotFiles.catalogCheck);
  const coveragePresent = coverageCatalog(dir, label);
  snapshotFiles.coverageCatalogCheck = path.join(dir, label + "coverage-catalog-check.json");
  const current = { appliedPrefixLength: ledger.appliedPrefixLength, pending: [...snapshotFiles.pending], planUpToDate: plan.upToDate,
    fullLedgerMatchesSource: full.completeSourceCoverage === true && same(full.pendingPaths, snapshotFiles.pending), operatorRpcVerified: catalog.prerequisite === "verified_applied_operator_rpc",
    coverageTimeoutControlVerified: true, coverageReadbackVerified: coveragePresent };
  verifyRecoveryObservedState(current);
  return { current, snapshotFiles, plan };
}
function reconcile(recoveryDir) {
  verifyPreflight(recoveryDir);
  const live = currentReadOnly(rootTemp("reconcile"), "post-review-"), current = live.current;
  const manifest = read(path.join(recoveryDir, "recovery-evidence.json"));
  if (!same(current, manifest.current)) fail("candidate_recovery_live_state_changed_after_review");
  const { coverageWriteRequired } = verifyRecoveryObservedState(current);
  const state = { coverage: coverageWriteRequired ? "pending" : "started_unverified", profileLink: "pending" };
  save(path.join(rootTemp("state"), "phase-state.json"), state);
  if (!coverageWriteRequired) save(path.join(rootTemp("coverage"), "coverage-resume-receipt.json"), { binding: manifest.binding, migration: COVERAGE, state: "read_only_observed_pending_verification", source: "reviewed_live_reconciliation" });
  save(path.join(rootTemp("reconcile"), "reconciled-state.json"), { state: "exact_reviewed_suffix_confirmed", current, coverageWriteRequired });
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `coverage_write_required=${coverageWriteRequired}\n`);
}

function preflight(evidenceDir, priorDir) {
  const binding = checkSource(); verifyFailureArtifactMetadata(read(path.join(priorDir, "artifact-metadata.json")));
  verifyFailureReceipts(priorDir); freshCredential(30000);
  const raw = rootTemp("preflight"), live = currentReadOnly(raw, "preflight-"), { current, snapshotFiles, plan } = live;
  const manifest = createRecoveryEvidence(binding, priorDir, current); fs.mkdirSync(evidenceDir, { recursive: true });
  save(path.join(evidenceDir, "recovery-evidence.json"), manifest);
  const archivedPrior = path.join(evidenceDir, "prior"); fs.mkdirSync(archivedPrior, { recursive: true });
  for (const relative of RECOVERY_FILES) {
    const target = path.join(archivedPrior, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(priorDir, relative), target);
  }
  fs.copyFileSync(path.join(priorDir, "artifact-metadata.json"), path.join(archivedPrior, "artifact-metadata.json"));
  for (const key of Object.keys(snapshotFiles)) if (typeof snapshotFiles[key] === "string") fs.copyFileSync(snapshotFiles[key], path.join(evidenceDir, path.basename(snapshotFiles[key])));
  save(path.join(evidenceDir, "plan-check.json"), plan);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `manifest_sha256=${sha256(fs.readFileSync(path.join(evidenceDir, "recovery-evidence.json")))}\ncoverage_write_required=${verifyRecoveryObservedState(current).coverageWriteRequired}\n`);
}
function verifyPreflight(recoveryDir, priorDir = path.join(recoveryDir, "prior")) {
  const binding = checkSource(); verifyFailureArtifactMetadata(read(path.join(priorDir, "artifact-metadata.json")));
  verifyFailureReceipts(priorDir); verifyRecoveryEvidence(read(path.join(recoveryDir, "recovery-evidence.json")), binding, priorDir);
}

function authorizeCredential() {
  const binding = checkSource(), phase = process.env.COMPLETE_PHASE;
  if (!["preflight", "reconcile", "coverage", "coverage-readback", "profile-link"].includes(phase)) fail("candidate_recovery_credential_phase_invalid");
  if (phase === "coverage" || phase === "coverage-readback" || phase === "profile-link") {
    const state = read(path.join(rootTemp("state"), "phase-state.json"));
    if (phase === "coverage") verifyRecoveryPhaseTransition(state, "coverage");
    else if (phase === "coverage-readback") verifyRecoveryCoverageReadbackTransition(state);
    else verifyRecoveryPhaseTransition(state, "profile-link");
  }
  const directory = rootTemp("credentials"), marker = path.join(directory, phase + ".json");
  fs.writeFileSync(marker, JSON.stringify({ phase, runId: binding.runId, requestedAt: new Date().toISOString() }), { flag: "wx" });
}

async function main([command, ...args]) {
  if (command === "source-authorization" && !args.length) return checkSource();
  if (command === "credential-authorization" && !args.length) return authorizeCredential();
  if (command === "verify-prior-artifact" && args.length === 1) return verifyFailureArtifactMetadata(read(args[0]));
  if (command === "verify-recovery-artifact" && args.length === 1) return verifyRecoveryArtifactMetadata(read(args[0]), process.env);
  if (command === "verify-prior-receipts" && args.length === 1) return verifyFailureReceipts(args[0]);
  if (command === "preflight" && args.length === 2) return preflight(args[0], args[1]);
  if (command === "verify-preflight" && args.length === 2) return verifyPreflight(args[0], args[1]);
  if (command === "verify-preflight-self-contained" && args.length === 1) return verifyPreflight(args[0]);
  if (command === "reconcile" && args.length === 1) return reconcile(args[0]);
  if (command === "current-read-only" && args.length === 2) { console.log(JSON.stringify(currentReadOnly(args[0], args[1]))); return; }
  if (command === "prepare-coverage" && !args.length) return stage("coverage");
  if (command === "apply-coverage" && args.length === 2) return applyCoverage(args[0], args[1]);
  if (command === "verify-coverage-readback" && args.length === 2) return verifyCoverageReadback(args[0], args[1]);
  if (command === "prepare-profile-link" && !args.length) return stage("profile-link");
  if (command === "apply-profile-link" && args.length === 2) return applyProfileLink(args[0], args[1]);
  fail("candidate_recovery_usage_invalid");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => {
  const code = error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : "candidate_recovery_failed";
  process.stderr.write(code + "\n"); process.exitCode = 1;
});
