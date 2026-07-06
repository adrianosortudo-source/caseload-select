import { describe, it, expect } from "vitest";
import {
  checkLegalGateEntryCondition,
  checkLegalGateExitCondition,
  checkBilingualAuthoringCondition,
} from "../content-studio-gates";

describe("checkLegalGateEntryCondition", () => {
  it("blocks when there is no current version", () => {
    const result = checkLegalGateEntryCondition({
      hasCurrentVersion: false,
      latestValidationResults: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("No current EN version");
  });

  it("blocks when no validation run has been recorded", () => {
    const result = checkLegalGateEntryCondition({
      hasCurrentVersion: true,
      latestValidationResults: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("No validation run recorded");
  });

  it("blocks when the latest validation run has a failing check", () => {
    const result = checkLegalGateEntryCondition({
      hasCurrentVersion: true,
      latestValidationResults: [{ status: "pass" }, { status: "fail" }, { status: "warn" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("1 failing check");
  });

  it("allows warnings through, only fails block", () => {
    const result = checkLegalGateEntryCondition({
      hasCurrentVersion: true,
      latestValidationResults: [{ status: "pass" }, { status: "warn" }, { status: "warn" }],
    });
    expect(result.ok).toBe(true);
  });

  it("passes when every check passes", () => {
    const result = checkLegalGateEntryCondition({
      hasCurrentVersion: true,
      latestValidationResults: [{ status: "pass" }, { status: "pass" }],
    });
    expect(result.ok).toBe(true);
  });
});

describe("checkLegalGateExitCondition", () => {
  it("passes when the deliverable is approved", () => {
    const result = checkLegalGateExitCondition({
      deliverableStatus: "approved",
      delegation: null,
      format: "canonical_service_page",
    });
    expect(result.ok).toBe(true);
  });

  it("blocks when the deliverable is in_review and there is no delegation", () => {
    const result = checkLegalGateExitCondition({
      deliverableStatus: "in_review",
      delegation: null,
      format: "canonical_service_page",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not been approved");
  });

  it("blocks when the deliverable is null (never linked) and there is no delegation", () => {
    const result = checkLegalGateExitCondition({
      deliverableStatus: null,
      delegation: null,
      format: "counsel_note",
    });
    expect(result.ok).toBe(false);
  });

  it("passes under an active delegation covering the format even without approval", () => {
    const result = checkLegalGateExitCondition({
      deliverableStatus: "in_review",
      delegation: { status: "active", expires_at: null, scope_formats: ["counsel_note"] },
      format: "counsel_note",
      now: new Date("2026-07-05T00:00:00Z"),
    });
    expect(result.ok).toBe(true);
  });

  it("blocks under a delegation that does not cover this format", () => {
    const result = checkLegalGateExitCondition({
      deliverableStatus: "in_review",
      delegation: { status: "active", expires_at: null, scope_formats: ["checklist"] },
      format: "counsel_note",
      now: new Date("2026-07-05T00:00:00Z"),
    });
    expect(result.ok).toBe(false);
  });

  it("blocks under an expired delegation", () => {
    const result = checkLegalGateExitCondition({
      deliverableStatus: "in_review",
      delegation: {
        status: "active",
        expires_at: "2026-01-01T00:00:00Z",
        scope_formats: ["counsel_note"],
      },
      format: "counsel_note",
      now: new Date("2026-07-05T00:00:00Z"),
    });
    expect(result.ok).toBe(false);
  });

  it("blocks under a revoked delegation", () => {
    const result = checkLegalGateExitCondition({
      deliverableStatus: "in_review",
      delegation: { status: "revoked", expires_at: null, scope_formats: ["counsel_note"] },
      format: "counsel_note",
    });
    expect(result.ok).toBe(false);
  });
});

describe("checkBilingualAuthoringCondition (Ses.17 WP-4)", () => {
  it("passes an English-only piece regardless of PT version state", () => {
    expect(
      checkBilingualAuthoringCondition({ languageMode: "en", hasCurrentPtVersion: false }).ok
    ).toBe(true);
    expect(
      checkBilingualAuthoringCondition({ languageMode: "en", hasCurrentPtVersion: true }).ok
    ).toBe(true);
  });

  it("blocks a bilingual piece with no current PT version", () => {
    const result = checkBilingualAuthoringCondition({
      languageMode: "bilingual",
      hasCurrentPtVersion: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("no current Portuguese version");
  });

  it("passes a bilingual piece once a current PT version exists", () => {
    const result = checkBilingualAuthoringCondition({
      languageMode: "bilingual",
      hasCurrentPtVersion: true,
    });
    expect(result.ok).toBe(true);
  });
});
