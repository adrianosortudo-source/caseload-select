import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { compileCandidate } from "../compiler";
import { candidate, snapshot } from "../fixtures/synthetic";
import { buildExpectedRunManifest, buildHeldCandidateEvidence, chunkExpectedRunManifest } from "../run-manifest";
import { assertManifestPackage, prepareManifestRequests, recoverCaseyMossHeldEvidenceOnce, submitManifestChunks, validateManifestChunks, CASEY_MOSS_HELD_EVIDENCE_RECOVERY, validateCaseyMossRecoveryAuthorization, type ManifestChunk, type ManifestReceipt } from "../manifest-delivery";
import { enqueue, type ApprovalManifest, type DeliveryApproval } from "../outbox";
import { protocolHash, sha256, within } from "../model";
import { main } from "../cli";
import { serializeSyntheticComparisonExport } from "../fixtures/comparison-signing";
import { wholeFirmRunId, WHOLE_FIRM_PROFILE } from "../profiles";
import { createHash } from "node:crypto";

type RecoveryFixture = {
  originalRequestFileBase64: string;
  originalPriorStateFileBase64: string;
  comparisonRequest: {
    manifest: { entries: unknown[]; manifestSha256: string; expectedPackageCount: number };
    packages: Array<{ envelope: { packageId: string }; payloadSha256: string }>;
  };
  manifestChunks: unknown[];
  heldEvidence: Array<{ entryId: string; evidenceSha256: string; issues: Array<{ reason: string }>; [key: string]: unknown }>;
};
async function workspace(t: { after: (fn: () => Promise<void>) => void }) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".tmp");
  await fs.mkdir(root, { recursive: true });
  const temp = await fs.mkdtemp(path.join(root, "pe-lane3-synthetic-"));
  t.after(async () => { const real = await fs.realpath(temp); assert.ok(within(root, real) && path.basename(real).startsWith("pe-lane3-synthetic-")); await fs.rm(real, { recursive: true, force: true }); });
  return temp;
}

let exactRecoveryFixturePromise: Promise<RecoveryFixture> | null = null;
function exactRecoveryFixture() {
  if (!exactRecoveryFixturePromise) exactRecoveryFixturePromise = (async () => {
    const compressed = await fs.readFile(new URL("../fixtures/casey-moss-held-recovery-source.json.gz", import.meta.url));
    return JSON.parse(gunzipSync(compressed).toString("utf8"));
  })();
  return exactRecoveryFixturePromise;
}
async function recoveryContext(t: { after: (fn: () => Promise<void>) => void }) {
  const source = await exactRecoveryFixture();
  const requestBytes = Buffer.from(source.originalRequestFileBase64, "base64");
  const priorStateBytes = Buffer.from(source.originalPriorStateFileBase64, "base64");
  const outbox = await workspace(t), manifestDir = path.join(outbox, "manifests", CASEY_MOSS_HELD_EVIDENCE_RECOVERY.runManifestSha256);
  await fs.mkdir(manifestDir, { recursive: true });
  await fs.writeFile(path.join(manifestDir, CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestKey + ".request.json"), requestBytes);
  await fs.writeFile(path.join(manifestDir, CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestKey + ".state.json"), priorStateBytes);
  const packages = source.comparisonRequest.packages.map(p => ({ clientPackageId: p.envelope.packageId, payloadSha256: p.payloadSha256 }));
  const approval: DeliveryApproval = {
    schemaVersion: "prospect-whole-firm-delivery-approval/v1", scope: "whole-firm-run",
    targetOrigin: "https://admin.caseloadselect.ca", projectId: "ssxryjxifwiivghglqer",
    approvalReference: "synthetic-offline-recovery-test", runId: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.runId,
    expectedRevisionCount: source.comparisonRequest.manifest.entries.length,
    sourceManifestSha256: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.sourceManifestSha256,
    runManifestSha256: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.runManifestSha256, packages,
  };
  const authorization = {
    schemaVersion: "prospect-held-evidence-recovery-authorization/v1",
    requestKey: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestKey,
    requestBodySha256: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestBodySha256,
    evidenceSha256: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.evidenceSha256,
    sourceManifestSha256: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.sourceManifestSha256,
    runManifestSha256: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.runManifestSha256,
    authorizationReference: "synthetic-explicit-action-time-approval",
  };
  const authorizationBytes = Buffer.from(JSON.stringify(authorization));
  return { source, outbox, requestBytes, priorStateBytes, approval, authorizationBytes, authorizationSha256: sha256(authorizationBytes) };
}
function recoveryOptions(ctx: Awaited<ReturnType<typeof recoveryContext>>, fetcher?: typeof fetch, beforeNetwork?: () => void) {
  return { outbox: ctx.outbox, chunks: ctx.source.manifestChunks, heldEvidence: ctx.source.heldEvidence, approval: ctx.approval,
    authorizationBytes: ctx.authorizationBytes, authorizationSha256: ctx.authorizationSha256, profile: "whole-firm" as const,
    confirmation: "RECOVER-CASEY-MOSS-HELD-EVIDENCE-ONCE", token: "synthetic-transport-only",
    now: "2026-10-10T15:30:00.000Z", fetcher, beforeNetwork };
}
function heldReceipt() {
  return { outcome: "held_evidence_recorded", runId: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.runId,
    entryId: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.entryId, evidenceSha256: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.evidenceSha256 };
}

