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
  const title = allPassed ? "No specific repair identified in this sample." : model.overview?.title === "No priority finding in this scan" ? "No specific repair identified in this sample." : model.overview?.title ?? "Review the available evidence.";
  const introduction = allPassed
    ? `All ${total} reviewed pages loaded successfully, used secure connections and had page titles. We found no published instructions telling Google to stay away from these pages or leave them out of search.`
    : model.overview?.attention ?? "Review the recorded observations before choosing website changes.";
  const firstFinding = model.overview?.findings[0];
  const interpretation = allPassed
    ? "These five checks found no specific repair to prioritise in this sample. Use the firm's search and enquiry records to choose a useful next review."
    : firstFinding?.ruleId === "R1"
      ? "Review and approve concise replacements for these search descriptions before the provider publishes them."
      : firstFinding?.ruleId === "R4"
        ? "Agree the role of each page before changing its introduction or navigation. Both pages may remain if their purposes are clear."
        : firstFinding?.ruleId === "R2"
          ? "Have a qualified reviewer check whether the shared FAQ answers fit each listed service page before changing the sections."
          : firstFinding?.ruleId === "R3"
            ? "Review whether the service headings belong in a related-services section before changing the page wording."
            : "Confirm the intended purpose of each affected page before asking a provider to change its settings.";
  const firstFocus = model.overview?.focusLinks[0];
  const direction = hasFindings && firstFocus ? `Start with “${firstFocus.title}” below, affecting ${firstFocus.pageCount} page${firstFocus.pageCount === 1 ? "" : "s"}.` : "Optional next review: compare priority service pages with the firm's search and enquiry records.";
  const aiSearch = [
    { name: "ChatGPT", token: "OAI-SearchBot" },
    { name: "Claude", token: "Claude-SearchBot" },
    { name: "Perplexity", token: "PerplexityBot" },
  ].map(service => {
    const record = model.crawlerPolicies.find(bot => bot.token === service.token);
    return { ...service, observation: record?.policyObservation ?? "not-assessed", result: record?.policyObservation === "no-blocking-rule-observed" ? "No blocking rule observed" : record?.policyObservation === "blocking-rule-observed" ? "Blocking rule observed" : "Rules not assessed" };
  });
  const aiIntro = aiSearch.every(b => b.observation === "no-blocking-rule-observed")
    ? "The published rules we checked did not block these three search crawlers. This result gives us no reason to recommend changing those rules."
    : aiSearch.some(b => b.observation === "blocking-rule-observed")
      ? "A published blocking rule was recorded for at least one search crawler below. Confirm whether that restriction is intentional before changing it."
      : "Some search crawler rules were not assessed. Establish the missing information before recommending changes to access settings.";
  const nextSteps = model.overview?.nextSteps ?? [];
  const serviceExamples = hasFindings ? [] : pages.filter(p => ["practice", "practice-area"].includes(p.pageType) && usable(p)).slice(0,3).map(p => ({ title: p.title?.trim() || p.url, url: p.url }));
  const helpDeliverable = hasFindings
    ? `CaseLoad Select can help prepare ${[...(model.overview?.findings ?? [])].map(finding => {
      const count = new Set(finding.pages.map(page => page.url)).size;
      const pages = `${count} ${count === 1 ? "page" : "pages"}`;
      if (finding.ruleId === "R1") return `search-description drafts for ${pages}`;
      if (finding.ruleId === "R2") return `FAQ review notes for ${pages}`;
      if (finding.ruleId === "R3") return `service-heading review notes for ${pages}`;
      if (finding.ruleId === "R4") return `page-role decisions for ${pages}`;
      if (finding.id === "sitemap-exclusion") return `sitemap and search-setting checks for ${pages}`;
      if (finding.id === "service-exclusions") return `service-page search decisions for ${pages}`;
      if (finding.id === "team-exclusions") return `team-page search decisions for ${pages}`;
      return `review notes and next steps for “${finding.title}” (${pages})`;
    }).join(", ")}. These are proposed deliverables based on this report.`
    : "CaseLoad Select can compare up to three service pages with the firm's search and enquiry records and prepare a focused review. Those records were not read by this scan.";
  return { checks, allPassed, title, introduction, interpretation, direction, stopLabel, coverageNote, aiSearch, aiIntro, nextSteps, serviceExamples, helpDeliverable };
}

export const websiteReviewCta = {
  heading: "Help from CaseLoad Select",
  body: "CaseLoad Select can help turn these findings into clear decisions and scoped website work.",
  linkLabel: "Discuss this report",
};
