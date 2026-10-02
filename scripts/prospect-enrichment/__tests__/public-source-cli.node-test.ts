import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type { PublicSourceCaptureReceipt } from "../public-source-capture";
import { preparePublicVerification, runPublicSourceCommand } from "../public-source-cli";
import { compileWholeFirmSnapshot } from "../whole-firm";
import { sha256 } from "../model";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const workspace = path.resolve(process.cwd());
  const root = await fs.mkdtemp(path.join(workspace, ".public-source-test-"));
  t.after(async () => {
    if (path.dirname(path.resolve(root)) !== workspace || !path.basename(root).startsWith(".public-source-test-"))
      throw Error("unexpected_test_cleanup_path");
    await fs.rm(root, { recursive: true, force: true });
  });
  const body = Buffer.from("<h1>Employment law</h1>");
  // Capture has its own network-bound suite. Construct exact saved bytes here
  // so slow local filesystem setup cannot consume a mock HTTP deadline.
  const captureRoot = path.join(root, "public-source");
  const bodySha256 = sha256(body);
  const receipt: PublicSourceCaptureReceipt = {
    schemaVersion: "prospect-public-source-capture/v1", requestedUrl: "https://synthetic.example/services", finalUrl: "https://synthetic.example/services",
    startedAt: "2026-10-02T12:00:00.000Z", retrievedAt: "2026-10-02T12:00:01.000Z", httpStatus: 200, contentType: "text/html", bytes: body.length,
    bodySha256, bodyFile: "bodies/" + bodySha256 + ".body", method: "public-https-get", observationsVerified: false,
  };
  await fs.mkdir(path.join(captureRoot, "bodies"), { recursive: true });
  await fs.mkdir(path.join(captureRoot, "receipts"));
  await fs.writeFile(path.join(captureRoot, receipt.bodyFile), body);
  const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + "\n"), receiptSha256 = sha256(receiptBytes);
  const receiptPath = path.join(captureRoot, "receipts", receiptSha256 + ".json");
  await fs.writeFile(receiptPath, receiptBytes);
  const captured = { receipt, receiptPath, receiptSha256 };
  const facts = {
    schemaVersion: "prospect-public-facts/v1", researchKey: "domain:synthetic.example", displayName: "Synthetic firm", canonicalDomain: "synthetic.example",
    originalLinks: [], facts: [{ kind: "service", data: { name: "Employment law", matterFit: "unknown" }, disposition: "supported", reason: null,
      verifiedAt: "2026-10-02T12:01:00.000Z", excerpt: "Employment law", contentLocator: { startByte: 4, endByte: 18 }, excerptExtractionMethod: "utf8-byte-range/v1" }],
  };
  const factsPath = path.join(root, "facts-input.json");
  await fs.writeFile(factsPath, JSON.stringify(facts, null, 2) + "\n");
  const options = { receiptPath: captured.receiptPath, receiptSha256: captured.receiptSha256, factsPath,
    outputRoot: path.join(root, "public-source"), now: () => new Date("2026-10-02T12:02:00.000Z") };
  return { root, body, captured, factsPath, options };
}

test("local prepare compiles with the existing adapter; exact replay preserves all hashes and artifact times", async t => {
  const f = await fixture(t), a = await preparePublicVerification(f.options);
  assert.equal(a.supportedFactCount, 1); assert.equal(a.heldFactCount, 0); assert.equal(a.networkRequests, 0); assert.equal(a.replayed, false);
  const manifestBytes = await fs.readFile(a.sourceManifestPath);
  assert.equal(sha256(manifestBytes), a.sourceManifestFileSha256);
  const compiled = compileWholeFirmSnapshot(JSON.parse(manifestBytes.toString("utf8")));
  assert.equal(compiled.packages.length, 1); assert.equal(compiled.packages[0].state, "identity_hold");
  assert.equal(compiled.packages[0].envelope.subject.stableFirmId, null); assert.equal(compiled.packages[0].envelope.assessment, null);
  const paths = [a.preparationPath, a.exportPath, a.sourceManifestPath, a.factsArchive];
  const times = await Promise.all(paths.map(async p => (await fs.stat(p)).mtimeMs));
  const b = await preparePublicVerification({ ...f.options, now: () => new Date("2026-10-03T12:02:00.000Z") });
  assert.equal(b.replayed, true); assert.equal(b.snapshotAt, a.snapshotAt);
  assert.equal(b.exportSha256, a.exportSha256); assert.equal(b.preparationSha256, a.preparationSha256);
  assert.deepEqual(await Promise.all(paths.map(async p => (await fs.stat(p)).mtimeMs)), times);
  assert.ok((await fs.readFile(a.factsArchive)).equals(await fs.readFile(f.factsPath)));
});

