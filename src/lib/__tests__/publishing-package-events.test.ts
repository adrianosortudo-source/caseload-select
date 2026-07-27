import { describe, it, expect } from "vitest";
import { buildEventReceipt, REQUIRED_RECEIPT_FIELDS, type BuildEventReceiptInput } from "../publishing-package-events";

function baseInput(overrides: Partial<BuildEventReceiptInput> = {}): BuildEventReceiptInput {
  return {
    packageId: "pkg-1",
    periodId: "period-1",
    firmId: "firm-1",
    contentSlotId: "counsel-note-en",
    deliverableId: null,
    sourceVersionId: null,
    assetId: "asset-1",
    filename: "hero.jpg",
    assetRole: "website_article_hero",
    destination: "website",
    locale: "en-CA",
    expectedHash: "a".repeat(64),
    computedHash: "a".repeat(64),
    previousBinding: null,
    resultingBinding: null,
    actorType: "operator",
    outcome: "success",
    failureReason: null,
    ...overrides,
  };
}

describe("buildEventReceipt", () => {
  it("receipt contains every required field", () => {
    const receipt = buildEventReceipt(baseInput());
    for (const field of REQUIRED_RECEIPT_FIELDS) {
      expect(field in receipt).toBe(true);
    }
  });

  it("failure outcome requires failure_reason", () => {
    expect(() => buildEventReceipt(baseInput({ outcome: "failure", failureReason: null }))).toThrow(
      "failure_reason is required when outcome is failure",
    );
    expect(() => buildEventReceipt(baseInput({ outcome: "failure", failureReason: "" }))).toThrow();
  });

  it("success outcome carries failure_reason null", () => {
    const receipt = buildEventReceipt(baseInput({ outcome: "success" }));
    expect(receipt.failure_reason).toBeNull();
  });

  it("operation_id is a unique uuid per call", () => {
    const a = buildEventReceipt(baseInput());
    const b = buildEventReceipt(baseInput());
    expect(a.operation_id).not.toBe(b.operation_id);
    expect(a.operation_id as string).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.operation_id as string).toMatch(/^[0-9a-f-]{36}$/);
  });
});
