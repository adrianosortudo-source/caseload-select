import { describe, expect, it } from "vitest";
import { ProspectDemoPackageError, validatePackage, validateProfile } from "../package";

const profile = {
  formatVersion: 1,
  id: "walker-law",
  slug: "walker-law",
  revision: 1,
  createdAt: "2026-09-10T12:00:00.000Z",
  updatedAt: "2026-09-10T12:00:00.000Z",
  firmName: "Walker Law",
  websiteTitle: "Walker Law website",
  reference: { url: "https://example.test", capturedAt: "2026-09-10T12:00:00.000Z" },
  screenshot: { assetId: "walker-screenshot", width: 2340, height: 1650, mimeType: "image/png" },
  placement: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  theme: { accent: "#B28B50", surface: "#FFFFFF", text: "#182538", buttonText: "#FFFFFF" },
  scenarios: [{ id: "invoice", label: "Unpaid invoice", description: "A fictional unpaid invoice scenario." }],
  defaultView: "website",
  defaultMode: "guided",
};

describe("prospect-demo package validation", () => {
  it("accepts a complete profile with a normalized placement", () => {
    expect(validateProfile(profile)).toMatchObject({ firmName: "Walker Law", placement: profile.placement });
  });

  it("rejects a placement that extends beyond the reference screenshot", () => {
    expect(() => validateProfile({ ...profile, placement: { ...profile.placement, x: 0.8 } })).toThrow(ProspectDemoPackageError);
  });

  it("rejects a package whose screenshot metadata does not match the profile", () => {
    expect(() => validatePackage({
      packageType: "caseload-select.prospect-demo",
      packageVersion: 1,
      exportedAt: "2026-09-10T12:00:00.000Z",
      profile,
      screenshot: { assetId: "another-asset", mimeType: "image/png", width: 2340, height: 1650, dataBase64: "AA==" },
    })).toThrow("metadata does not match");
  });
});
