import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../cli";
import { runWholeFirmOfflineHandoff } from "../offline-handoff";
import { coordinatorFixture } from "../fixtures/coordinator";
import { canonicalJson, protocolHash, sha256, within } from "../model";
import { snapshotCoordinatorState } from "../whole-firm-coordinator-export";

async function workspace(t: { after: (fn: () => Promise<void>) => void }) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".tmp");
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, "pe-offline-handoff-"));
  t.after(async () => { const real = await fs.realpath(dir); assert.ok(within(root, real) && path.basename(real).startsWith("pe-offline-handoff-")); await fs.rm(real, { recursive: true, force: true }); });
  const sourceRoot = path.join(dir, "source"), statePath = path.join(sourceRoot, "operations/luna_continuous_v1/control/whole_firm_state.json"), outputRoot = path.join(dir, "output");
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(coordinatorFixture(), null, 2) + "\n");
  return { dir, sourceRoot, statePath, outputRoot };
}

test("default handoff snapshots but writes no prepared packages, and exact replay reuses snapshotAt", async t => {
  const w = await workspace(t), firstAt = "2026-10-02T12:00:00.000Z", laterAt = "2026-10-03T12:00:00.000Z";
  const first = await runWholeFirmOfflineHandoff({ ...w, now: () => new Date(firstAt) });
  assert.equal(first.state, "dry-run");
  assert.equal(first.snapshotCreated, true);
  assert.equal(first.snapshotReused, false);
  assert.equal(first.snapshotAt, firstAt);
  assert.equal(first.expectedRevisionCount, first.accountedRevisionCount);
  assert.equal(first.preparedCount, 0);
  assert.equal(first.alreadyPreparedCount, 0);
  assert.equal(first.networkRequests, 0);
  assert.equal(first.submitted, 0);
  assert.equal(first.applied, 0);
  assert.equal(first.visibleVerified, 0);
  await assert.rejects(fs.access(String(first.handoffDir)), { code: "ENOENT" });
  await assert.rejects(fs.access(path.join(String(first.handoffDir), "checkpoint.json")), { code: "ENOENT" });
  assert.equal(sha256(await fs.readFile(w.statePath)), first.sourceSha256);
  const second = await runWholeFirmOfflineHandoff({ ...w, now: () => new Date(laterAt) });
  assert.equal(second.snapshotCreated, false);
  assert.equal(second.snapshotReused, true);
  assert.equal(second.snapshotAtReused, true);
  assert.equal(second.snapshotAt, firstAt);
  assert.equal(second.sourceManifestSha256, first.sourceManifestSha256);
  await assert.rejects(fs.access(path.join(String(second.handoffDir), "checkpoint.json")), { code: "ENOENT" });
});

test("dry-run and execute-offline handoff never call fetch", async t => {
  const w = await workspace(t), originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async (..._args: Parameters<typeof fetch>) => { fetchCalls++; throw Error("offline handoff must not use fetch"); }) as typeof fetch;
  try {
    const dryRun = await runWholeFirmOfflineHandoff({ ...w, now: () => new Date("2026-10-02T14:00:00.000Z") });
    assert.equal(dryRun.state, "dry-run");
    const executed = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now: () => new Date("2026-10-02T14:00:00.000Z") });
    assert.equal(executed.state, "prepared-pending-admin");
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(fetchCalls, 0);
});

test("execute-offline writes complete immutable artifacts and replay only verifies them", async t => {
  const w = await workspace(t), now = () => new Date("2026-10-02T13:00:00.000Z");
  const first = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now });
  assert.equal(first.state, "prepared-pending-admin");
  assert.equal(first.expectedRevisionCount, first.accountedRevisionCount);
  assert.ok(Number(first.preparedCount) > 0);
  assert.equal(first.alreadyPreparedCount, 0);
  assert.equal(first.networkRequests, 0);
  assert.equal(first.submitted, 0);
  assert.equal(first.applied, 0);
  assert.equal(first.visibleVerified, 0);
  const checkpointPath = String(first.checkpointPath), beforeCheckpoint = await fs.readFile(checkpointPath), checkpoint = JSON.parse(beforeCheckpoint.toString("utf8"));
  assert.equal(checkpoint.state, "prepared-pending-admin");
  assert.equal(checkpoint.expectedRevisionCount, checkpoint.accountedRevisionCount);
  for (const entry of checkpoint.files as { path: string; sha256: string }[]) assert.equal(sha256(await fs.readFile(path.join(String(first.handoffDir), entry.path))), entry.sha256);
  const replay = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now: () => new Date("2026-10-04T13:00:00.000Z") });
  assert.equal(replay.state, "prepared-pending-admin");
  assert.equal(replay.snapshotAt, first.snapshotAt);
  assert.equal(replay.preparedCount, 0);
  assert.equal(replay.alreadyPreparedCount, first.preparedCount);
  assert.equal(replay.networkRequests, 0);
  assert.ok((await fs.readFile(checkpointPath)).equals(beforeCheckpoint));
});

