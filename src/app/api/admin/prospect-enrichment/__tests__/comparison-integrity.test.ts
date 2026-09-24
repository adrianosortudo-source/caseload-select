import { describe, expect, it } from "vitest";
import { comparisonContentFingerprint, matchesPackageReadBack } from "../_comparison-integrity";

const stored = { id: "server-package", client_package_id: "client-package", payload_sha256: "a".repeat(64), state: "ready_for_review" };
const detail = { packageId: "server-package", clientPackageId: "client-package", payloadSha256: "a".repeat(64), state: "ready_for_review" };

describe("comparison package revision integrity", () => {
  it("accepts an exact state, payload and identity read-back", () => {
    expect(matchesPackageReadBack(stored, detail, "client-package")).toBe(true);
  });
  it("fails closed when package state changes between the summary and detail reads", () => {
    expect(matchesPackageReadBack(stored, { ...detail, state: "applied" }, "client-package")).toBe(false);
  });
  it("fails closed when package identity or payload changes between reads", () => {
    expect(matchesPackageReadBack(stored, { ...detail, clientPackageId: "other-package" }, "client-package")).toBe(false);
    expect(matchesPackageReadBack(stored, { ...detail, payloadSha256: "b".repeat(64) }, "client-package")).toBe(false);
  });
  it("ignores the capture timestamp but detects a changed or newly appeared package in the signed read set", () => {
    const fingerprint = (input: unknown) => JSON.stringify(input);
    const first = { capturedAt: "2026-09-23T12:00:00.000Z", packages: [{ state: "missing", serverPackageId: null }] };
    expect(comparisonContentFingerprint(first, fingerprint)).toBe(comparisonContentFingerprint({ ...first, capturedAt: "2026-09-23T12:00:01.000Z" }, fingerprint));
    expect(comparisonContentFingerprint(first, fingerprint)).not.toBe(comparisonContentFingerprint({ ...first, packages: [{ state: "received", serverPackageId: "package-id" }] }, fingerprint));
  });
});
