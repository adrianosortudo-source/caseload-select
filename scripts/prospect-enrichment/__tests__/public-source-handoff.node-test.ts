import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { PublicSourceCaptureReceipt } from "../public-source-capture";
import { preparePublicSourceHandoff, preparePublicVerification, runPublicSourceCommand } from "../public-source-cli";
import { canonicalJson, protocolHash, sha256 } from "../model";
import { compileWholeFirmSnapshot, type WholeFirmSourceManifest } from "../whole-firm";
import { serializeComparisonRequest, type ComparisonRequestPackage } from "../comparison-request";
import { heldEvidenceDigest, type ExpectedRunManifest, type HeldCandidateEvidence } from "../run-manifest";
import { WHOLE_FIRM_PROFILE } from "../profiles";

const capturedAt = "2026-10-02T12:00:01.000Z";
const verifiedAt = "2026-10-02T12:01:00.000Z";
const preparedAt = "2026-10-02T12:02:00.000Z";

async function fixture(t: { after: (fn: () => Promise<void>) => void }, privateWorkspace?: string) {
  const workspace = path.resolve(privateWorkspace ?? process.cwd());
  await fs.mkdir(workspace, { recursive: true });
  const root = await fs.mkdtemp(path.join(workspace, ".public-source-handoff-test-"));
  t.after(async () => {
    if (path.dirname(path.resolve(root)) !== workspace || !path.basename(root).startsWith(".public-source-handoff-test-"))
      throw Error("unexpected_test_cleanup_path");
    await fs.rm(root, { recursive: true, force: true });
  });
  const body = Buffer.from("<h1>Employment law</h1>");
  const outputRoot = path.join(root, "public-source");
  const bodySha256 = sha256(body);
  const receipt: PublicSourceCaptureReceipt = {
    schemaVersion: "prospect-public-source-capture/v1", requestedUrl: "https://synthetic.example/services",
    finalUrl: "https://synthetic.example/services", startedAt: "2026-10-02T12:00:00.000Z", retrievedAt: capturedAt,
    httpStatus: 200, contentType: "text/html", bytes: body.length, bodySha256,
    bodyFile: "bodies/" + bodySha256 + ".body", method: "public-https-get", observationsVerified: false,
  };
  await fs.mkdir(path.join(outputRoot, "bodies"), { recursive: true });
  await fs.mkdir(path.join(outputRoot, "receipts"));
  await fs.writeFile(path.join(outputRoot, receipt.bodyFile), body);
  const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + "\n");
  const receiptSha256 = sha256(receiptBytes);
  const receiptPath = path.join(outputRoot, "receipts", receiptSha256 + ".json");
  await fs.writeFile(receiptPath, receiptBytes);
  const facts = {
    schemaVersion: "prospect-public-facts/v1", researchKey: "domain:synthetic.example", displayName: "Synthetic firm",
    canonicalDomain: "synthetic.example", originalLinks: [],
    facts: [{ kind: "service", data: { name: "Employment law", matterFit: "unknown" }, disposition: "supported",
      reason: null as string | null, verifiedAt: verifiedAt as string | null, excerpt: "Employment law",
      contentLocator: { startByte: 4, endByte: 18 }, excerptExtractionMethod: "utf8-byte-range/v1" }],
  };
  const factsPath = path.join(root, "facts-input.json");
  await fs.writeFile(factsPath, JSON.stringify(facts, null, 2) + "\n");
  const options = { receiptPath, receiptSha256, factsPath, outputRoot, now: () => new Date(preparedAt) };
  return { root, body, receipt, facts, factsPath, options };
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

function jsonLines<T>(bytes: string): T[] {
  return bytes.split("\n").filter(Boolean).map(line => JSON.parse(line) as T);
}