test("completed legacy checkpoint without a progress journal replays unchanged", async t => {
  const w = await workspace(t), now = () => new Date("2026-10-02T13:15:00.000Z");
  const first = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now });
  const checkpointPath = String(first.checkpointPath), before = await fs.readFile(checkpointPath);
  await fs.unlink(path.join(String(first.handoffDir), "progress.jsonl"));
  const replay = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now: () => new Date("2026-10-04T13:15:00.000Z") });
  assert.equal(replay.state, "prepared-pending-admin");
  assert.equal(replay.preparedCount, 0);
  assert.equal(replay.alreadyPreparedCount, first.preparedCount);
  assert.ok((await fs.readFile(checkpointPath)).equals(before), "legacy checkpoint bytes stay untouched");
  await assert.rejects(fs.access(path.join(String(first.handoffDir), "progress.jsonl")), { code: "ENOENT" });
});

test("completed checkpoint replay validates and preserves a torn progress journal", async t => {
  const w = await workspace(t), now = () => new Date("2026-10-02T13:20:00.000Z");
  const first = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now });
  const checkpointPath = String(first.checkpointPath), progressPath = path.join(String(first.handoffDir), "progress.jsonl");
  const checkpointBytes = await fs.readFile(checkpointPath);
  await fs.appendFile(progressPath, "{\"interrupted\":");
  const progressBytes = await fs.readFile(progressPath);

  const replay = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now });
  assert.equal(replay.state, "technical-hold");
  assert.equal(replay.technicalHold, "offline_handoff_progress_unterminated_tail");
  assert.ok((await fs.readFile(checkpointPath)).equals(checkpointBytes));
  assert.ok((await fs.readFile(progressPath)).equals(progressBytes), "completed replay must preserve the torn journal exactly");
});

test("execute-offline resumes after a completed artifact checkpoint without duplicating or rewriting it", async t => {
  const w = await workspace(t), now = () => new Date("2026-10-02T13:30:00.000Z");
  const interrupted = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now,
    afterArtifactCheckpoint: (index) => { if (index === 0) throw Error("simulated interruption after durable artifact checkpoint"); } });
  assert.equal(interrupted.state, "technical-hold");
  assert.equal(interrupted.technicalHold, "offline_handoff_partial_artifacts_preserved");
  const progressPath = path.join(String(interrupted.handoffDir), "progress.jsonl"), logBefore = await fs.readFile(progressPath, "utf8");
  const progressRecords = logBefore.trimEnd().split("\n").map(line => JSON.parse(line));
  assert.equal(progressRecords.length, 2, "initial preparing checkpoint plus one durable artifact checkpoint");
  assert.equal(progressRecords[1].state, "preparing");
  assert.equal(progressRecords[1].files.length, 1);
  const firstArtifact = path.join(String(interrupted.handoffDir), progressRecords[1].files[0].path);
  const savedBytes = await fs.readFile(firstArtifact), firstHash = sha256(savedBytes);

  const resumed = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now: () => new Date("2026-10-04T13:30:00.000Z") });
  assert.equal(resumed.state, "prepared-pending-admin");
  assert.equal(resumed.snapshotAt, interrupted.snapshotAt);
  assert.ok(Number(resumed.preparedCount) > 0);
  assert.equal(resumed.alreadyPreparedCount, 0);
  assert.equal(resumed.networkRequests, 0);
  assert.equal(sha256(await fs.readFile(firstArtifact)), firstHash, "resume verifies and preserves already-written artifacts");
  assert.deepEqual((await fs.readFile(progressPath, "utf8")).trimEnd().split("\n").slice(0, 2), logBefore.trimEnd().split("\n"), "durable progress records are append-only");
  const checkpoint = JSON.parse(await fs.readFile(String(resumed.checkpointPath), "utf8"));
  assert.equal(resumed.preparedCount, checkpoint.packageCount);
  const actualFiles = (await fs.readdir(String(resumed.handoffDir), { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name).sort();
  assert.ok(actualFiles.includes("checkpoint.json"));
  assert.ok(actualFiles.includes("progress.jsonl"));
  assert.equal(checkpoint.state, "prepared-pending-admin");
  for (const entry of checkpoint.files as { path: string; sha256: string }[]) assert.equal(sha256(await fs.readFile(path.join(String(resumed.handoffDir), entry.path))), entry.sha256);

  const replay = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now });
  assert.equal(replay.state, "prepared-pending-admin");
  assert.equal(replay.preparedCount, 0);
  assert.equal(replay.alreadyPreparedCount, resumed.preparedCount);
});

