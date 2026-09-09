import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const list = readFileSync(resolve(process.cwd(), "src/app/admin/prospects/ReconciledProspects.tsx"), "utf8");
const audit = readFileSync(resolve(process.cwd(), "src/app/admin/prospects/audits/[firmId]/page.tsx"), "utf8");

describe("Unified prospect list UI contract", () => {
  it("keeps shared registry and legacy identity work in one four-view shell", () => {
    expect(list).toContain('data-ui-component-content="prospect-unified-list"');
    expect(list).toContain('["all", "All records"');
    expect(list).toContain('["shared_registry", "Shared registry"');
    expect(list).toContain('["audit_ready", "Audit ready"');
    expect(list).toContain('["identity_review", "Identity review"');
    expect(list).toContain("Record source");
    expect(list).toContain("Identity status");
    expect(list).toContain("Legacy provenance");
    expect(list).toContain("More qualification filters");
    expect(list).toContain("Observed lawyer count");
    expect(list).toContain("11 to 20 lawyers");
    expect(list).toContain("Minimum lawyers");
    expect(list).toContain("Maximum lawyers");
    expect(list).toContain("Public contact evidence");
    expect(list).toContain("Owner or leadership");
    expect(list).toContain("Other named public contacts");
    expect(list).toContain("Visibly published email");
    expect(list).toContain(">Unknown</span>");
    expect(list).toContain("They do not authorize outreach");
    expect(list).not.toContain("mailto:");
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
      "Owner identified",
      "Public email",
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
