// Fixed release coordinator. No arbitrary SQL, migration set, or automatic replay.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PROJECT_REF, sha256, findProjectEnvFiles, verifyDirectDatabaseUrl } from "./migration-gate.mjs";
import { verifyApplicationGate } from "./additive-release-gate.mjs";

const fail = code => { throw Error(code); };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RECEIPT = "scripts/prospect-enrichment/additive-release-review.json";
export const PHASES = Object.freeze(["qualification", "enrichment", "candidate"]);
export const EVIDENCE_FILES = Object.freeze(["source-check.json", "staged-inventory.json", "full-ledger-check.json", "ledger-check.json", "ledger-summary.json", "rpc-catalog-check.json", "qualification-catalog-check.json", "qualification-catalog-scratch.json", "qualification-catalog-production.json", "plan-check.json"]);
const exact = (a, b) => JSON.stringify(Object.keys(a ?? {}).sort()) === JSON.stringify([...b].sort());
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
export function verifyCompleteReleaseAuthorization(env, actualReceiptSha256) {
  if (env.PROJECT_REF !== PROJECT_REF) fail("complete_release_project_invalid");
  if (env.USE_TEMPORARY_DATABASE_CREDENTIAL !== "true") fail("complete_release_temporary_mode_required");
  if (!/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "") || env.GITHUB_RUN_ATTEMPT !== "1") fail("complete_release_rerun_prohibited");
  if (env.REPAIR_CONFIRMATION !== "RECONCILE-QUALIFICATION-HISTORY-V1" || env.ENRICHMENT_CONFIRMATION !== "APPLY-PROSPECT-ENRICHMENT-V1" || env.CANDIDATE_CONFIRMATION !== "APPLY-PROSPECT-CANDIDATE-PROFILES-V1") fail("complete_release_confirmations_required");
  verifyApplicationGate({ event: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF, repository: env.GITHUB_REPOSITORY,
    operation: "apply", reviewedSourceSha: env.REVIEWED_SOURCE_SHA, configuredReviewedSha: env.CONFIGURED_REVIEWED_SHA,
    checkoutSha: env.CHECKOUT_SHA, githubSha: env.GITHUB_SHA, reviewedReceiptSha256: env.REVIEWED_RECEIPT_SHA256,
    configuredReceiptSha256: env.CONFIGURED_RECEIPT_SHA256, actualReceiptSha256, confirmation: env.CANDIDATE_CONFIRMATION,
    environment: env, projectEnvFiles: findProjectEnvFiles(), authorizationOnly: true });
  return { runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT, sourceSha: env.REVIEWED_SOURCE_SHA, projectRef: PROJECT_REF, receiptSha256: actualReceiptSha256 };
}
function checkBinding(binding) {
  if (!exact(binding, ["runId", "runAttempt", "sourceSha", "projectRef", "receiptSha256"]) || !/^[1-9][0-9]*$/.test(binding.runId) || binding.runAttempt !== "1" || binding.projectRef !== PROJECT_REF || !/^[a-f0-9]{40}$/.test(binding.sourceSha) || !/^[a-f0-9]{64}$/.test(binding.receiptSha256)) fail("complete_release_binding_invalid");
}
function fileHashes(files) {
  if (!exact(files, EVIDENCE_FILES)) fail("complete_release_evidence_files_invalid");
  return Object.fromEntries(EVIDENCE_FILES.map(name => {
    if (!Buffer.isBuffer(files[name]) || !files[name].length) fail("complete_release_evidence_bytes_invalid");
    return [name, sha256(files[name])];
  }));
}
export function createPreflightEvidence(binding, files, now = Date.now()) {
  checkBinding(binding);
  return { schemaVersion: "prospect-complete-release-preflight/v1", binding, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), files: fileHashes(files) };
}
export function verifyPreflightEvidence(evidence, binding, files, now = Date.now()) {
  checkBinding(binding);
  if (!exact(evidence, ["schemaVersion", "binding", "createdAt", "expiresAt", "files"]) || evidence.schemaVersion !== "prospect-complete-release-preflight/v1") fail("complete_release_evidence_invalid");
  checkBinding(evidence.binding);
  if (Object.keys(binding).some(key => binding[key] !== evidence.binding[key])) fail("complete_release_evidence_binding_mismatch");
  const created = Date.parse(evidence.createdAt), expires = Date.parse(evidence.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || created > now || expires <= now || expires - created !== 86400000) fail("complete_release_evidence_expired");
  const hashes = fileHashes(files);
  if (!exact(evidence.files, EVIDENCE_FILES) || EVIDENCE_FILES.some(name => evidence.files[name] !== hashes[name])) fail("complete_release_evidence_hash_mismatch");
  const catalog = JSON.parse(files["qualification-catalog-check.json"]);
  if (catalog.scratchAndProductionCatalogsMatch !== true || catalog.tableCount !== 14 || !/^[a-f0-9]{64}$/.test(catalog.productionCatalogSha256 ?? "")) fail("complete_release_catalog_evidence_invalid");
  const ledger = JSON.parse(files["ledger-check.json"]);
  if (ledger.appliedPrefixLength !== 0 || ledger.pending?.length !== 11) fail("complete_release_initial_prefix_required");
  return { productionCatalogSha256: catalog.productionCatalogSha256, binding };
}
export function assertPhaseTransition(state, phase) {
  if (!exact(state, PHASES) || !PHASES.includes(phase)) fail("complete_release_phase_invalid");
  const index = PHASES.indexOf(phase);
  if (PHASES.some((name, i) => state[name] !== (i < index ? "verified" : "pending"))) fail("complete_release_phase_replay_or_dependency");
  return true;
}
export function assertCredentialFresh(env, now = Date.now(), requiredRemainingMs = 30000) {
  const issued = Number(env.TEMPORARY_DATABASE_ISSUED_AT), expires = Number(env.TEMPORARY_DATABASE_EXPIRES_AT);
  if (env.USE_TEMPORARY_DATABASE_CREDENTIAL !== "true" || !Number.isSafeInteger(issued) || !Number.isSafeInteger(expires) || issued > now || expires - issued < 60000 || expires - issued > 86400000 || expires - now < requiredRemainingMs) fail("complete_release_credential_expired");
  return true;
}
function run(command, args, options = {}) {
  try { return execFileSync(command, args, { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024, timeout: 180000, ...options }); }
  catch (error) {
    const operation = command === process.execPath ? path.basename(args[0], ".mjs").replace(/-/g, "_") + "_" + String(args[1]).replace(/-/g, "_") : path.basename(command);
    const status = Number.isInteger(error.status) ? String(Math.abs(error.status)) : "timeout_or_signal";
    fail("complete_release_" + (/^[a-z0-9_]+$/.test(operation) ? operation : "command") + "_exit_" + status);
  }
}
function gate(which, args, output, env = process.env) {
  const bytes = run(process.execPath, [path.join(ROOT, "scripts/prospect-enrichment", which + ".mjs"), ...args], { env });
  if (output) fs.writeFileSync(output, bytes);
  return bytes;
}
function source() {
  const checkout = run("git", ["rev-parse", "HEAD"]).toString().trim();
  run("git", ["fetch", "--no-tags", "origin", "main"]);
  if (checkout !== run("git", ["rev-parse", "origin/main"]).toString().trim()) fail("reviewed_source_sha_changed");
  const binding = verifyCompleteReleaseAuthorization({ ...process.env, CHECKOUT_SHA: checkout }, sha256(fs.readFileSync(path.join(ROOT, RECEIPT))));
  gate("additive-release-gate", ["receipt"]);
  return binding;
}
function connection(write = false) {
  assertCredentialFresh(process.env, Date.now(), write ? 210000 : 30000);
  verifyDirectDatabaseUrl(process.env.MIGRATION_DATABASE_URL, process.env, findProjectEnvFiles());
}
export function runDatabaseOperation({ environment, now = Date.now(), execute, args, write = false }) {
  assertCredentialFresh(environment, now, write ? 210000 : 30000);
  verifyDirectDatabaseUrl(environment.MIGRATION_DATABASE_URL, environment, findProjectEnvFiles());
  return execute(args);
}
function database(args, output, cwd = ROOT, write = false) {
  const bytes = runDatabaseOperation({ environment: process.env, args, write,
    execute: safeArgs => run("supabase", [...safeArgs, "--db-url", process.env.MIGRATION_DATABASE_URL], { cwd }) });
  if (output) fs.writeFileSync(output, bytes);
  return bytes;
}
function query(sql, output) { database(["db", "query", "--file", sql, "--output-format", "json", "--agent", "no"], output); }
function filesAt(dir) { return Object.fromEntries(EVIDENCE_FILES.map(name => {
  const file = path.join(dir, name), stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("complete_release_evidence_file_invalid");
  return [name, fs.readFileSync(file)];
})); }
function releaseDir() {
  const dir = path.resolve(process.env.COMPLETE_RELEASE_DIR ?? "");
  if (!process.env.RUNNER_TEMP || dir !== path.join(path.resolve(process.env.RUNNER_TEMP), "complete-release")) fail("complete_release_directory_invalid");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function stateAt(dir) { return read(path.join(dir, "phase-state.json")); }
function stateWrite(dir, state) {
  const file = path.join(dir, "phase-state.json"), temp = file + ".next";
  save(temp, state); fs.renameSync(temp, file);
}
function catalog(raw, evidence) {
  const id = process.env.POSTGRES_CONTAINER_ID;
  if (!/^[a-f0-9]{12,64}$/.test(id ?? "")) fail("complete_release_scratch_container_invalid");
  for (const file of ["scripts/prospect-enrichment/qualification-catalog-fixture.sql", "supabase/migrations/20260921120000_prospect_qualification_evidence.sql", "supabase/migrations/20260921121500_prospect_qualification_profile_details.sql"]) {
    run("docker", ["exec", "-i", id, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-X", "-f", "-"], { input: fs.readFileSync(path.join(ROOT, file)) });
  }
  const contract = path.join(ROOT, "scripts/prospect-enrichment/qualification-catalog-contract.sql");
  fs.writeFileSync(path.join(raw, "scratch.json"), run("docker", ["exec", "-i", id, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-X", "-A", "-t", "-f", "-"], { input: fs.readFileSync(contract) }));
  query(contract, path.join(raw, "catalog.json"));
  gate("migration-gate", ["catalog-compare", path.join(raw, "scratch.json"), path.join(raw, "catalog.json")], path.join(evidence, "qualification-catalog-check.json"));
  fs.copyFileSync(path.join(raw, "scratch.json"), path.join(evidence, "qualification-catalog-scratch.json"));
  fs.copyFileSync(path.join(raw, "catalog.json"), path.join(evidence, "qualification-catalog-production.json"));
}
function snapshot(raw, evidence, label, stage, prefix) {
  const p = name => path.join(raw, label + name), e = name => path.join(evidence, label + name);
  gate("additive-release-gate", ["ledger-query"], p("ledger.sql")); query(p("ledger.sql"), p("ledger.json"));
  gate("additive-release-gate", ["catalog-query"], p("catalog.sql")); query(p("catalog.sql"), p("rpc.json"));
  gate("migration-gate", ["full-query"], p("full.sql")); query(p("full.sql"), p("full.json"));
  gate("additive-release-gate", ["ledger-summary", p("ledger.json")], e("ledger-summary.json"));
  gate("additive-release-gate", ["ledger", p("ledger.json")], e("ledger-check.json"));
  gate("additive-release-gate", ["catalog-bound", p("rpc.json"), p("ledger.json")], e("rpc-catalog-check.json"));
  gate("additive-release-gate", ["full-ledger", p("full.json"), stage, e("ledger-check.json")], e("full-ledger-check.json"));
  if (prefix !== undefined && read(e("ledger-check.json")).appliedPrefixLength !== prefix) fail("complete_release_prefix_mismatch");
  return { ledger: p("ledger.json"), full: p("full.json"), proof: e("ledger-check.json") };
}
function plan(raw, evidence, label, stage, proof, kind = "additive-release-gate", phase = "pre") {
  const output = path.join(raw, label + "plan.json");
  database(["db", "push", "--dry-run", "--include-all", "--skip-vault", "--output-format", "json"], output, stage);
  gate(kind, kind === "migration-gate" ? ["plan", phase, output] : ["plan", phase, output, proof], path.join(evidence, label + "plan-check.json"));
}
function verifyDownloaded(dir, binding) {
  const directory = fs.lstatSync(dir), manifestStat = fs.lstatSync(path.join(dir, "preflight-manifest.json"));
  if (!directory.isDirectory() || directory.isSymbolicLink() || !manifestStat.isFile() || manifestStat.isSymbolicLink()) fail("complete_release_evidence_file_invalid");
  if (!exact(Object.fromEntries(fs.readdirSync(dir).map(name => [name, true])), [...EVIDENCE_FILES, "preflight-manifest.json"])) fail("complete_release_download_files_invalid");
  const manifest = read(path.join(dir, "preflight-manifest.json"));
  if (sha256(fs.readFileSync(path.join(dir, "preflight-manifest.json"))) !== process.env.EXPECTED_MANIFEST_SHA256) fail("complete_release_manifest_digest_mismatch");
  const proof = verifyPreflightEvidence(manifest, binding, filesAt(dir));
  const repeated = JSON.parse(gate("migration-gate", ["catalog-compare", path.join(dir, "qualification-catalog-scratch.json"), path.join(dir, "qualification-catalog-production.json")]));
  if (repeated.productionCatalogSha256 !== proof.productionCatalogSha256) fail("complete_release_catalog_evidence_invalid");
  return proof;
}
function prepare(dir, download) {
  const binding = source(); verifyDownloaded(download, binding);
  if (fs.existsSync(path.join(dir, "phase-state.json"))) fail("complete_release_state_exists");
  stateWrite(dir, Object.fromEntries(PHASES.map(phase => [phase, "pending"])));
  return binding;
}
function authorizeCredential() {
  source(); const dir = releaseDir(), phase = process.env.COMPLETE_PHASE;
  if (phase !== "preflight") assertPhaseTransition(stateAt(dir), phase);
  const marker = path.join(dir, "credential-" + phase + ".json");
  if (!["preflight", ...PHASES].includes(phase)) fail("complete_release_phase_invalid");
  fs.writeFileSync(marker, JSON.stringify({ phase, requested: true }), { flag: "wx" });
}
function preflight(evidence) {
  const binding = source(), dir = releaseDir(), raw = path.join(dir, "raw-preflight"), stage = path.join(dir, "stage-preflight");
  fs.mkdirSync(raw); fs.mkdirSync(evidence, { recursive: true }); save(path.join(evidence, "source-check.json"), binding);
  gate("migration-gate", ["stage", ROOT, stage], path.join(evidence, "staged-inventory.json"));
  const before = snapshot(raw, evidence, "", stage, 0);
  catalog(raw, evidence); plan(raw, evidence, "", stage, before.proof);
  const manifest = createPreflightEvidence(binding, filesAt(evidence));
  verifyPreflightEvidence(manifest, binding, filesAt(evidence));
  save(path.join(evidence, "preflight-manifest.json"), manifest);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `manifest_sha256=${sha256(fs.readFileSync(path.join(evidence, "preflight-manifest.json")))}\n`);
}
function phaseRun(phase, evidence, download) {
  const binding = source(), reviewed = verifyDownloaded(download, binding), dir = releaseDir(), state = stateAt(dir);
  assertPhaseTransition(state, phase);
  const raw = path.join(dir, "raw-" + phase), stage = path.join(dir, "stage-" + phase), allStage = path.join(dir, "all-" + phase);
  fs.mkdirSync(raw); fs.mkdirSync(evidence, { recursive: true });
  gate("migration-gate", ["stage", ROOT, allStage], path.join(evidence, phase + "-all-staged.json"));
  gate("migration-gate", [phase === "candidate" ? "stage" : "stage-prerequisites", ROOT, stage], path.join(evidence, phase + "-staged.json"));
  const expectedPrefix = { qualification: 0, enrichment: 2, candidate: 8 }[phase];
  let before = snapshot(raw, evidence, phase + "-before-", allStage, expectedPrefix);
  if (phase === "qualification") {
    catalog(raw, evidence);
    if (read(path.join(evidence, "qualification-catalog-check.json")).productionCatalogSha256 !== reviewed.productionCatalogSha256) fail("reviewed_catalog_evidence_missing_or_changed");
  } else plan(raw, evidence, phase + "-before-", stage, before.proof, phase === "enrichment" ? "migration-gate" : "additive-release-gate");
  source();
  before = snapshot(raw, evidence, phase + "-immediate-", allStage, expectedPrefix);
  if (phase === "qualification") {
    query(path.join(ROOT, "scripts/prospect-enrichment/qualification-catalog-contract.sql"), path.join(raw, "catalog-immediate.json"));
    gate("migration-gate", ["catalog-compare", path.join(raw, "scratch.json"), path.join(raw, "catalog-immediate.json")], path.join(evidence, "qualification-immediate-catalog.json"));
    gate("migration-gate", ["repair-authorization", read(path.join(evidence, "qualification-immediate-catalog.json")).productionCatalogSha256], path.join(evidence, "repair-authorization.json"), { ...process.env, CONFIRMATION: process.env.REPAIR_CONFIRMATION, REVIEWED_CATALOG_SHA256: reviewed.productionCatalogSha256 });
  } else plan(raw, evidence, phase + "-immediate-", stage, before.proof, phase === "enrichment" ? "migration-gate" : "additive-release-gate");
  gate("migration-gate", ["verify-stage", ROOT, stage, path.join(evidence, phase + "-staged.json")], path.join(evidence, phase + "-stage-check.json"));
  source();
  connection(true);
  executeReleasePhase({ state, phase, persist: value => stateWrite(dir, value), write: () => {
    if (phase === "qualification") database(["migration", "repair", "--status", "applied", "20260921120000", "20260921121500"], path.join(raw, "apply.json"), stage, true);
    else {
      database(["db", "push", "--yes", "--include-all", "--skip-vault", "--output-format", "json"], path.join(raw, "apply.json"), stage, true);
      if (phase === "enrichment") gate("migration-gate", ["plan", "apply", path.join(raw, "apply.json")], path.join(evidence, "enrichment-apply-check.json"));
    }
  }, verify: () => {
    const after = snapshot(raw, evidence, phase + "-post-", allStage);
    plan(raw, evidence, phase + "-recovery-", allStage, after.proof);
    if (read(after.proof).appliedPrefixLength !== { qualification: 2, enrichment: 8, candidate: 11 }[phase]) fail("complete_release_post_prefix_mismatch");
    if (phase === "qualification") gate("migration-gate", ["ledger-delta", before.full, after.full, "20260921120000", "20260921121500"], path.join(evidence, "qualification-delta-check.json"));
    else {
      if (phase === "enrichment") {
        gate("migration-gate", ["query"], path.join(raw, "six.sql")); query(path.join(raw, "six.sql"), path.join(raw, "six.json"));
        gate("migration-gate", ["ledger", path.join(raw, "six.json")], path.join(evidence, "enrichment-ledger-check.json"));
        gate("migration-gate", ["full-ledger", after.full, stage, "complete"], path.join(evidence, "enrichment-full-ledger-check.json"));
      } else gate("additive-release-gate", ["candidate-complete", after.proof], path.join(evidence, "candidate-complete-check.json"));
      plan(raw, evidence, phase + "-post-", stage, after.proof, phase === "enrichment" ? "migration-gate" : "additive-release-gate", "post");
    }
  }, recovery: () => save(path.join(evidence, phase + "-recovery.json"), { phase, state: "started_unverified", replayAllowed: false, readOnlyReconciliationRequired: true }) });
  save(path.join(evidence, phase + "-receipt.json"), { binding, phase, state: "verified" });
}
export function executeReleasePhase({ state, phase, write, verify, persist, recovery = () => {} }) {
  assertPhaseTransition(state, phase);
  state[phase] = "started"; persist({ ...state });
  let error;
  try { write(); } catch (caught) { error = caught; }
  try { verify(); } catch (caught) { error ??= caught; }
  if (error) { recovery(); throw error; }
  state[phase] = "verified"; persist({ ...state });
}
async function main([command, ...args]) {
  if (command === "source-authorization" && !args.length) return source();
  if (command === "credential-authorization" && !args.length) return authorizeCredential();
  if (command === "prepare-release" && args.length === 1) return prepare(releaseDir(), args[0]);
  if (command === "verify-artifact" && args.length === 1) return verifyArtifactMetadata(read(args[0]), process.env);
  if (command === "preflight" && args.length === 1) return preflight(args[0]);
  if (PHASES.includes(command) && args.length === 2) return phaseRun(command, args[0], args[1]);
  fail("complete_release_usage_invalid");
}
export function verifyArtifactMetadata(metadata, env) {
  if (!/^[1-9][0-9]*$/.test(env.EXPECTED_ARTIFACT_ID ?? "") || !/^[a-f0-9]{64}$/.test(env.EXPECTED_ARTIFACT_DIGEST ?? "") ||
      String(metadata.id) !== env.EXPECTED_ARTIFACT_ID || metadata.name !== "prospect-complete-release-preflight" || metadata.expired !== false ||
      metadata.digest !== "sha256:" + env.EXPECTED_ARTIFACT_DIGEST || String(metadata.workflow_run?.id) !== env.GITHUB_RUN_ID ||
      metadata.workflow_run?.head_sha !== env.REVIEWED_SOURCE_SHA) fail("complete_release_artifact_identity_mismatch");
  return true;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => {
  const code = error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : "complete_release_failed";
  process.stderr.write(code + "\n"); process.exitCode = 1;
});
