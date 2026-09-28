import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import * as gate from "../complete-release-gate.mjs";
import { PROJECT_REF, TEMPORARY_DATABASE_HOST, CONFIRMATION, QUALIFICATION_HISTORY_CONFIRMATION, stagePrerequisiteWorkdir, verifyProductionWorkdir } from "../migration-gate.mjs";
import { CANDIDATE_APPLY_CONFIRMATION } from "../additive-release-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sourceSha = "a".repeat(40), receiptSha256 = "b".repeat(64);
const binding = { runId: "36452099136", runAttempt: "1", sourceSha, projectRef: PROJECT_REF, receiptSha256 };
const environment = {
  GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
  GITHUB_REPOSITORY: "adrianosortudo-source/caseload-select", GITHUB_SHA: sourceSha,
  GITHUB_RUN_ID: binding.runId, GITHUB_RUN_ATTEMPT: binding.runAttempt,
  CHECKOUT_SHA: sourceSha, REVIEWED_SOURCE_SHA: sourceSha, CONFIGURED_REVIEWED_SHA: sourceSha,
  REVIEWED_RECEIPT_SHA256: receiptSha256, CONFIGURED_RECEIPT_SHA256: receiptSha256,
  PROJECT_REF, REPAIR_CONFIRMATION: QUALIFICATION_HISTORY_CONFIRMATION,
  ENRICHMENT_CONFIRMATION: CONFIRMATION, CANDIDATE_CONFIRMATION: CANDIDATE_APPLY_CONFIRMATION,
  USE_TEMPORARY_DATABASE_CREDENTIAL: "true",
};
const pending = () => ({ qualification: "pending", enrichment: "pending", candidate: "pending" });
const now = Date.parse("2026-09-28T18:00:00.000Z");
const files = Object.fromEntries(gate.EVIDENCE_FILES.map(name => [name, Buffer.from(JSON.stringify({ proof: name }))]));
files["qualification-catalog-check.json"] = Buffer.from(JSON.stringify({ scratchAndProductionCatalogsMatch: true, tableCount: 14, productionCatalogSha256: "c".repeat(64) }));
files["ledger-check.json"] = Buffer.from(JSON.stringify({ appliedPrefixLength: 0, pending: Array.from({ length: 11 }, (_, index) => String(index)) }));

test("preflight evidence binds every member to run, attempt, main, project and receipt", () => {
  const evidence = gate.createPreflightEvidence(binding, files, now);
  assert.doesNotThrow(() => gate.verifyPreflightEvidence(evidence, binding, files, now + 1000));
  for (const [key, value] of Object.entries({ runId: "36452099137", runAttempt: "2", sourceSha: "c".repeat(40), projectRef: "other-project", receiptSha256: "c".repeat(64) })) {
    assert.throws(() => gate.verifyPreflightEvidence(evidence, { ...binding, [key]: value }, files, now + 1000), key);
  }
  for (const name of Object.keys(files)) {
    assert.throws(() => gate.verifyPreflightEvidence(evidence, binding, { ...files, [name]: Buffer.from("catalog-or-ledger-drift") }, now + 1000), name);
    const missing = { ...files }; delete missing[name];
    assert.throws(() => gate.verifyPreflightEvidence(evidence, binding, missing, now + 1000), name);
  }
  assert.throws(() => gate.verifyPreflightEvidence(evidence, binding, { ...files, "unexpected.json": Buffer.from("{}") }, now));
  assert.throws(() => gate.createPreflightEvidence(binding, { ...files, "../outside.json": Buffer.from("{}") }, now));
  assert.throws(() => gate.verifyPreflightEvidence({ ...evidence, schemaVersion: "unknown" }, binding, files, now));
});

test("preflight evidence expires and cannot acquire an extended or future review window", () => {
  const evidence = gate.createPreflightEvidence(binding, files, now);
  assert.throws(() => gate.verifyPreflightEvidence(evidence, binding, files, now + 86400001));
  assert.throws(() => gate.verifyPreflightEvidence(evidence, binding, files, now - 1000));
  assert.throws(() => gate.verifyPreflightEvidence({ ...evidence, expiresAt: new Date(now + 7 * 86400000).toISOString() }, binding, files, now));
  assert.throws(() => gate.verifyPreflightEvidence({ ...evidence, createdAt: "invalid" }, binding, files, now));
});