type HandoffResult = Awaited<ReturnType<typeof preparePublicSourceHandoff>>;
function prepared(result: HandoffResult) {
  assert.equal(result.held, false);
  if (result.held) throw Error("unexpected_technical_hold");
  return result;
}
function held(result: HandoffResult) {
  assert.equal(result.held, true);
  if (!result.held) throw Error("expected_technical_hold");
  return result;
}
function zeroCounters(value: { networkRequests: number; submitted: number; applied: number; visibleVerified: number }) {
  assert.deepEqual([value.networkRequests, value.submitted, value.applied, value.visibleVerified], [0, 0, 0, 0]);
}
function artifact(result: ReturnType<typeof prepared>, relativePath: string) {
  const value = result.artifacts.find(item => item.relativePath === relativePath);
  assert.ok(value, "Missing artifact: " + relativePath);
  return value;
}
type Original = { responseBody: { encoding: string; bytes: number; bodySha256: string; chunks: string[] }; factsSource: { content: unknown }; verificationRecords: unknown[] };
function original(source: WholeFirmSourceManifest): Original {
  return (source.originalExport.revisions[0] as { originalRevision: Original }).originalRevision;
}

test("handoff publishes complete compiler artifacts and an unsigned hash-bound comparison with unresolved identity", async t => {
  const f = await fixture(t), result = prepared(await preparePublicSourceHandoff(f.options));
  assert.equal(result.schemaVersion, "prospect-public-source-handoff/v1");
  assert.equal(result.state, "prepared-pending-admin");
  assert.equal(result.replayed, false); zeroCounters(result);
  assert.deepEqual(result.counts, { expectedRevisionCount: 1, accountedRevisionCount: 1, packages: 1,
    nonPackageHolds: 0, heldCandidateEvidence: 0, supportedFactCount: 1, heldFactCount: 0, validationIssues: 0 });
  const names = result.artifacts.map(item => item.relativePath);
  for (const name of ["source-manifest.json", "expected-run-manifest.json", "expected-run-manifest-chunks.jsonl",
    "candidate-index.jsonl", "held-candidate-evidence.jsonl", "normalized-packages.jsonl", "comparison-packages.json",
    "delivery-index.jsonl", "validation-errors.jsonl", "coverage-report.json", "comparison-request.json"])
    assert.ok(names.includes(name), name);
  assert.equal(new Set(names).size, names.length);
  for (const item of result.artifacts) {
    assert.equal(path.resolve(item.path), path.resolve(result.handoffDir, item.relativePath));
    const bytes = await fs.readFile(item.path);
    assert.equal(bytes.length, item.bytes); assert.equal(sha256(bytes), item.sha256);
  }
  assert.equal(sha256(await fs.readFile(result.checkpointPath)), result.checkpointSha256);
  assert.ok((await fs.readFile(artifact(result, "source-manifest.json").path)).equals(await fs.readFile(result.sourceManifestPath)));
  const source = await readJson<WholeFirmSourceManifest>(artifact(result, "source-manifest.json").path);
  const compiled = compileWholeFirmSnapshot(source);
  const expected = await readJson<ExpectedRunManifest>(artifact(result, "expected-run-manifest.json").path);
  assert.deepEqual(expected, compiled.expected); assert.equal(expected.runId, result.runId);
  assert.equal(expected.manifestSha256, result.runManifestSha256);
  assert.equal(compiled.packages[0].state, "identity_hold");
  const envelope = compiled.packages[0].envelope;
  assert.equal(envelope.subject.identityState, "unresolved"); assert.equal(envelope.subject.stableFirmId, null);
  assert.equal(envelope.subject.databaseFirmId, null); assert.equal(envelope.subject.sourceRecordKey, null);
  assert.equal(envelope.assessment, null);
  assert.equal(envelope.observations[0].existingRecord, null);
  assert.deepEqual(envelope.originalResearch.content, original(source));
  assert.ok(Buffer.from(original(source).responseBody.chunks.join(""), "base64").equals(f.body));
  const packageFile = artifact(result, "packages/" + envelope.packageId + ".json");
  assert.deepEqual(await readJson(packageFile.path), envelope);
  const packages = await readJson<ComparisonRequestPackage[]>(artifact(result, "comparison-packages.json").path);
  assert.equal(packages[0].payloadSha256, protocolHash(envelope));
  const comparison = serializeComparisonRequest(expected, packages, "whole-firm");
  const comparisonArtifact = artifact(result, "comparison-request.json");
  assert.equal(comparisonArtifact.sha256, comparison.bodySha256);
  assert.equal(await fs.readFile(comparisonArtifact.path, "utf8"), comparison.body);
  assert.equal(Object.hasOwn(comparison.request, "signature"), false);
  assert.equal(Object.hasOwn(comparison.request, "provenance"), false);
  const coverage = await readJson<{ submitted: number; applied: number; visibleVerified: number }>(artifact(result, "coverage-report.json").path);
  assert.deepEqual([coverage.submitted, coverage.applied, coverage.visibleVerified], [0, 0, 0]);
  assert.equal(await fs.readFile(artifact(result, "held-candidate-evidence.jsonl").path, "utf8"), "");
});

