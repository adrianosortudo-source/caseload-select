import { describe, expect, it } from "vitest";
import { appendResearchHistoryPage, researchEvidenceFields, researchFirmHeading } from "../prospect-enrichment-presentation";
import type { ProspectEnrichmentEvidence, ProspectEnrichmentFirmDetail } from "../prospect-enrichment-reader";
const id = "00000000-0000-4000-8000-000000000001";
const base: ProspectEnrichmentEvidence = { id, table: "prospect_opportunity_observations", data: { id, firm_id: id, finding: "Synthetic observation", recommendation_hypothesis: null }, semanticSha256: "a".repeat(64), date: { observedAt: null, observedOn: "2026-09-23", precision: "date_only" }, dateLabel: "Observed September 23, 2026", freshness: "current", sourceUrls: [], legacyCriteria: [], qualificationCategory: null, enrichment: [], retractions: [], profileSource: null };
function detail(): ProspectEnrichmentFirmDetail { return { firm: { id, displayName: "Synthetic Legal", websiteUrl: null, sourceRecordKey: "synthetic", revision: "1" }, sections: [{ key: "marketing", title: "Marketing and intake", state: "empty", items: [], errorId: null, incomplete: true, nextCursors: { prospect_opportunity_observations: "synthetic-cursor" } }], complete: false, revisionStable: true, profileChoices: [], readAt: "2026-09-23T12:00:00Z", rendererVersion: "prospect-enrichment/v1" }; }
describe("source-linked dossier presentation", () => {
  it("exposes the five required marketing categories without losing null/empty/false data", () => {
    const item = { ...base, enrichment: [{ packageId: id, itemId: id, sourceEventId: id, data: { data: { observation: "Exact finding", strengths: [], interpretation: "Synthetic interpretation", recommendation: null, unknowns: ["owner role"] } }, sources: [], sourceIds: [], originalResearch: {}, runId: "synthetic", payloadSha256: "a".repeat(64) }] };
    const fields = researchEvidenceFields(item)[0];
    expect(fields.slice(0, 5).map((field) => field.label)).toEqual(["Observation", "Strengths", "Interpretation", "Recommendation", "Unknowns"]);
    expect(fields[1].value).toEqual([]); expect(fields[3].value).toBeNull(); expect(fields[4].value).toEqual(["owner role"]);
  });
  it("keeps gate failures and missing gates distinct from disqualification", () => {
    const item = { ...base, table: "gta_prospect_qualification_assessments", data: { qualification_state: "needs_evidence", criteria: { missingGates: ["owner_role"], ownerVerified: false }, assessed_on: "2026-09-23" }, qualificationCategory: "Incomplete" };
    const fields = researchEvidenceFields(item)[0];
    expect(fields.find((field) => field.label === "Original decision")?.value).toBe("needs_evidence");
    expect(fields.find((field) => field.label === "Missing gates")?.value).toEqual(["owner_role"]);
    expect(fields.find((field) => field.label === "Display category")?.value).toBe("Incomplete");
  });
  it("finishes paginated coverage and changes empty to available without removing errors", () => {
    const result = appendResearchHistoryPage(detail(), "marketing", base.table, { table: base.table, items: [base], nextCursor: null });
    expect(result.complete).toBe(true); expect(result.sections[0].state).toBe("available");
    const failed = { ...detail(), sections: [{ ...detail().sections[0], state: "error" as const, errorId: "synthetic" }] };
    expect(appendResearchHistoryPage(failed, "marketing", base.table, { table: base.table, items: [base], nextCursor: null }).complete).toBe(false);
    expect(() => appendResearchHistoryPage(detail(), "marketing", base.table, { table: base.table, items: [{ ...base, data: { firm_id: "foreign" } }], nextCursor: null })).toThrow("requested firm");
  });
  it("reports latest loaded observation as partial until all sections are complete", () => {
    const result = { ...detail(), sections: [{ ...detail().sections[0], items: [base] }] };
    expect(researchFirmHeading(result)).toMatchObject({ latestObservation: "Observed September 23, 2026", freshness: "Within refresh period", complete: false, stableIds: [], identityState: "error" });
  });
  it("keeps freshness states concise and distinct", () => {
    const older = { ...base, freshness: "refresh_recommended" as const };
    const result = { ...detail(), sections: [{ ...detail().sections[0], items: [older] }] };
    expect(researchFirmHeading(result).freshness).toBe("Refresh recommended");
    expect(researchFirmHeading(detail()).freshness).toBe("Freshness unknown");
  });
});
