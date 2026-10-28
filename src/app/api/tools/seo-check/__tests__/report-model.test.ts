import { describe, expect, it } from "vitest";
import { buildSeoReportModel, checkObservationDisplayText, type ReportInput } from "../report-model";

const base: ReportInput = {
  domain: "example.com",
  methodologyVersion: 4,
  pagesScanned: 2,
  overallScore: 74,
  categories: [{ name: "On-Page SEO", score: 7, maxScore: 10, items: [] }],
  pages: [
    {
      url: "https://example.com/",
      pageType: "homepage",
      httpStatus: 200,
      indexability: { metaNoindex: false, headerNoindex: false, indexable: true },
      lawFirm: { phoneVisible: true, contactFormPresent: false, consultationCta: false, practiceAreaIntent: true },
      categories: [],
    },
    {
      url: "https://example.com/services/",
      pageType: "practice",
      httpStatus: 200,
      indexability: { metaNoindex: false, headerNoindex: false, indexable: true },
      lawFirm: { phoneVisible: false, contactFormPresent: false, consultationCta: false, practiceAreaIntent: true },
      categories: [],
    },
  ],
  issues: [],
  aiBots: [],
};

describe("buildSeoReportModel", () => {
  it("labels the current weighted score clearly and always includes bounded-scope limitations and one CTA", () => {
    const model = buildSeoReportModel(base);
    expect(model.methodology).toMatchObject({ version: 4, label: "Website checks", notice: null });
    expect(model.scoreExplanation).toMatchObject({ assessed: true, score: 74, label: "Website checks" });
    expect(model.scoreExplanation.note).toBe("A weighted summary of applicable checks on the pages inspected. It is not a measurement of rankings, enquiries, legal content quality, or AI citations.");
    expect(model.limitations).toEqual(["This scan inspected the initial HTML of 2 pages. It did not check the whole website, confirm Google indexing or rankings, measure enquiries, assess legal accuracy, or test whether AI services cite the firm."]);
    expect(model.cta).toMatchObject({ heading: "Discuss these findings", linkLabel: "Book a conversation", href: "https://cal.com/adriano-caseloadselect/conversation" });
  });

  it("marks saved pre-v3 scores as historical and supplies the no-cross-method notice", () => {
    const model = buildSeoReportModel({ ...base, methodologyVersion: 2, overallScore: 88 });
    expect(model.methodology).toMatchObject({ version: 2, label: "Historical score" });
    expect(model.methodology.notice).toBe("This saved scan used an earlier scoring method. Run a new scan for the current report. Scores from different methods should not be compared.");
    expect(model.scoreExplanation).toMatchObject({ score: 88, label: "Historical score" });
  });

  it("preserves saved v3 scores as historical under the v4 report method", () => {
    const model = buildSeoReportModel({ ...base, methodologyVersion: 3, overallScore: 88 });
    expect(model.methodology).toMatchObject({ version: 3, label: "Historical score" });
    expect(model.scoreExplanation).toMatchObject({ score: 88, label: "Historical score" });
    expect(model.methodology.notice).toContain("Scores from different methods should not be compared");
  });

  it("treats unversioned saved scores as historical and preserves their stored value", () => {
    const unversioned: ReportInput = { ...base };
    delete unversioned.methodologyVersion;
    const model = buildSeoReportModel({ ...unversioned, overallScore: 81 });
    expect(model.methodology).toMatchObject({ version: 2, label: "Historical score" });
    expect(model.scoreExplanation).toMatchObject({ score: 81, label: "Historical score" });
  });

  it("renders a v4 report as Not scored when no eligible denominator exists", () => {
    const model = buildSeoReportModel({
      ...base,
      overallScore: null,
      categories: [{ name: "AI Visibility", score: 0, maxScore: 0, items: [] }],
    });
    expect(model.scoreExplanation).toMatchObject({ assessed: false, score: null, label: "Not assessed" });
  });

  it("qualifies unscored v4 observations and preserves historical v3 detail", () => {
    const detail = "3 redirect hops were observed.";
    expect(checkObservationDisplayText({ detail, scored: false, disposition: "unscored" }, 4))
      .toContain("3 redirect hops were observed. This is an observation for context, not a validated search defect.");
    expect(checkObservationDisplayText({ detail, scored: false, disposition: "pending-review" }, 4))
      .toContain("excluded until its source and meaning are verified");
    expect(checkObservationDisplayText({ detail, scored: false, disposition: "unscored" }, 3)).toBe(detail);
  });

  it("creates page-scoped noindex action copy and excludes utility pages from priority selection", () => {
    const pages = [
      { ...base.pages![0], indexability: { metaNoindex: true, headerNoindex: false, indexable: false } },
      { ...base.pages![1], indexability: { metaNoindex: false, headerNoindex: false, indexable: true } },
      { ...base.pages![1], url: "https://example.com/privacy/", pageType: "policy", indexability: { metaNoindex: true, headerNoindex: false, indexable: false } },
    ];
    const model = buildSeoReportModel({ ...base, pages, pagesScanned: 3 });
    expect(model.accessSummary.noindexCount).toBe(2);
    expect(model.accessSummary.homepageIndexDirective).toBe("observed");
    expect(model.priorityActions[0]).toMatchObject({
      family: "search-exclusion",
      observed: "1 of 3 checked pages contain an instruction asking search engines to leave them out of results.",
      affectedUrls: ["https://example.com/"],
    });
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
    expect(model.aiObservations.join(" ")).toContain("robots.txt blocking rules were observed");
    expect(model.aiObservations.join(" ")).toContain("does not verify actual fetching");
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
        { ...base.pages![0], indexability: { metaNoindex: null, headerNoindex: null, indexable: null }, categories: [{ name: "Indexability", score: 0, maxScore: 0, items: [unknown] }] },
        base.pages![1],
      ],
    });
    expect(model.accessSummary).toMatchObject({ googleBlockedCount: 0, bingBlockedCount: 0, googleNotAssessedCount: 1, bingNotAssessedCount: 1, homepageIndexDirective: "not-assessed" });
    const observedClear = buildSeoReportModel({ ...base, pages: [{ ...base.pages![0], indexability: { metaNoindex: false, headerNoindex: false, indexable: true } }, base.pages![1]] });
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
    expect(model.limitations[1]).toBe("The scan stopped before its available page checks were complete. Findings describe the pages successfully inspected.");
  });
});
