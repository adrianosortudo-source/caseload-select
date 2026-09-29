import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const yaml = createRequire(import.meta.url)("js-yaml");
import * as recovery from "../candidate-recovery-gate.mjs";
import { CANDIDATE_RELEASE_PATHS, PROJECT_REF, stageCandidateRecoveryWorkdir, verifyCandidateRecoveryWorkdir } from "../migration-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const oldBinding = { runId: recovery.FAILED_RUN_ID, runAttempt: "1", sourceSha: recovery.FAILED_SOURCE_SHA, projectRef: PROJECT_REF, receiptSha256: recovery.FAILED_RECEIPT_SHA256 };
const binding = { runId: "99999999999", runAttempt: "1", sourceSha: "a".repeat(40), projectRef: PROJECT_REF, receiptSha256: "b".repeat(64), priorArtifactId: recovery.FAILED_RECEIPTS_ARTIFACT_ID, priorArtifactSha256: recovery.FAILED_RECEIPTS_ARTIFACT_SHA256 };
const current = { appliedPrefixLength: 9, pending: [...recovery.REMAINING], planUpToDate: false, fullLedgerMatchesSource: true, operatorRpcVerified: true, coverageTimeoutControlVerified: true, coverageReadbackVerified: false };

function makePrior(t) {
  const tempRoot = path.resolve(root, "..", "..", "07_Prospects", ".candidate-recovery-tests"); fs.mkdirSync(tempRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(tempRoot, "candidate-recovery-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (rel, value) => { const file = path.join(dir, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
  put("complete-release/phase-state.json", { qualification: "verified", enrichment: "verified", candidate: "started" });
  put("release-evidence/candidate-recovery.json", { phase: "candidate", state: "started_unverified", replayAllowed: false, readOnlyReconciliationRequired: true });
  for (const phase of ["qualification", "enrichment"]) put(`release-evidence/${phase}-receipt.json`, { binding: oldBinding, phase, state: "verified" });
  put("release-evidence/candidate-post-ledger-check.json", { projectRef: PROJECT_REF, appliedPrefixLength: 9, pending: recovery.REMAINING.map(p => path.posix.basename(p)), appliedMigrations: CANDIDATE_RELEASE_PATHS.slice(0, 9).map(path => ({ path, statementContentMatchesReviewedSource: true })) });
  put("release-evidence/candidate-post-full-ledger-check.json", { phase: "candidate-pending", remoteVersionCount: 254, stagedMigrationCount: 256, pendingPaths: [...recovery.REMAINING], completeSourceCoverage: true });
  put("release-evidence/candidate-post-rpc-catalog-check.json", { prerequisite: "verified_applied_operator_rpc", ledgerStatementVerification: "ledger_statements_match_reviewed_source", catalog: { functionName: "revalidate_operator_membership_v1" } });
  put("release-evidence/candidate-recovery-plan-check.json", { phase: "pre", migrations: recovery.REMAINING.map(p => path.posix.basename(p)), dryRun: true, upToDate: false });
  return dir;
}

test("failed-run artifact metadata is pinned to the original run, name, id, digest and source", () => {
  const metadata = { id: Number(recovery.FAILED_RECEIPTS_ARTIFACT_ID), name: "prospect-complete-release-receipts", digest: "sha256:" + recovery.FAILED_RECEIPTS_ARTIFACT_SHA256, expired: false,
    workflow_run: { id: Number(recovery.FAILED_RUN_ID), head_sha: recovery.FAILED_SOURCE_SHA } };
  assert.equal(recovery.verifyFailureArtifactMetadata(metadata), true);
  for (const change of [{ id: 1 }, { name: "other" }, { digest: "sha256:" + "0".repeat(64) }, { expired: true }, { workflow_run: { id: 1, head_sha: recovery.FAILED_SOURCE_SHA } }]) {
    assert.throws(() => recovery.verifyFailureArtifactMetadata({ ...metadata, ...change }));
  }
});

test("recovery accepts only the immutable verified-nine/pending-two failure receipts", t => {
  const dir = makePrior(t);
  assert.equal(recovery.verifyFailureReceipts(dir).appliedPrefixLength, 9);
  const phaseState = path.join(dir, "complete-release/phase-state.json"), original = fs.readFileSync(phaseState);
  fs.writeFileSync(phaseState, JSON.stringify({ qualification: "verified", enrichment: "verified", candidate: "verified" }));
  assert.throws(() => recovery.verifyFailureReceipts(dir), /candidate_recovery_phase_state_mismatch/);
  fs.writeFileSync(phaseState, original);
  const ledger = path.join(dir, "release-evidence/candidate-post-ledger-check.json"), proof = JSON.parse(fs.readFileSync(ledger));
  proof.pending.push("20260921120000_prospect_qualification_evidence.sql"); fs.writeFileSync(ledger, JSON.stringify(proof));
  assert.throws(() => recovery.verifyFailureReceipts(dir), /candidate_recovery_prior_ledger_invalid/);
});

test("recovery manifest binds current run and every prior evidence file and expires", t => {
  const dir = makePrior(t), manifest = recovery.createRecoveryEvidence(binding, dir, current, 1800000000000);
  assert.equal(recovery.verifyRecoveryEvidence(manifest, binding, dir, 1800000000001), true);
  assert.throws(() => recovery.verifyRecoveryEvidence(manifest, { ...binding, sourceSha: "c".repeat(40) }, dir, 1800000000001));
  assert.throws(() => recovery.verifyRecoveryEvidence(manifest, binding, dir, 1800000000000 + 86400001));
  fs.appendFileSync(path.join(dir, recovery.RECOVERY_FILES[0]), " ");
  assert.throws(() => recovery.verifyRecoveryEvidence(manifest, binding, dir, 1800000000001), /candidate_recovery_prior_evidence_changed/);
});

test("recovery preflight accepts only exact prefix-nine write or prefix-ten read-back states", () => {
  assert.deepEqual(recovery.verifyRecoveryObservedState(current), { coverageWriteRequired: true });
  const resumed = { ...current, appliedPrefixLength: 10, pending: [recovery.PROFILE_LINK], coverageReadbackVerified: true };
  assert.deepEqual(recovery.verifyRecoveryObservedState(resumed), { coverageWriteRequired: false });
  for (const invalid of [
    { ...resumed, pending: [...recovery.REMAINING] },
    { ...resumed, coverageReadbackVerified: false },
    { ...resumed, operatorRpcVerified: false },
    { ...resumed, fullLedgerMatchesSource: false },
    { ...current, coverageReadbackVerified: true },
    { ...current, appliedPrefixLength: 8 },
  ]) assert.throws(() => recovery.verifyRecoveryObservedState(invalid), /candidate_recovery_live_state_invalid/);
});test("live recovery plan must exactly match the reviewed phase and cannot carry roles or seeds", () => {
  assert.deepEqual(recovery.verifyRecoveryPlan({ dryRun: true, upToDate: false, migrations: [path.posix.basename(recovery.COVERAGE)], seeds: [], roles: [] }, [recovery.COVERAGE]).migrations, [path.posix.basename(recovery.COVERAGE)]);
  assert.throws(() => recovery.verifyRecoveryPlan({ dryRun: true, upToDate: false, migrations: recovery.REMAINING.map(p => path.posix.basename(p)), seeds: [], roles: [] }, [recovery.COVERAGE]));
  assert.throws(() => recovery.verifyRecoveryPlan({ dryRun: true, upToDate: false, migrations: [path.posix.basename(recovery.COVERAGE)], seeds: [], roles: ["unexpected"] }, [recovery.COVERAGE]));
  assert.deepEqual(recovery.verifyRecoveryPlan({ dryRun: true, upToDate: true, migrations: [], seeds: [], roles: [] }, []), { dryRun: true, upToDate: true, migrations: [] });
});

test("profile link cannot run until coverage read-back has verified", () => {
  assert.equal(recovery.verifyRecoveryPhaseTransition({ coverage: "pending", profileLink: "pending" }, "coverage"), true);
  assert.throws(() => recovery.verifyRecoveryPhaseTransition({ coverage: "started_unverified", profileLink: "pending" }, "profile-link"), /candidate_recovery_prior_phase_unverified/);
  assert.throws(() => recovery.verifyRecoveryPhaseTransition({ coverage: "started_unverified", profileLink: "pending" }, "coverage"), /candidate_recovery_prior_phase_unverified/);
  assert.throws(() => recovery.verifyRecoveryPhaseTransition({ coverage: "pending", profileLink: "verified" }, "profile-link"));
  assert.equal(recovery.verifyRecoveryPhaseTransition({ coverage: "verified", profileLink: "pending" }, "profile-link"), true);
  assert.equal(recovery.verifyRecoveryCoverageReadbackTransition({ coverage: "started_unverified", profileLink: "pending" }), true);
  for (const state of [{ coverage: "pending", profileLink: "pending" }, { coverage: "verified", profileLink: "pending" }, { coverage: "started_unverified", profileLink: "verified" }]) assert.throws(() => recovery.verifyRecoveryCoverageReadbackTransition(state), /candidate_recovery_coverage_readback_not_pending/);
  assert.throws(() => recovery.verifyRecoveryPhaseTransition({ coverage: "verified", profileLink: "verified" }, "profile-link"));
});

test("writer response loss after ledger advances stays unverified and prohibits coverage replay", () => {
  const persisted = recovery.beginRecoveryCoverageWrite({ coverage: "pending", profileLink: "pending" });
  const fakeLedger = { appliedPrefixLength: 9 };
  assert.throws(() => {
    fakeLedger.appliedPrefixLength = 10; // Commit completed, but the CLI response was lost.
    throw Error("simulated_writer_response_loss");
  }, /simulated_writer_response_loss/);
  assert.deepEqual(persisted, { coverage: "started_unverified", profileLink: "pending" });
  assert.equal(fakeLedger.appliedPrefixLength, 10);
  assert.throws(() => recovery.beginRecoveryCoverageWrite(persisted), /candidate_recovery_prior_phase_unverified/);
  assert.throws(() => recovery.verifyRecoveryPhaseTransition(persisted, "profile-link"), /candidate_recovery_prior_phase_unverified/);
});

test("injected recovery adapters persist uncertainty and run prefix-ten read-back without replay", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-recovery-faults-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = (name) => path.join(root, name), put = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value));
  const get = (name) => JSON.parse(fs.readFileSync(file(name), "utf8"));

  put("writer-state.json", { coverage: "pending", profileLink: "pending" });
  const fakeLedger = { appliedPrefixLength: 9 };
  await assert.rejects(recovery.runRecoveryCoverageWriter({
    stateFile: file("writer-state.json"), receiptFile: file("writer-receipt.json"), markerFile: file("writer-marker.json"),
    state: get("writer-state.json"), receipt: { state: "verified" },
    write: () => { fakeLedger.appliedPrefixLength = 10; throw Error("simulated_commit_response_loss"); },
  }), /simulated_commit_response_loss/);
  assert.equal(fakeLedger.appliedPrefixLength, 10);
  assert.deepEqual(get("writer-state.json"), { coverage: "started_unverified", profileLink: "pending" });
  assert.equal(fs.existsSync(file("writer-receipt.json")), false);
  assert.deepEqual(get("writer-marker.json"), { phase: "candidate-coverage", state: "started_unverified", replayAllowed: false, readOnlyReconciliationRequired: true });
  let replayAttempts = 0;
  await assert.rejects(recovery.runRecoveryCoverageWriter({
    stateFile: file("writer-state.json"), receiptFile: file("writer-receipt.json"), markerFile: file("writer-marker.json"),
    state: get("writer-state.json"), receipt: { state: "verified" }, write: () => { replayAttempts += 1; },
  }), /candidate_recovery_prior_phase_unverified/);
  assert.equal(replayAttempts, 0);

  for (const failedAt of ["ledger", "fullLedger", "dryRun", "catalog"]) {
    const name = `readback-${failedAt}`;
    put(`${name}-state.json`, { coverage: "started_unverified", profileLink: "pending" });
    const called = [];
    const stages = Object.fromEntries(["ledger", "fullLedger", "dryRun", "catalog"].map(stage => [stage, () => {
      called.push(stage);
      if (stage === failedAt) throw Error(`simulated_${stage}_failure`);
    }]));
    await assert.rejects(recovery.runRecoveryCoverageReadback({
      stateFile: file(`${name}-state.json`), receiptFile: file(`${name}-receipt.json`), markerFile: file(`${name}-marker.json`), stages, receipt: () => ({ state: "verified" }),
    }), new RegExp(`simulated_${failedAt}_failure`));
    assert.deepEqual(get(`${name}-state.json`), { coverage: "started_unverified", profileLink: "pending" }, failedAt);
    assert.equal(fs.existsSync(file(`${name}-receipt.json`)), false, failedAt);
    assert.deepEqual(called, ["ledger", "fullLedger", "dryRun", "catalog"].slice(0, ["ledger", "fullLedger", "dryRun", "catalog"].indexOf(failedAt) + 1));
    assert.throws(() => recovery.beginRecoveryCoverageWrite(get(`${name}-state.json`)), /candidate_recovery_prior_phase_unverified/);
    assert.throws(() => recovery.verifyRecoveryPhaseTransition(get(`${name}-state.json`), "profile-link"), /candidate_recovery_prior_phase_unverified/);
  }

  const observed = { ...current, appliedPrefixLength: 10, pending: [recovery.PROFILE_LINK], coverageReadbackVerified: true };
  const { coverageWriteRequired } = recovery.verifyRecoveryObservedState(observed);
  assert.equal(coverageWriteRequired, false);
  let writerCalls = 0; const readbackOrder = [];
  if (coverageWriteRequired) writerCalls += 1;
  put("resume-state.json", { coverage: "started_unverified", profileLink: "pending" });
  const stages = Object.fromEntries(["ledger", "fullLedger", "dryRun", "catalog"].map(stage => [stage, () => { readbackOrder.push(stage); }]));
  await recovery.runRecoveryCoverageReadback({ stateFile: file("resume-state.json"), receiptFile: file("resume-receipt.json"), markerFile: file("resume-marker.json"), stages, receipt: () => ({ state: "verified" }) });
  assert.equal(writerCalls, 0);
  assert.deepEqual(readbackOrder, ["ledger", "fullLedger", "dryRun", "catalog"]);
  assert.deepEqual(get("resume-state.json"), { coverage: "verified", profileLink: "pending" });
  assert.deepEqual(get("resume-receipt.json"), { state: "verified" });
  assert.equal(recovery.verifyRecoveryPhaseTransition(get("resume-state.json"), "profile-link"), true);
});

