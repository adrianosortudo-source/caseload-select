import { describe, expect, it } from "vitest";
import { heroUploadPath, isAllowedHeroFile, readHeroUploadError } from "../hero-image-control-pure";

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
});