test("capture default is network-free; capture and verification require their distinct confirmations", async t => {
  const f = await fixture(t), requestPath = path.join(f.root, "request.json");
  await fs.writeFile(requestPath, JSON.stringify({ schemaVersion: "prospect-public-source-request/v1", requestedUrl: "https://synthetic.example/", allowedOrigins: ["https://synthetic.example"] }));
  let calls = 0;
  const context = { profileRoot: f.root, captureDependencies: { transport: async () => { calls++; throw Error("must_not_run"); } } };
  const checked = await runPublicSourceCommand(["capture", "--request", requestPath], context);
  assert.equal(typeof checked, "object"); assert.equal(calls, 0);
  await assert.rejects(runPublicSourceCommand(["capture", "--request", requestPath, "--execute"], context), /public_capture_confirmation_required/);
  await assert.rejects(runPublicSourceCommand(["prepare", "--receipt", f.captured.receiptPath, "--receipt-sha256", f.captured.receiptSha256, "--facts", f.factsPath], context), /public_fact_confirmation_required/);
  assert.equal(calls, 0);
});

test("tampered receipt, export or checkpoint cannot be replayed as success", async t => {
  const f = await fixture(t), prepared = await preparePublicVerification(f.options);
  const originalExport = await fs.readFile(prepared.exportPath);
  await fs.appendFile(prepared.exportPath, " ");
  await assert.rejects(preparePublicVerification(f.options), /public_preparation_artifact_conflict/);
  await fs.writeFile(prepared.exportPath, originalExport);
  const checkpoint = JSON.parse(await fs.readFile(prepared.preparationPath, "utf8"));
  await fs.writeFile(prepared.preparationPath, JSON.stringify({ ...checkpoint, supportedFactCount: 100 }));
  await assert.rejects(preparePublicVerification(f.options), /public_preparation_checkpoint_conflict/);
  await fs.appendFile(f.captured.receiptPath, " ");
  await assert.rejects(preparePublicVerification(f.options), /receipt_hash_mismatch/);
});

test("changed verification input creates an additive export instead of overwriting its parent", async t => {
  const f = await fixture(t), a = await preparePublicVerification(f.options);
  const parentBytes = await fs.readFile(a.sourceManifestPath);
  const facts = JSON.parse(await fs.readFile(f.factsPath, "utf8"));
  facts.facts[0].disposition = "held"; facts.facts[0].reason = "Requires additional content verification"; facts.facts[0].verifiedAt = null;
  await fs.writeFile(f.factsPath, JSON.stringify(facts));
  const b = await preparePublicVerification(f.options);
  assert.notEqual(b.sourceManifestSha256, a.sourceManifestSha256); assert.equal(b.supportedFactCount, 0); assert.equal(b.heldFactCount, 1);
  assert.ok((await fs.readFile(a.sourceManifestPath)).equals(parentBytes));
  const compiled = compileWholeFirmSnapshot(JSON.parse(await fs.readFile(b.sourceManifestPath, "utf8")));
  assert.equal(compiled.packages.length, 0); assert.equal(compiled.expected.entries.length, 1);
});

test("facts JSON with invalid UTF-8 is rejected before any preparation checkpoint", async t => {
  const f = await fixture(t);
  await fs.writeFile(f.factsPath, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]));
  await assert.rejects(preparePublicVerification(f.options), /public_input_json_invalid/);
  await assert.rejects(fs.stat(path.join(f.options.outputRoot, "preparations")), { code: "ENOENT" });
});

test("output paths cannot leave the profile root or follow a redirected artifact directory", async t => {
  const f = await fixture(t);
  await assert.rejects(runPublicSourceCommand(["capture", "--request", f.factsPath, "--output-root", path.dirname(f.root)], { profileRoot: f.root }), /output_must_be_in_whole_firm_private_root/);
  const outside = path.join(f.root, "unrelated"); await fs.mkdir(outside);
  await fs.symlink(outside, path.join(f.options.outputRoot, "exports"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(preparePublicVerification(f.options), /output_path_redirected/);
  assert.deepEqual(await fs.readdir(outside), []);
});