test("every partial coverage read-back failure preserves started_unverified and blocks writer and profile-link", () => {
  const boundaries = ["ledger", "fullLedger", "dryRun", "catalog"];
  for (const failedAt of boundaries) {
    const persisted = recovery.beginRecoveryCoverageWrite({ coverage: "pending", profileLink: "pending" });
    const checks = { ledger: false, fullLedger: false, dryRun: false, catalog: false };
    for (const boundary of boundaries) {
      if (boundary === failedAt) break;
      checks[boundary] = true;
    }
    assert.throws(() => recovery.completeRecoveryCoverageReadback(persisted, checks), /candidate_recovery_coverage_readback_invalid/, failedAt);
    assert.deepEqual(persisted, { coverage: "started_unverified", profileLink: "pending" }, failedAt);
    assert.throws(() => recovery.beginRecoveryCoverageWrite(persisted), /candidate_recovery_prior_phase_unverified/, failedAt);
    assert.throws(() => recovery.verifyRecoveryPhaseTransition(persisted, "profile-link"), /candidate_recovery_prior_phase_unverified/, failedAt);
  }
});

test("reviewed prefix-ten resume authorizes read-back only, then profile-link after all checks", () => {
  const observed = { ...current, appliedPrefixLength: 10, pending: [recovery.PROFILE_LINK], coverageReadbackVerified: true };
  assert.deepEqual(recovery.verifyRecoveryObservedState(observed), { coverageWriteRequired: false });
  const resumed = { coverage: "started_unverified", profileLink: "pending" };
  assert.throws(() => recovery.beginRecoveryCoverageWrite(resumed), /candidate_recovery_prior_phase_unverified/);
  const verified = recovery.completeRecoveryCoverageReadback(resumed, { ledger: true, fullLedger: true, dryRun: true, catalog: true });
  assert.equal(recovery.verifyRecoveryPhaseTransition(verified, "profile-link"), true);
  for (const invalid of [
    { ledger: false, fullLedger: true, dryRun: true, catalog: true },
    { ledger: true, fullLedger: false, dryRun: true, catalog: true },
    { ledger: true, fullLedger: true, dryRun: false, catalog: true },
    { ledger: true, fullLedger: true, dryRun: true, catalog: false },
  ]) assert.throws(() => recovery.completeRecoveryCoverageReadback(resumed, invalid), /candidate_recovery_coverage_readback_invalid/);
});

