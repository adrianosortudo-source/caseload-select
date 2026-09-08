import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const list = readFileSync(resolve(process.cwd(), "src/app/admin/prospects/ReconciledProspects.tsx"), "utf8");
const audit = readFileSync(resolve(process.cwd(), "src/app/admin/prospects/audits/[firmId]/page.tsx"), "utf8");

describe("Firm expansion qualification UI contract", () => {
  it("keeps qualification in Firm expansion with the four decision views", () => {
    expect(list).toContain('data-ui-component-content="firm-expansion"');
    expect(list).toContain('["all", "All reviewed"');
    expect(list).toContain('["qualified", "Qualified"');
    expect(list).toContain('["audit_ready", "Audit ready"');
    expect(list).toContain('["needs_evidence", "Needs evidence"');
    expect(list).toContain("More qualification filters");
  });

  it("exposes the evidence dimensions and the protected in-console audit route", () => {
    for (const label of [
      "Advertising activity",
      "Advertising source type",
      "GBP opportunity",
      "Website opportunity",
      "Visible intake channel",
      "Lawyer-count confidence",
      "Evidence freshness",
      "Research cohort",
    ]) expect(list).toContain(label);
    expect(list).toContain("/admin/prospects/audits/");
    expect(audit).toContain("getQualifiedProspectByFirmId");
    expect(audit).toContain("evidenceForQualifiedProspect");
    expect(audit).toContain("SHA-256:");
    expect(audit).toContain("Observable advertising activity");
    expect(audit).toContain("Website and intake opportunity");
    expect(audit).toContain("Marketing review priorities");
    expect(audit).toContain("dossier.audit.verificationPriorities.map");
    expect(audit).toContain("do not assert performance, results or deficiencies");
    expect(audit).not.toContain("decodeURIComponent(firmId)");
  });

  it("keeps governed copy full width and free of em dashes", () => {
    for (const source of [list, audit]) {
      expect(source).not.toContain("—");
      expect(source).not.toMatch(/max-w-|maxWidth|maxInlineSize/);
    }
    expect(list.match(/data-ui-copy=/g)?.length).toBeGreaterThanOrEqual(4);
    expect(audit.match(/data-ui-copy=/g)?.length).toBeGreaterThanOrEqual(16);
  });
});
