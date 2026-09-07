import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("legacy prospect iframe contract", () => {
  it("keeps legacy scripts and outbound source links while withholding the console origin", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/admin/prospects/ProspectsFrame.tsx"),
      "utf8",
    );

    expect(source).toContain('sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"');
    expect(source).not.toMatch(/sandbox="[^"]*allow-same-origin/);
  });
});