test("exact handoff replay keeps its original snapshot, checkpoint hashes and all artifact modification times", async t => {
  const f = await fixture(t), one = prepared(await preparePublicSourceHandoff(f.options));
  const paths = [...one.artifacts.map(item => item.path), one.checkpointPath, one.preparationPath, one.sourceManifestPath];
  const saved = await Promise.all(paths.map(async file => ({ hash: sha256(await fs.readFile(file)), mtime: (await fs.stat(file)).mtimeMs })));
  const two = prepared(await preparePublicSourceHandoff({ ...f.options, now: () => new Date("2026-10-03T12:02:00.000Z") }));
  assert.equal(two.replayed, true); assert.equal(two.snapshotAt, preparedAt); zeroCounters(two);
  assert.equal(two.checkpointSha256, one.checkpointSha256); assert.equal(two.preparationSha256, one.preparationSha256);
  assert.equal(two.runManifestSha256, one.runManifestSha256); assert.deepEqual(two.artifacts, one.artifacts);
  assert.deepEqual(await Promise.all(paths.map(async file => ({ hash: sha256(await fs.readFile(file)), mtime: (await fs.stat(file)).mtimeMs }))), saved);
});

test("mixed supported and held facts retain complete original evidence without asserting the held fact", async t => {
  const f = await fixture(t);
  const unresolved = { ...structuredClone(f.facts.facts[0]), disposition: "held", reason: "The semantic claim needs another first-party source",
    verifiedAt: null, data: { name: "Unverified niche", matterFit: "unknown" } };
  f.facts.facts.push(unresolved);
  await fs.writeFile(f.factsPath, JSON.stringify(f.facts, null, 2) + "\n");
  const result = prepared(await preparePublicSourceHandoff(f.options));
  assert.equal(result.counts.supportedFactCount, 1); assert.equal(result.counts.heldFactCount, 1); zeroCounters(result);
  const source = await readJson<WholeFirmSourceManifest>(artifact(result, "source-manifest.json").path);
  assert.deepEqual(original(source).factsSource.content, f.facts);
  const compiled = compileWholeFirmSnapshot(source);
  assert.equal(compiled.packages.length, 1); assert.equal(compiled.packages[0].envelope.observations.length, 1);
  assert.equal(compiled.packages[0].envelope.observations[0].kind, "service");
  assert.equal(compiled.packages[0].envelope.assessment, null);
  assert.ok(compiled.issues.some(issue => issue.code === "public_fact_held" && issue.reason === unresolved.reason));
});

