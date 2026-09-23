import { describe, expect, it } from "vitest";
import { evidenceDate, evidenceDateLabel, evidenceRefreshState, projectLegacyCriteria, qualificationDisplayCategory, readEvidenceJsonPointer, safeEvidenceUrl } from "@/lib/prospect-enrichment-legacy";

describe("retained historical research", () => {
  it("distinguishes absent, null, false, empty lists and escaped JSON keys", () => {
    const original = { null: null, false: false, list: [], "a/b~c": { value: 0 } };
    expect(readEvidenceJsonPointer(original, "/missing")).toEqual({ found: false });
    expect(readEvidenceJsonPointer(original, "/null")).toEqual({ found: true, value: null });
    expect(readEvidenceJsonPointer(original, "/false")).toEqual({ found: true, value: false });
    expect(readEvidenceJsonPointer(original, "/list")).toEqual({ found: true, value: [] });
    expect(readEvidenceJsonPointer(original, "/a~1b~0c/value")).toEqual({ found: true, value: 0 });
    expect(readEvidenceJsonPointer(original, "/constructor")).toEqual({ found: false });
    expect(readEvidenceJsonPointer(original, "/~2")).toEqual({ found: false });
  });
  it("links rich criteria to their original assessment without generating typed contacts or ads", () => {
    const criteria = { lawyerCount: true, ownerVerified: false, observedLawyers: 3, unknown: null, missingGates: ["owner_role", "advertising"], evidence: { sourceUrl: "https://enrichment-fixture-008.example/team", observedOn: "2026-09-23" } };
    const before = JSON.stringify(criteria);
    const projected = projectLegacyCriteria("00000000-0000-4000-8000-000000000008", criteria);
    expect(projected).toHaveLength(Object.keys(criteria).length);
    expect(projected.every((item) => item.parentTable === "gta_prospect_qualification_assessments" && item.disposition === "retain_only")).toBe(true);
    expect(projected.find((item) => item.selector === "/criteria/ownerVerified")?.value).toBe(false);
    expect(projected.find((item) => item.selector === "/criteria/evidence")?.value).toEqual(criteria.evidence);
    expect(JSON.stringify(criteria)).toBe(before);
  });
  it("keeps date precision and never makes publication year an observation", () => {
    const date = evidenceDate({ source_observed_precision: "date_only", source_observed_on: "2026-09-23", observed_at: null });
    expect(date.observedAt).toBeNull();
    expect(evidenceDateLabel(date)).toBe("Observed September 23, 2026");
    expect(evidenceDateLabel(evidenceDate({ publicationLabel: "2023" }))).toBe("Observation date not recorded");
    expect(evidenceDateLabel(evidenceDate({ source_observed_precision: "unknown", observed_at: null, source_observed_on: null }))).toBe("Observation date not recorded");
  });
  it("only labels old observations for refresh, leaving qualification independent", () => {
    const date = evidenceDate({ observed_on: "2026-01-01" });
    expect(evidenceRefreshState(date, 30, new Date("2026-09-23T12:00:00Z"))).toBe("refresh_recommended");
    expect(qualificationDisplayCategory("needs_evidence")).toBe("Incomplete");
    expect(qualificationDisplayCategory("disqualified")).toBe("Disqualified for this cohort");
  });
  it("allows only public http(s) evidence links without credentials", () => {
    expect(safeEvidenceUrl("javascript:alert(1)")).toBeNull();
    expect(safeEvidenceUrl("https://user:secret@example.com/")).toBeNull();
    expect(safeEvidenceUrl("C:/private/source.json")).toBeNull();
    expect(safeEvidenceUrl("https://enrichment-fixture-001.example/team")).toBe("https://enrichment-fixture-001.example/team");
  });
});
