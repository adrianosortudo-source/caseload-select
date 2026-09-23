import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));
import { compareResearchItem } from "../_comparison-read";
import type { ProspectEnrichmentEvidence, ProspectEnrichmentFirmDetail } from "@/lib/prospect-enrichment-reader";
const id = "00000000-0000-4000-8000-000000000001";
function evidence(data: Record<string, unknown>, table = "prospect_decision_maker_contacts"): ProspectEnrichmentEvidence {
  return { id, table, data: { id, firm_id: id, ...data }, semanticSha256: "a".repeat(64), date: { observedAt: null, observedOn: "2026-09-23", precision: "date_only" }, dateLabel: "Observed September 23, 2026", freshness: "current", sourceUrls: [], legacyCriteria: [], qualificationCategory: null, enrichment: [], retractions: [], profileSource: null } as ProspectEnrichmentEvidence;
}
function detail(items: ProspectEnrichmentEvidence[]): ProspectEnrichmentFirmDetail { return { firm: { id, displayName: "Synthetic Legal", websiteUrl: null, sourceRecordKey: "synthetic", revision: "4" }, sections: [{ key: "profile", title: "Current profile", state: "available", items, errorId: null, incomplete: false, nextCursors: {} }], complete: true, revisionStable: true, profileChoices: [], readAt: "2026-09-23T12:00:00Z", rendererVersion: "prospect-enrichment/v1" }; }
const proposed = { itemId: id, itemKind: "contact", data: { evidenceState: "asserted", data: { personName: "Synthetic Owner", contactType: "public-named-email", contactValue: "new@enrichment-fixture-002.example" } } };
describe("authenticated current-versus-proposed comparison", () => {
  it("compares like-for-like contacts while retaining different general inbox evidence", () => {
    const exact = evidence({ person_name: "Synthetic Owner", contact_type: "public-named-email", contact_value: "old@enrichment-fixture-002.example" });
    const general = evidence({ person_name: null, contact_type: "general-inbox", contact_value: "info@enrichment-fixture-002.example" });
    const result = compareResearchItem(proposed, detail([exact, general]));
    expect(result.currentValue.acceptedHistory).toHaveLength(2);
    expect(result.currentValue.fields.find((field) => field.field === "contact_value")?.current).toHaveLength(1);
    expect(result.conflicts[0]).toContain("contact_value");
    expect(result.currentValue.selectedProfileValues).toEqual([]);
  });
  it("preserves supplied null separately from absent values and explicit false", () => {
    const current = evidence({ person_name: "Synthetic Owner", contact_type: "public-named-email", contact_value: null, role_verification: false });
    const result = compareResearchItem({ ...proposed, data: { data: { personName: "Synthetic Owner", contactType: "public-named-email", contactValue: null, roleVerification: false } } }, detail([current]));
    expect(result.currentValue.fields.find((field) => field.field === "contact_value")).toMatchObject({ proposed: { supplied: true, value: null }, current: [{ supplied: true, value: null, matches: true }] });
    expect(result.currentValue.fields.find((field) => field.field === "role_verification")?.current[0].matches).toBe(true);
    expect(result.currentValue.fields.find((field) => field.field === "role_label")).toMatchObject({ proposed: { supplied: false }, current: [{ supplied: false, matches: null }] });
  });
  it("keeps retracted contradictory evidence in history without treating it as current conflict", () => {
    const current = { ...evidence({ person_name: "Synthetic Owner", contact_type: "public-named-email", contact_value: "old@enrichment-fixture-002.example" }), retractions: [{ reason: "Superseded source" }] };
    const result = compareResearchItem(proposed, detail([current]));
    expect(result.currentValue.acceptedHistory).toHaveLength(1); expect(result.conflicts).toEqual([]);
  });
  it("distinguishes unresolved identity, failed read, and proven absence", () => {
    expect(compareResearchItem(proposed, null).currentValue.state).toBe("unresolved");
    expect(compareResearchItem(proposed, null, true).currentValue.state).toBe("error");
    expect(compareResearchItem(proposed, detail([])).currentValue.state).toBe("empty");
    const failed = detail([]); const result = compareResearchItem(proposed, { ...failed, sections: [{ ...failed.sections[0], state: "error", errorId: "synthetic", incomplete: true }] });
    expect(result.currentValue.state).toBe("error"); expect(result.conflicts).toHaveLength(1);
  });
  it("labels source-only provenance as not applicable and forbids retracted profile use", () => {
    expect(compareResearchItem({ ...proposed, itemKind: "source" }, null).currentValue.state).toBe("not_applicable");
    expect(compareResearchItem({ ...proposed, data: { evidenceState: "retracted" } }, detail([])).profileOmissionReason).toContain("retracted");
  });
});
