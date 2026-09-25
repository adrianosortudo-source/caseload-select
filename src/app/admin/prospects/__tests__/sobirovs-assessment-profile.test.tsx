import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvidenceCard } from "../ProspectResearchDetail";
import type { ProspectEnrichmentEvidence } from "@/lib/prospect-enrichment-reader";

// Public facts copied from the governed Sobirovs read-back dated 2026-09-24.
// The test checks presentation, not whether the live Admin import has occurred.
const firmId = "8d892094-f43b-48bb-aa51-eee5766dabbe";
const assessment: ProspectEnrichmentEvidence = {
  id: "7fc25a5c-21aa-4e14-b895-ef1dd3b0f14f",
  table: "gta_prospect_qualification_assessments",
  data: {
    id: "7fc25a5c-21aa-4e14-b895-ef1dd3b0f14f", firm_id: firmId,
    qualification_state: "qualified", assessed_on: "2026-09-24",
    criteria: { record: {
      lawyerCount: { count: 3, sourceUrl: "https://sobirovs.com/about-us/our-team/", observedAt: "2026-09-24" },
      decisionMaker: { name: "Rakhmad Sobirov", role: "Co-Founder and Managing Lawyer", authorityEvidence: { sourceUrl: "https://sobirovs.com/about-us/careers/", observedAt: "2026-09-24" } },
      email: { address: "rakhmad@sobirovs.com", attributedTo: "Rakhmad Sobirov", sourceUrl: "https://sobirovs.com/team/rakhmad-sobirov/", observedAt: "2026-09-24" },
      advertising: { status: "pixels-detected", recentAdStatus: "not-verified", observations: [{ vendor: "google_ads", kind: "conversion-tag", identifier: "AW-378398717", sourceUrl: "https://sobirovs.com/", observedAt: "2026-09-24" }] },
    } },
  },
  semanticSha256: "a".repeat(64),
  date: { observedAt: null, observedOn: "2026-09-24", precision: "date_only" },
  dateLabel: "Observed September 24, 2026", freshness: "current",
  sourceUrls: [], legacyCriteria: [], qualificationCategory: "Qualified", enrichment: [],
  retractions: [], profileSource: null,
};

describe("governed qualification research in the firm profile", () => {
  it("renders Sobirovs count, owner, attributed email, advertising tag and source dates as labeled fields", () => {
    const html = renderToStaticMarkup(createElement(EvidenceCard, { item: assessment }));
    for (const label of ["Observed lawyer count", "Roster source", "Roster observed", "Named owner or decision maker", "Leadership role", "Role source", "Role observed", "Attributed direct email", "Email source", "Email observed", "Advertising signal status", "Advertising signals and sources", "Recent ad status"]) {
      expect(html).toContain(label);
    }
    for (const fact of [">3<", "Rakhmad Sobirov", "Co-Founder and Managing Lawyer", "rakhmad@sobirovs.com", "AW-378398717", "2026-09-24", "not-verified"]) {
      expect(html).toContain(fact);
    }
    expect(html).toContain("Complete stored evidence");
  });

  it("shows unknown values without manufacturing missing owner or contact facts", () => {
    const held = { ...assessment, data: { ...assessment.data, qualification_state: "needs_evidence", criteria: { record: { lawyerCount: { count: 3, sourceUrl: null, observedAt: null }, decisionMaker: null, email: null, advertising: { status: "unknown", observations: [] } } } } };
    const html = renderToStaticMarkup(createElement(EvidenceCard, { item: held }));
    expect(html).toContain("Not supplied");
    expect(html).toContain("unknown");
    expect(html).not.toContain("rakhmad@sobirovs.com");
    expect(html).not.toContain("AW-378398717");
  });
});
