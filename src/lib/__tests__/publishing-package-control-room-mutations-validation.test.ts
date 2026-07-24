/**
 * Pure input-validation coverage for registerCandidate (N2) and
 * createPackageManifest (O4) -- proves each rejection happens BEFORE any
 * database touch, by mocking supabaseAdmin.from() to throw. If a
 * validation rule were checked after a DB call, these tests would fail
 * with the mock's own thrown error instead of the expected validation
 * message.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: () => {
      throw new Error("DB must not be touched");
    },
  },
}));

import { registerCandidate, createPackageManifest, type RegisterCandidateInput } from "../publishing-package-control-room-mutations";
import { baseManifestJson, DRG_FIRM_ID, DRG_RENEWAL_PERIOD_ID } from "../__fixtures__/publishing-package-drg-renewal-week";

const FIRM = "f1f1f1f1-0000-4000-8000-0000000000f1";
const PERIOD = "b2b2b2b2-0000-4000-8000-000000000002";

function baseInput(overrides: Partial<RegisterCandidateInput> = {}): RegisterCandidateInput {
  return {
    contentSlotId: "counsel-note-en",
    assetRole: "website_article_hero",
    locale: "en-CA",
    destination: "website",
    filename: "hero.jpg",
    mimeType: "image/jpeg",
    byteSize: 240_000,
    width: 1600,
    height: 900,
    sha256: "a".repeat(64),
    altText: "A hero image",
    textPolicy: "textless",
    overlayLanguage: null,
    ...overrides,
  };
}

describe("registerCandidate -- validation runs before any DB touch", () => {
  it("rejects empty alt_text", async () => {
    const result = await registerCandidate(FIRM, PERIOD, baseInput({ altText: "  " }));
    expect(result).toEqual({ ok: false, error: "alt_text is required" });
  });

  it("rejects empty filename", async () => {
    const result = await registerCandidate(FIRM, PERIOD, baseInput({ filename: "" }));
    expect(result).toEqual({ ok: false, error: "filename is required" });
  });

  it("rejects empty mime_type", async () => {
    const result = await registerCandidate(FIRM, PERIOD, baseInput({ mimeType: "" }));
    expect(result).toEqual({ ok: false, error: "mime_type is required" });
  });

  it("rejects a non-positive byte_size", async () => {
    const result = await registerCandidate(FIRM, PERIOD, baseInput({ byteSize: 0 }));
    expect(result).toEqual({ ok: false, error: "byte_size must be a positive number" });
  });

  it("rejects non-positive width/height for an image role", async () => {
    const result = await registerCandidate(FIRM, PERIOD, baseInput({ width: 0, height: 900 }));
    expect(result).toEqual({ ok: false, error: "width and height must be positive for image assets" });
  });
});

describe("createPackageManifest -- validation runs before any DB touch", () => {
  it("rejects a manifest that fails validatePackageManifest, with a path in the error", async () => {
    const result = await createPackageManifest(FIRM, PERIOD, { schema_version: 1 }, 16); // missing firm_id/period_id/pieces etc.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("manifest failed validation:");
      expect(result.error).toMatch(/firm_id|period_id|pieces/);
    }
  });

  it("rejects a valid manifest whose firm_id/period_id do not match the route's params", async () => {
    const validManifest = baseManifestJson(); // firm_id = DRG_FIRM_ID, period_id = DRG_RENEWAL_PERIOD_ID
    expect(DRG_FIRM_ID).not.toBe(FIRM);
    const result = await createPackageManifest(FIRM, PERIOD, validManifest, 16);
    expect(result).toEqual({ ok: false, error: "manifest firm_id/period_id must match this period" });
  });

  it("accepts a manifest whose firm_id/period_id genuinely match the route's params -- reaches the (mocked, throwing) DB call next", async () => {
    const validManifest = baseManifestJson();
    await expect(createPackageManifest(DRG_FIRM_ID, DRG_RENEWAL_PERIOD_ID, validManifest, 16)).rejects.toThrow(
      "DB must not be touched",
    );
  });
});
