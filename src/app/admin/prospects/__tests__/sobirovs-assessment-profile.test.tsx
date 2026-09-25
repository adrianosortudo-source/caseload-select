import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvidenceCard } from "../ProspectResearchDetail";
import type { ProspectEnrichmentEvidence } from "@/lib/prospect-enrichment-reader";
import { researchEvidenceFields } from "@/lib/prospect-enrichment-presentation";

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
    const displayed = new Map(researchEvidenceFields(assessment)[0].map((field) => [field.label, field.value]));
    expect(displayed.get("Observed lawyer count")).toBe(3);
    expect(displayed.get("Named owner or decision maker")).toBe("Rakhmad Sobirov");
    expect(displayed.get("Attributed direct email")).toBe("rakhmad@sobirovs.com");
    expect(displayed.get("Advertising signals and sources")).toEqual(expect.arrayContaining([expect.objectContaining({ identifier: "AW-378398717", observedAt: "2026-09-24" })]));
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

  it("projects the root-level Englobe production assessment and its source dates", () => {
    // Minimal slice of the stored Englobe assessment read-back, 2026-09-23.
    const englobe = { ...assessment, data: { ...assessment.data, criteria: {
      lawyerCount: 3,
      lawyerCountEvidence: { count: 3, sourceUrl: "https://englobelaw.com/people/", observedAt: "2026-09-23T04:01:20.299515Z" },
      services: [{ niche: "focused-immigration", sourceUrl: "https://englobelaw.com/practice-areas/immigration/appeal-and-judicial-review/", observedAt: "2026-09-23T04:02:10.7949803Z" }],
      decisionMaker: { name: "Vahid Yeganeh", role: "Founding Partner", roleEvidence: { sourceUrl: "https://englobelaw.com/people/vahid-yeganeh/", observedAt: "2026-09-23T04:01:23.096096Z" } },
      directPublishedEmail: { address: "yeganeh@englobelaw.com", attributedTo: "Vahid Yeganeh", sourceUrl: "https://englobelaw.com/people/vahid-yeganeh/", observedAt: "2026-09-23T04:01:23.096096Z" },
      advertisingPixelStatus: "pixels-detected", advertisingStatus: "recent-ad-verified",
      advertisingObservations: [{ vendor: "google_ads", kind: "ads-tag", identifier: "AW-16570963733", sourceUrl: "https://www.googletagmanager.com/gtag/js?id=GT-5TWNJSR4", observedAt: "2026-09-23T04:00:45.472003Z" }],
    } } };
    const displayed = new Map(researchEvidenceFields(englobe)[0].map((field) => [field.label, field.value]));
    expect(displayed.get("Observed lawyer count")).toBe(3);
    expect(displayed.get("Roster source")).toBe("https://englobelaw.com/people/");
    expect(displayed.get("Named owner or decision maker")).toBe("Vahid Yeganeh");
    expect(displayed.get("Role observed")).toBe("2026-09-23T04:01:23.096096Z");
    expect(displayed.get("Attributed direct email")).toBe("yeganeh@englobelaw.com");
    expect(displayed.get("Advertising signal status")).toBe("pixels-detected");
    expect(displayed.get("Recent ad status")).toBe("recent-ad-verified");
    expect(displayed.get("Advertising signals and sources")).toEqual(expect.arrayContaining([expect.objectContaining({ identifier: "AW-16570963733" })]));
    expect(displayed.get("Practice niche evidence")).toEqual(expect.arrayContaining([expect.objectContaining({ niche: "focused-immigration" })]));
  });

  it("keeps nested firm-fit service evidence visible without promoting a held candidate", () => {
    const held = { ...assessment, data: { ...assessment.data, qualification_state: "needs_evidence", criteria: {
      firmFit: { services: [{ niche: "wills-estates-probate", sourceUrl: "https://valleylaw.ca/areas-of-practice/wills-and-estates/", observedAt: "2026-09-25" }] },
      advertising: { observations: [{ kind: "ads-tag", observedAt: "2026-09-25" }] },
    } } };
    const displayed = new Map(researchEvidenceFields(held)[0].map((field) => [field.label, field.value]));
    expect(displayed.get("Practice niche evidence")).toEqual(expect.arrayContaining([expect.objectContaining({ niche: "wills-estates-probate", observedAt: "2026-09-25" })]));
    expect(displayed.get("Original decision")).toBe("needs_evidence");
    expect(displayed.has("Attributed direct email")).toBe(false);
  });
});
