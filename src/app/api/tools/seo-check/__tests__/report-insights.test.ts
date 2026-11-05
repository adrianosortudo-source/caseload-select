import { describe, expect, it } from "vitest";
import { buildReportInsights, decodeEvidenceOnce, normalizeEvidence, type InsightPage } from "../report-insights";

function page(url: string, options: Partial<InsightPage> & { audit?: InsightPage["pageAudit"] } = {}): InsightPage {
  const { audit, ...rest } = options;
  return {
    url, title: "Example service page", pageType: "other", httpStatus: 200,
    indexability: {}, categories: [], ...rest, pageAudit: audit,
  };
}
const prefix = "ENPT 905 393 2999Schedule your consultation Immigration Lawyer in Toronto for Brazilians";
const matchingDescription = (url: string, description = prefix, phoneEvidence = ["905 393 2999"]) => page(url, { pageType: "practice", audit: { metaDescription: description, phoneEvidence } });

function ids(pages: InsightPage[]) { return buildReportInsights(pages).map(item => item.ruleId); }

describe("report insights", () => {
  it("detects only a locale, matching phone and contact phrase at the saved description prefix", () => {
    const result = buildReportInsights([
      matchingDescription("https://alpha.test/en/service/"),
      matchingDescription("https://beta.test/pt/service/", "EN / PT 905 393 2999 Agende sua consulta Immigration guidance", ["+1 (905) 393-2999"]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ ruleId: "R1", state: "Improve first", pages: [{ url: "https://alpha.test/en/service/" }, { url: "https://beta.test/pt/service/" }] });
    expect(result[0].title).toBe("2 search descriptions begin with menu text");
    expect(buildReportInsights([matchingDescription("https://alpha.test/en/service/"), matchingDescription("https://alpha.test/en/service/")])[0]).toMatchObject({ title: "1 search description begins with menu text", pages: [{ url: "https://alpha.test/en/service/" }] });
    expect(result[0].pages[0].evidence).toContain(prefix);
    expect(buildReportInsights([matchingDescription("https://renamed.test/service/")])[0].ruleId).toBe("R1");
  });

  it("suppresses R1 for natural copy, ordinary consultation language, language services, phone mismatch or absent evidence", () => {
    const cases = [
      matchingDescription("https://a.test/", "Immigration support for Canadians. Call 905 393 2999 to discuss your matter."),
      matchingDescription("https://b.test/", "Schedule your consultation today for immigration matters in Ontario."),
      matchingDescription("https://c.test/", "EN PT language translation and interpreting services for businesses."),
      matchingDescription("https://d.test/", prefix, ["905 222 9999"]),
      matchingDescription("https://e.test/", prefix, []),
      page("https://f.test/", { audit: { h2s: [prefix], phoneEvidence: ["905 393 2999"] } }),
      matchingDescription("https://g.test/", "", ["905 393 2999"]),
      page("https://h.test/", { audit: { phoneEvidence: ["905 393 2999"] } }),
    ];
    expect(ids(cases)).not.toContain("R1");
  });

  it("groups exact topic FAQ headings across distinct service descriptors, and omits generic, dedicated-topic and location-only cases", () => {
    const heading = "Frequently Asked Questions About Wrongful Dismissal";
    const three = [
      page("https://firm.test/breach/", { title: "Breach of Contract Lawyer: Toronto & North York", pageType: "other", audit: { h1s: ["Breach of Contract Lawyer In Toronto"], h2s: [heading] } }),
      page("https://firm.test/contract/", { title: "Contract Lawyer: Toronto", pageType: "other", audit: { h1s: ["Contract Lawyer In Toronto"], h2s: [heading] } }),
      page("https://firm.test/disability/", { title: "Disability Insurance Lawyer", pageType: "other", audit: { h1s: ["Disability Insurance Lawyer In Toronto"], h2s: [heading] } }),
    ];
    const r2 = buildReportInsights(three).find(item => item.ruleId === "R2");
    expect(r2?.pages.map(item => item.url)).toHaveLength(3);
    expect(r2?.pages[0].evidence).toContain(heading);
    const dedicated = page("https://firm.test/wrongful-dismissal/", { title: "Wrongful Dismissal Lawyer", pageType: "other", audit: { h1s: ["Wrongful Dismissal Lawyer"], h2s: [heading] } });
    expect(ids([...three.slice(0, 1), dedicated])).not.toContain("R2");
    const locations = [
      page("https://firm.test/location-a/", { title: "Contract Lawyer Toronto", audit: { h1s: ["Contract Lawyer in Toronto"], h2s: [heading] } }),
      page("https://firm.test/location-b/", { title: "Contract Lawyer North York", audit: { h1s: ["Contract Lawyer in North York"], h2s: [heading] } }),
    ];
    expect(ids(locations)).not.toContain("R2");
    expect(ids(three.map(item => ({ ...item, pageType: "article" })))).not.toContain("R2");
    expect(ids(three.map(item => ({ ...item, pageAudit: { ...item.pageAudit, h2s: ["Frequently asked questions"] } })))).not.toContain("R2");
  });

  it("flags other service families on a Portuguese immigration page as context only", () => {
    const saku = page("https://firm.test/imigracao/", {
      title: "Imigração - Example Law", pageType: "other",
      audit: {
        h1s: ["Sua Jornada de Imigração para o Canadá"],
        h2s: ["Separação, guarda de filhos, pensão e questões transnacionais Brasil-Canadá.", "Imóveis & Transações", "Empresas & Corporativo", "Testamentos e Herança", "Direito Civil", "Recebi um N12 no Canadá: Preciso Mesmo Sair de Casa?"],
      },
    });
    const r3 = buildReportInsights([saku]).find(item => item.ruleId === "R3");
    expect(r3).toMatchObject({ state: "Check context", pages: [{ url: saku.url }] });
    expect(r3?.observed).toContain("page title and main heading");
    expect(r3?.observed).toContain("section headings");
    expect(r3?.observed).not.toMatch(/\bH1\b|\bH2\b/);
    expect(r3?.pages[0].evidence).toContain("Separação, guarda de filhos, pensão e questões transnacionais Brasil-Canadá.");
    expect(r3?.pages[0].evidence).toContain("H1:");
    expect(r3?.pages[0].evidence).toContain("H2 evidence:");
    expect(r3?.nextStep).toContain("related services");
  });

  it("does not promote shared related-service headings, ambiguous pages, unsupported evidence or article titles", () => {
    const shared = [
      page("https://firm.test/immigration/", { title: "Immigration - Example", audit: { h1s: ["Immigration services"], h2s: ["Family Law", "Real Estate", "Corporate Law"] } }),
      page("https://firm.test/real-estate/", { title: "Real Estate - Example", audit: { h1s: ["Real Estate services"], h2s: ["Family Law", "Real Estate", "Corporate Law"] } }),
    ];
    expect(ids(shared)).not.toContain("R3");
    expect(ids([page("https://firm.test/unknown/", { title: "Legal Services", audit: { h1s: ["Helping you move forward"], h2s: ["Family Law", "Real Estate"] } })])).not.toContain("R3");
    expect(ids([page("https://firm.test/article/", { pageType: "article", title: "Immigration article", audit: { h1s: ["Immigration guidance"], h2s: ["Family Law", "Real Estate"] } })])).not.toContain("R3");
    expect(ids([page("https://firm.test/immigration/", { title: "Immigration", audit: { h1s: ["Immigration"], h2s: ["My Employer Changed My Job and Cut My Pay", "What Should I Do Next?", "Frequently asked questions"] } })])).not.toContain("R3");
  });

  it("compares exactly two same-language immigration pages even when a translation is also present", () => {
    const pages = [
      page("https://firm.test/en/immigration/", { title: "Immigration - Example Law", audit: { h1s: ["Legal Solutions for Your New Life in Canada", "Our Immigration Services"], h2s: ["Our Immigration Services"] } }),
      page("https://firm.test/en/immigration-lawyer/", { title: "Immigration Lawyer - Example Law", audit: { h1s: ["Immigration Lawyer in Toronto for Brazilians Building a Life in Canada"] } }),
      page("https://firm.test/imigracao/", { title: "Imigração - Example Law", audit: { h1s: ["Sua Jornada de Imigração para o Canadá"] } }),
    ];
    const r4 = buildReportInsights(pages).find(item => item.ruleId === "R4");
    expect(r4).toMatchObject({ state: "Confirm intent" });
    expect(r4?.pages).toHaveLength(2);
    expect(r4?.nextStep).toContain("keep both");
    const translationOnly = [pages[0], pages[2]];
    expect(ids(translationOnly)).not.toContain("R4");
  });

  it("does not treat location-only variants as two service roles and orders input deterministically", () => {
    const locations = [
      page("https://firm.test/en/immigration-toronto/", { title: "Immigration Lawyer Toronto", audit: { h1s: ["Immigration Lawyer in Toronto"] } }),
      page("https://firm.test/en/immigration-north-york/", { title: "Immigration Lawyer North York", audit: { h1s: ["Immigration Lawyer in North York"] } }),
    ];
    expect(ids(locations)).not.toContain("R4");
    const noisy = [matchingDescription("https://z.test/a/"), matchingDescription("https://a.test/b/"), ...locations];
    expect(buildReportInsights(noisy)).toEqual(buildReportInsights([...noisy].reverse()));
  });

  it("does not confuse other Canadian city variants with separate services", () => {
    const heading = "Frequently Asked Questions About Wrongful Dismissal";
    const pages = [
      page("https://firm.test/en/immigration-ottawa/", { title: "Immigration Lawyer Ottawa", audit: { h1s: ["Immigration Lawyer in Ottawa"], h2s: [heading] } }),
      page("https://firm.test/en/immigration-kingston/", { title: "Immigration Lawyer Kingston", audit: { h1s: ["Immigration Lawyer in Kingston"], h2s: [heading] } }),
    ];
    expect(ids(pages)).not.toContain("R2");
    expect(ids(pages)).not.toContain("R4");
  });
  it("decodes exactly one layer safely and normalizes comparison without changing display evidence", () => {
    expect(decodeEvidenceOnce("A &amp; B &#8217; &#x1F600;")).toBe("A & B ’ 😀");
    expect(decodeEvidenceOnce("&amp;#39; &#99999999999999; &#x110000;")).toBe("&#39; &#99999999999999; &#x110000;");
    expect(normalizeEvidence("  IMIGRAÇÃO   &amp; Family ")).toBe("imigracao & family");
  });
});