test("artifact metadata rejects substituted artifact, digest, run, source or expired evidence", t => {
  const env = { ...environment, EXPECTED_ARTIFACT_ID: "10984017149", EXPECTED_ARTIFACT_DIGEST: "d".repeat(64) };
  const metadata = { id: 10984017149, name: "prospect-complete-release-preflight", expired: false, digest: "sha256:" + env.EXPECTED_ARTIFACT_DIGEST, workflow_run: { id: Number(binding.runId), head_sha: sourceSha } };
  assert.doesNotThrow(() => gate.verifyArtifactMetadata(metadata, env));
  for (const change of [
    { id: 10984017150 }, { name: "other" }, { expired: true }, { expired: undefined },
    { digest: "sha256:" + "e".repeat(64) }, { digest: undefined },
    { workflow_run: { ...metadata.workflow_run, id: Number(binding.runId) + 1 } },
    { workflow_run: { ...metadata.workflow_run, head_sha: "e".repeat(40) } },
    { workflow_run: undefined },
  ]) assert.throws(() => gate.verifyArtifactMetadata({ ...metadata, ...change }, env));
  assert.throws(() => gate.verifyArtifactMetadata(metadata, { ...env, EXPECTED_ARTIFACT_ID: "" }));
  assert.throws(() => gate.verifyArtifactMetadata(metadata, { ...env, EXPECTED_ARTIFACT_DIGEST: "" }));
  const base = fs.mkdtempSync(path.join(path.dirname(root), ".complete-release-test-"));
  t.after(() => {
    assert.equal(path.dirname(base), path.dirname(root));
    assert.ok(path.basename(base).startsWith(".complete-release-test-"));
    fs.rmSync(base, { recursive: true, force: true });
  });
  const file = path.join(base, "artifact.json");
  fs.writeFileSync(file, JSON.stringify(metadata));
  const invoke = () => spawnSync(process.execPath, [path.join(root, "scripts/prospect-enrichment/complete-release-gate.mjs"), "verify-artifact", file], { cwd: root, encoding: "utf8", timeout: 15000, env: { ...process.env, ...env } });
  const valid = invoke();
  assert.equal(valid.error, undefined);
  assert.equal(valid.status, 0, valid.stderr);
  fs.writeFileSync(file, JSON.stringify({ ...metadata, expired: true }));
  const invalid = invoke();
  assert.equal(invalid.error, undefined);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr.trim(), /^[a-z0-9_]+$/);
});

test("a freshly hashed failed catalog or partial prefix is still insufficient evidence", () => {
  for (const change of [
    { "qualification-catalog-check.json": Buffer.from(JSON.stringify({ scratchAndProductionCatalogsMatch: false, tableCount: 14, productionCatalogSha256: "c".repeat(64) })) },
    { "qualification-catalog-check.json": Buffer.from(JSON.stringify({ scratchAndProductionCatalogsMatch: true, tableCount: 13, productionCatalogSha256: "c".repeat(64) })) },
    { "ledger-check.json": Buffer.from(JSON.stringify({ appliedPrefixLength: 1, pending: Array(10).fill("pending") })) },
    { "ledger-check.json": Buffer.from(JSON.stringify({ appliedPrefixLength: 0, pending: Array(12).fill("pending") })) },
  ]) {
    const changed = { ...files, ...change };
    const evidence = gate.createPreflightEvidence(binding, changed, now);
    assert.throws(() => gate.verifyPreflightEvidence(evidence, binding, changed, now));
  }
});

