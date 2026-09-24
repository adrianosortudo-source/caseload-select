import { describe, expect, it } from "vitest";
import { filterReconciledGtaProspects, type ReconciledGtaProspect } from "@/lib/gta-prospect-records";
import { prospectProfileFields } from "@/lib/gta-prospect-profile";
import { SYNTHETIC_SUPPLEMENTAL_GBP_PROSPECTS } from "@/app/dev/prospect-qualified-preview/synthetic-supplemental";

const records: ReconciledGtaProspect[] = ["selected", "held", "rejected", "incomplete", "not_selected"].map((status, index) => ({
  ...SYNTHETIC_SUPPLEMENTAL_GBP_PROSPECTS[0], id: "fixture-" + status, firmName: "Fixture " + index,
  supplementalEvidence: { identity: null, websiteIntake: { observedOn: "2026-09-24", opportunityState: "supported", channels: [{ kind: "web-form", sourceUrl: "https://example.test/source-" + index, visibleFields: ["Sixth form field"] }] }, qualification: { state: status === "selected" ? "qualified" : status === "rejected" ? "disqualified" : "needs_evidence", cohort: "fixture-all", assessedOn: "2026-09-23", criteria: { originalStatus: status, unknown: null, evidence: { sourceUrl: "https://example.test/criteria-" + index, observedOn: "2026-09-22", failure: "blocked-" + index }, "escaped/key~": false, textBoolean: "false" } } },
}));

describe("retained profile search and exact field filters", () => {
  it.each(["selected", "held", "rejected", "incomplete", "not_selected"])("searches facts, source URLs, dates and original %s disposition without a UUID", status => {
    const index = ["selected", "held", "rejected", "incomplete", "not_selected"].indexOf(status);
    for (const query of [status, "criteria-" + index, "blocked-" + index, "source-" + index]) expect(filterReconciledGtaProspects(records, { query }).map(row => row.id)).toEqual(query === "selected" ? ["fixture-selected", "fixture-not_selected"] : ["fixture-" + status]);
    expect(filterReconciledGtaProspects([records[index]], { query: "2026-09-22" })).toHaveLength(1);
    expect(filterReconciledGtaProspects([records[index]], { query: "Sixth form field", intakeChannel: "web-form" })).toHaveLength(1);
    expect(filterReconciledGtaProspects(records, { profileField: "/supplementalEvidence/qualification/criteria/originalStatus", profileValue: JSON.stringify(status) }).map(row => row.id)).toEqual(["fixture-" + status]);
  });
  it("uses escaped JSON pointer paths and distinguishes unknown, false and text", () => {
    const fields = prospectProfileFields(records[0]);
    expect(fields).toContainEqual({ path: "/supplementalEvidence/qualification/criteria/escaped~1key~0", value: "false" });
    expect(fields).toContainEqual({ path: "/supplementalEvidence/qualification/criteria/unknown", value: "null" });
    expect(fields).toContainEqual({ path: "/supplementalEvidence/qualification/criteria/textBoolean", value: '"false"' });
    expect(filterReconciledGtaProspects(records, { profileField: "/supplementalEvidence/qualification/criteria/textBoolean", profileValue: "false" })).toHaveLength(0);
    expect(filterReconciledGtaProspects(records, { profileField: "/not-recorded" })).toHaveLength(0);
  });
  it("does not treat supported supplemental intake as every possible website opportunity", () => {
    expect(filterReconciledGtaProspects(records, { websiteOpportunityType: "technical_path" })).toHaveLength(0);
    expect(filterReconciledGtaProspects(records, { websiteOpportunityType: "public_site_review" })).toHaveLength(5);
  });
});