test("all-held business evidence produces package-less coverage and a hash-bound complete held body", async t => {
  const f = await fixture(t);
  f.facts.facts[0].disposition = "held"; f.facts.facts[0].reason = "Verification is incomplete"; f.facts.facts[0].verifiedAt = null;
  await fs.writeFile(f.factsPath, JSON.stringify(f.facts, null, 2) + "\n");
  const result = prepared(await preparePublicSourceHandoff(f.options));
  assert.equal(result.counts.packages, 0); assert.equal(result.counts.nonPackageHolds, 1);
  assert.equal(result.counts.heldCandidateEvidence, 1); assert.equal(result.counts.accountedRevisionCount, 1);
  assert.equal(result.counts.supportedFactCount, 0); assert.equal(result.counts.heldFactCount, 1); zeroCounters(result);
  const source = await readJson<WholeFirmSourceManifest>(artifact(result, "source-manifest.json").path);
  const manifest = await readJson<ExpectedRunManifest>(artifact(result, "expected-run-manifest.json").path);
  assert.equal(manifest.entries[0].clientPackageId, null); assert.equal(manifest.entries[0].initialDisposition, "hold_schema");
  const evidence = jsonLines<HeldCandidateEvidence>(await fs.readFile(artifact(result, "held-candidate-evidence.jsonl").path, "utf8"));
  assert.equal(evidence.length, 1); assert.equal(evidence[0].evidenceSha256, heldEvidenceDigest(manifest.entries[0]));
  assert.equal(evidence[0].originalJson, canonicalJson(source.originalExport.revisions[0]));
  const retained = JSON.parse(evidence[0].originalJson) as { originalRevision: Original };
  assert.deepEqual(retained.originalRevision.factsSource.content, f.facts);
  assert.ok(Buffer.from(retained.originalRevision.responseBody.chunks.join(""), "base64").equals(f.body));
  const packages = await readJson<ComparisonRequestPackage[]>(artifact(result, "comparison-packages.json").path);
  assert.deepEqual(packages, []);
  const expected = serializeComparisonRequest(manifest, packages, "whole-firm");
  assert.equal(await fs.readFile(artifact(result, "comparison-request.json").path, "utf8"), expected.body);
  assert.equal(result.artifacts.some(item => item.relativePath.startsWith("packages/")), false);
});

test("changed facts create a separate additive handoff and leave the first immutable handoff intact", async t => {
  const f = await fixture(t), one = prepared(await preparePublicSourceHandoff(f.options));
  const originalPaths = [...one.artifacts.map(item => item.path), one.checkpointPath];
  const hashes = await Promise.all(originalPaths.map(async file => sha256(await fs.readFile(file))));
  f.facts.facts[0].disposition = "held"; f.facts.facts[0].reason = "A later audit requires corroboration"; f.facts.facts[0].verifiedAt = null;
  await fs.writeFile(f.factsPath, JSON.stringify(f.facts, null, 2) + "\n");
  const two = prepared(await preparePublicSourceHandoff(f.options));
  assert.notEqual(two.preparationSha256, one.preparationSha256); assert.notEqual(two.handoffDir, one.handoffDir);
  assert.notEqual(two.sourceManifestSha256, one.sourceManifestSha256); assert.notEqual(two.runId, one.runId);
  assert.deepEqual(await Promise.all(originalPaths.map(async file => sha256(await fs.readFile(file)))), hashes);
  assert.equal(two.counts.packages, 0); assert.equal(two.counts.nonPackageHolds, 1); zeroCounters(two);
});

test("altered or missing completed artifacts and checkpoints become durable holds rather than being regenerated", async t => {
  for (const problem of ["corrupt-artifact", "missing-artifact", "corrupt-checkpoint", "extra-file"] as const) {
    await t.test(problem, async child => {
      const f = await fixture(child), first = prepared(await preparePublicSourceHandoff(f.options));
      const file = artifact(first, "comparison-request.json").path;
      if (problem === "corrupt-artifact") await fs.appendFile(file, " ");
      else if (problem === "missing-artifact") await fs.unlink(file);
      else if (problem === "corrupt-checkpoint") {
        const checkpoint = await readJson<Record<string, unknown>>(first.checkpointPath);
        await fs.writeFile(first.checkpointPath, JSON.stringify({ ...checkpoint, state: "complete" }));
      } else await fs.writeFile(path.join(first.handoffDir, "unexpected.json"), "{}\n");
      const result = held(await preparePublicSourceHandoff(f.options));
      assert.equal(result.state, "technical-hold"); zeroCounters(result);
      assert.match(result.reason, /^[a-z][a-z0-9_-]+$/);
      assert.equal(sha256(await fs.readFile(result.holdPath)), result.holdSha256);
      if (problem === "missing-artifact") await assert.rejects(fs.stat(file), { code: "ENOENT" });
      if (problem === "corrupt-artifact") assert.equal((await fs.readFile(file, "utf8")).endsWith(" "), true);
      const replay = held(await preparePublicSourceHandoff(f.options));
      assert.equal(replay.holdPath, result.holdPath); assert.equal(replay.holdSha256, result.holdSha256);
    });
  }
});

