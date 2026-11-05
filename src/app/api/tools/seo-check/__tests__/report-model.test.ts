import { describe, expect, it } from "vitest";
import { buildSeoReportModel, checkObservationDisplayText, getDisplayedCategoryWeights, type ReportInput, type ReportPage } from "../report-model";

const base: ReportInput = {
  domain: "example.com",
  methodologyVersion: 5,
  pagesScanned: 2,
  overallScore: 74,
  categories: [{ name: "On-Page SEO", score: 7, maxScore: 10, items: [{ label: "Page title", status: "pass", detail: "A title is present." }] }],
  pages: [
    {
      url: "https://example.com/",
      pageType: "homepage",
      httpStatus: 200,
      indexability: { metaNoindex: false, headerNoindex: false, indexable: true, googleDirectives: { noindex: "not-observed", nofollow: "not-observed", observations: [] } },
      robotsAccess: { google: true, bing: true },
      lawFirm: { phoneVisible: true, contactFormPresent: false, consultationCta: false, practiceAreaIntent: true },
      categories: [],
    },
    {
      url: "https://example.com/services/",
      pageType: "practice",
      httpStatus: 200,
      indexability: { metaNoindex: false, headerNoindex: false, indexable: true, googleDirectives: { noindex: "not-observed", nofollow: "not-observed", observations: [] } },
      robotsAccess: { google: true, bing: true },
      lawFirm: { phoneVisible: false, contactFormPresent: false, consultationCta: false, practiceAreaIntent: true },
      categories: [],
    },
  ],
  issues: [],
  aiBots: [],
};