test("database writer TTL and process limits leave read-back to a separately issued credential", () => {
  assert.equal(recovery.verifyRecoveryTimeoutBudget(300000, 240000, 10000), true);
  assert.equal(recovery.verifyRecoveryTimeoutBudget(180000, 120000, 60000), true);
  assert.equal(recovery.verifyRecoveryTimeoutBudget(250000, 200000, 50000), true);
  assert.throws(() => recovery.verifyRecoveryTimeoutBudget(249999, 240000, 10000), /candidate_recovery_credential_budget_insufficient/);
  assert.throws(() => recovery.verifyRecoveryTimeoutBudget(300000, 240000, 0.5), /candidate_recovery_credential_budget_insufficient/);
  assert.throws(() => recovery.verifyRecoveryTimeoutBudget(Number.NaN, 210000, 60000), /candidate_recovery_credential_budget_insufficient/);
});

test("coverage migration sets a transaction-local 240-second timeout before DDL", t => {
  const migration = fs.readFileSync(path.join(root, recovery.COVERAGE), "utf8");
  assert.equal(recovery.verifyRecoveryCoverageTimeout(migration), true);
  for (const changed of [
    migration.replace("SET LOCAL statement_timeout = '240s';", "SET LOCAL statement_timeout = '120s';"),
    migration.replace("SET LOCAL statement_timeout = '240s';", ""),
    migration.replace("SET LOCAL statement_timeout = '240s';", "").replace("COMMIT;", "SET LOCAL statement_timeout = '240s';\nCOMMIT;"),
    migration.replace("SET LOCAL statement_timeout = '240s';", "SET LOCAL statement_timeout = '240s';\nSET LOCAL statement_timeout = '240s';"),
    migration.replace("BEGIN;", "-- pg-delta: transaction=false\nBEGIN;"),
  ]) assert.throws(() => recovery.verifyRecoveryCoverageTimeout(changed), /candidate_recovery_coverage_timeout_control_invalid/);
  const dir = makePrior(t);
  const invalid = { ...current, coverageTimeoutControlVerified: false };
  assert.throws(() => recovery.createRecoveryEvidence(binding, dir, invalid, 1800000000000), /candidate_recovery_live_state_invalid/);
});