test("resume holds an unterminated progress-log tail and preserves its exact bytes", async t => {
  const w = await workspace(t), now = () => new Date("2026-10-02T13:45:00.000Z");
  const interrupted = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now,
    afterArtifactCheckpoint: (index) => { if (index === 0) throw Error("simulated interruption"); } });
  const progressPath = path.join(String(interrupted.handoffDir), "progress.jsonl"), validPrefix = await fs.readFile(progressPath);
  await fs.appendFile(progressPath, "{\"truncated\":");
  const originalBytes = await fs.readFile(progressPath);
  const resumed = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now });
  assert.equal(resumed.state, "technical-hold");
  assert.equal(resumed.technicalHold, "offline_handoff_progress_unterminated_tail");
  assert.equal(validPrefix.length < originalBytes.length, true);
  assert.ok((await fs.readFile(progressPath)).equals(originalBytes));
  const retry = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now });
  assert.equal(retry.technicalHold, "offline_handoff_progress_unterminated_tail");
  assert.ok((await fs.readFile(progressPath)).equals(originalBytes));
});

test("exact checkpoint temp is promoted from the terminal validated progress record", async t => {
  const w = await workspace(t), now = () => new Date("2026-10-02T13:50:00.000Z");
  const interrupted = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now,
    afterFinalProgress: () => { throw Error("simulated interruption before checkpoint promotion"); } });
  assert.equal(interrupted.state, "technical-hold");
  const progressPath = path.join(String(interrupted.handoffDir), "progress.jsonl"), lines = (await fs.readFile(progressPath, "utf8")).trimEnd().split("\n");
  const terminal = JSON.parse(lines[lines.length - 1]);
  assert.equal(terminal.state, "prepared-pending-admin");
  const exactCheckpointBytes = Buffer.from(canonicalJson(terminal) + "\n"), tempPath = path.join(String(interrupted.handoffDir), ".checkpoint.json.tmp");
  await fs.writeFile(tempPath, exactCheckpointBytes);

  const resumed = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now });
  assert.equal(resumed.state, "prepared-pending-admin", `replay hold: ${resumed.technicalHold ?? "none"}`);
  assert.ok((await fs.readFile(String(resumed.checkpointPath))).equals(exactCheckpointBytes));
  await assert.rejects(fs.access(tempPath), { code: "ENOENT" });
});

test("partial checkpoint temp is held and preserved when progress proves the expected bytes", async t => {
  const w = await workspace(t), now = () => new Date("2026-10-02T13:55:00.000Z");
  const interrupted = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now,
    afterFinalProgress: () => { throw Error("simulated interruption before checkpoint promotion"); } });
  const tempPath = path.join(String(interrupted.handoffDir), ".checkpoint.json.tmp"), partialBytes = Buffer.from("{\"partial\":");
  await fs.writeFile(tempPath, partialBytes);

  const held = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now });
  assert.equal(held.state, "technical-hold");
  assert.equal(held.technicalHold, "offline_handoff_checkpoint_temp_mismatch");
  assert.ok((await fs.readFile(tempPath)).equals(partialBytes));
  await assert.rejects(fs.access(path.join(String(interrupted.handoffDir), "checkpoint.json")), { code: "ENOENT" });
});