test("a partial publication remains held after manual deletion and cannot be silently rebuilt", async t => {
  const f = await fixture(t), prep = await preparePublicVerification(f.options);
  const partial = path.join(f.options.outputRoot, "handoffs", prep.preparationSha256);
  await fs.mkdir(partial, { recursive: true });
  const marker = path.join(partial, "comparison-request.json"); await fs.writeFile(marker, "partial-publication\n");
  const result = held(await preparePublicSourceHandoff(f.options));
  zeroCounters(result); assert.equal(await fs.readFile(marker, "utf8"), "partial-publication\n");
  await assert.rejects(fs.stat(path.join(partial, "checkpoint.json")), { code: "ENOENT" });
  await fs.unlink(marker); await fs.rmdir(partial);
  const replay = held(await preparePublicSourceHandoff(f.options));
  assert.equal(replay.holdPath, result.holdPath); assert.equal(replay.holdSha256, result.holdSha256);
  await assert.rejects(fs.stat(path.join(partial, "checkpoint.json")), { code: "ENOENT" });
});

async function directoryHashes(directory: string): Promise<{ relativePath: string; sha256: string }[]> {
  const hashes: { relativePath: string; sha256: string }[] = [];
  async function visit(current: string) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      assert.equal(entry.isSymbolicLink(), false);
      if (entry.isDirectory()) await visit(file);
      else {
        assert.equal(entry.isFile(), true);
        hashes.push({ relativePath: path.relative(directory, file).split(path.sep).join("/"), sha256: sha256(await fs.readFile(file)) });
      }
    }
  }
  await visit(directory);
  return hashes.sort((one, two) => one.relativePath.localeCompare(two.relativePath));
}

test("redirected artifact and handoff directories are refused even when their targets contain exact valid bytes", async t => {
  for (const redirected of ["packages", "handoff"] as const) {
    await t.test(redirected, async child => {
      const f = await fixture(child), result = prepared(await preparePublicSourceHandoff(f.options));
      const outside = path.join(f.root, "unrelated"); await fs.mkdir(outside);
      const target = redirected === "packages" ? path.join(result.handoffDir, "packages") : result.handoffDir;
      const originalHashes = await directoryHashes(target);
      await fs.cp(target, outside, { recursive: true });
      assert.deepEqual(await directoryHashes(outside), originalHashes);
      await fs.rename(target, path.join(f.root, "retained-original-" + redirected));
      await fs.symlink(outside, target, process.platform === "win32" ? "junction" : "dir");
      const refused = held(await preparePublicSourceHandoff(f.options));
      zeroCounters(refused); assert.equal(refused.state, "technical-hold");
      assert.equal(refused.reason, "public_handoff_path_invalid");
      assert.deepEqual(await directoryHashes(outside), originalHashes);
    });
  }
});

test("a redirected checkpoint directory is refused as a non-file without modifying its target", async t => {
  const f = await fixture(t), result = prepared(await preparePublicSourceHandoff(f.options));
  const outside = path.join(f.root, "nonfile-checkpoint-target"); await fs.mkdir(outside);
  const saved = path.join(f.root, "retained-original-checkpoint.json");
  await fs.rename(result.checkpointPath, saved);
  await fs.symlink(outside, result.checkpointPath, process.platform === "win32" ? "junction" : "dir");
  const refused = held(await preparePublicSourceHandoff(f.options));
  zeroCounters(refused); assert.equal(refused.reason, "public_handoff_path_invalid");
  assert.deepEqual(await fs.readdir(outside), []);
  assert.equal(sha256(await fs.readFile(saved)), result.checkpointSha256);
});

