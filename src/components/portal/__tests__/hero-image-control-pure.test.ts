import { describe, expect, it } from "vitest";
import {
  HERO_UPLOAD_HELPER_TEXT,
  heroUploadPath,
  isAllowedHeroFile,
  readHeroUploadError,
  shouldShowHeroImageControl,
} from "../hero-image-control-pure";

describe("hero image operator upload contract", () => {
  it.each([
    ["hero.png", "image/png"], ["hero.jpg", "image/jpeg"],
    ["hero.jpeg", "image/jpeg"], ["hero.webp", "image/webp"],
  ])("accepts %s", (name, type) => {
    expect(isAllowedHeroFile({ name, type })).toBe(true);
  });

  it.each([["hero.gif", "image/gif"], ["hero.png", "image/jpeg"], ["hero.svg", "image/svg+xml"]])(
    "rejects %s without submitting", (name, type) => {
      expect(isAllowedHeroFile({ name, type })).toBe(false);
    },
  );

  it("uses the existing authenticated hero endpoint", () => {
    expect(heroUploadPath("firm/a", "deliverable b")).toBe(
      "/api/portal/firm%2Fa/deliverables/deliverable%20b/hero",
    );
  });

  it("preserves backend validation errors verbatim", async () => {
    const error = await readHeroUploadError(
      new Response(JSON.stringify({ error: "file type not allowed: image/gif" }), { status: 415 }),
    );
    expect(error).toBe("file type not allowed: image/gif");
  });

  it.each([
    ["operator with selected version", "version-1", "operator", true],
    ["operator without selected version", null, "operator", false],
    ["lawyer with selected version", "version-1", "lawyer", false],
    ["client with selected version", "version-1", "client", false],
    ["lawyer preview with selected version", "version-1", "lawyer", false],
  ])("visibility: %s", (_label, selectedVersionId, viewerRole, expected) => {
    expect(shouldShowHeroImageControl(
      selectedVersionId,
      viewerRole as "operator" | "lawyer" | "client",
    )).toBe(expected);
  });

  it("uses the exact encoding-safe helper text", () => {
    expect(HERO_UPLOAD_HELPER_TEXT).toBe("PNG, JPG, JPEG, or WebP · max 10 MB");
    expect(HERO_UPLOAD_HELPER_TEXT).not.toContain("Â");
    expect(HERO_UPLOAD_HELPER_TEXT).not.toContain("Ã");
  });
});