test("conflicting final checkpoint and temp are both held and preserved", async t => {
  const w = await workspace(t), now = () => new Date("2026-10-02T14:00:00.000Z");
  const completed = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now });
  const checkpointPath = String(completed.checkpointPath), tempPath = path.join(String(completed.handoffDir), ".checkpoint.json.tmp");
  const checkpointBytes = await fs.readFile(checkpointPath), tempBytes = Buffer.from("partial conflicting temp");
  await fs.writeFile(tempPath, tempBytes);

  const held = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now });
  assert.equal(held.state, "technical-hold");
  assert.equal(held.technicalHold, "offline_handoff_checkpoint_temp_conflicts_with_final");
  assert.ok((await fs.readFile(checkpointPath)).equals(checkpointBytes));
  assert.ok((await fs.readFile(tempPath)).equals(tempBytes));
});

test("all-package-less source executes with full held accounting and stable zero-network replay", async t => {
  const w = await workspace(t), now = () => new Date("2026-10-02T14:15:00.000Z"), state = coordinatorFixture();
  for (const candidate of state.candidates) for (const result of candidate.results)
    (result as unknown as Record<string, unknown>).completedAt = "not-a-valid-completion-time";
  await fs.writeFile(w.statePath, JSON.stringify(state, null, 2) + "\n");
  const sourceBytes = await fs.readFile(w.statePath), sourceHash = sha256(sourceBytes), originalFetch = globalThis.fetch;
  let fetchCalls = 0, first: Awaited<ReturnType<typeof runWholeFirmOfflineHandoff>>, replay: Awaited<ReturnType<typeof runWholeFirmOfflineHandoff>>;
  globalThis.fetch = (async (..._args: Parameters<typeof fetch>) => { fetchCalls++; throw Error("all-package-less offline handoff must not use fetch"); }) as typeof fetch;
  try {
    first = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now });
    assert.equal(first.state, "prepared-pending-admin");
    assert.equal(first.expectedRevisionCount, first.accountedRevisionCount);
    assert.ok(Number(first.expectedRevisionCount) > 0);
    assert.equal(first.preparedCount, 0);
    assert.equal(first.alreadyPreparedCount, 0);
    assert.equal(first.heldCount, first.expectedRevisionCount);
    assert.equal(first.timestampTechnicalHoldCount, first.expectedRevisionCount);
    assert.equal(first.networkRequests, 0);
    assert.equal(first.submitted, 0);
    assert.equal(first.applied, 0);
    assert.equal(first.visibleVerified, 0);
    assert.equal(fetchCalls, 0);

    const coveragePath = path.join(String(first.handoffDir), "coverage-report.json");
    const heldPath = path.join(String(first.handoffDir), "held-candidate-evidence.jsonl");
    const packagesPath = path.join(String(first.handoffDir), "normalized-packages.jsonl");
    const deliveryPath = path.join(String(first.handoffDir), "delivery-index.jsonl");
    const coverage = JSON.parse(await fs.readFile(coveragePath, "utf8"));
    const held = (await fs.readFile(heldPath, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    const expected = JSON.parse(await fs.readFile(path.join(String(first.handoffDir), "expected-run-manifest.json"), "utf8"));
    assert.equal(coverage.packages, 0);
    assert.equal(coverage.expectedRevisionCount, first.expectedRevisionCount);
    assert.equal(coverage.accountedRevisionCount, first.expectedRevisionCount);
    assert.equal(coverage.nonPackageHolds, first.expectedRevisionCount);
    assert.equal(coverage.timestampTechnicalHolds, first.expectedRevisionCount);
    assert.equal(expected.entries.length, first.expectedRevisionCount);
    assert.ok(expected.entries.every((entry: { clientPackageId: string | null; errorCodes: string[] }) =>
      entry.clientPackageId === null && entry.errorCodes.includes("result_completed_at_invalid")));
    assert.equal(held.length, first.expectedRevisionCount);
    assert.ok(held.every((entry: { issues: { code: string }[] }) => entry.issues.some(issue => issue.code === "result_completed_at_invalid")));
    assert.equal(await fs.readFile(packagesPath, "utf8"), "");
    assert.equal(await fs.readFile(deliveryPath, "utf8"), "");

    const checkpointPath = String(first.checkpointPath), progressPath = path.join(String(first.handoffDir), "progress.jsonl");
    const checkpointBytes = await fs.readFile(checkpointPath), progressBytes = await fs.readFile(progressPath), heldBytes = await fs.readFile(heldPath);
    const checkpoint = JSON.parse(checkpointBytes.toString("utf8"));
    assert.equal(checkpoint.state, "prepared-pending-admin");
    assert.equal(checkpoint.packageCount, 0);
    assert.equal(checkpoint.heldCount, first.expectedRevisionCount);
    assert.equal(checkpoint.expectedRevisionCount, checkpoint.accountedRevisionCount);

    replay = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now: () => new Date("2026-10-05T14:15:00.000Z") });
    assert.equal(replay.state, "prepared-pending-admin");
    assert.equal(replay.expectedRevisionCount, first.expectedRevisionCount);
    assert.equal(replay.accountedRevisionCount, first.accountedRevisionCount);
    assert.equal(replay.heldCount, first.heldCount);
    assert.equal(replay.preparedCount, 0);
    assert.equal(replay.alreadyPreparedCount, 0);
    assert.equal(replay.networkRequests, 0);
    assert.equal(replay.submitted, 0);
    assert.equal(replay.applied, 0);
    assert.equal(replay.visibleVerified, 0);
    assert.equal(fetchCalls, 0);
    assert.ok((await fs.readFile(checkpointPath)).equals(checkpointBytes));
    assert.ok((await fs.readFile(progressPath)).equals(progressBytes));
    assert.ok((await fs.readFile(heldPath)).equals(heldBytes));
    assert.ok((await fs.readFile(w.statePath)).equals(sourceBytes));
    assert.equal(sha256(await fs.readFile(w.statePath)), sourceHash);
  } finally { globalThis.fetch = originalFetch; }
});