function fixture() {
  const results = [0, 1].map(i => compileCandidate(candidate({ workKey: "synthetic-manifest-" + i, firmName: "Synthetic", status: "held" }), snapshot));
  const source = { schemaVersion: "prospect-backfill-manifest/v1" as const, ...snapshot, roots: [], artifacts: [], issues: [] };
  const coverage = results.map(r => ({ researchKey: r.researchKey, sourceRoot: "root-a", relativePath: "synthetic.json", sourcePointer: "", sourceSha256: "b".repeat(64), packageIds: r.packages.map(p => p.envelope.packageId), issues: [] }));
  const expected = buildExpectedRunManifest(source, results.flatMap(r => r.packages), coverage, []);
  const chunks = validateManifestChunks(chunkExpectedRunManifest(expected, 1));
  const approval: ApprovalManifest = { schemaVersion: "prospect-enrichment-delivery-approval/v1", scope: "pilot", targetOrigin: "https://admin.caseloadselect.ca", projectId: "ssxryjxifwiivghglqer", sourceManifestSha256: snapshot.manifestSha256, runManifestSha256: expected.manifestSha256, approvalReference: "synthetic-test-only", packages: results.flatMap(r => r.packages).map(p => ({ clientPackageId: p.envelope.packageId, payloadSha256: p.payloadSha256 })) };
  return { chunks, approval, packages: results.flatMap(r => r.packages) };
}
function receipt(chunk: ManifestChunk, finalize: boolean): ManifestReceipt {
  const count = finalize ? chunk.chunkCount : chunk.chunkIndex + 1;
  return { outcome: finalize ? "finalized" : "chunk_registered", runId: chunk.runId, runKey: chunk.runId, sourceManifestSha256: chunk.sourceManifestSha256, manifestSha256: chunk.runManifestSha256, registeredChunkCount: count, expectedChunkCount: chunk.chunkCount, receivedEntryCount: count, expectedEntryCount: chunk.expectedEntryCount, receivedPackageCount: count, expectedPackageCount: chunk.expectedPackageCount, manifestState: finalize ? "finalized" : "open" };
}

