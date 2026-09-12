import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const component = readFileSync(resolve(process.cwd(), "src/app/admin/prospects/SupplementalEvidenceImport.tsx"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/app/admin/prospects/page.tsx"), "utf8");

describe("supplemental prospect evidence importer UI", () => {
  it("is mounted alongside, not inside or instead of, the standard importer", () => {
    expect(page).toContain("<GtaProspectImport />");
    expect(page).toContain("<SupplementalEvidenceImport />");
    expect(component).toContain('aria-labelledby="supplemental-evidence-import-heading"');
  });

  it("accepts a strict JSON package only and calls the distinct evidence endpoint", () => {
    expect(component).toContain('accept=".json,application/json"');
    expect(component).toContain("JSON.parse(draft)");
    expect(component).toContain("must be one JSON object, not a CSV or array");
    expect(component).toContain('fetch("/admin/prospects/evidence-import", { method: "POST"');
    expect(component).toContain('fetch("/admin/prospects/evidence-import", { method: "PUT"');
  });

  it("requires a protected review and an explicit confirmation before recording evidence", () => {
    expect(component).toContain("review.rejected.length === 0");
    expect(component).toContain("review.summary.reviewRequired === 0");
    expect(component).toContain("I reviewed this source-linked evidence package");
    expect(component).toContain("The server reviews the exact package again before it writes.");
  });

  it("keeps evidence collection separate from outreach and website use", () => {
    expect(component).toContain("never creates a separate list, sends outreach, or activates a website channel.");
    expect(component).toContain("not permission to contact a person or use a website intake channel.");
  });

  it("marks rendered copy for the quality gate and avoids em dashes", () => {
    expect(component).toContain('data-ui-component-content="supplemental-evidence-import"');
    expect(component).toContain('data-ui-copy="heading"');
    expect(component).toContain('data-ui-copy="body"');
    expect(component).not.toContain("—");
  });
});
