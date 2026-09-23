import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileCandidate } from "../compiler";
import { candidate, snapshot } from "../fixtures/synthetic";
import { buildExpectedRunManifest, chunkExpectedRunManifest } from "../run-manifest";
import { assertManifestPackage, prepareManifestRequests, submitManifestChunks, validateManifestChunks, type ManifestChunk, type ManifestReceipt } from "../manifest-delivery";
import { enqueue, type ApprovalManifest } from "../outbox";
import { protocolHash, within } from "../model";

async function workspace(t: { after: (fn: () => Promise<void>) => void }) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".tmp");
  await fs.mkdir(root, { recursive: true });
  const temp = await fs.mkdtemp(path.join(root, "pe-lane3-synthetic-"));
  t.after(async () => { const real = await fs.realpath(temp); assert.ok(within(root, real) && path.basename(real).startsWith("pe-lane3-synthetic-")); await fs.rm(real, { recursive: true, force: true }); });
  return temp;
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
