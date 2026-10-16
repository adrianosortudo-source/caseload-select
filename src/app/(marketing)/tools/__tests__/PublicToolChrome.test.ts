import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("public tool chrome", () => {
  it("uses the light-background lockup on all white standalone headers", () => {
    const headers = [
      "src/app/(marketing)/tools/seo-check/_components/ToolNav.tsx",
      "src/app/(marketing)/tools/website-design-check/_components/ToolNav.tsx",
      "src/components/firm-voice-builder/ToolHeader.tsx",
      "src/components/why-your-firm/ToolHeader.tsx",
    ].map(read);

    for (const header of headers) {
      expect(header).toContain("lockup-horizontal-tagline-light-transparent.png");
      expect(header).not.toContain("lockup-horizontal-tagline-dark-transparent.png");
    }
  });

  it("links Screen to its verified canonical marketing page", () => {
    const footer = read("src/app/(marketing)/tools/PublicToolFooter.tsx");

    expect(footer).toContain('{ href: "https://caseloadselect.ca/screen.html", label: "Screen" }');
    expect(footer).not.toContain("https://caseloadselect.ca/screen-demo");
  });

  it("keeps shared marketing navigation out of printed reports", () => {
    const footer = read("src/app/(marketing)/tools/PublicToolFooter.tsx");

    expect(footer).toMatch(/@media\s+print\s*\{[^}]*\.public-tool-footer\s*\{\s*display:\s*none\s*!important;/);
  });
});
