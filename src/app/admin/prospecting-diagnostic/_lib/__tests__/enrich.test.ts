import { describe, it, expect } from "vitest";
import {
  buildResearchPacket,
  buildEnrichPrompt,
  parseEnrichment,
  EMPTY_ENRICHMENT,
} from "../enrich";
import type { SeoCheckResult, SeoPageResult } from "../seo-types";

const EM_DASH = String.fromCharCode(0x2014);

function mkPage(over: Partial<SeoPageResult> & { url: string }): SeoPageResult {
  return {
    url: over.url,
    title: over.title ?? null,
    pageType: over.pageType ?? "other",
    schema: over.schema ?? { types: [], fields: { address: false, areaServed: false } },
    lawFirm: over.lawFirm ?? { practiceAreaIntent: false, addressVisible: false },
    wordCount: over.wordCount,
  };
}

function mkResult(pages: SeoPageResult[]): Pick<SeoCheckResult, "pagesScanned" | "pages"> {
  return { pagesScanned: pages.length, pages };
}

describe("buildResearchPacket", () => {
  it("extracts practice slugs, schema union, address signal, and capped page summaries", () => {
    const result = mkResult([
      mkPage({
        url: "https://x-law.ca/",
        title: "Immigration Lawyer in Toronto | X Law",
        pageType: "homepage",
        schema: { types: ["LegalService", "Organization"], fields: { address: true, areaServed: false } },
        lawFirm: { practiceAreaIntent: true, addressVisible: true },
      }),
      mkPage({
        url: "https://x-law.ca/immigration-law",
        title: "Immigration Law Services",
        pageType: "practice",
        schema: { types: ["LegalService"], fields: { address: false, areaServed: false } },
        lawFirm: { practiceAreaIntent: true, addressVisible: false },
      }),
    ]);

    const packet = buildResearchPacket(
      { firmName: "X Law", primaryDomain: "x-law.ca", linkedinUrl: "linkedin.com/company/x-law" },
      result
    );

    expect(packet.firmName).toBe("X Law");
    expect(packet.primaryDomain).toBe("x-law.ca");
    expect(packet.linkedinUrl).toBe("linkedin.com/company/x-law");
    expect(packet.pagesScanned).toBe(2);
    expect(packet.addressSignal).toBe(true);
    expect(packet.schemaTypes).toEqual(expect.arrayContaining(["LegalService", "Organization"]));
    expect(packet.practiceSlugs).toContain("/immigration-law");
    expect(packet.pages[0].title).toContain("Toronto");
    expect(packet.pages[0].practiceIntent).toBe(true);
  });

  it("tolerates a result with no pages", () => {
    const packet = buildResearchPacket(
      { firmName: "Y Law", primaryDomain: "y-law.ca" },
      { pagesScanned: 0, pages: undefined }
    );
    expect(packet.pages).toEqual([]);
    expect(packet.addressSignal).toBe(false);
    expect(packet.schemaTypes).toEqual([]);
    expect(packet.linkedinUrl).toBeUndefined();
  });
});

describe("buildEnrichPrompt", () => {
  it("carries the no-invention rules and the page evidence", () => {
    const packet = buildResearchPacket(
      { firmName: "X Law", primaryDomain: "x-law.ca" },
      mkResult([mkPage({ url: "https://x-law.ca/", title: "Toronto Family Lawyer", pageType: "homepage" })])
    );
    const { system, user } = buildEnrichPrompt(packet);
    expect(system).toContain("Do not infer or invent competitors");
    expect(system).toContain("Do not invent practice areas");
    expect(system).toContain("low confidence");
    expect(system).toContain("Do not use LinkedIn content");
    expect(user).toContain("X Law");
    expect(user).toContain("Toronto Family Lawyer");
  });
});

describe("parseEnrichment", () => {
  it("coerces a well-formed response", () => {
    const raw = JSON.stringify({
      market: { value: "Toronto, Ontario", confidence: "high", evidence: ["Homepage title"] },
      practiceAreaFocus: {
        summary: "Immigration law focus",
        practiceAreas: ["Immigration", "Work permits"],
        confidence: "high",
        evidence: ["/immigration-law"],
      },
      alternateDomains: [{ domain: "https://www.X-Law.com/", reason: "redirect", confidence: "medium" }],
    });
    const e = parseEnrichment(raw);
    expect(e.market.value).toBe("Toronto, Ontario");
    expect(e.practiceAreaFocus.practiceAreas).toEqual(["Immigration", "Work permits"]);
    expect(e.alternateDomains[0].domain).toBe("x-law.com"); // protocol + www stripped, lowercased
    expect(e.alternateDomains[0].confidence).toBe("medium");
  });

  it("survives code fences around the JSON", () => {
    const raw = "```json\n" + JSON.stringify({ market: { value: "Ottawa, Ontario", confidence: "medium" } }) + "\n```";
    const e = parseEnrichment(raw);
    expect(e.market.value).toBe("Ottawa, Ontario");
  });

  it("clamps an invalid confidence to low and strips em dashes", () => {
    const raw = JSON.stringify({
      market: { value: `Toronto ${EM_DASH} Ontario`, confidence: "VERY_SURE", evidence: [] },
    });
    const e = parseEnrichment(raw);
    expect(e.market.confidence).toBe("low");
    expect(e.market.value.includes(EM_DASH)).toBe(false);
  });

  it("returns the empty enrichment on garbage input", () => {
    expect(parseEnrichment("not json at all")).toEqual(EMPTY_ENRICHMENT);
    expect(parseEnrichment("")).toEqual(EMPTY_ENRICHMENT);
  });

  it("drops alternate-domain entries with no domain", () => {
    const raw = JSON.stringify({
      alternateDomains: [
        { domain: "", reason: "nothing", confidence: "low" },
        { domain: "old-x.ca", reason: "legacy brand", confidence: "low" },
      ],
    });
    const e = parseEnrichment(raw);
    expect(e.alternateDomains).toHaveLength(1);
    expect(e.alternateDomains[0].domain).toBe("old-x.ca");
  });
});
