import { describe, it, expect } from "vitest";
import { extractHost, filterInternalLinkTargetsToFirmHost } from "../content-studio-links";

describe("extractHost", () => {
  it("extracts the bare hostname from a full URL", () => {
    expect(extractHost("https://drglaw.ca/journal/commercial-lease")).toBe("drglaw.ca");
  });

  it("strips a leading www.", () => {
    expect(extractHost("https://www.drglaw.ca/")).toBe("drglaw.ca");
  });

  it("lowercases the hostname", () => {
    expect(extractHost("https://DRGLaw.ca/")).toBe("drglaw.ca");
  });

  it("returns undefined for an invalid URL", () => {
    expect(extractHost("not-a-url")).toBeUndefined();
  });

  it("returns undefined for null/undefined input", () => {
    expect(extractHost(undefined)).toBeUndefined();
    expect(extractHost(null)).toBeUndefined();
  });
});

describe("filterInternalLinkTargetsToFirmHost", () => {
  const FIRM_WEBSITE = "https://drglaw.ca";

  it("allows a link that resolves to the firm's own host", () => {
    const { allowed, excluded } = filterInternalLinkTargetsToFirmHost(
      [{ url: "https://drglaw.ca/resources/checklist" }],
      FIRM_WEBSITE
    );
    expect(allowed).toHaveLength(1);
    expect(excluded).toHaveLength(0);
  });

  it("excludes a link that resolves to a different host", () => {
    const { allowed, excluded } = filterInternalLinkTargetsToFirmHost(
      [{ url: "https://some-other-site.com/page" }],
      FIRM_WEBSITE
    );
    expect(allowed).toHaveLength(0);
    expect(excluded).toEqual(["https://some-other-site.com/page"]);
  });

  it("partitions a mixed list correctly", () => {
    const { allowed, excluded } = filterInternalLinkTargetsToFirmHost(
      [
        { url: "https://drglaw.ca/journal/a" },
        { url: "https://competitor.ca/page" },
        { url: "https://www.drglaw.ca/journal/b" },
      ],
      FIRM_WEBSITE
    );
    expect(allowed.map((t) => t.url)).toEqual([
      "https://drglaw.ca/journal/a",
      "https://www.drglaw.ca/journal/b",
    ]);
    expect(excluded).toEqual(["https://competitor.ca/page"]);
  });

  it("does not exclude anything when the firm has no website on file", () => {
    const { allowed, excluded } = filterInternalLinkTargetsToFirmHost(
      [{ url: "https://anywhere.com/page" }],
      undefined
    );
    expect(allowed).toHaveLength(1);
    expect(excluded).toHaveLength(0);
  });

  it("handles an empty/undefined target list without throwing", () => {
    expect(filterInternalLinkTargetsToFirmHost(undefined, FIRM_WEBSITE)).toEqual({
      allowed: [],
      excluded: [],
    });
    expect(filterInternalLinkTargetsToFirmHost([], FIRM_WEBSITE)).toEqual({
      allowed: [],
      excluded: [],
    });
  });
});