test("a redirected private output root refuses publication rather than creating a hold outside the trusted root", async t => {
  const f = await fixture(t), target = path.join(f.root, "unrelated"); await fs.mkdir(target);
  const redirected = path.join(f.root, "redirected-output");
  await fs.symlink(target, redirected, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(preparePublicSourceHandoff({ ...f.options, outputRoot: redirected }), /output_path_redirected/);
  assert.deepEqual(await fs.readdir(target), []);
});

test("handoff CLI requires verification confirmation, rejects execution flags and never uses capture transport", async t => {
  const f = await fixture(t); let calls = 0;
  const context = { profileRoot: f.root, now: f.options.now,
    captureDependencies: { transport: async () => { calls++; throw Error("must_not_capture"); } } };
  const args = ["handoff", "--receipt", f.options.receiptPath, "--receipt-sha256", f.options.receiptSha256,
    "--facts", f.factsPath, "--output-root", f.options.outputRoot];
  await assert.rejects(runPublicSourceCommand(args, context), /public_fact_confirmation_required/);
  await assert.rejects(runPublicSourceCommand([...args, "--confirm", "VERIFIED-PUBLIC-FACTS", "--execute"], context), /public_cli_scope_invalid/);
  const value = await runPublicSourceCommand([...args, "--confirm", "VERIFIED-PUBLIC-FACTS"], context);
  assert.ok(typeof value === "object" && value !== null && "held" in value && value.held === false);
  assert.ok("networkRequests" in value && value.networkRequests === 0); assert.equal(calls, 0);
  assert.equal(Object.hasOwn(value, "facts"), false); assert.equal(Object.hasOwn(value, "body"), false);
  await assert.rejects(runPublicSourceCommand([...args, "--confirm", "VERIFIED-PUBLIC-FACTS", "--request", f.factsPath], context), /public_cli_scope_invalid/);
  assert.equal(calls, 0);
});

async function runExecutable(args: string[]) {
  const executable = fileURLToPath(new URL("../public-source-cli.ts", import.meta.url));
  const child = spawn(process.execPath, ["--import", "tsx", executable, ...args], {
    cwd: process.cwd(), windowsHide: true, timeout: 30_000,
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += String(chunk); });
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.once("error", reject); child.once("close", code => resolve({ code, stdout, stderr }));
  });
}

test("executable CLI exits zero for business-held evidence and nonzero for a technical hold without printing source content", async t => {
  const f = await fixture(t, WHOLE_FIRM_PROFILE.outputRoot);
  f.facts.facts[0].disposition = "held"; f.facts.facts[0].reason = "Needs semantic corroboration"; f.facts.facts[0].verifiedAt = null;
  await fs.writeFile(f.factsPath, JSON.stringify(f.facts, null, 2) + "\n");
  const args = ["handoff", "--receipt", f.options.receiptPath, "--receipt-sha256", f.options.receiptSha256,
    "--facts", f.factsPath, "--output-root", f.options.outputRoot, "--confirm", "VERIFIED-PUBLIC-FACTS"];
  const business = await runExecutable(args);
  assert.equal(business.code, 0, business.stderr);
  const first = prepared(JSON.parse(business.stdout) as HandoffResult);
  assert.equal(first.counts.packages, 0); assert.equal(first.counts.nonPackageHolds, 1); zeroCounters(first);
  await fs.appendFile(artifact(first, "comparison-request.json").path, " ");
  const technical = await runExecutable(args);
  assert.notEqual(technical.code, null); assert.notEqual(technical.code, 0, technical.stderr);
  const refused = held(JSON.parse(technical.stdout) as HandoffResult);
  assert.equal(refused.state, "technical-hold"); zeroCounters(refused);
  for (const output of [business.stdout, business.stderr, technical.stdout, technical.stderr]) {
    assert.equal(output.includes("https://synthetic.example"), false);
    assert.equal(output.includes("Employment law"), false);
    assert.equal(output.includes("Needs semantic corroboration"), false);
    assert.equal(output.includes(f.body.toString("base64")), false);
  }
});