test("migration staging excludes only the final link during coverage, then restores it", t => {
  const tempRoot = path.resolve(root, "..", "..", "07_Prospects", ".candidate-recovery-tests"); fs.mkdirSync(tempRoot, { recursive: true });
  const base = fs.mkdtempSync(path.join(tempRoot, "candidate-stage-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const coverage = path.join(base, "coverage"), coverageProof = stageCandidateRecoveryWorkdir(root, coverage, "coverage");
  assert.equal(coverageProof.deferred[0], recovery.PROFILE_LINK);
  assert.equal(verifyCandidateRecoveryWorkdir(root, coverage, coverageProof, "coverage").verified, true);
  const final = path.join(base, "final"), finalProof = stageCandidateRecoveryWorkdir(root, final, "profile-link");
  assert.deepEqual(finalProof.deferred, []);
  assert.equal(verifyCandidateRecoveryWorkdir(root, final, finalProof, "profile-link").verified, true);
  assert.throws(() => verifyCandidateRecoveryWorkdir(root, final, coverageProof, "coverage"));
});

test("same-run review evidence artifact rejects a changed id, digest, run or source", () => {
  const env = { EXPECTED_ARTIFACT_ID: "12", EXPECTED_ARTIFACT_DIGEST: "a".repeat(64), GITHUB_RUN_ID: "13", REVIEWED_SOURCE_SHA: "b".repeat(40) };
  const metadata = { id: 12, name: "prospect-candidate-suffix-recovery-preflight", digest: "sha256:" + env.EXPECTED_ARTIFACT_DIGEST, expired: false, workflow_run: { id: 13, head_sha: env.REVIEWED_SOURCE_SHA } };
  assert.equal(recovery.verifyRecoveryArtifactMetadata(metadata, env), true);
  assert.throws(() => recovery.verifyRecoveryArtifactMetadata({ ...metadata, id: 14 }, env));
});

test("recovery workflow requires two sequential environment reviews and blocks the final phase on coverage failure", () => {
  const workflow = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/prospect-candidate-suffix-recovery.yml"), "utf8"));
  const trigger = workflow.on ?? workflow["on"];
  assert.ok(trigger.workflow_dispatch);
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.equal(workflow.jobs.reconcile.environment, "Production prospect migrations");
  assert.equal(workflow.jobs.apply.environment, "Production prospect migrations");
  assert.equal(workflow.jobs.apply.needs, "reconcile");
  assert.equal(workflow.jobs.reconcile.outputs.coverage_write_required, "${{ steps.reconcile.outputs.coverage_write_required }}");
  const steps = workflow.jobs.apply.steps.map(step => step.name ?? "");
  const coverage = steps.indexOf("Apply coverage migration within bounded writer credential lifetime");
  const readbackCredential = steps.indexOf("Acquire fresh credential for coverage read-back after writer or reviewed prefix-ten reconciliation");
  const readback = steps.indexOf("Verify coverage migration ledger and catalog read-back");
  const final = steps.indexOf("Apply final profile link only after coverage receipt is verified");
  assert.ok(coverage >= 0 && readbackCredential > coverage && readback > readbackCredential && final > readback);
  assert.match(workflow.jobs.apply.steps[coverage].if, /post_review_reconcile.outputs.coverage_write_required/);
  assert.equal(workflow.jobs.apply.steps[readbackCredential].if, undefined, "both writer and prefix-ten resume paths require read-back");
  const reviewSummary = workflow.jobs.reconcile.steps.find(step => step.name === "Present exact partial ledger and remaining suffix for second protected review").run;
  assert.match(reviewSummary, /transaction-local statement_timeout of 240 seconds before DDL/);
  assert.match(reviewSummary, /300-second credential/);
  assert.match(reviewSummary, /240-second CLI hard timeout/);
  assert.match(reviewSummary, /read-back uses a separate credential with at least 250 seconds remaining/);
  assert.match(reviewSummary, /prefix ten with only profile-link pending/);
  assert.equal(workflow.jobs.apply.steps[final].if, undefined, "GitHub default success gating keeps later phases stopped on an unverified result");
  assert.ok(workflow.jobs.apply.steps.slice(coverage + 1, final).some(step => step.name === "Acquire a new credential only after verified coverage"));
  const failedEvidence = workflow.jobs.reconcile.steps.find(step => step.name === "Retain failed preflight evidence");
  assert.match(failedEvidence.with.path, /candidate-recovery/);
});

test("coverage writer uses bounded CLI timeout without role-level setting privileges", () => {
  const source = fs.readFileSync(path.join(root, "scripts/prospect-enrichment/candidate-recovery-gate.mjs"), "utf8");
  assert.doesNotMatch(source, /ALTER ROLE SESSION_USER|checkRoleTimeout/);
  assert.match(source, /\{ cwd: staged\.dir, timeout: 240000 \}/);
  assert.match(source, /freshCredential\(250000\)/);
  assert.match(source, /verifyRecoveryTimeoutBudget\([^\n]+, 240000, 10000\)/);
  assert.match(source, /freshCredential\(250000\)/);
  assert.match(source, /verifyRecoveryTimeoutBudget\([^\n]+, 200000, 50000\)/);
  assert.match(source, /timeout: 20000/);
  assert.match(source, /verify-coverage-readback/);
  const credential = fs.readFileSync(path.join(root, "scripts/prospect-enrichment/temporary-credential.mjs"), "utf8");
  assert.doesNotMatch(credential, /options=-c.*statement_timeout/);
  const migration = fs.readFileSync(path.join(root, recovery.COVERAGE), "utf8");
  assert.equal(recovery.verifyRecoveryCoverageTimeout(migration), true);
});
