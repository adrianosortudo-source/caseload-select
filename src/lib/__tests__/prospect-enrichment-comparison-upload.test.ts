import { prospectEnrichmentProtocolHash } from "../prospect-enrichment-hash";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { prepareResearchComparisonUpload, researchComparisonEndpoint, verifyResearchComparisonResponse } from "../prospect-enrichment-comparison-upload";

const body = JSON.stringify({ schemaVersion: "prospect-enrichment-comparison-request/v1", manifest: { runId: "run-test" }, packages: [] });
function file(name: string, bytes: string | Uint8Array) { return Object.assign(new Blob([typeof bytes === "string" ? bytes : new Uint8Array(bytes)]), { name }); }
function snapshot(reader: string) { return { schemaVersion: "prospect-enrichment-comparison/v1", projectId: "ssxryjxifwiivghglqer", snapshotSha256: "a".repeat(64), signature: { algorithm: "Ed25519", keyId: "test", signatureBase64: "signed" }, provenance: { reader, operatorAuthenticated: true, sourceArtifactSha256: "b".repeat(64) }, packages: [], identities: [], events: [], capturedAt: "2026-09-30T17:00:00Z" }; }

describe("operator comparison upload", () => {
  it("can prepare an initial request without any existing Admin run", async () => {
    const upload = await prepareResearchComparisonUpload(file("request.json", body));
    expect(upload.requestSha256).toBe(prospectEnrichmentProtocolHash(JSON.parse(body))); expect(upload.runId).toBe("run-test"); expect(upload.body).toBe(body);
    expect(researchComparisonEndpoint("bootstrap")).toBe("/api/admin/prospect-enrichment/comparison-export/bootstrap");
    expect(researchComparisonEndpoint("finalized")).toBe("/api/admin/prospect-enrichment/comparison-export");
  });
  it("keeps the exact compressed wire body while verifying its decoded run identity", async () => {
    const compressed = file("request.json.gz", gzipSync(body));
    const upload = await prepareResearchComparisonUpload(compressed, "run-test");
    expect(upload.body).toBe(compressed); expect(upload.headers["Content-Encoding"]).toBe("gzip");
    await expect(prepareResearchComparisonUpload(compressed, "different-run")).rejects.toThrow("exact run");
  });
  it("rejects oversized compressed wire data and gzip expansion before posting", async () => {
    await expect(prepareResearchComparisonUpload(file("request.json.gz", new Uint8Array(4 * 1024 * 1024 + 1)))).rejects.toThrow("larger than 4 MB");
    await expect(prepareResearchComparisonUpload(file("request.json.gz", gzipSync("x".repeat(32 * 1024 * 1024 + 1))))).rejects.toThrow("decoded private comparison request");
  });
  it("rejects malformed JSON and incomplete request envelopes", async () => {
    await expect(prepareResearchComparisonUpload(file("request.json", "{"))).rejects.toThrow("not valid JSON");
    await expect(prepareResearchComparisonUpload(file("request.json", JSON.stringify({ schemaVersion: "prospect-enrichment-comparison-request/v1", manifest: { runId: "run-test" } })))).rejects.toThrow("complete comparison request");
  });
  it("fails closed on a wrong reader or unsigned response", () => {
    expect(() => verifyResearchComparisonResponse(snapshot("admin-prospect-enrichment-bootstrap/v1"), "bootstrap", "c".repeat(64))).toThrow("unexpected");
    expect(() => verifyResearchComparisonResponse(snapshot("admin-prospect-enrichment-bootstrap/v1"), "bootstrap", "b".repeat(64))).not.toThrow();
    expect(() => verifyResearchComparisonResponse(snapshot("admin-prospect-enrichment-bootstrap-resume/v1"), "bootstrap", "b".repeat(64))).not.toThrow();
    expect(() => verifyResearchComparisonResponse(snapshot("admin-prospect-enrichment-comparison/v1"), "finalized", "b".repeat(64))).not.toThrow();
    expect(() => verifyResearchComparisonResponse(snapshot("admin-prospect-enrichment-bootstrap/v1"), "finalized", "b".repeat(64))).toThrow("unexpected");
    expect(() => verifyResearchComparisonResponse({ ...snapshot("admin-prospect-enrichment-comparison/v1"), signature: null }, "finalized", "b".repeat(64))).toThrow("unsigned");
    expect(() => verifyResearchComparisonResponse({ ...snapshot("admin-prospect-enrichment-bootstrap/v1"), packages: [{}] }, "bootstrap", "b".repeat(64))).toThrow("unexpected");
  });
});
