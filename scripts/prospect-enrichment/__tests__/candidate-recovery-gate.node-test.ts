import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import * as recovery from "../candidate-recovery-gate.mjs";
import { CANDIDATE_RELEASE_PATHS, PROJECT_REF, stageCandidateRecoveryWorkdir, verifyCandidateRecoveryWorkdir } from "../migration-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const oldBinding = { runId: recovery.FAILED_RUN_ID, runAttempt: "1", sourceSha: recovery.FAILED_SOURCE_SHA, projectRef: PROJECT_REF, receiptSha256: recovery.FAILED_RECEIPT_SHA256 };
const binding = { runId: "99999999999", runAttempt: "1", sourceSha: "a".repeat(40), projectRef: PROJECT_REF, receiptSha256: "b".repeat(64), priorArtifactId: recovery.FAILED_RECEIPTS_ARTIFACT_ID, priorArtifactSha256: recovery.FAILED_RECEIPTS_ARTIFACT_SHA256 };
const current = { appliedPrefixLength: 9, pending: [...recovery.REMAINING], planUpToDate: false, fullLedgerMatchesSource: true, operatorRpcVerified: true };

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

test("live recovery plan must exactly match the reviewed phase and cannot carry roles or seeds", () => {
  assert.deepEqual(recovery.verifyRecoveryPlan({ dryRun: true, upToDate: false, migrations: [path.posix.basename(recovery.COVERAGE)], seeds: [], roles: [] }, [recovery.COVERAGE]).migrations, [path.posix.basename(recovery.COVERAGE)]);
  assert.throws(() => recovery.verifyRecoveryPlan({ dryRun: true, upToDate: false, migrations: recovery.REMAINING.map(p => path.posix.basename(p)), seeds: [], roles: [] }, [recovery.COVERAGE]));
  assert.throws(() => recovery.verifyRecoveryPlan({ dryRun: true, upToDate: false, migrations: [path.posix.basename(recovery.COVERAGE)], seeds: [], roles: ["unexpected"] }, [recovery.COVERAGE]));
  assert.deepEqual(recovery.verifyRecoveryPlan({ dryRun: true, upToDate: true, migrations: [], seeds: [], roles: [] }, []), { dryRun: true, upToDate: true, migrations: [] });
});

test("profile link cannot run until coverage read-back has verified", () => {
  assert.equal(recovery.verifyRecoveryPhaseTransition({ coverage: "pending", profileLink: "pending" }, "coverage"), true);
  assert.throws(() => recovery.verifyRecoveryPhaseTransition({ coverage: "started_unverified", profileLink: "pending" }, "profile-link"), /candidate_recovery_prior_phase_unverified/);
  assert.throws(() => recovery.verifyRecoveryPhaseTransition({ coverage: "pending", profileLink: "verified" }, "profile-link"));
  assert.equal(recovery.verifyRecoveryPhaseTransition({ coverage: "verified", profileLink: "pending" }, "profile-link"), true);
  assert.throws(() => recovery.verifyRecoveryPhaseTransition({ coverage: "verified", profileLink: "verified" }, "profile-link"));
});

test("database write timeouts leave an explicit read-back and cleanup reserve inside credential TTL", () => {
  assert.equal(recovery.verifyRecoveryTimeoutBudget(270000, 210000, 60000), true);
  assert.equal(recovery.verifyRecoveryTimeoutBudget(180000, 120000, 60000), true);
  assert.throws(() => recovery.verifyRecoveryTimeoutBudget(269999, 210000, 60000), /candidate_recovery_credential_budget_insufficient/);
  assert.throws(() => recovery.verifyRecoveryTimeoutBudget(300000, 210000, 0.5), /candidate_recovery_credential_budget_insufficient/);
  assert.throws(() => recovery.verifyRecoveryTimeoutBudget(Number.NaN, 210000, 60000), /candidate_recovery_credential_budget_insufficient/);
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
  const steps = workflow.jobs.apply.steps.map(step => step.name ?? "");
  const coverage = steps.indexOf("Apply coverage migration, verify ledger and catalog, and reset the scoped timeout");
  const final = steps.indexOf("Apply final profile link only after coverage receipt is verified");
  assert.ok(coverage >= 0 && final > coverage);
  assert.equal(workflow.jobs.apply.steps[final].if, undefined, "GitHub default success gating keeps later phases stopped on an unverified result");
  assert.ok(workflow.jobs.apply.steps.slice(coverage + 1, final).some(step => step.name === "Acquire a new credential only after verified coverage"));
});