describe("buildSeoReportModel", () => {
  it("integrates Soni-like technical evidence and shared FAQ review without capping distinct findings", () => {
    const excluded = [
      ["/practice/employment-law/", "Employment Law | Soni Law Firm", "practice"],
      ["/team/", "Our Team | Soni Law Firm", "attorney"],
      ["/team/thanh-justin-pham/", "Thanh Justin Pham | Soni Law Firm", "attorney"],
      ["/team/ummuhani-khaleel/", "Ummuhani Khaleel | Soni Law Firm", "attorney"],
      ["/team/haya-tariq/", "Haya Tariq | Soni Law Firm", "attorney"],
      ["/team/harjot-dosanjh/", "Harjot Dosanjh | Soni Law Firm", "attorney"],
    ] as const;
    const faqHeading = "Frequently Asked Questions About Wrongful Dismissal";
    const servicePages: ReportPage[] = [
      { url: "https://sonilaw.ca/breach-of-contract-lawyer/", title: "Breach of Contract Lawyer: Toronto & North York's Best Lawyer", pageType: "other", httpStatus: 200, indexability: {}, categories: [], pageAudit: { h1s: ["Breach of Contract Lawyer In North York & Toronto"], h2s: [faqHeading] } },
      { url: "https://sonilaw.ca/contract-lawyer/", title: "Contract Lawyer: Employee Contract Dispute Lawyer | North York", pageType: "other", httpStatus: 200, indexability: {}, categories: [], pageAudit: { h1s: ["Contract Lawyer In North York & Toronto"], h2s: [faqHeading] } },
      { url: "https://sonilaw.ca/disability-insurance-lawyer/", title: "Disability Insurance Lawyer: Lawyer in Toronto & North York", pageType: "other", httpStatus: 200, indexability: {}, categories: [], pageAudit: { h1s: ["Disability Insurance Lawyer In North York & Toronto"], h2s: [faqHeading] } },
    ];
    const pages: ReportPage[] = [
      ...excluded.map(([path, title, pageType]) => ({ url: `https://sonilaw.ca${path}`, title, pageType, httpStatus: 200, indexability: { googleDirectives: { noindex: "observed" as const, nofollow: "not-observed" as const, observations: [] }, inSitemap: path === "/team/" }, categories: [] })),
      ...servicePages,
      ...Array.from({ length: 16 }, (_, index) => ({ url: `https://sonilaw.ca/other-${index}/`, title: `Other page ${index}`, pageType: "other", httpStatus: 200, indexability: { googleDirectives: { noindex: "not-observed" as const, nofollow: "not-observed" as const, observations: [] }, inSitemap: false }, categories: [] })),
    ];
    const model = buildSeoReportModel({ ...base, domain: "sonilaw.ca", pagesScanned: 25, pages, issues: [] });
    expect(model.accessSummary).toMatchObject({ checkedPageCount: 25, noindexCount: 6 });
    expect(model.overview?.title).toBe("6 pages ask Google to leave them out of search");
    expect(model.overview?.attention).toContain("One of those 6 pages also appears in the inspected sitemap");
    expect(model.overview?.attention).toContain("overlap is part of the total, not an extra page");
    expect(model.overview?.attention).toContain("other 5 excluded pages");
    expect(model.overview?.findings.map(item => item.id)).toContain("sitemap-exclusion");
    const faq = model.overview?.findings.find(item => item.ruleId === "R2");
    expect(faq?.pages.map(item => item.url)).toHaveLength(3);
    expect(faq?.pages[0].evidence).toContain(faqHeading);
    expect(model.overview?.findings.length).toBeGreaterThan(3);
    expect(model.overview?.focusLinks).toHaveLength(3);
  });

  it("integrates the Sakuraba-like description, Portuguese context and English page-role observations", () => {
    const prefix = "ENPT 905 393 2999Schedule your consultation";
    const described = ["immigration-lawyer", "real-estate-lawyer", "wills-estates-lawyer", "civil-litigation-lawyer"].map(slug => ({
      url: `https://sakurabalaw.ca/en/${slug}/`, title: `${slug === "immigration-lawyer" ? "Immigration Lawyer" : slug} - Sakuraba Law`, pageType: "practice", httpStatus: 200,
      indexability: {}, categories: [], pageAudit: { metaDescription: `${prefix} ${slug}`, phoneEvidence: ["905 393 2999"], h1s: [slug === "immigration-lawyer" ? "Immigration Lawyer in Toronto for Brazilians Building a Life in Canada" : `${slug} in Toronto`] },
    } as ReportPage));
    const pages: ReportPage[] = [
      ...described,
      { url: "https://sakurabalaw.ca/imigracao/", title: "Imigração - Sakuraba Law", pageType: "other", httpStatus: 200, indexability: {}, categories: [], pageAudit: { h1s: ["Sua Jornada de Imigração para o Canadá"], h2s: ["Separação, guarda de filhos, pensão e questões transnacionais Brasil-Canadá.", "Imóveis & Transações", "Empresas & Corporativo", "Testamentos e Herança", "Direito Civil"] } },
      { url: "https://sakurabalaw.ca/en/immigration/", title: "Immigration - Sakuraba Law", pageType: "practice", httpStatus: 200, indexability: {}, categories: [], pageAudit: { h1s: ["Legal Solutions for Your New Life in Canada", "Our Immigration Services"] } },
    ];
    const model = buildSeoReportModel({ ...base, domain: "sakurabalaw.ca", pagesScanned: 25, pages, issues: [] });
    expect(model.overview?.findings.find(item => item.ruleId === "R1")?.pages).toHaveLength(4);
    expect(model.overview?.findings.find(item => item.ruleId === "R3")?.pages[0].evidence).toContain("Imóveis & Transações");
    expect(model.overview?.findings.find(item => item.ruleId === "R4")?.pages).toHaveLength(2);
    expect(model.scoreExplanation).toEqual(buildSeoReportModel({ ...base, pages, issues: [] }).scoreExplanation);
  });

  it("labels the current weighted score clearly and always includes bounded-scope limitations and one CTA", () => {
    const model = buildSeoReportModel(base);
    expect(model.methodology).toMatchObject({ version: 5, label: "Website checks", notice: null });
    expect(model.scoreExplanation).toMatchObject({ assessed: true, score: 74, label: "Limited checks: 1 check type across 1 of 1 category", scoredCheckTypeCount: 1, assessedCategoryCount: 1, totalCategoryCount: 1 });
    expect(model.scoreExplanation.note).toBe("Not a whole-site grade or ranking prediction.");
    expect(model.limitations).toEqual(["Only the initial HTML of 2 pages was checked. This is not a full site audit and does not verify indexing, rankings, enquiries or legal accuracy."]);
    expect(model.cta).toMatchObject({ heading: "Next steps", linkLabel: "Book a conversation", href: "https://cal.com/adriano-caseloadselect/conversation" });
  });

  it("shows the dynamic scored-check and contributing-category denominator", () => {
    const scored = (label: string) => ({ label, status: "pass" as const, detail: "Observed.", scored: true });
    const categories: NonNullable<ReportInput["categories"]> = [
      { name: "On-Page SEO", score: 10, maxScore: 10, items: [scored("Page title")] },
      { name: "Indexability", score: 25, maxScore: 30, items: [scored("HTTP status"), scored("Indexable"), scored("robots.txt crawl access")] },
      { name: "Technical & Security", score: 10, maxScore: 10, items: [scored("HTTPS")] },
      ...["Schema & Structured Data", "AI Visibility", "Legal Marketing", "Local SEO", "Rendering & Crawlability", "Performance", "Links & Content"].map((name) => ({
        name, score: 0, maxScore: 0, items: [{ label: "Context observation", status: "warn" as const, detail: "Observed only.", scored: false }],
      })),
    ];
    const model = buildSeoReportModel({ ...base, overallScore: 98, categories });

    expect(model.scoreExplanation).toMatchObject({
      score: 98,
      label: "Limited checks: 5 check types across 3 of 10 categories",
      scoredCheckTypeCount: 5,
      assessedCategoryCount: 3,
      totalCategoryCount: 10,
    });
    expect(model.scoreExplanation.note).toBe("Not a whole-site grade or ranking prediction.");
  });

  it("marks saved pre-v3 scores as historical and supplies the no-cross-method notice", () => {
    const model = buildSeoReportModel({ ...base, methodologyVersion: 2, overallScore: 88 });
    expect(model.methodology).toMatchObject({ version: 2, label: "Historical score" });
    expect(model.methodology.notice).toBe("This saved scan used an earlier scoring method. Run a new scan for the current report. Scores from different methods should not be compared.");
    expect(model.scoreExplanation).toMatchObject({ score: 88, label: "Historical score" });
  });

  it("preserves saved v3 scores as historical under the v5 report method", () => {
    const model = buildSeoReportModel({ ...base, methodologyVersion: 3, overallScore: 88 });
    expect(model.methodology).toMatchObject({ version: 3, label: "Historical score" });
    expect(model.scoreExplanation).toMatchObject({ score: 88, label: "Historical score" });
    expect(model.methodology.notice).toContain("Scores from different methods should not be compared");
  });

  it("treats unversioned saved scores as historical with method not recorded", () => {
    const unversioned: ReportInput = { ...base };
    delete unversioned.methodologyVersion;
    const model = buildSeoReportModel({ ...unversioned, overallScore: 81 });
    expect(model.methodology).toMatchObject({ version: 2, label: "Method not recorded" });
    expect(model.scoreExplanation).toMatchObject({ score: 81, label: "Historical score" });
  });

  it("renders a v5 report as Not scored when no eligible denominator exists", () => {
    const model = buildSeoReportModel({
      ...base,
      overallScore: null,
      categories: [{ name: "AI Visibility", score: 0, maxScore: 0, items: [] }],
    });
    expect(model.scoreExplanation).toMatchObject({ assessed: false, score: null, label: "Not assessed" });
  });

  it("keeps v4 as a historical score and does not reinterpret its saved noindex booleans", () => {
    const model = buildSeoReportModel({ ...base, methodologyVersion: 4, pages: [{ ...base.pages![0], indexability: { metaNoindex: false, headerNoindex: false, indexable: true } }] });
    expect(model.methodology).toMatchObject({ version: 4, label: "Historical score" });
    expect(model.scoreExplanation).toMatchObject({ score: 74, label: "Historical score" });
    expect(model.accessSummary.indexabilityNotAssessedCount).toBe(0);
  });

  it("keeps a v5 unknown directive out of noindex actions and all-clear strengths", () => {
    const page = { ...base.pages![0], indexability: { metaNoindex: false, headerNoindex: false, indexable: null, googleDirectives: { noindex: "unknown" as const, nofollow: "not-observed" as const, observations: [] } }, categories: [{ name: "Indexability", score: 0, maxScore: 10, items: [{ label: "Indexable", status: "warn" as const, detail: "Scope unknown.", scored: false, applicability: "unknown" as const }] }] };
    const model = buildSeoReportModel({ ...base, pages: [page], issues: [{ id: "unknown", category: "Indexability", status: "warn", title: "Indexable", detail: "Scope unknown.", affectedUrls: [page.url], affectedCount: 1, totalPages: 1 }] });
    expect(model.accessSummary.indexabilityNotAssessedCount).toBe(1);
    expect(model.accessSummary.homepageIndexDirective).toBe("not-assessed");
    expect(model.accessSummary.noindexCount).toBe(0);
    expect(model.priorityActions).toEqual([]);
    expect(model.strengths.some((strength) => /noindex/i.test(strength))).toBe(false);
  });

  it("does not interpret scores or legacy indexability fields from an unknown future method", () => {
    const future = buildSeoReportModel({ ...base, methodologyVersion: 6, overallScore: 91, pages: [{ ...base.pages![0], indexability: { metaNoindex: true, headerNoindex: false, indexable: false } }] });
    expect(future.methodology).toMatchObject({ version: 6, label: "Unsupported method" });
    expect(future.scoreExplanation).toMatchObject({ score: null, label: "Unsupported method", assessed: false });
    expect(future.accessSummary.noindexCount).toBe(0);
  });

  it("qualifies unscored v4 observations and preserves historical v3 detail", () => {
    const detail = "3 redirect hops were observed.";
    expect(checkObservationDisplayText({ detail, scored: false, disposition: "unscored" }, 4))
      .toContain("3 redirect hops were observed. This is an observation for context, not a validated search defect.");
    expect(checkObservationDisplayText({ detail, scored: false, disposition: "pending-review" }, 4))
      .toContain("excluded until its source and meaning are verified");
    expect(checkObservationDisplayText({ detail, scored: false, disposition: "unscored" }, 3)).toBe(detail);
  });

  it("uses singular and plural wording for observed Google instructions", () => {
    const observedPage = (page: NonNullable<ReportInput["pages"]>[number], url: string) => ({
      ...page,
      url,
      pageType: "practice",
      indexability: {
        metaNoindex: true,
        headerNoindex: false,
        indexable: false,
        googleDirectives: { noindex: "observed" as const, nofollow: "not-observed" as const, observations: [] },
      },
    });
    const single = buildSeoReportModel({
      ...base,
      pagesScanned: 1,
      pages: [observedPage(base.pages![1], "https://example.com/employment/")],
    });
    expect(single.priorityActions[0].observed).toBe(
      "1 of 1 checked page tells Google not to include it in search. Google must load the page first.",
    );
    expect(single.priorityActions[0].whyItMatters).toBe("This instruction may keep useful pages out of Google.");

    const oneOfTwentyFive = buildSeoReportModel({
      ...base,
      pagesScanned: 25,
      pages: Array.from({ length: 25 }, (_, index) =>
        index === 0
          ? observedPage(base.pages![1], "https://example.com/employment/")
          : { ...base.pages![1], url: `https://example.com/page-${index}/` },
      ),
    });
    expect(oneOfTwentyFive.priorityActions[0].observed).toBe(
      "1 of 25 checked pages tells Google not to include it in search. Google must load the page first.",
    );
    const plural = buildSeoReportModel({
      ...base,
      pagesScanned: 2,
      pages: [
        observedPage(base.pages![1], "https://example.com/employment/"),
        observedPage(base.pages![1], "https://example.com/family-law/"),
      ],
    });
    expect(plural.priorityActions[0].observed).toBe(
      "2 of 2 checked pages tell Google not to include them in search. Google must load the page first.",
    );
  });
  it("creates page-scoped noindex action copy and excludes utility pages from priority selection", () => {
    const pages = [
      { ...base.pages![0], indexability: { metaNoindex: true, headerNoindex: false, indexable: false } },
      { ...base.pages![1], indexability: { metaNoindex: false, headerNoindex: false, indexable: true } },
      { ...base.pages![1], url: "https://example.com/privacy/", pageType: "policy", indexability: { metaNoindex: true, headerNoindex: false, indexable: false } },
    ];
    const model = buildSeoReportModel({ ...base, methodologyVersion: 4, pages, pagesScanned: 3 });
    expect(model.accessSummary.noindexCount).toBe(2);
    expect(model.accessSummary.homepageIndexDirective).toBe("observed");
    expect(model.priorityActions[0]).toMatchObject({
      family: "search-exclusion",
      observed: "1 of 3 checked pages contain an instruction asking search engines to leave them out of results.",
      affectedUrls: ["https://example.com/"],
    });
  });

  it("keeps v4 header-only search guidance neutral and preserves the recorded score", () => {
    const model = buildSeoReportModel({
      ...base,
      methodologyVersion: 4,
      overallScore: 81,
      pagesScanned: 1,
      pages: [{
        ...base.pages![1],
        url: "https://example.com/employment/",
        indexability: { metaNoindex: false, headerNoindex: true, indexable: false },
      }],
    });

    expect(model.scoreExplanation.score).toBe(81);
    expect(model.priorityActions[0]).toMatchObject({ family: "search-exclusion" });
    expect(model.priorityActions[0].whyItMatters).not.toMatch(/Google/i);
  });
  it("explains mixed content separately from pages that loaded without HTTPS", () => {
    const mixedOnly = buildSeoReportModel({
      ...base,
      issues: [{
        id: "mixed-content", category: "Technical & Security", status: "warn", title: "Mixed content",
        detail: "2 HTTP resources on an HTTPS page.", affectedUrls: ["https://example.com/"], affectedCount: 1, totalPages: 2, confidence: "high",
      }],
    });
    expect(mixedOnly.priorityActions[0]).toMatchObject({
      observed: "1 checked page loaded over HTTPS but included resources served over HTTP.",
      whyItMatters: "A browser may block or limit resources served over HTTP on an HTTPS page, which can affect how the page appears or works.",
      nextStep: "Ask your web provider to replace the affected HTTP resource addresses with HTTPS, then confirm the pages still display and work as intended.",
    });
    expect(mixedOnly.priorityActions[0].observed).not.toContain("loaded over HTTP rather than HTTPS");

    const both = buildSeoReportModel({
      ...base,
      issues: [
        { id: "https", category: "Technical & Security", status: "fail", title: "HTTPS", detail: "Page loaded over HTTP.", affectedUrls: ["https://example.com/"], affectedCount: 1, totalPages: 2, confidence: "high" },
        { id: "mixed-content", category: "Technical & Security", status: "warn", title: "Mixed content", detail: "1 HTTP resource on an HTTPS page.", affectedUrls: ["https://example.com/services/"], affectedCount: 1, totalPages: 2, confidence: "high" },
      ],
    });
    expect(both.priorityActions[0].observed).toContain("1 checked page loaded over HTTP rather than HTTPS.");
    expect(both.priorityActions[0].observed).toContain("Resources served over HTTP were also found on 1 checked page.");
    expect(both.priorityActions[0].nextStep).toContain("replace HTTP resource addresses on the other affected pages with HTTPS");
  });

  it("reports provider-specific purposes and keeps policy separate from actual access", () => {
    const model = buildSeoReportModel({
      ...base,
      aiBots: [
        { token: "ClaudeBot", name: "ClaudeBot", purposes: ["training"], isControlToken: false, blocked: true, policyObservation: "blocking-rule-observed", actualFetchAccess: "not-verified", sourceUrl: "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler", reviewedAt: "2026-10-28", sourceVerification: "verified" },
        { token: "Claude-SearchBot", name: "Claude Search", purposes: ["search"], isControlToken: false, blocked: null, policyObservation: "not-assessed", actualFetchAccess: "not-verified", sourceUrl: "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler", reviewedAt: "2026-10-28", sourceVerification: "verified" },
        { token: "ChatGPT-User", name: "ChatGPT-User", purposes: ["user-initiated"], isControlToken: false, robotsSemantics: "may-not-apply", blocked: true, policyObservation: "blocking-rule-observed", actualFetchAccess: "not-verified", sourceUrl: "https://developers.openai.com/api/docs/bots", reviewedAt: "2026-10-28", sourceVerification: "verified" },
        { token: 'Perplexity-User', name: 'Perplexity-User', purposes: ['user-initiated'], isControlToken: false, robotsSemantics: 'generally-ignores', blocked: true, policyObservation: 'blocking-rule-observed', actualFetchAccess: 'not-verified', sourceUrl: 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers', reviewedAt: '2026-10-28', sourceVerification: 'verified' },
        { token: "CCBot", name: "CCBot", purposes: ["open-dataset"], isControlToken: false, blocked: false, policyObservation: "no-blocking-rule-observed", actualFetchAccess: "not-verified", sourceUrl: "https://www.commoncrawl.org/ccbot", reviewedAt: "2026-10-28", sourceVerification: "verified" },
        { token: "Google-Extended", name: "Google-Extended", purposes: ["training", "grounding"], isControlToken: true, blocked: null, policyObservation: "not-assessed", actualFetchAccess: "not-verified", sourceUrl: "https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers#google-extended", reviewedAt: "2026-10-28", sourceVerification: "verified" },
      ],
    });
    expect(model.crawlerPolicies.find((bot) => bot.token === "ClaudeBot")?.purposes).toEqual(["training"]);
    expect(model.crawlerPolicies.find((bot) => bot.token === "ChatGPT-User")).toMatchObject({ robotsSemantics: "may-not-apply", policyObservation: "blocking-rule-observed", actualFetchAccess: "not-verified" });
    expect(model.crawlerPolicies.find((bot) => bot.token === 'Perplexity-User')).toMatchObject({ robotsSemantics: 'generally-ignores', policyObservation: 'blocking-rule-observed', actualFetchAccess: 'not-verified' });
    expect(model.crawlerPolicies.find((bot) => bot.token === "CCBot")?.purposes).toEqual(["open-dataset"]);
    expect(model.crawlerPolicies.find((bot) => bot.token === "Google-Extended")).toMatchObject({ isControlToken: true, actualFetchAccess: "not-verified" });
    expect(model.aiObservations).toEqual(["The list below describes crawler purposes, robots.txt rules and documented behavior. A rule does not prove access or use."]);
    expect(model.aiObservations.join(" ")).not.toContain("listed training crawlers");
    expect(model.priorityActions).toEqual([]);
  });

  it("normalizes legacy bot categories without inventing purposes or sources", () => {
    const model = buildSeoReportModel({
      ...base,
      methodologyVersion: 3,
      aiBots: [
        { name: "ClaudeBot", category: "training", blocked: true },
        { name: "Claude-SearchBot", category: "search", blocked: null },
      ],
    });
    expect(model.crawlerPolicies.find((bot) => bot.name === "ClaudeBot")).toMatchObject({
      purposes: ["unknown"], sourceUrl: null, sourceVerification: "unavailable", actualFetchAccess: "not-verified",
    });
    expect(model.crawlerPolicies.find((bot) => bot.name === "Claude-SearchBot")?.purposes).toEqual(["search"]);
    expect(model.aiObservations.join(" ")).not.toContain("listed training crawlers");
  });

  it("limits ranked actions to three and omits unsupported generic findings", () => {
    const issues = [
      { id: "a", category: "Indexability", status: "fail" as const, title: "Indexable", detail: "The page is set to noindex.", affectedUrls: ["https://example.com/"], affectedCount: 1, totalPages: 2 },
      { id: "b", category: "Technical & Security", status: "fail" as const, title: "HTTPS", detail: "Page loaded over HTTP.", affectedUrls: ["https://example.com/services/"], affectedCount: 1, totalPages: 2 },
      { id: "c", category: "On-Page SEO", status: "warn" as const, title: "H1 heading", detail: "Heading unclear.", affectedUrls: ["https://example.com/"], affectedCount: 1, totalPages: 2, confidence: "high" as const },
      { id: "d", category: "Other", status: "fail" as const, title: "Unknown detector", detail: "Unknown assertion.", affectedUrls: ["https://example.com/"], affectedCount: 1, totalPages: 2 },
    ];
    const model = buildSeoReportModel({ ...base, issues });
    expect(model.priorityActions).toHaveLength(3);
    expect(model.priorityActions.map((action) => action.sourceIssueIds).flat()).not.toContain("d");
  });

  it("uses plain-language observations for ranked findings", () => {
    const model = buildSeoReportModel({
      ...base,
      issues: [{ id: "contact", category: "Legal Marketing", status: "fail", title: "No clear contact path", detail: "No visible phone, form, or consultation CTA.", affectedUrls: ["https://example.com/services/"], affectedCount: 1, totalPages: 2, confidence: "high" }],
    });
    expect(model.priorityActions[0].observed).toBe("A clear contact option was not confirmed in the scanned page content on 1 checked page.");
    expect(model.priorityActions[0].title).toBe("Make the next contact step easy to find");
    expect(model.priorityActions[0].evidenceLabel).toBe("Observed in this scan");
  });

  it("does not turn security-header prose or word-count-only findings into priorities", () => {
    const model = buildSeoReportModel({
      ...base,
      issues: [
        { id: "hsts", category: "Technical & Security", status: "warn", title: "HSTS header", detail: "Missing. HSTS tells browsers to always use HTTPS. Security hygiene; excluded from the SEO score.", affectedUrls: ["https://example.com/"], affectedCount: 1, totalPages: 2, confidence: "high" },
        { id: "csp", category: "Technical & Security", status: "warn", title: "Content-Security-Policy", detail: "Missing security header. Configure HTTP response headers.", affectedUrls: ["https://example.com/"], affectedCount: 1, totalPages: 2, confidence: "high" },
        { id: "words", category: "On-Page SEO", status: "fail", title: "Word count", detail: "No content answers questions; word count is low.", affectedUrls: ["https://example.com/"], affectedCount: 1, totalPages: 2, confidence: "high" },
      ],
    });
    expect(model.priorityActions).toEqual([]);
  });

  it("uses confidence for action evidence labels and maps only exact supported detector names", () => {
    const lowConfidence = buildSeoReportModel({
      ...base,
      issues: [{ id: "title", category: "On-Page SEO", status: "warn", title: "Page title", detail: "Unusually long title.", affectedUrls: ["https://example.com/"], affectedCount: 1, totalPages: 2, confidence: "low" }],
    });
    const wrongCategory = buildSeoReportModel({
      ...base,
      issues: [{ id: "title", category: "Other", status: "fail", title: "Page title", detail: "Missing title.", affectedUrls: ["https://example.com/"], affectedCount: 1, totalPages: 2, confidence: "high" }],
    });
    expect(lowConfidence.priorityActions[0].evidenceLabel).toBe("Needs confirmation");
    expect(wrongCategory.priorityActions).toEqual([]);
  });

  it("distinguishes unknown robots access and derives the homepage index directive state", () => {
    const unknown = {
      label: "robots.txt crawl access", status: "warn" as const, detail: "Could not assess Googlebot and Bingbot access.",
      scored: false, applicability: "unknown" as const,
    };
    const model = buildSeoReportModel({
      ...base,
      pages: [
        { ...base.pages![0], robotsAccess: { google: null, bing: null }, indexability: { metaNoindex: null, headerNoindex: null, indexable: null, googleDirectives: { noindex: "unknown", nofollow: "unknown", observations: [] } }, categories: [{ name: "Indexability", score: 0, maxScore: 0, items: [unknown] }] },
        base.pages![1],
      ],
    });
    expect(model.accessSummary).toMatchObject({ googleBlockedCount: 0, bingBlockedCount: 0, googleNotAssessedCount: 1, bingNotAssessedCount: 1, homepageIndexDirective: "not-assessed" });
    const observedClear = buildSeoReportModel({ ...base, pages: [{ ...base.pages![0], indexability: { metaNoindex: false, headerNoindex: false, indexable: true, googleDirectives: { noindex: "not-observed", nofollow: "not-observed", observations: [] } } }, base.pages![1]] });
    expect(observedClear.accessSummary.homepageIndexDirective).toBe("not-observed");
    const noHomepage = buildSeoReportModel({ ...base, pages: [base.pages![1]] });
    expect(noHomepage.accessSummary.homepageIndexDirective).toBe("not-checked");
  });

  it("keeps legacy AI-only findings out of ranked actions and public issue evidence", () => {
    const model = buildSeoReportModel({
      ...base,
      issues: [
        { id: "legacy-ai", category: "AI Visibility", status: "fail", title: "Not positioned to be found or cited in AI search", detail: "Legacy AI visibility score is low.", affectedUrls: ["https://example.com/"], affectedCount: 1, totalPages: 2 },
        { id: "search", category: "Indexability", status: "fail", title: "Indexable", detail: "The page is set to noindex.", affectedUrls: ["https://example.com/"], affectedCount: 1, totalPages: 2 },
      ],
    });
    expect(model.priorityActions.map((action) => action.sourceIssueIds).flat()).not.toContain("legacy-ai");
    expect(model.findingGroups.some((finding) => finding.title.includes("AI search"))).toBe(false);
    expect(model.priorityActions[0].family).toBe("search-exclusion");
  });
  it("uses the exact partial-scan limitation and reports Not assessed when no category applies", () => {
    const model = buildSeoReportModel({ ...base, partial: true, categories: [{ name: "AI Visibility", score: 0, maxScore: 0, items: [] }] });
    expect(model.scoreExplanation).toMatchObject({ assessed: false, score: null, label: "Not assessed" });
    expect(model.limitations[1]).toBe("The scan is incomplete. Findings apply only to inspected pages.");
  });

  it("uses coverage-only partial state consistently for the badge model and limitation copy", () => {
    const model = buildSeoReportModel({
      ...base,
      coverage: {
        requestedLimit: 25, attemptedPages: 10, successfulPages: 9, failedPages: 1,
        skippedPages: 0, discoveredCandidateUrls: 9, totalSitePages: null,
        stopReason: "fetch-failure", skippedReasons: {}, sitemapIncomplete: false,
        partial: true, pageSetHashBasis: "normalized-url-identities",
      },
    });
    expect(model.coverage.partial).toBe(true);
    expect(model.limitations).toContain("The scan is incomplete. Findings apply only to inspected pages.");
  });

  it("explains recognized AEO observations without changing the recorded evidence or score", () => {
    const raw = [
      { label: "Attorney / person schema", status: "pass" as const, scored: false, detail: "Attorney or Person schema was observed in the inspected HTML." },
      { label: "Question-format headings", status: "pass" as const, scored: false, detail: "1 headings matched this question-format pattern in initial HTML. This is a formatting observation; no question format is required by this check." },
      { label: "Direct-answer sentences", status: "pass" as const, scored: false, detail: "2 sentences matched a broad wording pattern in initial HTML. This is not an assessment of answer quality or AI visibility." },
      { label: "Semantic HTML structure", status: "pass" as const, scored: false, detail: "4 of this check's listed semantic element types were observed in initial HTML. This structural observation is not a measure of AI visibility." },
      { label: "Entity description", status: "pass" as const, scored: false, detail: "No named entity was found in the inspected JSON-LD. Other formats and rendered markup were not assessed." },
      { label: "Author / reviewer signals", status: "pass" as const, scored: false, detail: "An author meta tag or Person/Attorney JSON-LD was observed. Identity, qualifications, and other page content were not assessed." },
    ];
    const snapshot = JSON.stringify(raw);
    const model = buildSeoReportModel({ ...base, pages: [{ ...base.pages![0], categories: [{ name: "AI Visibility", score: 0, maxScore: 0, items: raw }] }] });
    expect(model.aiPageObservations.map(item => item.label)).toEqual(["Person information", "Question headings", "Answer wording", "Page structure", "Firm information", "Author information"]);
    expect(model.aiPageObservations[0].detail).toContain("No identity or qualifications were verified");
    expect(model.aiPageObservations[1].detail).toContain("1 heading looks like a question");
    expect(model.aiPageObservations[2].detail).toContain("2 sentences matched");
    expect(model.aiPageObservations[3].detail).toContain("includes 4 of the structure types");
    expect(model.aiPageObservations[4].detail).toContain("Other formats and visible content were not checked");
    expect(model.aiPageObservations[5].detail).toContain("Authorship and credentials were not verified");
    expect(JSON.stringify(raw)).toBe(snapshot);
    expect(model.scoreExplanation.score).toBe(74);
  });

  it("groups only allowlisted v5 page HTML observations and keeps their page associations", () => {
    const question = { label: "Question-format headings", status: "pass" as const, detail: "2 headings matched the pattern.", scored: false };
    const pages = [
      {
        ...base.pages![0],
        categories: [{
          name: "AI Visibility",
          score: 0,
          maxScore: 0,
          items: [
            question,
            { label: "Direct-answer sentences", status: "pass" as const, detail: "1 sentence matched the pattern.", scored: false },
            { label: "Authoritative citations", status: "pass" as const, detail: "2 external links matched selected domain patterns.", scored: false },
            { label: "AI search bot access", status: "pass" as const, detail: "Root policy only.", scored: false },
            { label: "AI training bot control", status: "pass" as const, detail: "Root policy only.", scored: false },
            { label: "llms.txt file", status: "pass" as const, detail: "Site-level file observation.", scored: false },
            { label: "Answer quality", status: "pass" as const, detail: "Must not appear.", scored: true },
            { label: "Legacy item", status: "pass" as const, detail: "Must not appear." },
          ],
        }],
      },
      {
        ...base.pages![1],
        categories: [{
          name: "AI Visibility",
          score: 0,
          maxScore: 0,
          items: [question],
        }],
      },
    ];
    const model = buildSeoReportModel({ ...base, pages });

    expect(model.aiPageObservations).toEqual([
      {
        label: "Question-format headings",
        detail: "2 headings matched the pattern.",
        pageUrls: ["https://example.com/", "https://example.com/services/"],
      },
      {
        label: "Direct-answer sentences",
        detail: "1 sentence matched the pattern.",
        pageUrls: ["https://example.com/"],
      },
    ]);
    expect(model.aiPageObservations.some((item) => /citations|selected domains/i.test(item.label))).toBe(false);
    expect(pages[0].categories[0].items).toContainEqual({
      label: "Authoritative citations",
      status: "pass",
      detail: "2 external links matched selected domain patterns.",
      scored: false,
    });
    expect(model.scoreExplanation).toMatchObject({ score: 74, assessed: true });
  });

  it("excludes unknown and unassessed page items but retains observed and not-observed evidence", () => {
    const pageUrl = "https://example.com/services/";
    const htmlEvidence = (coverage: "observed" | "not-observed" | "not-assessed", applicability: "applicable" | "unknown" | "not-applicable" = "applicable") => ({
      kind: "initial-html-pattern",
      assessedUrl: pageUrl,
      applicability,
      coverage,
      detail: "Synthetic evidence state.",
    });
    const model = buildSeoReportModel({
      ...base,
      pages: [{
        ...base.pages![0],
        url: pageUrl,
        categories: [{
          name: "AI Visibility",
          score: 0,
          maxScore: 0,
          items: [
            { label: "Question-format headings", status: "pass", detail: "A question pattern was observed.", scored: false, applicability: "applicable", evidence: htmlEvidence("observed") },
            { label: "Semantic HTML structure", status: "pass", detail: "No listed semantic element type was observed.", scored: false, applicability: "applicable", evidence: htmlEvidence("not-observed") },
            { label: "Direct-answer sentences", status: "warn", detail: "Unknown.", scored: false, applicability: "unknown", evidence: htmlEvidence("observed", "unknown") },
            { label: "Entity description", status: "warn", detail: "Not assessed.", scored: false, evidence: htmlEvidence("not-assessed") },
            { label: "Attorney / person schema", status: "pass", detail: "Pending source review.", scored: false, disposition: "pending-review", evidence: htmlEvidence("observed") },
            { label: "Author / reviewer signals", status: "pass", detail: "Not applicable.", scored: false, applicability: "not-applicable", evidence: htmlEvidence("observed", "not-applicable") },
          ],
        }],
      }],
    });

    expect(model.aiPageObservations).toEqual([
      {
        label: "Question-format headings",
        detail: "A question pattern was observed.",
        pageUrls: [pageUrl],
      },
      {
        label: "Semantic HTML structure",
        detail: "No listed semantic element type was observed.",
        pageUrls: [pageUrl],
      },
    ]);
  });

  it("leaves historical methods and missing page observations empty", () => {
    const v4 = buildSeoReportModel({
      ...base,
      methodologyVersion: 4,
      pages: [{
        ...base.pages![0],
        categories: [{ name: "AI Visibility", score: 0, maxScore: 0, items: [
          { label: "Question-format headings", status: "pass", detail: "Historical observation.", scored: false },
        ] }],
      }],
    });
    const missingCategory = buildSeoReportModel({ ...base, pages: [{ ...base.pages![0], categories: [] }] });
    const missingPages = buildSeoReportModel({ ...base, pages: [] });

    expect(v4.aiPageObservations).toEqual([]);
    expect(missingCategory.aiPageObservations).toEqual([]);
    expect(missingPages.aiPageObservations).toEqual([]);
    expect(v4.methodology.label).toBe("Historical score");
  });

});

describe("getDisplayedCategoryWeights", () => {
  const weights = {
    "On-Page SEO": 20,
    Indexability: 8,
    "Schema & Structured Data": 16,
    "AI Visibility": 0,
    "Legal Marketing": 16,
    "Local SEO": 12,
    "Technical & Security": 4,
    "Rendering & Crawlability": 2,
    Performance: 6,
    "Links & Content": 6,
    Intent: 8,
  };

  it("shows only contributing positive-weight categories for v4", () => {
    const categories: NonNullable<ReportInput["categories"]> = [
      { name: "On-Page SEO", score: 9, maxScore: 10, items: [{ label: "Page title", status: "pass", detail: "Observed." }] },
      { name: "Indexability", score: 28, maxScore: 30, items: [{ label: "Indexable", status: "pass", detail: "Observed." }] },
      { name: "Technical & Security", score: 10, maxScore: 10, items: [{ label: "HTTPS", status: "pass", detail: "Observed." }] },
      { name: "Schema & Structured Data", score: 0, maxScore: 0, items: [{ label: "Optional schema", status: "warn", detail: "Context only.", scored: false }] },
    ];

    expect(getDisplayedCategoryWeights(categories, weights, 4)).toEqual([
      ["On-Page SEO", 20],
      ["Indexability", 8],
      ["Technical & Security", 4],
    ]);
  });

  it("preserves recorded weights for historical methods", () => {
    expect(getDisplayedCategoryWeights([], weights, 3)).toEqual(Object.entries(weights));
  });

  it("returns no category weights when no v4 category contributed", () => {
    const categories: NonNullable<ReportInput["categories"]> = [
      { name: "Schema & Structured Data", score: 0, maxScore: 0, items: [{ label: "Optional schema", status: "warn", detail: "Context only.", scored: false }] },
    ];
    expect(getDisplayedCategoryWeights(categories, weights, 4)).toEqual([]);
  });
});


describe("decision-led lawyer report", () => {
  const excludedPage = (url:string,pageType:string,inSitemap?:boolean|null,sitemapComplete=true) => ({
    ...base.pages![0], url, title:url, pageType,
    indexability:{...base.pages![0].indexability,inSitemap,sitemapComplete,googleDirectives:{noindex:"observed" as const,nofollow:"not-observed" as const,observations:[]}},
  });
  it("separates a Soni-style sitemap mismatch from service and team purpose decisions without mutating the result",()=>{
    const affected=[excludedPage("https://example.com/employment/","practice",false),excludedPage("https://example.com/team/","attorney",true),...Array.from({length:4},(_,i)=>excludedPage(`https://example.com/team/person-${i}/`,"attorney",false))];
    const input:ReportInput={...base,overallScore:98,pagesScanned:25,pages:[...affected,...Array.from({length:19},(_,i)=>({...base.pages![0],url:`https://example.com/other-${i}/`}))]};
    const before=JSON.stringify(input);
    const model=buildSeoReportModel(input);
    expect(model.overview?.findings.map(f=>f.id)).toEqual(["sitemap-exclusion","service-exclusions","team-exclusions"]);
    expect(model.overview?.findings.map(f=>f.pages.length)).toEqual([1,1,4]);
    expect(model.overview?.findings[0]).toMatchObject({state:"Observed mismatch",pages:[{url:affected[1].url}]});
    expect(model.overview?.findings.slice(1).every(f=>f.state==="Confirm intended use")).toBe(true);
    expect(model.overview?.attention).toContain("other 5 excluded pages");
    expect(model.overview?.nextSteps).toHaveLength(4);
    expect(model.overview?.findings.every(f=>f.owner && f.verification)).toBe(true);
    expect(model.scoreExplanation.score).toBe(98);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("does not infer a sitemap mismatch or absence from unknown membership",()=>{
    const model=buildSeoReportModel({...base,pages:[excludedPage("https://example.com/service/","practice",null)],pagesScanned:1});
    expect(model.overview?.findings.map(f=>f.id)).toEqual(["service-exclusions"]);
    expect(model.overview?.findings[0].pages[0].evidence).toContain("membership was not established");
  });
  it("does not claim sitemap absence when discovery is incomplete",()=>{
    const model=buildSeoReportModel({...base,pages:[excludedPage("https://example.com/service/","practice",false,false)],pagesScanned:1});
    expect(model.overview?.findings[0].pages[0].evidence).not.toContain("Not listed");
  });
  it("keeps positive sitemap evidence even when other sitemap discovery is incomplete",()=>{
    const model=buildSeoReportModel({...base,pages:[excludedPage("https://example.com/service/","practice",true,false)],pagesScanned:1});
    expect(model.overview?.findings[0].id).toBe("sitemap-exclusion");
    expect(model.overview?.findings[0].pages[0].evidence).toContain("Listed in");
  });
  it("does not reinterpret unknown Google applicability as a sitemap mismatch",()=>{
    const page={...excludedPage("https://example.com/service/","practice",true),indexability:{inSitemap:true,googleDirectives:{noindex:"unknown" as const,nofollow:"not-observed" as const,observations:[]}}};
    const model=buildSeoReportModel({...base,pages:[page],pagesScanned:1});
    expect(model.overview?.findings.map(f=>f.id)).toEqual(["unknown-settings"]);
    expect(model.overview?.findings[0].state).toBe("Evidence incomplete");
  });
  it("does not treat an excluded utility page as a marketing failure",()=>{
    const model=buildSeoReportModel({...base,pages:[excludedPage("https://example.com/privacy/","policy",true)],pagesScanned:1});
    expect(model.overview?.findings).toEqual([]);
    expect(model.overview?.attention).toContain("not a marketing failure");
    expect(model.overview?.nextSteps.map(s=>s.detail).join(" ")).not.toContain("correct exclusions");
  });
  it("does not turn service keywords or contact patterns into a prominent strength",()=>{
    const model=buildSeoReportModel(base);
    expect(model.overview?.findings).toEqual([]);
    expect(model.overview?.attention).not.toMatch(/strong|service information was found|foundation|contact options/);
    expect(model.overview?.basics.join(" ")).toContain("contact-detail or enquiry-invitation pattern");
    expect(model.overview?.basics.join(" ")).not.toContain("service information");
  });
  it("publishes one material finding without filling three slots",()=>{
    const model=buildSeoReportModel({...base,pages:[excludedPage("https://example.com/service/","practice",true)],pagesScanned:1});
    expect(model.overview?.findings).toHaveLength(1);
  });
  it("uses page titles and preserves staff roles rather than inventing lawyer identities",()=>{
    const page={...excludedPage("https://example.com/team/haya/","attorney",false),title:"Haya Tariq - Senior Law Clerk"};
    const model=buildSeoReportModel({...base,pages:[page],pagesScanned:1});
    expect(model.overview?.findings[0].pages[0].title).toBe(page.title);
    expect(JSON.stringify(model.overview)).not.toContain("four lawyers");
  });
  it("uses the actual URL when a saved title is absent",()=>{
    const page={...excludedPage("https://example.com/service/","practice",true),title:null};
    expect(buildSeoReportModel({...base,pages:[page]}).overview?.findings[0].pages[0].title).toBe(page.url);
  });
  it("keeps actual AI visibility unmeasured rather than grading open access",()=>{
    const model=buildSeoReportModel(base);
    expect(model.overview?.aiVisibility).toMatch(/^Actual AI mentions and citations were not measured/);
    expect(model.overview?.aiVisibility).not.toMatch(/0 visibility|high visibility|A-/);
    expect(model.overview?.aiNextStep).toContain("actual answers");
  });
  it("does not present failed responses as reliable service or sitemap findings",()=>{
    const model=buildSeoReportModel({...base,pages:[{...excludedPage("https://example.com/missing/","practice",true),httpStatus:404}],pagesScanned:1});
    expect(model.overview?.findings.map(f=>f.id)).toEqual(["page-evidence"]);
    expect(model.overview?.basics.join(" ")).toContain("0 inspected pages loaded over HTTPS");
  });
  it("requests usable evidence instead of commissioning content when no pages were returned",()=>{
    const model=buildSeoReportModel({...base,pages:[],pagesScanned:0});
    expect(model.overview?.title).toContain("Obtain usable page evidence");
    expect(model.overview?.nextSteps[0].title).toBe("Establish the cause");
  });
  it("describes crawl restrictions without claiming actual Google indexing",()=>{
    const model=buildSeoReportModel({...base,pages:[{...base.pages![0],robotsAccess:{google:false,bing:true}}],pagesScanned:1});
    expect(model.overview?.findings[0].id).toBe("crawler-access");
    expect(model.overview?.attention).not.toMatch(/not indexed|cannot be indexed/);
  });
  it("preserves the interpretation of historical and unsupported methods",()=>{
    expect(buildSeoReportModel({...base,methodologyVersion:4}).overview).toBeNull();
    expect(buildSeoReportModel({...base,methodologyVersion:6}).overview).toBeNull();
  });
});