test("credential freshness rejects missing, expired and insufficient safety margin", () => {
  const env = { ...environment, TEMPORARY_DATABASE_ISSUED_AT: String(now - 60000), TEMPORARY_DATABASE_EXPIRES_AT: String(now + 240000) };
  assert.doesNotThrow(() => gate.assertCredentialFresh(env, now));
  for (const expires of [undefined, "NaN", String(now - 1), String(now + 29999)]) {
    assert.throws(() => gate.assertCredentialFresh({ ...env, TEMPORARY_DATABASE_EXPIRES_AT: expires }, now));
  }
  assert.throws(() => gate.assertCredentialFresh({ ...env, TEMPORARY_DATABASE_ISSUED_AT: String(now + 1) }, now));
});

test("database runner blocks credential expiry before invoking a database command", () => {
  const current = Date.now();
  const env = { ...environment, TEMPORARY_DATABASE_ROLE: "cli_login_synthetic",
    TEMPORARY_DATABASE_ISSUED_AT: String(current - 60000), TEMPORARY_DATABASE_EXPIRES_AT: String(current + 300000),
    MIGRATION_DATABASE_URL: `postgresql://cli_login_synthetic.${PROJECT_REF}:synthetic-only@${TEMPORARY_DATABASE_HOST}:5432/postgres?sslmode=verify-full`,
  };
  const args = ["db", "query", "--file", "synthetic-read-only.sql"];
  let called = 0;
  const execute = () => { called++; return Buffer.from("{}"); };
  gate.runDatabaseOperation({ environment: env, now: current, execute, args, write: false });
  assert.equal(called, 1);
  for (const remaining of [-1, 29999]) {
    assert.throws(() => gate.runDatabaseOperation({ environment: { ...env, TEMPORARY_DATABASE_EXPIRES_AT: String(current + remaining) }, now: current, execute, args, write: false }));
  }
  assert.equal(called, 1);
  assert.throws(() => gate.runDatabaseOperation({ environment: { ...env, TEMPORARY_DATABASE_EXPIRES_AT: String(current + 209999) }, now: current, execute, args, write: true }));
  assert.equal(called, 1, "bounded write requires timeout plus safety margin before executing");
  gate.runDatabaseOperation({ environment: env, now: current, execute, args, write: true });
  assert.equal(called, 2);
  assert.throws(() => gate.runDatabaseOperation({ environment: { ...env, MIGRATION_DATABASE_URL: env.MIGRATION_DATABASE_URL.replace("verify-full", "require") }, now: current, execute, args, write: false }));
  assert.equal(called, 2);
});

test("complete release requires reviewed main, receipt and each distinct write confirmation", () => {
  assert.doesNotThrow(() => gate.verifyCompleteReleaseAuthorization(environment, receiptSha256));
  for (const [key, value] of Object.entries({
    GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/heads/feature", GITHUB_REPOSITORY: "other/repo",
    GITHUB_SHA: "c".repeat(40), CHECKOUT_SHA: "c".repeat(40), CONFIGURED_REVIEWED_SHA: "c".repeat(40),
    CONFIGURED_RECEIPT_SHA256: "c".repeat(64), REVIEWED_RECEIPT_SHA256: "c".repeat(64),
    GITHUB_RUN_ATTEMPT: "2", GITHUB_RUN_ID: "", PROJECT_REF: "other-project",
    REPAIR_CONFIRMATION: "", ENRICHMENT_CONFIRMATION: "", CANDIDATE_CONFIRMATION: "",
  })) assert.throws(() => gate.verifyCompleteReleaseAuthorization({ ...environment, [key]: value }, receiptSha256), key);
  assert.throws(() => gate.verifyCompleteReleaseAuthorization(environment, "c".repeat(64)));
  assert.throws(() => gate.verifyCompleteReleaseAuthorization({ ...environment, PGHOST: "different" }, receiptSha256));
});

