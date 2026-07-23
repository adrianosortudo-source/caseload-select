import { describe, it, expect } from "vitest";
import {
  SUPPORT_PREVIEW_READ_ONLY_CODE,
  SUPPORT_PREVIEW_READ_ONLY_MESSAGE,
  SUPPORT_PREVIEW_DECISION_MAKER_SENTENCE,
  supportPreviewAudienceLabel,
  buildSupportPreviewBannerText,
} from "../support-preview-copy";

describe("support-preview-copy: exact strings", () => {
  it("exposes the exact machine-readable reason code", () => {
    expect(SUPPORT_PREVIEW_READ_ONLY_CODE).toBe("support_preview_read_only");
  });

  it("exposes the exact required guard message", () => {
    expect(SUPPORT_PREVIEW_READ_ONLY_MESSAGE).toBe(
      "Support preview is read-only. Complete this action from the firm’s own authorized session.",
    );
  });

  it("exposes the exact required decision-maker sentence", () => {
    expect(SUPPORT_PREVIEW_DECISION_MAKER_SENTENCE).toBe(
      "Only the firm’s authorized lawyer/client decision-maker can complete this action from their own portal session.",
    );
  });
});

describe("supportPreviewAudienceLabel", () => {
  it("maps lawyer to Lawyer decision-maker", () => {
    expect(supportPreviewAudienceLabel("lawyer")).toBe("Lawyer decision-maker");
  });

  it("maps client to Client viewer", () => {
    expect(supportPreviewAudienceLabel("client")).toBe("Client viewer");
  });
});

describe("buildSupportPreviewBannerText", () => {
  it("names the real firm and Lawyer decision-maker audience", () => {
    const text = buildSupportPreviewBannerText("DRG Law", "lawyer");
    expect(text).toContain("DRG Law");
    expect(text).toContain("Lawyer decision-maker");
    expect(text).toContain("SUPPORT PREVIEW");
    expect(text).toContain("cannot make changes on the firm’s behalf");
  });

  it("names the real firm and Client viewer audience", () => {
    const text = buildSupportPreviewBannerText("DRG Law", "client");
    expect(text).toContain("DRG Law");
    expect(text).toContain("Client viewer");
  });

  it("never contains a raw firm id, only the display name given", () => {
    const text = buildSupportPreviewBannerText("DRG Law", "lawyer");
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});
