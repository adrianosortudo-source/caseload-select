import test from "node:test";
import assert from "node:assert/strict";
import { buildPublicVerificationExport, parsePublicFactsInput, type PublicFactsInput, type PublicVerificationBuildInput } from "../public-source-verification";
import type { PublicSourceCaptureReceipt } from "../public-source-capture";
import { compileWholeFirmSnapshot, freezeWholeFirmExport } from "../whole-firm";
import { canonicalJson, object, protocolHash, sha256 } from "../model";

function fixture(): PublicVerificationBuildInput {
  const body = Buffer.from("<h1>Employment law</h1><p>Résumé consultation</p>", "utf8");
  const receipt: PublicSourceCaptureReceipt = {
    schemaVersion: "prospect-public-source-capture/v1", requestedUrl: "https://synthetic.example/services", finalUrl: "https://synthetic.example/services",
    startedAt: "2026-10-02T12:00:00.000Z", retrievedAt: "2026-10-02T12:00:01.000Z", httpStatus: 200, contentType: "text/html", bytes: body.byteLength,
    bodySha256: sha256(body), bodyFile: "bodies/" + sha256(body) + ".body", method: "public-https-get", observationsVerified: false,
  };
  const facts: PublicFactsInput = {
    schemaVersion: "prospect-public-facts/v1", researchKey: "domain:synthetic.example", displayName: "Synthetic firm", canonicalDomain: "synthetic.example",
    originalLinks: [{ sourceManifestSha256: "a".repeat(64), revisionId: "revision-parent", packageId: "pe-parent", payloadSha256: "b".repeat(64), sourcePointer: "/originalExport/revisions/0" }],
    facts: [{ kind: "service", data: { name: "Employment law", matterFit: "unknown" }, disposition: "supported", reason: null,
      verifiedAt: "2026-10-02T12:01:00.000Z", excerpt: "Employment law", contentLocator: { startByte: 4, endByte: 18 }, excerptExtractionMethod: "utf8-byte-range/v1" }],
  };
  return { body, receipt, receiptPath: "D:/synthetic/captures/receipt.json", receiptSha256: sha256(canonicalJson(receipt) + "\n"),
    facts, snapshotAt: "2026-10-02T12:02:00.000Z", factsSourcePath: "D:/synthetic/facts.json", factsSourceSha256: sha256(canonicalJson(facts) + "\n") };
}
function prepare(input = fixture()) {
  const result = buildPublicVerificationExport(input);
  const frozen = freezeWholeFirmExport(result.exported, sha256(canonicalJson(result.exported) + "\n"));
  return { ...result, frozen, compiled: compileWholeFirmSnapshot(frozen) };
}
function original(result: ReturnType<typeof prepare>) {
  const revision = result.exported.revisions[0];
  assert.ok(object(revision) && object(revision.originalRevision));
  return revision.originalRevision;
}

test("supported facts compile with complete public provenance and exact retained originals", () => {
  const input = fixture(), priorFacts = canonicalJson(input.facts), priorReceipt = canonicalJson(input.receipt), result = prepare(input);
  assert.equal(result.supportedFactCount, 1); assert.equal(result.heldFactCount, 0); assert.equal(result.issues.length, 0);
  assert.equal(result.compiled.packages.length, 1);
  const e = result.compiled.packages[0].envelope;
  assert.equal(e.assessment, null); assert.equal(e.supersedesPackageId, null);
  assert.deepEqual(e.subject, { researchKey: "domain:synthetic.example", displayName: "Synthetic firm", canonicalDomain: "synthetic.example", databaseFirmId: null, stableFirmId: null, sourceRecordKey: null, identityState: "unresolved" });
  assert.equal(Object.keys(e.sources[0]).length, 17);
  assert.equal(e.sources[0].policyState, "public-source"); assert.equal(e.sources[0].retrievalOutcome, "success-content-verified");
  assert.equal(e.sources[0].observedAt, "2026-10-02T12:01:00.000Z"); assert.equal(e.sources[0].publicationLabel, null);
  assert.equal(e.sources[0].bodySha256, sha256(input.body));
  const { sourceId, ...semanticSource } = e.sources[0];
  assert.equal(sourceId, "src-" + protocolHash(["whole-firm-adapter/v1", "caseload-whole-firm-v1", e.subject.researchKey, "source", { captureReceiptSha256: input.receiptSha256, content: semanticSource }]).slice(0, 48));
  const { observationId, ...semanticObservation } = e.observations[0];
  assert.equal(observationId, "obs-" + protocolHash(["whole-firm-adapter/v1", "caseload-whole-firm-v1", e.subject.researchKey, "service", semanticObservation]).slice(0, 48));
  const revision = original(result);
  assert.equal(protocolHash(e.originalResearch.content), protocolHash(revision));
  assert.ok(object(revision.responseBody));
  assert.ok(Buffer.from((revision.responseBody.chunks as string[]).join(""), "base64").equals(input.body));
  assert.ok(object(revision.factsSource)); assert.equal(canonicalJson(revision.factsSource.content), priorFacts);
  assert.ok(object(revision.capture)); assert.equal(canonicalJson(revision.capture.receipt), priorReceipt);
  assert.equal(canonicalJson(input.facts), priorFacts); assert.equal(canonicalJson(input.receipt), priorReceipt);
});

