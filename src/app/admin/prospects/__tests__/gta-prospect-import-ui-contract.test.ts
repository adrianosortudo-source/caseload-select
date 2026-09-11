import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const component = readFileSync(resolve(process.cwd(), "src/app/admin/prospects/GtaProspectImport.tsx"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/app/admin/prospects/page.tsx"), "utf8");

describe("GTA prospect importer operator UI", () => {
  it("is mounted inside the authenticated prospect console", () => {
    expect(page).toContain("<GtaProspectImport />");
    expect(component).toContain('aria-labelledby="gta-prospect-import-heading"');
  });

  it("supports the standard CSV and JSON intake formats without treating a browser parse as an import", () => {
    expect(component).toContain("parseCsv");
    expect(component).toContain("JSON.parse");
    expect(component).toContain('fetch("/admin/prospects/research-import"');
    expect(component).toContain("Review package");
    expect(component).toContain("The server could not validate this package.");
    expect(component).toContain("Download CSV template");
  });

  it("requires a fresh server review and an explicit confirmation before apply", () => {
    expect(component).toContain("preview.summary.reviewRequired === 0");
    expect(component).toContain("I reviewed this package and want to import only the server-approved records.");
    expect(component).toContain('fetch("/admin/prospects/research-import", { method: "PUT"');
    expect(component).toContain("Import stays disabled until every invalid or identity-review row is resolved");
  });

  it("preserves source provenance and keeps public contact evidence separate from outreach", () => {
    expect(component).toContain("Public owner and email evidence remains source-attributed information, not outreach permission.");
    expect(component).toContain("Duplicate and identity-review classifications stay visible in the receipt and do not authorize contact or outreach.");
  });

  it("loads a bounded, source-attributed import history on mount and after an applied batch", () => {
    expect(component).toContain('fetch("/admin/prospects/research-import", { signal');
    expect(component).toContain("rows.slice(0, 10)");
    expect(component).toContain("await loadHistory()");
    expect(component).toContain("Recent import history");
    expect(component).toContain("No import batches have been recorded yet.");
  });

  it("marks reviewed copy for the rendered quality gate and avoids em dashes", () => {
    expect(component).toContain('data-ui-component-content="gta-prospect-import"');
    expect(component).toContain('data-ui-copy="heading"');
    expect(component).toContain('data-ui-copy="body"');
    expect(component).not.toContain("—");
  });
});