test("changed coordinator bytes create a distinct snapshot lineage", async t => {
  const w = await workspace(t), first = await runWholeFirmOfflineHandoff({ ...w, now: () => new Date("2026-10-02T15:00:00.000Z") });
  const state = JSON.parse(await fs.readFile(w.statePath, "utf8"));
  state.updatedAt = "2026-10-02T15:01:00.000Z";
  await fs.writeFile(w.statePath, JSON.stringify(state, null, 2) + "\n");
  const second = await runWholeFirmOfflineHandoff({ ...w, now: () => new Date("2026-10-02T15:02:00.000Z") });
  assert.equal(second.state, "dry-run");
  assert.notEqual(second.sourceSha256, first.sourceSha256);
  assert.notEqual(second.sourceManifestSha256, first.sourceManifestSha256);
  assert.notEqual(second.snapshotAt, first.snapshotAt);
});

test("exact-state replay reuses archived evidence when the live referenced artifact changes", async t => {
  const w = await workspace(t), relativeEvidence = "operations/luna_continuous_v1/workers/synthetic-evidence.md";
  const evidencePath = path.join(w.sourceRoot, relativeEvidence);
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  await fs.writeFile(evidencePath, "first immutable evidence version");
  const state = coordinatorFixture();
  (state.candidates[0].results[0] as unknown as { evidenceArtifacts: string[] }).evidenceArtifacts = [relativeEvidence];
  await fs.writeFile(w.statePath, JSON.stringify(state, null, 2) + "\n");
  const first = await runWholeFirmOfflineHandoff({ ...w, now: () => new Date("2026-10-02T17:00:00.000Z") });
  assert.equal(first.state, "dry-run");
  const originalManifestBytes = await fs.readFile(String(first.sourceManifestPath));
  const originalSource = JSON.parse(originalManifestBytes.toString("utf8"));
  const originalReference = originalSource.originalExport.sourceInventory.provenance.references.find((ref: { value: string }) => ref.value === relativeEvidence);
  assert.ok(originalReference?.sourceSha256);

  await fs.writeFile(evidencePath, "changed live evidence version");
  const second = await runWholeFirmOfflineHandoff({ ...w, now: () => new Date("2026-10-03T17:00:00.000Z") });
  assert.equal(second.state, "dry-run");
  assert.equal(second.snapshotCreated, false);
  assert.equal(second.snapshotReused, true);
  assert.equal(second.snapshotAt, first.snapshotAt);
  assert.equal(second.sourceSha256, first.sourceSha256);
  assert.equal(second.sourceManifestSha256, first.sourceManifestSha256);
  assert.ok((await fs.readFile(String(second.sourceManifestPath))).equals(originalManifestBytes));
  assert.equal((await fs.readdir(path.join(w.outputRoot, "runs"))).length, 1);
  await assert.rejects(fs.access(String(second.handoffDir)), { code: "ENOENT" });
});