test("single-request recovery authorization is exact to the frozen request hashes and rejects missing or changed scope", () => {
  const authorization = {
    schemaVersion: "prospect-held-evidence-recovery-authorization/v1",
    requestKey: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestKey,
    requestBodySha256: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestBodySha256,
    evidenceSha256: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.evidenceSha256,
    sourceManifestSha256: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.sourceManifestSha256,
    runManifestSha256: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.runManifestSha256,
    authorizationReference: "synthetic-explicit-action-time-approval",
  };
  const bytes = Buffer.from(JSON.stringify(authorization));
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.deepEqual(validateCaseyMossRecoveryAuthorization(bytes, digest), authorization);
  for (const changed of [
    { ...authorization, requestBodySha256: "0".repeat(64) },
    { ...authorization, evidenceSha256: "0".repeat(64) },
    { ...authorization, authorizationReference: "" },
    { ...authorization, secondAttempt: true },
  ]) { const changedBytes = Buffer.from(JSON.stringify(changed)); assert.throws(() => validateCaseyMossRecoveryAuthorization(changedBytes, createHash("sha256").update(changedBytes).digest("hex")), /held_evidence_recovery_authorization_invalid/); }
  const missing = Object.fromEntries(Object.entries(authorization).filter(([key]) => key !== "authorizationReference"));
  const missingBytes = Buffer.from(JSON.stringify(missing));
  assert.throws(() => validateCaseyMossRecoveryAuthorization(missingBytes, createHash("sha256").update(missingBytes).digest("hex")), /held_evidence_recovery_authorization_invalid/);
  assert.throws(() => validateCaseyMossRecoveryAuthorization(bytes, "0".repeat(64)), /held_evidence_recovery_authorization_hash_mismatch/);
});

