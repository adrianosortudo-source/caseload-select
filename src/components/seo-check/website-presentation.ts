import type { ReportInput, ReportPage, SeoReportModel } from "@/app/api/tools/seo-check/report-model";

// Presentation only: reads saved observations, never changes crawl or score rules.
export function buildWebsitePresentation(input: ReportInput, model: SeoReportModel) {
  const pages = input.pages ?? [];
  const total = pages.length;
  const usable = (page: ReportPage) => page.httpStatus >= 200 && page.httpStatus < 300;
  const definitions = [
    { id: "seo.indexability.http-status", label: "HTTP status", title: "Pages opened successfully", detail: "The checker received a successful response from these pages.", matches: (p: ReportPage) => usable(p) },
    { id: "seo.technical.https", label: "HTTPS", title: "Secure connections", detail: "These pages loaded over HTTPS, which encrypts the connection.", matches: (p: ReportPage) => usable(p) && p.url.startsWith("https://") },
    { id: "seo.on-page.page-title", label: "Page title", title: "Page titles present", detail: "These pages had a title that search engines can use.", followUp: "The clarity and relevance of each title need a content review.", matches: (p: ReportPage) => usable(p) && Boolean(p.title?.trim()) },
    { id: "seo.indexability.indexable", label: "Indexable", title: "No Google exclusion", detail: "No instruction asking Google to leave these pages out of search was recorded.", matches: (p: ReportPage) => usable(p) && p.indexability.googleDirectives?.noindex === "not-observed" },
    { id: "seo.indexability.robots-txt-crawl-access", label: "robots.txt crawl access", title: "Google crawl rules", detail: "The published rules did not block Google from these pages.", matches: (p: ReportPage) => usable(p) && p.robotsAccess?.google === true },
  ];
  const checks = definitions.map(definition => {
    let passed = 0, review = 0, unknown = 0;
    for (const page of pages) {
      const item = page.categories.flatMap(c => c.items).find(i => i.checkId === definition.id || (!i.checkId && i.label === definition.label));
      if (!item || item.scored === false || item.applicability === "unknown" || item.applicability === "not-applicable" || item.evidence?.applicability === "unknown" || item.evidence?.applicability === "not-applicable" || item.evidence?.coverage === "not-assessed") unknown++;
      else if (item.status === "pass" && definition.matches(page)) passed++;
      else review++;
    }
    const mixedDetails: Record<string, string> = {
      "seo.indexability.http-status": "The passed count includes pages that returned a successful response. Review any unsuccessful or unassessed pages below.",
      "seo.technical.https": "The passed count includes pages that loaded over an encrypted connection. Review any remaining pages below.",
      "seo.on-page.page-title": "The passed count includes pages with a recorded title. Review any missing titles, then assess whether each title describes its page clearly.",
      "seo.indexability.indexable": "The passed count includes pages with no recorded Google exclusion. Review the excluded pages named in the priority findings above.",
      "seo.indexability.robots-txt-crawl-access": "The passed count includes pages with no recorded Google crawl restriction. Review any remaining pages in the supporting evidence.",
    };
    const detail = unknown && !review ? "Evidence was missing for some pages. The passed count includes only confirmed observations; inspect the remaining pages in the supporting evidence." : review ? mixedDetails[definition.id] : definition.detail;
    return { id: definition.id, title: definition.title, detail, followUp: review || unknown ? undefined : definition.followUp, passed, review, unknown, total };
  });
  const coverage = model.coverage;
  const stopLabel = coverage.stopReason === "page-limit" ? `${coverage.requestedLimit ?? total}-page sample limit reached`
    : coverage.stopReason === "time-budget" ? "Scan time limit reached"
    : coverage.stopReason === "fetch-failure" ? "Some pages could not be retrieved"
    : coverage.stopReason === "blocked" ? "The scan encountered an access restriction"
    : coverage.stopReason === "discovery-exhausted" ? "No further pages found within crawl limits"
    : coverage.partial ? "Some page evidence is incomplete" : "Page sample reviewed";
  const coverageNote = [
    `${coverage.successfulPages} page${coverage.successfulPages === 1 ? " was" : "s were"} retrieved for review.`,
    coverage.failedPages ? `${coverage.failedPages} attempted page${coverage.failedPages === 1 ? " did" : "s did"} not return usable evidence.` : "",
    coverage.stopReason === "page-limit" ? "The scan stopped at its page limit. Pages outside this sample were not assessed." : "This sample is not a complete inventory of the website.",
    coverage.sitemapIncomplete ? "Sitemap discovery was incomplete." : "",
  ].filter(Boolean).join(" ");
  const hasFindings = Boolean(model.overview?.findings.length);
  const allPassed = total > 0 && total === input.pagesScanned && coverage.successfulPages === total && checks.every(c => c.passed === total) && !coverage.failedPages && !hasFindings;
  const title = allPassed ? "The basic checks passed." : model.overview?.title === "No priority finding in this scan" ? "Some checks need a closer review." : model.overview?.title ?? "Review the available evidence.";
  const introduction = allPassed
    ? `All ${total} reviewed pages loaded successfully, used secure connections and had page titles. We found no published instructions telling Google to stay away from these pages or leave them out of search.`
    : model.overview?.attention ?? "Review the recorded observations before choosing website changes.";
  const interpretation = allPassed
    ? "These five checks found no technical repair to prioritise in this sample. Use your search and enquiry records to identify which service pages need attention."
    : "Agree the purpose of each affected page before changing its settings. Use your search and enquiry records to judge the effect on the firm.";
  const direction = hasFindings ? "Your next step: decide which pages belong in search and have your provider update the settings." : "Your next step: review whether your service pages help attract the cases your firm wants.";
  const aiSearch = [
    { name: "ChatGPT", token: "OAI-SearchBot" },
    { name: "Claude", token: "Claude-SearchBot" },
    { name: "Perplexity", token: "PerplexityBot" },
  ].map(service => {
    const record = model.crawlerPolicies.find(bot => bot.token === service.token);
    return { ...service, observation: record?.policyObservation ?? "not-assessed", result: record?.policyObservation === "no-blocking-rule-observed" ? "No blocking rule found" : record?.policyObservation === "blocking-rule-observed" ? "Blocking rule found" : "Rules not assessed" };
  });
  const aiIntro = aiSearch.every(b => b.observation === "no-blocking-rule-observed")
    ? "The published rules we checked did not block these three search crawlers. This result gives us no reason to recommend changing those rules."
    : aiSearch.some(b => b.observation === "blocking-rule-observed")
      ? "A published blocking rule was recorded for at least one search crawler below. Confirm whether that restriction is intentional before changing it."
      : "Some search crawler rules were not assessed. Establish the missing information before recommending changes to access settings.";
  const nextSteps = hasFindings || !total ? model.overview?.nextSteps.map(step => ({...step, title: step.title === "Verify before expanding the work" ? "Verify the changes" : step.title})) ?? [] : [
    { title: "Choose your priorities", detail: "Agree which services, locations and client languages the website should support. Identify the corresponding pages before commissioning changes." },
    { title: "Review the client journey", detail: "Review those pages alongside search and enquiry records. Establish whether people can find the service, understand who it is for and see a clear route to contacting the firm. Include a review of actual AI answers about these services." },
    { title: "Agree the work", detail: "Commission changes where the review identifies a gap. Each recommendation should name the affected page, the reason to act, who will do the work and how the firm will judge the result." },
  ];
  const serviceExamples = hasFindings ? [] : pages.filter(p => ["practice", "practice-area"].includes(p.pageType) && usable(p)).slice(0,3).map(p => ({ title: p.title?.trim() || p.url, url: p.url }));
  return { checks, allPassed, title, introduction, interpretation, direction, stopLabel, coverageNote, aiSearch, aiIntro, nextSteps, serviceExamples };
}

export const websiteReviewCta = {
  heading: "Plan your next step",
  body: "CaseLoad Select can review your priority services, search evidence and enquiry journey, then recommend the work worth commissioning. The aim is a clear plan tied to the matters your firm wants to attract.",
  linkLabel: "Discuss your website priorities",
};