test("conflicting validated inventories for identical coordinator bytes hold as ambiguous", async t => {
  const w = await workspace(t), relativeEvidence = "operations/luna_continuous_v1/workers/synthetic-evidence.md";
  const evidencePath = path.join(w.sourceRoot, relativeEvidence);
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  await fs.writeFile(evidencePath, "first immutable evidence version");
  const state = coordinatorFixture();
  (state.candidates[0].results[0] as unknown as { evidenceArtifacts: string[] }).evidenceArtifacts = [relativeEvidence];
  await fs.writeFile(w.statePath, JSON.stringify(state, null, 2) + "\n");
  const first = await runWholeFirmOfflineHandoff({ ...w, now: () => new Date("2026-10-02T18:00:00.000Z") });
  assert.equal(first.state, "dry-run");
  await fs.writeFile(evidencePath, "second immutable evidence version");
  await snapshotCoordinatorState({ ...w, snapshotAt: "2026-10-03T18:00:00.000Z" });
  const ambiguous = await runWholeFirmOfflineHandoff({ ...w, now: () => new Date("2026-10-04T18:00:00.000Z") });
  assert.equal(ambiguous.state, "technical-hold");
  assert.equal(ambiguous.technicalHold, "snapshot_checkpoint_ambiguous");
});

test("symlinked coordinator state input is rejected before inventory or output", async t => {
  const w = await workspace(t), linkedRoot = path.join(w.dir, "linked-source-root"), linkedControl = path.join(linkedRoot, "operations/luna_continuous_v1/control");
  const targetControl = path.join(w.dir, "actual-control");
  await fs.mkdir(linkedControl, { recursive: true });
  await fs.mkdir(targetControl, { recursive: true });
  await fs.copyFile(w.statePath, path.join(targetControl, "whole_firm_state.json"));
  const linkedState = path.join(linkedControl, "whole_firm_state.json");
  try { await fs.rm(linkedControl, { recursive: true }); await fs.symlink(targetControl, linkedControl, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && ["EPERM", "EACCES", "UNKNOWN"].includes(String(code))) { t.skip(`Host cannot create a Windows directory junction for the coordinator-state path (${code}).`); return; }
    throw error;
  }
  await assert.rejects(runWholeFirmOfflineHandoff({ ...w, statePath: linkedState }), /coordinator_state_path_invalid/);
  await assert.rejects(fs.access(w.outputRoot), { code: "ENOENT" });
});

test("output root junction or symlink is rejected before outside writes", async t => {
  const w = await workspace(t), target = path.join(w.dir, "real-output"), redirected = path.join(w.dir, "redirected-output");
  await fs.mkdir(target);
  try { await fs.symlink(target, redirected, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && ["EPERM", "EACCES", "UNKNOWN"].includes(String(code))) { t.skip(`Host cannot create a Windows output junction (${code}).`); return; }
    throw error;
  }
  await assert.rejects(runWholeFirmOfflineHandoff({ ...w, outputRoot: redirected }), /coordinator_output_path_redirected/);
  assert.deepEqual(await fs.readdir(target), []);
});

test("altered but rehashed offline checkpoint counters hold and remain untouched", async t => {
  const w = await workspace(t), first = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now: () => new Date("2026-10-02T20:00:00.000Z") });
  const checkpointPath = String(first.checkpointPath), checkpoint = JSON.parse(await fs.readFile(checkpointPath, "utf8"));
  const { checkpointSha256: _originalHash, ...unsigned } = checkpoint;
  const alteredUnsigned = { ...unsigned, packageCount: checkpoint.packageCount + 1, heldCount: checkpoint.heldCount + 1,
    timestampTechnicalHoldCount: checkpoint.timestampTechnicalHoldCount + 1, expectedRevisionCount: checkpoint.expectedRevisionCount + 1,
    accountedRevisionCount: checkpoint.accountedRevisionCount + 1 };
  const altered = { ...alteredUnsigned, checkpointSha256: protocolHash(alteredUnsigned) };
  await fs.writeFile(checkpointPath, canonicalJson(altered) + "\n");
  const alteredBytes = await fs.readFile(checkpointPath), held = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true });
  assert.equal(held.state, "technical-hold");
  assert.equal(held.technicalHold, "offline_handoff_checkpoint_coverage_mismatch");
  assert.ok((await fs.readFile(checkpointPath)).equals(alteredBytes));
});