test("Casey request, evidence and open-run comparison pins derive from the unchanged original artifacts", async () => {
  const source = await exactRecoveryFixture();
  const requestBytes = Buffer.from(source.originalRequestFileBase64, "base64");
  const request = JSON.parse(requestBytes.toString("utf8"));
  const evidence = JSON.parse(request.body).evidence;
  const core = { schemaVersion: evidence.schemaVersion, entryId: evidence.entryId, researchKey: evidence.researchKey,
    source: evidence.source, originalJson: evidence.originalJson, issues: evidence.issues };
  const stateBytes = Buffer.from(source.originalPriorStateFileBase64, "base64"), pin = CASEY_MOSS_HELD_EVIDENCE_RECOVERY;
  assert.equal(sha256(requestBytes), pin.requestFileSha256);
  assert.equal(request.requestKey, pin.requestKey);
  assert.equal(sha256(request.body), pin.requestBodySha256);
  assert.equal(protocolHash(core), pin.evidenceSha256);
  assert.equal(evidence.entryId, pin.entryId); assert.equal(evidence.runId, pin.runId);
  assert.equal(sha256(stateBytes), pin.priorStateSha256);
  assert.equal(protocolHash(source.comparisonRequest), pin.comparisonRequestSha256);
  assert.equal(source.comparisonRequest.manifest.manifestSha256, pin.runManifestSha256);
  assert.equal(source.comparisonRequest.manifest.expectedPackageCount, pin.expectedPackageCount);
  assert.equal(source.comparisonRequest.packages.length, pin.expectedPackageCount);
  assert.equal(wholeFirmRunId(pin.sourceManifestSha256), pin.runId);
  const storedEvidence = source.heldEvidence.find(item => item.entryId === pin.entryId);
  assert.ok(storedEvidence); assert.equal(storedEvidence.evidenceSha256, pin.evidenceSha256);
  const runbookPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/runbooks/prospect-projection-repair-single-request-recovery.md");
  const runbook = await fs.readFile(runbookPath, "utf8");
  for (const hash of [pin.evidenceSha256, pin.requestFileSha256, pin.priorStateSha256, pin.comparisonRequestSha256]) assert.ok(runbook.includes(hash));
});
test("the open-run recovery CLI accepts the exact resume comparison without a package key", async t => {
  const source = await exactRecoveryFixture(), root = await workspace(t);
  const chunksPath = path.join(root, "chunks.jsonl"), heldPath = path.join(root, "held.jsonl"), packagesPath = path.join(root, "packages.json"), snapshotPath = path.join(root, "resume-snapshot.json");
  await fs.writeFile(chunksPath, source.manifestChunks.map((item: unknown) => JSON.stringify(item)).join("\n") + "\n");
  await fs.writeFile(heldPath, source.heldEvidence.map((item: unknown) => JSON.stringify(item)).join("\n") + "\n");
  await fs.writeFile(packagesPath, JSON.stringify(source.comparisonRequest.packages));
  const capturedAt = new Date().toISOString();
  const snapshot = serializeSyntheticComparisonExport({ schemaVersion: "prospect-enrichment-comparison/v1", projectId: "ssxryjxifwiivghglqer",
    capturedAt, provenance: { reader: "admin-prospect-enrichment-bootstrap-resume/v1", sourceArtifactSha256: protocolHash(source.comparisonRequest), operatorAuthenticated: true },
    identities: [], packages: [], events: [] }, capturedAt).snapshot;
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot));
  const outbox = path.join(WHOLE_FIRM_PROFILE.outputRoot, "runs", "casey-moss-recovery-dry-run");
  const args = ["recover-held-evidence", "--profile", "whole-firm", "--outbox", outbox,
    "--manifest-chunks", chunksPath, "--held-evidence", heldPath, "--packages", packagesPath, "--snapshot", snapshotPath];
  const result = await main(args) as Record<string, unknown>;
  assert.equal(result.dryRun, true); assert.equal(result.command, "recover-held-evidence");
  assert.equal(result.key, null); assert.equal(result.networkRequests, 0);
  await assert.rejects(main([...args, "--key", "unused"]), /held_evidence_recovery_cli_scope_invalid/);
});
test("one-use recovery preserves exact prior state, records 5 to 6, sends unchanged bytes, and denies repeat", async t => {
  const ctx = await recoveryContext(t), statePath = path.join(ctx.outbox, "manifests", CASEY_MOSS_HELD_EVIDENCE_RECOVERY.runManifestSha256, CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestKey + ".state.json");
  let calls = 0, sentBody = "";
  const fetcher = (async (_url, init) => { calls++; sentBody = String(init?.body); return new Response(JSON.stringify(heldReceipt()), { status: 201 }); }) as typeof fetch;
  const result = await recoverCaseyMossHeldEvidenceOnce(recoveryOptions(ctx, fetcher));
  assert.equal(result.outcome, "attempted"); assert.equal(result.networkRequests, 1); assert.equal(result.attempts, 6);
  assert.equal(result.state, "received"); assert.equal(calls, 1);
  const request = JSON.parse(ctx.requestBytes.toString("utf8")); assert.equal(sentBody, request.body);
  const state = JSON.parse(await fs.readFile(statePath, "utf8")); assert.equal(state.attempts, 6); assert.equal(state.state, "received");
  const audit = (await fs.readFile(path.join(ctx.outbox, "recovery-audit.jsonl"), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(audit[0].event, "held_evidence_recovery_started"); assert.equal(audit[0].previousState.attempts, 5);
  assert.equal(audit[0].previousState.state, "retry_exhausted"); assert.equal(audit[0].previousStateSha256, CASEY_MOSS_HELD_EVIDENCE_RECOVERY.priorStateSha256);
  assert.equal(audit[0].attemptNumber, 6);
  await assert.rejects(recoverCaseyMossHeldEvidenceOnce(recoveryOptions(ctx, fetcher)), /saved_state_hash_mismatch/); assert.equal(calls, 1);
});
test("concurrent exact recovery is denied by the existing submission lock", async t => {
  const ctx = await recoveryContext(t); let signalStarted!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { signalStarted = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
  const fetcher = (async () => { signalStarted(); await wait; return new Response(JSON.stringify(heldReceipt()), { status: 201 }); }) as typeof fetch;
  const first = recoverCaseyMossHeldEvidenceOnce(recoveryOptions(ctx, fetcher)); await started;
  const secondFetch = (async () => { throw Error("must not send"); }) as typeof fetch;
  await assert.rejects(recoverCaseyMossHeldEvidenceOnce(recoveryOptions(ctx, secondFetch)), /outbox_submission_locked/);
  release(); assert.equal((await first).state, "received");
});
test("saved request, held evidence and prior state drift fail closed before network", async t => {
  await t.test("request file bytes", async t => { const ctx = await recoveryContext(t), dir = path.join(ctx.outbox, "manifests", CASEY_MOSS_HELD_EVIDENCE_RECOVERY.runManifestSha256); let calls = 0;
    await fs.appendFile(path.join(dir, CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestKey + ".request.json"), " ");
    const noSend = (async () => { calls++; throw Error("must not send"); }) as typeof fetch;
    await assert.rejects(recoverCaseyMossHeldEvidenceOnce(recoveryOptions(ctx, noSend)), /saved_request_hash_mismatch/); assert.equal(calls, 0); });
  await t.test("prior retry state bytes", async t => { const ctx = await recoveryContext(t), dir = path.join(ctx.outbox, "manifests", CASEY_MOSS_HELD_EVIDENCE_RECOVERY.runManifestSha256); let calls = 0;
    await fs.writeFile(path.join(dir, CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestKey + ".state.json"), JSON.stringify({ ...JSON.parse(ctx.priorStateBytes.toString("utf8")), attempts: 4 }));
    const noSend = (async () => { calls++; throw Error("must not send"); }) as typeof fetch;
    await assert.rejects(recoverCaseyMossHeldEvidenceOnce(recoveryOptions(ctx, noSend)), /saved_state_hash_mismatch/); assert.equal(calls, 0); });
  await t.test("held evidence", async t => { const ctx = await recoveryContext(t), changed = structuredClone(ctx.source.heldEvidence), entry = changed.find(item => item.entryId === CASEY_MOSS_HELD_EVIDENCE_RECOVERY.entryId); assert.ok(entry); entry.issues[0].reason += " tampered"; let calls = 0;
    const noSend = (async () => { calls++; throw Error("must not send"); }) as typeof fetch;
    await assert.rejects(recoverCaseyMossHeldEvidenceOnce({ ...recoveryOptions(ctx, noSend), heldEvidence: changed }), /held_evidence_manifest_mismatch/); assert.equal(calls, 0); });
});
test("recovery retains terminal outcomes for 503, timeout and bad receipt without retry", async t => {
  for (const kind of ["503", "timeout", "bad-receipt"] as const) await t.test(kind, async t => {
    const ctx = await recoveryContext(t);
    const fetcher = (async () => { if (kind === "timeout") throw Error("synthetic timeout"); if (kind === "503") return new Response("unavailable", { status: 503 }); const bad = { ...heldReceipt(), evidenceSha256: "0".repeat(64) }; return new Response(JSON.stringify(bad), { status: 201 }); }) as typeof fetch;
    const result = await recoverCaseyMossHeldEvidenceOnce(recoveryOptions(ctx, fetcher));
    const dir = path.join(ctx.outbox, "manifests", CASEY_MOSS_HELD_EVIDENCE_RECOVERY.runManifestSha256), state = JSON.parse(await fs.readFile(path.join(dir, CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestKey + ".state.json"), "utf8"));
    assert.equal(result.networkRequests, 1); assert.equal(result.attempts, 6); assert.equal(state.attempts, 6); assert.equal(state.nextAttemptAt, null);
    if (kind === "503") { assert.equal(state.state, "retry_exhausted"); assert.equal(state.lastStatus, 503); assert.equal(state.lastError, "http_503"); }
    if (kind === "timeout") { assert.equal(state.state, "retry_exhausted"); assert.equal(state.lastStatus, null); assert.equal(state.lastError, "network_or_timeout"); }
    if (kind === "bad-receipt") { assert.equal(state.state, "manual_review"); assert.equal(state.lastStatus, 201); assert.equal(state.lastError, "manifest_receipt_mismatch"); }
  });
});
test("second comparison expiry returns not-sent without spending an attempt or marker", async t => {
  const ctx = await recoveryContext(t); let checks = 0, calls = 0;
  const noSend = (async () => { calls++; throw Error("must not send"); }) as typeof fetch;
  const result = await recoverCaseyMossHeldEvidenceOnce(recoveryOptions(ctx, noSend, () => { checks++; if (checks === 2) throw Error("comparison_stale"); }));
  assert.equal(checks, 2); assert.equal(calls, 0); assert.equal(result.outcome, "not_sent");
  assert.equal(result.networkRequests, 0); assert.equal(result.attempts, 5); assert.equal(result.state, "retry_exhausted");
  const dir = path.join(ctx.outbox, "manifests", CASEY_MOSS_HELD_EVIDENCE_RECOVERY.runManifestSha256), state = await fs.readFile(path.join(dir, CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestKey + ".state.json"));
  assert.equal(sha256(state), CASEY_MOSS_HELD_EVIDENCE_RECOVERY.priorStateSha256);
  const recoveryDir = path.join(ctx.outbox, "recovery-authorizations");
  await assert.rejects(fs.access(path.join(recoveryDir, CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestKey + ".attempt.json")));
  await assert.rejects(fs.access(path.join(recoveryDir, CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestKey + ".json")));
  const audit = JSON.parse((await fs.readFile(path.join(ctx.outbox, "recovery-audit.jsonl"), "utf8")).trim());
  assert.equal(audit.event, "held_evidence_recovery_not_sent"); assert.equal(audit.networkRequests, 0);
});

test("expiry during durable recovery writes restores the exact unused state before fetch", async t => {
  const ctx = await recoveryContext(t); let checks = 0, calls = 0, expiredDuringWrite = false;
  const noSend = (async () => { calls++; throw Error("must not send"); }) as typeof fetch;
  const result = await recoverCaseyMossHeldEvidenceOnce(recoveryOptions(ctx, noSend, () => {
    checks++;
    if (checks === 2) setImmediate(() => { expiredDuringWrite = true; });
    if (checks === 3 && expiredDuringWrite) throw Error("comparison_stale");
  }));
  assert.equal(expiredDuringWrite, true); assert.equal(checks, 3); assert.equal(calls, 0);
  assert.equal(result.outcome, "not_sent"); assert.equal(result.networkRequests, 0);
  assert.equal(result.attempts, 5); assert.equal(result.state, "retry_exhausted");
  const recoveryDir = path.join(ctx.outbox, "recovery-authorizations");
  const statePath = path.join(ctx.outbox, "manifests", CASEY_MOSS_HELD_EVIDENCE_RECOVERY.runManifestSha256, CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestKey + ".state.json");
  assert.equal(sha256(await fs.readFile(statePath)), CASEY_MOSS_HELD_EVIDENCE_RECOVERY.priorStateSha256);
  await assert.rejects(fs.access(path.join(recoveryDir, CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestKey + ".attempt.json")));
  await fs.access(path.join(recoveryDir, CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestKey + ".json"));
  const audit = (await fs.readFile(path.join(ctx.outbox, "recovery-audit.jsonl"), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(audit.at(-1).event, "held_evidence_recovery_not_sent");
  assert.equal(audit.at(-1).reason, "fresh_comparison_revalidation_failed_after_durable_write");
  assert.equal(audit.at(-1).networkRequests, 0);
});
test("manifest registration prepares a stable run key and exact final replay without network access", () => {
  const { chunks } = fixture(), a = prepareManifestRequests(chunks), b = prepareManifestRequests(JSON.parse(JSON.stringify(chunks)));
  assert.deepEqual(a.requests, b.requests);
  assert.equal(a.requests.length, 3);
  const bodies = a.requests.map(r => JSON.parse(r.body));
  assert.deepEqual(bodies.map(b => b.finalize), [false, false, true]);
  assert.deepEqual(bodies[1].chunk, bodies[2].chunk);
  assert.notEqual(a.requests[1].requestKey, a.requests[2].requestKey);
  assert.ok(a.requests.every(r => /^pe-manifest-v1-[a-f0-9]{64}$/.test(r.requestKey)));
  assert.throws(() => prepareManifestRequests(chunks.slice(1)), /sequence_mismatch/);
  const mutated = structuredClone(chunks); mutated[0].entries[0].errorCodes.push("altered");
  assert.throws(() => prepareManifestRequests(mutated), /chunk_invalid/);
  mutated[0].chunkSha256 = protocolHash(mutated[0].entries);
  assert.throws(() => prepareManifestRequests(mutated), /full_hash_mismatch/);
});
test("candidate-specific source holds retain original evidence and are durably registered before finalization", () => {
  const base = fixture();
  const held = {
    researchKey: "synthetic-held-candidate", sourceRoot: "root-a", relativePath: "held.json", sourcePointer: "/firms/2",
    sourceSha256: "c".repeat(64), packageIds: [], original: { firmName: "Held Synthetic Firm", status: "held", evidence: ["source finding"] },
    issues: [{ code: "identity_unresolved", path: "/firmId", reason: "No safe canonical firm identity was established." }],
  };
  const source = { schemaVersion: "prospect-backfill-manifest/v1" as const, ...snapshot, roots: [], artifacts: [], issues: [] };
  const expected = buildExpectedRunManifest(source, base.packages, [
    { researchKey: base.packages[0].envelope.subject.researchKey, sourceRoot: "root-a", relativePath: "synthetic.json", sourcePointer: "", sourceSha256: "b".repeat(64), packageIds: [base.packages[0].envelope.packageId], issues: [] },
    { researchKey: base.packages[1].envelope.subject.researchKey, sourceRoot: "root-a", relativePath: "synthetic.json", sourcePointer: "", sourceSha256: "b".repeat(64), packageIds: [base.packages[1].envelope.packageId], issues: [] },
    held,
  ], []);
  const evidence = buildHeldCandidateEvidence(expected, [held]);
  assert.equal(evidence.length, 1);
  assert.deepEqual(JSON.parse(evidence[0].originalJson), held.original);
  assert.deepEqual(evidence[0].issues, held.issues);
  const chunks = chunkExpectedRunManifest(expected, 1);
  const prepared = prepareManifestRequests(chunks, "legacy-backfill", evidence);
  assert.deepEqual(prepared.requests.map(request => request.endpoint), ["manifest-chunks", "manifest-chunks", "manifest-chunks", "held-evidence", "manifest-chunks"]);
  assert.equal(JSON.parse(prepared.requests.at(-1)!.body).finalize, true);
  assert.throws(() => prepareManifestRequests(chunks, "legacy-backfill", []), /held_evidence_coverage_mismatch/);
  const changed = structuredClone(evidence); changed[0].issues[0].reason = "modified after approval";
  assert.throws(() => prepareManifestRequests(chunks, "legacy-backfill", changed), /held_evidence_manifest_mismatch/);
});
test("manifest registration verifies all receipts then reuses saved finalized receipt without another request", async t => {
  const outbox = await workspace(t), { chunks, approval } = fixture(), sent: { chunk: ManifestChunk; finalize: boolean }[] = [];
  const fetcher = (async (url, init) => {
    assert.equal(url, "https://admin.caseloadselect.ca/api/internal/prospect-enrichment/runs/manifest-chunks");
    assert.equal(init?.redirect, "error");
    const body = JSON.parse(String(init?.body)); sent.push(body);
    return new Response(JSON.stringify(receipt(body.chunk, body.finalize)), { status: 200 });
  }) as typeof fetch;
  const options = { outbox, chunks, approval, confirmation: "SUBMIT-APPROVED-PROSPECT-RESEARCH", token: "synthetic-transport-only", now: snapshot.snapshotAt, fetcher };
  const result = await submitManifestChunks(options);
  assert.equal(result.state, "finalized"); assert.equal(result.completedRequests, 3);
  assert.deepEqual(sent.map(s => [s.chunk.chunkIndex, s.finalize]), [[0, false], [1, false], [1, true]]);
  assert.equal((await submitManifestChunks(options)).state, "finalized");
  assert.equal(sent.length, 3);
});
test("manifest timeout retries identical bytes and stops before later chunks until its retry is due", async t => {
  const outbox = await workspace(t), { chunks, approval } = fixture(), bodies: string[] = [];
  const fetcher = (async (_url, init) => {
    bodies.push(String(init?.body)); if (bodies.length === 1) throw Error("synthetic timeout");
    const body = JSON.parse(String(init?.body)); return new Response(JSON.stringify(receipt(body.chunk, body.finalize)), { status: 200 });
  }) as typeof fetch;
  const options = { outbox, chunks, approval, confirmation: "SUBMIT-APPROVED-PROSPECT-RESEARCH", token: "synthetic-transport-only", fetcher };
  assert.equal((await submitManifestChunks({ ...options, now: snapshot.snapshotAt })).state, "retry_pending");
  assert.equal((await submitManifestChunks({ ...options, now: "2026-09-23T12:00:04.000Z" })).state, "retry_pending");
  assert.equal(bodies.length, 1);
  assert.equal((await submitManifestChunks({ ...options, now: "2026-09-23T12:00:05.000Z" })).state, "finalized");
  assert.equal(bodies[0], bodies[1]); assert.equal(bodies.length, 4);
});
test("manifest approvals and final counts fail closed, preserving manual review", async t => {
  const outbox = await workspace(t), { chunks, approval } = fixture(); let calls = 0;
  const fetcher = (async (_url, init) => {
    calls++; const body = JSON.parse(String(init?.body)), result = receipt(body.chunk, body.finalize);
    if (body.finalize) result.receivedPackageCount = 0;
    return new Response(JSON.stringify(result), { status: 200 });
  }) as typeof fetch;
  const options = { outbox, chunks, approval, confirmation: "SUBMIT-APPROVED-PROSPECT-RESEARCH", token: "synthetic-transport-only", now: snapshot.snapshotAt, fetcher };
  await assert.rejects(submitManifestChunks({ ...options, approval: { ...approval, runManifestSha256: "0".repeat(64) } }), /exact_approval_scope/);
  assert.equal(calls, 0);
  const result = await submitManifestChunks(options);
  assert.equal(result.state, "manual_review"); assert.equal(result.completedRequests, 2);
  assert.equal((await submitManifestChunks(options)).state, "manual_review"); assert.equal(calls, 3);
});
test("package must match final manifest identity, content hash and complete client item inventory", async t => {
  const outbox = await workspace(t), { chunks, packages } = fixture();
  const entry = (await enqueue(outbox, packages[0].envelope, snapshot.snapshotAt)).entry;
  assert.doesNotThrow(() => assertManifestPackage(chunks, entry));
  assert.throws(() => assertManifestPackage(chunks, { ...entry, payloadSha256: "0".repeat(64) }), /frozen_manifest/);
  const bad = structuredClone(chunks); bad.flatMap(c => c.entries).find(e => e.clientPackageId === entry.envelope.packageId)!.clientItems[0].clientItemId = "changed";
  assert.throws(() => assertManifestPackage(bad, entry), /frozen_manifest/);
});

test("freshness is checked at the network boundary without consuming a retry or sending stale research", async t => {
  const outbox = await workspace(t), { chunks, approval } = fixture(); let calls = 0;
  const options = { outbox, chunks, approval, confirmation: "SUBMIT-APPROVED-PROSPECT-RESEARCH", token: "synthetic-transport-only", now: snapshot.snapshotAt, fetcher: (async () => { calls++; throw Error("must never run"); }) as typeof fetch, beforeNetwork: () => { throw Error("comparison_stale"); } };
  await assert.rejects(submitManifestChunks(options), /comparison_stale/);
  assert.equal(calls, 0);
  const prepared = prepareManifestRequests(chunks);
  const stateFile = path.join(outbox, "manifests", chunks[0].runManifestSha256, prepared.requests[0].requestKey + ".state.json");
  assert.equal(JSON.parse(await fs.readFile(stateFile, "utf8")).attempts, 0);
});