test("phase order cannot skip prerequisite verification or replay uncertain writes", () => {
  assert.doesNotThrow(() => gate.assertPhaseTransition(pending(), "qualification"));
  assert.doesNotThrow(() => gate.assertPhaseTransition({ ...pending(), qualification: "verified" }, "enrichment"));
  assert.doesNotThrow(() => gate.assertPhaseTransition({ qualification: "verified", enrichment: "verified", candidate: "pending" }, "candidate"));
  for (const phase of ["enrichment", "candidate", "unknown"]) assert.throws(() => gate.assertPhaseTransition(pending(), phase));
  for (const state of [
    { ...pending(), qualification: "started" },
    { ...pending(), qualification: "verified" },
    { ...pending(), enrichment: "verified" },
    { ...pending(), candidate: "started" },
    { ...pending(), qualification: "failed" },
    { ...pending(), extra: "pending" },
    {}, null,
  ]) assert.throws(() => gate.assertPhaseTransition(state, "qualification"));
  assert.throws(() => gate.assertPhaseTransition({ qualification: "verified", enrichment: "started", candidate: "pending" }, "candidate"));
  assert.throws(() => gate.assertPhaseTransition({ qualification: "verified", enrichment: "verified", candidate: "started" }, "candidate"));
  assert.throws(() => gate.assertPhaseTransition({ qualification: "verified", enrichment: "verified", candidate: "verified" }, "candidate"));
});

test("release executor durably marks started before write and verifies before advancing", () => {
  const state = pending(), events = [];
  gate.executeReleasePhase({ state, phase: "qualification",
    persist: current => events.push(["persist", structuredClone(current)]),
    write: () => { assert.equal(state.qualification, "started"); events.push(["write"]); },
    verify: () => { assert.equal(state.qualification, "started"); events.push(["verify"]); },
  });
  assert.deepEqual(events.map(event => event[0]), ["persist", "write", "verify", "persist"]);
  assert.equal(events[0][1].qualification, "started");
  assert.equal(events[3][1].qualification, "verified");
  assert.equal(state.qualification, "verified");
});

test("prerequisite stage permits only the exact receipt-bound candidate deferral", async t => {
  const base = fs.mkdtempSync(path.join(path.dirname(root), ".complete-release-test-"));
  t.after(() => {
    assert.equal(path.dirname(base), path.dirname(root));
    assert.ok(path.basename(base).startsWith(".complete-release-test-"));
    fs.rmSync(base, { recursive: true, force: true });
  });
  const staged = path.join(base, "stage");
  const proof = await stagePrerequisiteWorkdir(root, staged);
  assert.equal(verifyProductionWorkdir(root, staged, proof).verified, true);
  for (const change of [
    { prerequisiteOnly: false }, { prerequisiteOnly: undefined },
    { additiveReceiptSha256: "0".repeat(64) },
    { deferredCandidateMigrations: proof.deferredCandidateMigrations.slice(1) },
    { deferredCandidateMigrations: [...proof.deferredCandidateMigrations].reverse() },
    { deferredCandidateMigrations: proof.deferredCandidateMigrations.map((item, index) => index ? item : { ...item, sha256: "0".repeat(64) }) },
  ]) assert.throws(() => verifyProductionWorkdir(root, staged, { ...proof, ...change }));
  fs.appendFileSync(path.join(staged, "supabase/config.toml"), "\n# changed after review\n");
  assert.throws(() => verifyProductionWorkdir(root, staged, proof));
});

test("failed write and failed read-back retain uncertain state and prohibit the next write", () => {
  for (const failureAt of ["write", "verify"]) {
    const state = pending(), snapshots = [], calls = [];
    let recoveryRecorded = false;
    assert.throws(() => gate.executeReleasePhase({ state, phase: "qualification",
      persist: current => snapshots.push(structuredClone(current)),
      write: () => { calls.push("write"); if (failureAt === "write") throw Error("synthetic_write_failure"); },
      verify: () => { calls.push("verify"); if (failureAt === "verify") throw Error("synthetic_readback_failure"); },
      recovery: () => { recoveryRecorded = true; assert.equal(state.qualification, "started"); },
    }));
    assert.equal(state.qualification, "started");
    assert.equal(recoveryRecorded, true);
    assert.ok(snapshots.every(snapshot => snapshot.qualification === "started"));
    assert.deepEqual(calls, ["write", "verify"], "uncertain write gets read-only reconciliation even after write subprocess fails");
    for (const phase of ["qualification", "enrichment", "candidate"]) {
      assert.throws(() => gate.executeReleasePhase({ state, phase, persist: () => assert.fail("must not persist"), write: () => assert.fail("must not write"), verify: () => assert.fail("must not verify") }));
    }
  }
});

