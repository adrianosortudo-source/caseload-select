import { describe, expect, it } from "vitest";
import { createProspectEnrichmentFixtures, createProspectEnrichmentLegacyCriteriaFixtures, ENRICHMENT_FIXTURE_OBSERVED_ON } from "../__fixtures__/prospect-enrichment-v1";
import { buildProspectEnrichmentClientItems, parseProspectEnrichmentEnvelope } from "../prospect-enrichment-contract";
import { prospectEnrichmentProtocolHash } from "../prospect-enrichment-hash";
import { projectLegacyCriteria } from "../prospect-enrichment-legacy";
describe("synthetic prospect enrichment fixture inventory", () => {
  it("provides ten deterministic valid scenarios and every declared variant", () => {
    const fixtures = createProspectEnrichmentFixtures(); expect(fixtures).toHaveLength(10);
    expect(prospectEnrichmentProtocolHash(fixtures)).toBe(prospectEnrichmentProtocolHash(createProspectEnrichmentFixtures()));
    for (const fixture of fixtures) for (const value of [fixture.envelope, ...fixture.variants.map((variant) => variant.envelope)]) {
      const parsed = parseProspectEnrichmentEnvelope(value);
      expect(parsed, fixture.scenario + ": " + JSON.stringify(parsed.ok ? {} : parsed.issues)).toMatchObject({ ok: true });
      expect(value.controls).toEqual({ contactFormsSubmitted: false, chatSessionsStarted: false, outreachSent: false });
      for (const source of value.sources) expect(new URL(source.url!).hostname).toMatch(/enrichment-fixture-\d{3}\.example$/);
    }
  });
  it("preserves unknowns, failed retrieval, and the original eleven-lawyer cohort decision", () => {
    const fixtures = createProspectEnrichmentFixtures();
    expect(fixtures[3].envelope.assessment?.selectionDisposition).toBe("disqualified");
    expect(fixtures[4].envelope.originalResearch.content).toMatchObject({ ownerVerified: false, unknown: null, contacts: [], roster: null });
    expect(fixtures[4].variants[0].envelope).toMatchObject({ sources: [], observations: [], assessment: null });
    expect(fixtures[7].envelope.sources[0]).toMatchObject({ publicationLabel: "2023", publicationPrecision: "year", httpStatus: 403, observedOn: ENRICHMENT_FIXTURE_OBSERVED_ON });
  });
  it("keeps package retry and source-event semantic conflicts independently testable", () => {
    const fixtures = createProspectEnrichmentFixtures(); const retry = fixtures[8];
    expect(prospectEnrichmentProtocolHash(retry.envelope)).toBe(prospectEnrichmentProtocolHash(retry.variants[0].envelope));
    expect(buildProspectEnrichmentClientItems(retry.envelope)).toEqual(buildProspectEnrichmentClientItems(retry.variants[1].envelope));
    const conflict = fixtures[9]; const old = buildProspectEnrichmentClientItems(conflict.envelope)[0]; const changed = buildProspectEnrichmentClientItems(conflict.variants[2].envelope)[0];
    expect(changed.sourceEventKey).toBe(old.sourceEventKey); expect(changed.semanticSha256).not.toBe(old.semanticSha256);
  });
  it("retains all 39 synthetic historical rows including 5 boolean-only and 34 rich criteria", () => {
    const rows = createProspectEnrichmentLegacyCriteriaFixtures(); expect(rows).toHaveLength(39);
    expect(rows.slice(0, 5).every((row) => Object.keys(row.criteria!).length === 2)).toBe(true);
    for (const row of rows) {
      const projected = projectLegacyCriteria(String(row.id), row.criteria!);
      expect(projected.find((item) => item.selector === "/criteria/ownerVerified")?.value).toBe(false);
      if (projected.length > 2) expect(projected.find((item) => item.selector === "/criteria/unknown")?.value).toBeNull();
      expect(projected.every((item) => item.disposition === "retain_only")).toBe(true);
    }
  });
});