test("symlinked offline checkpoint is held without following or changing its target", async t => {
  const w = await workspace(t), first = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now: () => new Date("2026-10-02T21:00:00.000Z") });
  const checkpointPath = String(first.checkpointPath), savedCheckpoint = path.join(w.dir, "saved-checkpoint.json"), targetPath = path.join(w.dir, "checkpoint-target");
  const original = await fs.readFile(checkpointPath);
  await fs.rename(checkpointPath, savedCheckpoint);
  await fs.mkdir(targetPath);
  await fs.writeFile(path.join(targetPath, "preserved.txt"), "outside checkpoint target remains unchanged");
  const targetBytes = await fs.readFile(path.join(targetPath, "preserved.txt"));
  try { await fs.symlink(targetPath, checkpointPath, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && ["EPERM", "EACCES", "UNKNOWN"].includes(String(code))) { t.skip(`Host cannot create a Windows checkpoint directory junction (${code}).`); return; }
    throw error;
  }
  const held = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true });
  assert.equal(held.state, "technical-hold");
  assert.equal(held.technicalHold, "offline_handoff_path_invalid");
  assert.ok((await fs.readFile(savedCheckpoint)).equals(original));
  assert.ok((await fs.readFile(path.join(targetPath, "preserved.txt"))).equals(targetBytes));
  assert.equal((await fs.lstat(checkpointPath)).isSymbolicLink(), true);
});

test("corrupt matching inventory checkpoint is held and preserved", async t => {
  const w = await workspace(t), first = await runWholeFirmOfflineHandoff({ ...w, now: () => new Date("2026-10-02T19:00:00.000Z") });
  const inventoryPath = path.join(path.dirname(String(first.sourceManifestPath)), "coordinator-inventory.json");
  const damaged = JSON.parse(await fs.readFile(inventoryPath, "utf8"));
  damaged.exportSha256 = "0".repeat(64);
  await fs.writeFile(inventoryPath, JSON.stringify(damaged) + "\n");
  const damagedBytes = await fs.readFile(inventoryPath);
  const held = await runWholeFirmOfflineHandoff({ ...w, now: () => new Date("2026-10-03T19:00:00.000Z") });
  assert.equal(held.state, "technical-hold");
  assert.equal(held.technicalHold, "snapshot_checkpoint_corrupt_or_incomplete");
  assert.ok((await fs.readFile(inventoryPath)).equals(damagedBytes));
  assert.equal((await fs.readdir(path.join(w.outputRoot, "runs"))).length, 1);
});

test("corrupt and partial handoffs remain untouched and are reported as technical holds", async t => {
  const w = await workspace(t), now = () => new Date("2026-10-02T16:00:00.000Z");
  const first = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now });
  const checkpoint = JSON.parse(await fs.readFile(String(first.checkpointPath), "utf8"));
  const artifact = path.join(String(first.handoffDir), checkpoint.files[0].path);
  await fs.appendFile(artifact, "tampered");
  const damaged = await fs.readFile(artifact), replay = await runWholeFirmOfflineHandoff({ ...w, executeOffline: true, now });
  assert.equal(replay.state, "technical-hold");
  assert.equal(replay.technicalHold, "offline_handoff_artifact_hash_mismatch");
  assert.ok((await fs.readFile(artifact)).equals(damaged));

  const partial = await workspace(t), dryRun = await runWholeFirmOfflineHandoff({ ...partial, now });
  const partialDir = String(dryRun.handoffDir), sentinel = path.join(partialDir, "partial.keep");
  await fs.mkdir(partialDir, { recursive: true });
  await fs.writeFile(sentinel, "preserve partial evidence");
  const held = await runWholeFirmOfflineHandoff({ ...partial, executeOffline: true, now });
  assert.equal(held.state, "technical-hold");
  assert.equal(held.technicalHold, "offline_handoff_checkpoint_missing");
  assert.equal(await fs.readFile(sentinel, "utf8"), "preserve partial evidence");
});

test("handoff command accepts only the offline execute flag and rejects delivery or identity inputs", async () => {
  const base = ["handoff", "--profile", "whole-firm", "--coordinator-state", "never-read-state.json"];
  await assert.rejects(main([...base, "--execute"]), /offline_handoff_scope_invalid/);
  await assert.rejects(main([...base, "--token-file", "never-read-token"]), /offline_handoff_scope_invalid/);
  await assert.rejects(main([...base, "--snapshot", "comparison.json"]), /offline_handoff_scope_invalid/);
  await assert.rejects(main([...base, "--database-firm-id", "00000000-0000-4000-8000-000000000000"]), /invalid_cli_arguments/);
});