test("exact replay retains revision, semantic events and package identity; new capture gets new events", () => {
  const input = fixture(), a = prepare(input), b = prepare(input);
  assert.equal(canonicalJson(a.exported), canonicalJson(b.exported));
  assert.equal(a.compiled.packages[0].envelope.packageId, b.compiled.packages[0].envelope.packageId);
  const changed = fixture(); changed.receipt.startedAt = "2026-10-02T12:00:00.100Z"; changed.receiptSha256 = sha256(canonicalJson(changed.receipt) + "\n");
  const c = prepare(changed);
  assert.notEqual(a.compiled.packages[0].envelope.sources[0].sourceId, c.compiled.packages[0].envelope.sources[0].sourceId);
  assert.notEqual(a.compiled.packages[0].envelope.observations[0].observationId, c.compiled.packages[0].envelope.observations[0].observationId);
});

test("body hash tampering yields package-less hold retaining the actual provided bytes", () => {
  const input = fixture(); input.body = Buffer.from(input.body); input.body[5] = 0x78;
  const result = prepare(input);
  assert.equal(result.compiled.packages.length, 0); assert.equal(result.compiled.expected.entries.length, 1);
  assert.equal(result.compiled.expected.entries[0].clientPackageId, null); assert.equal(result.supportedFactCount, 0);
  assert.ok(result.issues.some(i => i.code === "public_capture_binding_invalid"));
  const r = original(result); assert.ok(object(r.responseBody));
  assert.ok(Buffer.from((r.responseBody.chunks as string[]).join(""), "base64").equals(input.body));
});

test("held facts remain unchanged and never become negative or supported observations", () => {
  const input = fixture(), facts = input.facts as PublicFactsInput;
  facts.facts.push({ kind: "service", data: { name: "Unestablished service", matterFit: "no-match" }, disposition: "held", reason: "Public page does not establish this fact",
    verifiedAt: null, excerpt: "", contentLocator: { startByte: 0, endByte: 0 }, excerptExtractionMethod: "utf8-byte-range/v1" });
  const before = canonicalJson(facts), result = prepare(input);
  assert.equal(result.supportedFactCount, 1); assert.equal(result.heldFactCount, 1); assert.equal(result.compiled.packages.length, 1);
  const e = result.compiled.packages[0].envelope;
  assert.equal(e.observations.length, 1); assert.equal(e.assessment, null);
  const retained = original(result).factsSource; assert.ok(object(retained)); assert.equal(canonicalJson(retained.content), before);
  assert.ok(result.issues.some(i => i.code === "public_fact_held"));
  facts.facts[0].disposition = "held"; facts.facts[0].reason = "Await independent content review"; facts.facts[0].verifiedAt = null;
  const allHeld = prepare(input);
  assert.equal(allHeld.supportedFactCount, 0); assert.equal(allHeld.compiled.packages.length, 0); assert.equal(allHeld.compiled.expected.entries.length, 1);
});

test("quotes require exact byte ranges and actual independent verification timestamps", () => {
  for (const mutate of [
    (fact: PublicFactsInput["facts"][number]) => { fact.excerpt = "Employment laws"; },
    (fact: PublicFactsInput["facts"][number]) => { fact.verifiedAt = "2026-10-02T11:59:59.000Z"; },
    (fact: PublicFactsInput["facts"][number]) => { fact.verifiedAt = "2026-10-02T12:03:00.000Z"; },
    (fact: PublicFactsInput["facts"][number]) => { fact.verifiedAt = null; },
    (fact: PublicFactsInput["facts"][number]) => { fact.contentLocator.endByte = 9999; },
  ]) {
    const input = fixture(); mutate((input.facts as PublicFactsInput).facts[0]); const result = prepare(input);
    assert.equal(result.supportedFactCount, 0); assert.equal(result.compiled.packages.length, 0);
    assert.ok(result.issues.some(i => i.code === "public_fact_verification_hold"));
  }
});

