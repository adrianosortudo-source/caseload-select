import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), "utf8");

describe("Secure Import Room trust guide", () => {
  const guide = read("src", "components", "portal", "SecureImportTrustGuide.tsx");
  const room = read("src", "components", "portal", "SecureImportRoom.tsx");
  const page = read("src", "app", "portal", "[firmId]", "clients", "import", "page.tsx");

  it("states the transient processing boundary instead of claiming a direct browser-to-CRM upload", () => {
    expect(guide).toMatch(/temporarily processes only the\s+normalized contact rows/);
    expect(guide).toContain("groups of up to 25 normalized contact rows");
    expect(guide).toContain("not saved in the CaseLoad Select database");
    expect(guide).toContain("request IP when available, the browser user-agent string");
    expect(guide).toContain("authorized firm lawyer or administrator");
    expect(guide).toContain("configured HighLevel location ID");
    expect(guide).toContain("require reconciliation");
  });

  it("documents the verified infrastructure controls and their limits", () => {
    expect(guide).toContain("ISO/IEC 27001:2022");
    expect(guide).toContain("SOC 2 Type II");
    expect(guide).toContain("TLS 1.2 or 1.3");
    expect(guide).toContain("AES-256");
    expect(guide).toMatch(/hosted in the United\s+States/);
    expect(guide).toContain("Independent attestation");
    expect(guide).toContain("They do not certify CaseLoad");
    expect(guide).toContain("not HIPAA");
    expect(guide).toContain("Business Associate Agreement");
    expect(guide).toMatch(/each\s+applicable sub-account/);
    expect(guide).toContain("https://www.gohighlevel.com/data-processing-agreement");
  });

  it("shows every live CSV header with safe fictional data and explains that import is not consent", () => {
    for (const header of [
      "first_name",
      "last_name",
      "email",
      "phone",
      "relationship_type",
      "practice_area",
      "matter_closed_year",
      "marketing_permission",
    ]) {
      expect(guide).toContain(header);
    }
    expect(guide).toContain("example.com");
    expect(guide).toContain("Importing never creates consent");
    expect(guide).toContain("Only these eight columns are used");
    expect(guide).toContain("remove every other column");
  });

  it("keeps the wide template preview keyboard accessible and gives every column a scoped header", () => {
    expect(guide).toContain('aria-label="Scrollable CSV template preview"');
    expect(guide).toContain("tabIndex={0}");
    expect(guide.match(/scope="col"/g)).toHaveLength(8);
  });

  it("provides visible focus treatment for disclosure and external-link controls", () => {
    expect(guide).toContain("focus-visible:ring-inset focus-visible:ring-navy");
    expect(guide).toContain("(opens in a new tab)");
  });

  it("places the guide before the file-selection control", () => {
    expect(room.indexOf("{trustGuide}")).toBeLessThan(room.indexOf('id="relationship-import-file"'));
    expect(page).toContain("trustGuide={<SecureImportTrustGuide />}");
  });

  it("associates the file requirements and progress updates with accessible controls", () => {
    expect(room).toContain('aria-describedby="prepare-description import-file-requirements"');
    expect(room).toContain('aria-label="Import progress"');
    expect(room).toContain('role="status"');
    expect(room).toContain('aria-atomic="true"');
  });
});