test("real CLI rejects unknown command without hanging or printing raw environment secrets", () => {
  const sentinel = "synthetic-private-marker-do-not-echo";
  const result = spawnSync(process.execPath, [path.join(root, "scripts/prospect-enrichment/complete-release-gate.mjs"), "invalid-command"], {
    cwd: root, encoding: "utf8", timeout: 15000, env: { ...process.env, ...environment, MIGRATION_ACCESS_TOKEN: sentinel },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr + result.stdout, new RegExp(sentinel));
  assert.match(result.stderr.trim(), /^[a-z0-9_]+$/);
});

test("workflow retains two protected sequential jobs and shared production writer concurrency", () => {
  const workflow = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/prospect-enrichment-complete-release.yml"), "utf8"));
  assert.deepEqual(Object.keys(workflow.jobs).sort(), ["preflight", "release"]);
  const { preflight, release } = workflow.jobs;
  for (const job of [preflight, release]) {
    assert.equal(typeof job.environment === "string" ? job.environment : job.environment.name, "Production prospect migrations");
  }
  assert.match(preflight.if, /workflow_dispatch/);
  assert.match(preflight.if, /refs\/heads\/main/);
  assert.match(preflight.if, /adrianosortudo-source\/caseload-select/);
  assert.doesNotMatch(release.if ?? "", /always\(\)|failure\(\)/, "release must depend on successful preflight");
  assert.deepEqual([release.needs].flat(), ["preflight"]);
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  for (const filename of ["prospect-enrichment-migration-gate.yml", "prospect-candidate-additive-release.yml"]) {
    const old = yaml.load(fs.readFileSync(path.join(root, ".github/workflows", filename), "utf8"));
    assert.equal(old.concurrency.group, workflow.concurrency.group, filename);
  }
  const downloads = release.steps.filter(step => step.uses?.startsWith("actions/download-artifact@"));
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].with?.["run-id"], undefined, "cross-run artifact downloads are prohibited");
  assert.equal(downloads[0].with?.["github-token"], undefined);
  assert.equal(downloads[0].with?.["artifact-ids"], "${{ needs.preflight.outputs.artifact_id }}");
  assert.ok(release.steps.some(step => step.uses?.startsWith("actions/upload-artifact@") && /always\(\)/.test(step.if)), "failure receipts must upload");
  const preflightCredentials = preflight.steps.filter(step => /temporary-credential\.mjs/.test(step.run ?? ""));
  assert.equal(preflightCredentials.length, 1);
  assert.equal(preflightCredentials[0].env.COMPLETE_PHASE, "preflight");
  const releaseSequence = release.steps.flatMap(step => {
    if (/temporary-credential\.mjs/.test(step.run ?? "")) return ["credential:" + step.env.COMPLETE_PHASE];
    const phase = /complete-release-gate\.mjs (qualification|enrichment|candidate) /.exec(step.run ?? "");
    return phase ? ["phase:" + phase[1]] : [];
  });
  assert.deepEqual(releaseSequence, ["credential:qualification", "phase:qualification", "credential:enrichment", "phase:enrichment", "credential:candidate", "phase:candidate"]);
  const prepareIndex = release.steps.findIndex(step => /complete-release-gate\.mjs prepare-release/.test(step.run ?? ""));
  const firstCredentialIndex = release.steps.findIndex(step => /temporary-credential\.mjs/.test(step.run ?? ""));
  assert.ok(prepareIndex >= 0 && prepareIndex < firstCredentialIndex, "reviewed evidence must verify before acquiring a write credential");
  for (const job of [preflight, release]) for (const step of job.steps) {
    if (!/temporary-credential\.mjs/.test(step.run ?? "")) assert.equal(step.env?.MIGRATION_ACCESS_TOKEN, undefined);
    if (step.uses?.startsWith("actions/upload-artifact@")) assert.doesNotMatch(step.with.path, /GITHUB_ENV|raw-|credential|\.env/);
  }
});