test("UTF-8 multibyte boundaries cannot be replaced or normalized into a passing quote", () => {
  const input = fixture(), facts = input.facts as PublicFactsInput;
  const start = input.body.indexOf(Buffer.from("Résumé"));
  facts.facts[0].excerpt = "Résumé"; facts.facts[0].contentLocator = { startByte: start, endByte: start + Buffer.byteLength("Résumé") };
  assert.equal(prepare(input).supportedFactCount, 1);
  facts.facts[0].contentLocator.startByte = start + 2;
  assert.equal(prepare(input).supportedFactCount, 0);
});

test("unknown fact keys and malformed typed data produce schema holds without omitting originals", () => {
  for (const bad of [
    { ...(fixture().facts as PublicFactsInput), unexpectedCanonicalId: "guessed" },
    { ...(fixture().facts as PublicFactsInput), facts: [{ ...(fixture().facts as PublicFactsInput).facts[0], data: { name: "Employment law", matterFit: "invented" } }] },
  ]) {
    const input = fixture(); input.facts = bad;
    assert.equal(parsePublicFactsInput(bad).ok, false);
    const result = prepare(input); assert.equal(result.compiled.packages.length, 0);
    assert.equal(result.compiled.expected.entries.length, 1);
    const retained = original(result).factsSource; assert.ok(object(retained)); assert.equal(canonicalJson(retained.content), canonicalJson(bad));
  }
});

test("body over the package bound is retained completely in bounded chunks as one package-less revision", () => {
  const input = fixture(); input.body = Buffer.concat([input.body, Buffer.alloc(2 * 1024 * 1024, 0x61)]);
  input.receipt.bytes = input.body.byteLength; input.receipt.bodySha256 = sha256(input.body); input.receipt.bodyFile = "bodies/" + sha256(input.body) + ".body";
  input.receiptSha256 = sha256(canonicalJson(input.receipt) + "\n");
  const result = prepare(input);
  assert.equal(result.compiled.packages.length, 0); assert.equal(result.supportedFactCount, 0);
  assert.ok(result.issues.some(i => i.code === "public_verification_envelope_hold" && i.reason.includes("2 MiB")));
  const revision = original(result); assert.ok(object(revision.responseBody));
  const chunks = revision.responseBody.chunks as string[];
  assert.ok(chunks.every(c => c.length <= 32_768)); assert.ok(Buffer.from(chunks.join(""), "base64").equals(input.body));
  assert.equal(result.compiled.expected.entries[0].clientPackageId, null);
});

test("unbound contact-role references are held without invented replacement sources", () => {
  const input = fixture(), facts = input.facts as PublicFactsInput;
  facts.facts = [{ ...facts.facts[0], kind: "contact", data: { personName: "Synthetic person", roleLabel: "Partner", roleVerification: "first-party", contactType: "public-named-email", contactValue: "synthetic@synthetic.example", contactQuality: "published-direct-unverified", deliverability: "not-tested", roleSourceIds: ["src-old-unverified"] } }];
  const before = canonicalJson(facts), result = prepare(input);
  assert.equal(result.supportedFactCount, 0); assert.equal(result.compiled.packages.length, 0);
  assert.ok(result.issues.some(i => i.reason.includes("contact-role")));
  const retained = original(result).factsSource; assert.ok(object(retained)); assert.equal(canonicalJson(retained.content), before);
});

test("direct builder refuses malformed, private, credential-bearing and cross-origin receipts", () => {
  for (const mutate of [
    (r: PublicSourceCaptureReceipt) => { r.finalUrl = "https://different.example/services"; },
    (r: PublicSourceCaptureReceipt) => { r.requestedUrl = r.finalUrl = "https://127.0.0.1/services"; },
    (r: PublicSourceCaptureReceipt) => { r.requestedUrl = r.finalUrl = "https://user:secret@synthetic.example/services"; },
    (r: PublicSourceCaptureReceipt) => { r.bodyFile = "../outside.body"; },
    (r: PublicSourceCaptureReceipt) => { r.startedAt = "2026-10-02T11:00:00.000Z"; },
    (r: PublicSourceCaptureReceipt) => { (r as unknown as Record<string, unknown>).observationsVerified = true; },
  ]) {
    const input = fixture(); mutate(input.receipt); const result = prepare(input);
    assert.equal(result.compiled.packages.length, 0); assert.equal(result.supportedFactCount, 0);
    assert.ok(result.issues.some(i => i.code === "public_capture_binding_invalid"));
  }
  const input = fixture(); input.receipt = null as unknown as PublicSourceCaptureReceipt;
  const result = prepare(input); assert.equal(result.compiled.packages.length, 0);
  assert.ok(result.issues.some(i => i.code === "public_capture_binding_invalid"));
});
