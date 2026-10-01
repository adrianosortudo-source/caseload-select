import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("research comparison download contract", () => {
  it("renders the verified signed snapshot as an explicit downloadable link", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/admin/prospects/ResearchComparisonExport.tsx"), "utf8");

    expect(source).toContain('URL.createObjectURL(blob)');
    expect(source).toContain('href={download.href} download={download.filename}>Download signed comparison</a>');
    expect(source).toContain('filename = `prospect-enrichment-comparison-${upload.runId}.json`');
    expect(source).toContain('URL.revokeObjectURL(download.href)');
    expect(source).not.toContain('anchor.click()');
  });
});
