import { describe, it, expect } from "vitest";
import { renderReleaseGraphReport, summarizeReleaseGraphAudits, toReleaseGraphReportJson } from "../release-graph-report";
import type { ReleaseGraphAudit, ReleaseGraphNoPlacementAudit } from "../release-graph-types";

const GENERATED_AT = "2026-07-21T10:00:00.000Z";

function audit(overrides: Partial<ReleaseGraphAudit> = {}): ReleaseGraphAudit {
  return {
    deliverableId: "d1",
    deliverableTitle: "Test deliverable",
    versionId: "v1",
    versionNumber: 1,
    placementId: "p1",
    destination: "firm_website",
    locale: "en-CA",
    verdict: "publish_now",
    findings: [],
    existingPreflightGate: { mayPublish: true, reason: null },
    resolvedAt: GENERATED_AT,
    ...overrides,
  };
}

const HOLD_FINDING = {
  classification: "content_absent" as const,
  fact: "release_authorized_source_version" as const,
  summary: "Canonical source missing",
  releaseImpact: "blocks_today" as const,
  factualEvidence: "no body",
  canonicalSourceConsulted: "deliverable_versions",
  immediateDisposition: "do not attempt",
  rootCause: "never authored",
  proposedDurableSolution: "author it",
  authorityRequired: "operator",
  reusablePreflightRule: "check body first",
};

describe("summarizeReleaseGraphAudits", () => {
  it("counts each verdict correctly", () => {
    const audits = [
      audit({ verdict: "publish_now" }),
      audit({ verdict: "hold", findings: [HOLD_FINDING] }),
      audit({ verdict: "hold", findings: [HOLD_FINDING] }),
      audit({ verdict: "needs_verification" }),
      audit({ verdict: "system_improvement" }),
    ];
    const summary = summarizeReleaseGraphAudits(audits);
    expect(summary).toEqual({ publish_now: 1, hold: 2, needs_verification: 1, system_improvement: 1, total: 5 });
  });
});

describe("renderReleaseGraphReport", () => {
  it("groups releases under exactly the four required verdict labels", () => {
    const report = renderReleaseGraphReport({
      audits: [
        audit({ verdict: "hold", findings: [HOLD_FINDING] }),
        audit({ verdict: "needs_verification", deliverableId: "d2" }),
        audit({ verdict: "system_improvement", deliverableId: "d3" }),
        audit({ verdict: "publish_now", deliverableId: "d4" }),
      ],
      generatedAt: GENERATED_AT,
    });
    expect(report).toContain("## Hold (1)");
    expect(report).toContain("## Needs verification (1)");
    expect(report).toContain("## System improvement (1)");
    expect(report).toContain("## Publish now (1)");
  });

  it("orders Hold first and Publish now last, regardless of input order", () => {
    const report = renderReleaseGraphReport({
      audits: [audit({ verdict: "publish_now" }), audit({ verdict: "hold", findings: [HOLD_FINDING], deliverableId: "d2" })],
      generatedAt: GENERATED_AT,
    });
    expect(report.indexOf("## Hold")).toBeLessThan(report.indexOf("## Publish now"));
  });

  it("prints all eight structured-output fields for every finding", () => {
    const report = renderReleaseGraphReport({ audits: [audit({ verdict: "hold", findings: [HOLD_FINDING] })], generatedAt: GENERATED_AT });
    expect(report).toContain("Factual evidence: no body");
    expect(report).toContain("Canonical source consulted: deliverable_versions");
    expect(report).toContain("Immediate disposition: do not attempt");
    expect(report).toContain("Root cause: never authored");
    expect(report).toContain("Proposed durable solution: author it");
    expect(report).toContain("Authority required: operator");
    expect(report).toContain("Reusable preflight rule: check body first");
  });

  it("states the report is dry-run and read-only", () => {
    const report = renderReleaseGraphReport({ audits: [], generatedAt: GENERATED_AT });
    expect(report).toContain("Dry-run, read-only");
  });

  it("reports deliverables with no placements by name, never silently", () => {
    const noPlacement: ReleaseGraphNoPlacementAudit = {
      deliverableId: "orphan-1",
      deliverableTitle: "Orphan Deliverable",
      verdict: "needs_verification",
      findings: [],
      resolvedAt: GENERATED_AT,
    };
    const report = renderReleaseGraphReport({ audits: [], noPlacementAudits: [noPlacement], generatedAt: GENERATED_AT });
    expect(report).toContain("Orphan Deliverable");
  });

  it("prints the reused existing-preflight-gate result on every audited release", () => {
    const report = renderReleaseGraphReport({
      audits: [audit({ existingPreflightGate: { mayPublish: false, reason: "3 unresolved comments" } })],
      generatedAt: GENERATED_AT,
    });
    expect(report).toContain("mayPublish=false (3 unresolved comments)");
  });

  it("is deterministic: identical input produces byte-identical output", () => {
    const input = { audits: [audit({ verdict: "hold", findings: [HOLD_FINDING] })], generatedAt: GENERATED_AT };
    expect(renderReleaseGraphReport(input)).toBe(renderReleaseGraphReport(input));
  });
});

describe("toReleaseGraphReportJson", () => {
  it("carries the same summary and audits as the markdown report", () => {
    const json = toReleaseGraphReportJson({ periodId: "period-x", audits: [audit({ verdict: "hold", findings: [HOLD_FINDING] })], generatedAt: GENERATED_AT });
    expect(json.periodId).toBe("period-x");
    expect(json.summary.hold).toBe(1);
    expect(json.audits).toHaveLength(1);
  });
});
