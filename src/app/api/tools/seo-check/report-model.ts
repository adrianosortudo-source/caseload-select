import { normalizeLegacyPurposes } from "./crawler-policy";
import { CATEGORY_WEIGHTS } from "./category-weights";
import type { AiBotPurpose } from "./engine-core";
import { CURRENT_METHODOLOGY_VERSION, isLimitedScoreMethodology, isCurrentMethodology } from "./methodology-version";

/**
 * Deterministic public report model for the in-tool SEO check.
 * Internal prospecting fields stay out of this boundary.
 */

export interface ReportCheckItem {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  scored?: boolean;
  checkId?: string;
  sourceIds?: string[];
  disposition?: "scored" | "unscored" | "pending-review";
  basis?: string;
  predicate?: string;
  scoringRationale?: string;
  evidence?: {
    kind: string; assessedUrl?: string;
    applicability: "applicable" | "not-applicable" | "unknown";
    coverage: "observed" | "not-observed" | "not-assessed";
    detail: string;
  };
  applicability?: "applicable" | "not-applicable" | "unknown";
}

export function checkObservationDisplayText(item: Pick<ReportCheckItem, "detail" | "scored" | "disposition">, methodologyVersion?: number): string {
  if (methodologyVersion !== 4 && methodologyVersion !== 5 || item.scored !== false) return item.detail;
  const explanation = item.disposition === "pending-review"
    ? "This check is excluded until its source and meaning are verified; it does not establish a search defect. No fix is recommended from this check."
    : "This is an observation for context, not a validated search defect. No fix is recommended from this check.";
  return `${item.detail} ${explanation}`;
}

export interface ReportCategory {
  name: string;
  score: number;
  maxScore: number;
  items: ReportCheckItem[];
}

export interface ReportPage {
  url: string;
  pageType: string;
  httpStatus: number;
  indexability: {
    metaNoindex?: boolean | null;
    headerNoindex?: boolean | null;
    indexable?: boolean | null;
    googleDirectives?: { noindex: "observed" | "not-observed" | "unknown"; nofollow: "observed" | "not-observed" | "unknown"; observations: Array<{ source: "meta" | "x-robots-tag"; scope: string; crawlerToken: string | null; rawValue: string; googleApplicability: "applicable" | "not-applicable" | "unknown"; limitation?: string }> };
  };
  robotsAccess?: { google: boolean | null; bing: boolean | null };
  lawFirm?: {
    phoneVisible: boolean;
    contactFormPresent: boolean;
    consultationCta: boolean;
    practiceAreaIntent: boolean;
    trust?: { credentials: boolean };
  };
  categories: ReportCategory[];
}

export interface ReportIssue {
  id: string;
  category: string;
  status: "pass" | "warn" | "fail";
  title: string;
  detail: string;
  fix?: string;
  evidence?: string;
  affectedUrls: string[];
  affectedCount: number;
  totalPages: number;
  confidence?: "high" | "medium" | "low";
}

export type ReportCoverageStopReason = "page-limit" | "time-budget" | "discovery-exhausted" | "fetch-failure" | "blocked" | "other";

export interface ReportAiBot {
  token?: string;
  name: string;
  blocked: boolean | null;
  category?: "search" | "training" | "user-initiated";
  purposes?: AiBotPurpose[];
  isControlToken?: boolean;
  robotsSemantics?: "respects" | "may-not-apply" | "generally-ignores" | "controls-specified-uses" | "unknown";
  policyObservation?: "blocking-rule-observed" | "no-blocking-rule-observed" | "not-assessed";
  actualFetchAccess?: "not-verified";
  sourceUrl?: string | null;
  reviewedAt?: string | null;
  sourceVerification?: "verified" | "unavailable";
}

export interface ReportInput {
  domain: string;
  methodologyVersion?: number | null;
  pagesScanned: number;
  overallScore?: number | null;
  pages?: ReportPage[];
  categories?: ReportCategory[];
  issues?: ReportIssue[];
  aiBots?: ReportAiBot[];
  partial?: boolean;
  checkedAt?: string;
  coverage?: {
    requestedLimit: number;
    attemptedPages: number;
    successfulPages: number;
    failedPages: number;
    skippedPages: number;
    discoveredCandidateUrls: number;
    totalSitePages: number | null;
    stopReason: ReportCoverageStopReason;
    skippedReasons: Record<string, number>;
    sitemapIncomplete: boolean;
    partial: boolean;
    pageSetHash?: string;
    pageSetHashBasis: "normalized-url-identities";
  };
}

export interface ReportAction {
  id: string;
  family: string;
  priorityLabel: string;
  evidenceLabel: "Observed in this scan" | "Needs confirmation" | "Not assessed" | "Optional choice";
  title: string;
  observed: string;
  whyItMatters: string;
  nextStep: string;
  affectedUrls: string[];
  affectedCount: number;
  checkedPageCount: number;
  sourceIssueIds: string[];
  technicalEvidence: string[];
}

export interface SeoReportModel {
  methodology: { version: number; label: "Website checks" | "Historical score" | "Unsupported method" | "Method not recorded"; notice: string | null };
  coverage: {
    pagesScanned: number; partial: boolean; checkedAt: string | null;
    requestedLimit: number | null; attemptedPages: number | null; successfulPages: number;
    failedPages: number | null; skippedPages: number | null; discoveredCandidateUrls: number | null;
    totalSitePages: number | null; stopReason: ReportCoverageStopReason | null;
    skippedReasons: Record<string, number>; sitemapIncomplete: boolean; pageSetHash: string | null;
    pageSetHashBasis: "normalized-url-identities" | null;
  };
  headline: { domain: string; interpretation: string };
  accessSummary: {
    checkedPageCount: number;
    noindexCount: number;
    indexabilityNotAssessedCount: number;
    googleBlockedCount: number;
    bingBlockedCount: number;
    googleNotAssessedCount: number;
    bingNotAssessedCount: number;
    homepageIndexDirective: "observed" | "not-observed" | "not-assessed" | "not-checked";
  };
  directiveObservations: Array<{ url: string; source: "meta" | "x-robots-tag"; scope: string; crawlerToken: string | null; rawValue: string; googleApplicability: "applicable" | "not-applicable" | "unknown"; limitation?: string }>;
  priorityActions: ReportAction[];
  strengths: string[];
  aiObservations: string[];
  crawlerPolicies: Array<{
    token: string;
    name: string;
    purposes: AiBotPurpose[];
    isControlToken: boolean;
    robotsSemantics: "respects" | "may-not-apply" | "generally-ignores" | "controls-specified-uses" | "unknown";
    policyObservation: "blocking-rule-observed" | "no-blocking-rule-observed" | "not-assessed";
    actualFetchAccess: "not-verified";
    sourceUrl: string | null;
    reviewedAt: string | null;
    sourceVerification: "verified" | "unavailable";
  }>;
  limitations: string[];
  findingGroups: Array<{ category: string; title: string; detail: string; affectedUrls: string[]; status: "pass" | "warn" | "fail" }>;
  scoreExplanation: {
    assessed: boolean;
    score: number | null;
    label: string;
    note: string;
    scoredCheckTypeCount: number;
    assessedCategoryCount: number;
    totalCategoryCount: number;
  };
  cta: { heading: string; body: string; linkLabel: string; href: string };
}

const METHOD_NOTE = "This saved scan used an earlier scoring method. Run a new scan for the current report. Scores from different methods should not be compared.";
const UNSUPPORTED_METHOD_NOTE = "This saved scan records a scoring method this report does not interpret. Run a new scan for the current report.";
const SCORE_NOTE = "Not a whole-site grade or ranking prediction.";
const LIMITATION = (n: number) => `Only the initial HTML of ${n} ${n === 1 ? "page" : "pages"} was checked. This is not a full site audit and does not verify indexing, rankings, enquiries, legal accuracy, or AI citations of the firm.`;
const PARTIAL_LIMITATION = "The scan is incomplete. Findings apply only to inspected pages.";
const CTA_HREF = "https://cal.com/adriano-caseloadselect/conversation";

type Family = { id: string; rank: number; title: string; why: string; next: string; priority: string };

const FAMILIES: Family[] = [
  { id: "search-exclusion", rank: 1, priority: "Review first", title: "Review which pages should appear in search", why: "This instruction can affect whether search engines include a page in results.", next: "Ask your provider to review which pages should appear in search." },
  { id: "robots-access", rank: 1, priority: "Review first", title: "Review crawler access to these pages", why: "This can limit crawling. It does not prove that a URL is absent from search results.", next: "Confirm whether the restriction is intentional before changing it." },
  { id: "connection", rank: 2, priority: "Review", title: "Review page connection security", why: "Visitors should have a secure connection when using the site, especially before sharing information.", next: "Ask your web provider to confirm HTTPS is available and consistently used." },
  { id: "contact-route", rank: 3, priority: "Review", title: "Make the next contact step easy to find", why: "A clear contact route can help prospective clients understand how to reach the firm.", next: "Review affected pages on desktop and mobile and confirm how a prospective client should contact the firm." },
  { id: "service-information", rank: 4, priority: "Review", title: "Clarify the matters the firm handles", why: "Clear service information can help readers decide whether a page is relevant to their situation.", next: "Review whether main services and intended clients are clear on the relevant pages." },
  { id: "page-labels", rank: 5, priority: "Review", title: "Make page topics easier to understand", why: "Clear page names and headings help readers understand what each inspected page covers.", next: "Review page names, headings and search descriptions for clarity and consistency." },
  { id: "business-information", rank: 6, priority: "Review", title: "Check how the firm's information is described", why: "Machine-readable business details should reflect the firm's current public information.", next: "Ask your provider to compare the structured information with current public details." },
  { id: "supporting-content", rank: 7, priority: "Review", title: "Review how key pages answer client questions", why: "A qualified review can determine whether important questions are answered clearly and supported where appropriate.", next: "Have a qualified reviewer assess the clarity and support for important answers." },
  { id: "discovery", rank: 8, priority: "Review", title: "Review how important pages are connected", why: "Page links and identifiers help describe the relationship between inspected pages.", next: "Ask your provider to check page relationships and intended versions." },
  { id: "browser-experience", rank: 9, priority: "Verify", title: "Verify the visitor experience", why: "The initial HTML does not show every interaction or how a page behaves in a browser.", next: "Test in a browser and use measured performance evidence before choosing work." },
];

const ISSUE_FAMILY_BY_KEY: Readonly<Record<string, Family>> = {
  "indexability|indexable": FAMILIES[0],
  "indexability|robots.txt crawl access": FAMILIES[1],
  "technical & security|https": FAMILIES[2],
  "technical & security|mixed content": FAMILIES[2],
  "legal marketing|no clear contact path": FAMILIES[3],
  "legal marketing|phone number visible": FAMILIES[3],
  "legal marketing|contact form / direct contact": FAMILIES[3],
  "legal marketing|consultation call to action": FAMILIES[3],
  "legal marketing|practice-area intent": FAMILIES[4],
  "legal marketing|no practice-area pages found": FAMILIES[4],
  "legal marketing|no attorney or team page found in checked pages": FAMILIES[4],
  "on-page seo|page title": FAMILIES[5],
  "on-page seo|meta description": FAMILIES[5],
  "on-page seo|h1 heading": FAMILIES[5],
  "schema & structured data|business / legalservice schema": FAMILIES[6],
  "schema & structured data|business schema fields": FAMILIES[6],
  "schema & structured data|entity description": FAMILIES[6],
  "schema & structured data|attorney / person schema": FAMILIES[6],
  "on-page seo|question-format headings": FAMILIES[7],
  "on-page seo|direct-answer sentences": FAMILIES[7],
  "on-page seo|authoritative citations": FAMILIES[7],
  "on-page seo|author / reviewer signals": FAMILIES[7],
  "indexability|canonical tag": FAMILIES[8],
  "indexability|mixed indexability signals": FAMILIES[8],
  "indexability|sitemap membership": FAMILIES[8],
  "indexability|redirect chain": FAMILIES[8],
  "indexability|hreflang annotations": FAMILIES[8],
  "on-page seo|internal links": FAMILIES[8],
  "performance|time to first byte": FAMILIES[9],
  "performance|html document size": FAMILIES[9],
  "performance|render-blocking resources": FAMILIES[9],
};

function familyFor(issue: ReportIssue): Family | null {
  return ISSUE_FAMILY_BY_KEY[`${issue.category.trim().toLowerCase()}|${issue.title.trim().toLowerCase()}`] ?? null;
}

const LEGACY_AI_ONLY_RE = /\bAI[- ](?:visibility|search|citation|readiness)\b|\b(?:answer[- ]engine|llms\.txt|GPTBot|ClaudeBot|Claude-SearchBot|PerplexityBot|ChatGPT-User)\b|not positioned to be found or cited in AI search/i;
function isLegacyAiOnlyIssue(issue: ReportIssue): boolean {
  return issue.category.trim().toLowerCase() === "ai visibility" || LEGACY_AI_ONLY_RE.test(`${issue.category} ${issue.title} ${issue.detail}`);
}

function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))]; }

export function getDisplayedCategoryWeights(
  categories: ReportCategory[],
  categoryWeights: Record<string, number>,
  methodologyVersion: number,
): Array<[string, number]> {
  const entries = Object.entries(categoryWeights);
  if (!isLimitedScoreMethodology(methodologyVersion)) return entries;

  const contributingCategories = new Set(categories
    .filter((category) => category.maxScore > 0 && (CATEGORY_WEIGHTS[category.name] ?? 6) > 0)
    .map((category) => category.name));
  return entries.filter(([name, weight]) => weight > 0 && contributingCategories.has(name));
}

function checkItems(pages: ReportPage[], label: string): Array<{ page: ReportPage; item: ReportCheckItem }> {
  return pages.flatMap((page) => page.categories.flatMap((category) => category.items
    .filter((item) => item.label === label && item.applicability !== "not-applicable" && item.applicability !== "unknown")
    .map((item) => ({ page, item }))));
}

function allCheckItems(pages: ReportPage[], label: string): Array<{ page: ReportPage; item: ReportCheckItem }> {
  return pages.flatMap((page) => page.categories.flatMap((category) => category.items
    .filter((item) => item.label === label)
    .map((item) => ({ page, item }))));
}

function utilityPage(page: ReportPage): boolean { return ["policy", "intake", "tool"].includes(page.pageType); }

function makeAction(family: Family, issues: ReportIssue[], pages: ReportPage[], selectedUrls?: string[], methodologyVersion = 2): ReportAction {
  const urls = unique(selectedUrls ?? issues.flatMap((i) => i.affectedUrls));
  const isPlainHttpIssue = (issue: ReportIssue) => issue.title.toLowerCase() === "https" || /loaded over http|served over http/i.test(`${issue.title} ${issue.detail}`);
  const plainHttpUrls = unique(issues.filter(isPlainHttpIssue).flatMap((issue) => issue.affectedUrls));
  const mixedContentUrls = unique(issues.filter((issue) => issue.title.toLowerCase() === "mixed content").flatMap((issue) => issue.affectedUrls));
  const hasPlainHttp = plainHttpUrls.length > 0;
  const hasMixedContent = mixedContentUrls.length > 0;
  const evidence = unique(issues.flatMap((i) => [i.evidence, i.detail]).filter((x): x is string => Boolean(x)));
  const sampleUrl = (url: string) => {
    try { return new URL(url).pathname || "/"; } catch { return url; }
  };
  let observed = `The scan recorded a ${family.id.replaceAll("-", " ")} check finding on ${urls.length || 1} checked page${(urls.length || 1) === 1 ? "" : "s"}.`;
  if (family.id === "search-exclusion") {
    const count = urls.length;
    observed = methodologyVersion === 5
      ? `${count} of ${pages.length} checked ${pages.length === 1 ? "page" : "pages"} ${count === 1 ? "tells" : "tell"} Google not to include ${count === 1 ? "it" : "them"} in search. Google must retrieve the instruction first.`
      : `${count} of ${pages.length} checked pages contain an instruction asking search engines to leave them out of results.`;
  } else if (family.id === "robots-access") {
    const crawlerNames = unique(evidence.flatMap((line) => ["Googlebot", "Bingbot"].filter((name) => line.includes(name))));
    observed = `The inspected robots.txt rules restrict ${crawlerNames.join(" and ") || "a listed search crawler"} on ${urls.length} checked page${urls.length === 1 ? "" : "s"}.`;
  } else if (family.id === "connection") {
    if (hasPlainHttp && hasMixedContent) {
      observed = `${plainHttpUrls.length} checked page${plainHttpUrls.length === 1 ? "" : "s"} loaded over HTTP rather than HTTPS. Resources served over HTTP were also found on ${mixedContentUrls.length} checked page${mixedContentUrls.length === 1 ? "" : "s"}.`;
    } else if (hasPlainHttp) {
      observed = `${plainHttpUrls.length} checked page${plainHttpUrls.length === 1 ? "" : "s"} loaded over HTTP rather than HTTPS.`;
    } else if (hasMixedContent) {
      observed = `${mixedContentUrls.length} checked page${mixedContentUrls.length === 1 ? "" : "s"} loaded over HTTPS but included resources served over HTTP.`;
    }
  } else if (family.id === "contact-route") {
    observed = `A clear contact option was not confirmed in the scanned page content on ${urls.length} checked page${urls.length === 1 ? "" : "s"}.`;
  } else if (family.id === "service-information") {
    observed = `Service details on ${urls.length} checked page${urls.length === 1 ? "" : "s"} may need a closer review.`;
  } else if (family.id === "page-labels") {
    observed = `Page titles, descriptions, or headings on ${urls.length} checked page${urls.length === 1 ? "" : "s"} may need review.`;
  } else if (family.id === "business-information") {
    observed = `Structured business details on ${urls.length} checked page${urls.length === 1 ? "" : "s"} may need to be checked against current public information.`;
  } else if (family.id === "supporting-content") {
    observed = `A qualified review could check whether these ${urls.length} page${urls.length === 1 ? "" : "s"} answer important client questions clearly.`;
  } else if (family.id === "discovery") {
    observed = `Page relationships and search discovery settings on ${urls.length} checked page${urls.length === 1 ? "" : "s"} may need a closer look.`;
  } else if (family.id === "browser-experience") {
    observed = `This scan cannot confirm how these ${urls.length} page${urls.length === 1 ? "" : "s"} behave in a browser; browser testing is needed.`;
  }
  return {
    id: family.id,
    family: family.id,
    priorityLabel: family.priority,
    evidenceLabel: issues.length > 0 && issues.every((issue) => issue.confidence === "high")
      ? "Observed in this scan"
      : "Needs confirmation",
    title: family.title,
    observed,
    whyItMatters: family.id === "search-exclusion" && methodologyVersion === 5
      ? "This instruction may keep useful pages out of Google."
      : family.id === "connection" && hasMixedContent && hasPlainHttp
      ? "Some checked pages loaded without HTTPS, and browsers may block or limit resources served over HTTP on other HTTPS pages."
      : family.id === "connection" && hasMixedContent
      ? "A browser may block or limit resources served over HTTP on an HTTPS page, which can affect how the page appears or works."
      : family.why,
    nextStep: family.id === "connection" && hasMixedContent && hasPlainHttp
      ? "Ask your web provider to secure the pages loaded over HTTP and replace HTTP resource addresses on the other affected pages with HTTPS."
      : family.id === "connection" && hasMixedContent
      ? "Ask your web provider to replace the affected HTTP resource addresses with HTTPS, then confirm the pages still display and work as intended."
      : family.next,
    affectedUrls: urls,
    affectedCount: urls.length || issues.reduce((n, i) => Math.max(n, i.affectedCount), 0),
    checkedPageCount: pages.length,
    sourceIssueIds: issues.map((i) => i.id),
    technicalEvidence: unique([...evidence, ...urls.map(sampleUrl)]),
  };
}

export function buildSeoReportModel(input: ReportInput): SeoReportModel {
  const pages = input.pages ?? [];
  const issues = input.issues ?? [];
  const reportIssues = issues.filter((issue) => !isLegacyAiOnlyIssue(issue));
  const resolvedPartial = input.coverage?.partial ?? Boolean(input.partial);
  const version = typeof input.methodologyVersion === "number" ? input.methodologyVersion : 2;
  // v3 and earlier keep their stored score meaning and are never silently
  // reinterpreted through the v4 report copy or denominator.
  const current = isCurrentMethodology(version);
  const supported = isLimitedScoreMethodology(version);
  const scoreMethodSupported = supported || version <= 3;
  const noindexPages = version === 5
    ? pages.filter((p) => p.indexability?.googleDirectives?.noindex === "observed")
    : version <= 4
      ? pages.filter((p) => p.indexability?.metaNoindex || p.indexability?.headerNoindex)
      : [];
  const googleBlocked = version === 5
    ? pages.filter((page) => page.robotsAccess?.google === false)
    : version <= 4 ? checkItems(pages, "robots.txt crawl access").filter(({ item }) => item.status === "fail" && /Googlebot/.test(item.detail)) : [];
  const bingBlocked = version === 5
    ? pages.filter((page) => page.robotsAccess?.bing === false)
    : version <= 4 ? checkItems(pages, "robots.txt crawl access").filter(({ item }) => item.status === "fail" && /Bingbot/.test(item.detail)) : [];
  const unknownRobotsPages = unique(allCheckItems(pages, "robots.txt crawl access")
    .filter(({ item }) => item.scored === false || item.applicability === "unknown")
    .map(({ page }) => page.url));
  const homepage = pages.find((page) => page.pageType === "homepage");
  const homepageIndexDirective = !homepage
    ? "not-checked"
    : version > CURRENT_METHODOLOGY_VERSION
      ? "not-assessed"
    : version === 5 && homepage.indexability.googleDirectives?.noindex === "unknown"
      ? "not-assessed"
    : version === 5 && homepage.indexability.googleDirectives?.noindex === "observed"
      ? "observed"
      : version === 5 && homepage.indexability.googleDirectives?.noindex === "not-observed"
        ? "not-observed"
      : version === 5
        ? "not-assessed"
      : homepage.indexability.metaNoindex === true || homepage.indexability.headerNoindex === true
        ? "observed"
      : homepage.indexability.metaNoindex === false && homepage.indexability.headerNoindex === false
        ? "not-observed"
        : "not-assessed";

  const groups = new Map<string, ReportIssue[]>();
  for (const issue of reportIssues) {
    if (issue.status === "pass") continue;
    const family = familyFor(issue);
    if (!family) continue;
    const list = groups.get(family.id) ?? [];
    list.push(issue);
    groups.set(family.id, list);
  }
  const candidates = [...groups.entries()].map(([id, group]) => {
    const family = FAMILIES.find((x) => x.id === id)!;
    const urls = unique(group.flatMap((i) => i.affectedUrls)).filter((url) => {
      const page = pages.find((p) => p.url === url);
      const indexabilityItem = page?.categories.find((category) => category.name === "Indexability")?.items.find((item) => item.label === "Indexable");
      if (version === 5 && id === "search-exclusion" && indexabilityItem?.applicability === "unknown") return false;
      if (version > CURRENT_METHODOLOGY_VERSION && id === "search-exclusion") return false;
      return !page || !utilityPage(page);
    });
    return { family, group, urls };
  }).filter(({ urls }) => urls.length > 0).sort((a, b) =>
    a.family.rank - b.family.rank || b.urls.length - a.urls.length || a.family.id.localeCompare(b.family.id));

  const priorityActions = candidates.slice(0, 3).map(({ family, group, urls }) => makeAction(family, group, pages, urls, version));
  if (noindexPages.length && !priorityActions.some((a) => a.family === "search-exclusion")) {
    const relevant = noindexPages.filter((p) => !utilityPage(p));
    if (relevant.length) priorityActions.unshift(makeAction(FAMILIES[0], [], pages, relevant.map((p) => p.url), version));
    priorityActions.splice(3);
  }

  const strengths: string[] = [];
  if (pages.length && pages.every((p) => p.url.startsWith("https://"))) strengths.push(`All ${pages.length} checked pages loaded over HTTPS.`);
  if (pages.some((p) => p.lawFirm?.contactFormPresent || p.lawFirm?.phoneVisible || p.lawFirm?.consultationCta)) strengths.push("A contact route was found in the inspected page content.");
  if (pages.some((p) => p.lawFirm?.practiceAreaIntent)) strengths.push("Service information was found in the inspected page content.");
  if (pages.length && version <= CURRENT_METHODOLOGY_VERSION && (version === 5
    ? pages.every((p) => p.indexability?.googleDirectives?.noindex === "not-observed")
    : pages.every((p) => p.indexability?.indexable === true))) strengths.push(version === 5 ? "No noindex instruction addressed to Google was observed in the checked page responses." : "No noindex instruction was observed on the checked pages.");

  const crawlerPolicies = (input.aiBots ?? []).map((bot) => ({
    token: bot.token ?? bot.name,
    name: bot.name,
    purposes: normalizeLegacyPurposes(bot.purposes, bot.category),
    isControlToken: bot.isControlToken ?? false,
    robotsSemantics: bot.robotsSemantics ?? "unknown",
    policyObservation: bot.policyObservation ?? (bot.blocked === null ? "not-assessed" : bot.blocked ? "blocking-rule-observed" : "no-blocking-rule-observed"),
    actualFetchAccess: "not-verified" as const,
    sourceUrl: bot.sourceUrl ?? null,
    reviewedAt: bot.reviewedAt ?? null,
    sourceVerification: bot.sourceVerification ?? "unavailable",
  }));
  const aiObservations: string[] = crawlerPolicies.length
    ? ["Provider-specific purposes, robots.txt rule observations, and documented robots behavior are listed per token below. An observed rule does not verify actual access or downstream use."]
    : ["This scan did not assess provider-specific crawler policy or actual AI service access."];

  const scoreCategories = input.categories ?? [];
  const contributingCategories = scoreCategories.filter((category) =>
    category.maxScore > 0 && (CATEGORY_WEIGHTS[category.name] ?? 6) > 0
  );
  const scoredCheckTypeCount = new Set(contributingCategories.flatMap((category) =>
    category.items
      .filter((item) => item.scored !== false && item.applicability !== "not-applicable" && item.applicability !== "unknown")
      .map((item) => `${category.name}::${item.label}`)
  )).size;
  const assessedCategoryCount = contributingCategories.length;
  const totalCategoryCount = scoreCategories.length;
  const assessed = assessedCategoryCount > 0;
  const scopedLabel = `Limited checks: ${scoredCheckTypeCount} ${scoredCheckTypeCount === 1 ? "check type" : "check types"} across ${assessedCategoryCount} of ${totalCategoryCount} ${totalCategoryCount === 1 ? "category" : "categories"}`;
  const note = current
    ? assessed
      ? SCORE_NOTE
      : "No scored checks contributed to this scan. This scan does not grade the whole site or predict rankings."
    : METHOD_NOTE;
  const limitations = [LIMITATION(pages.length || input.pagesScanned), ...(resolvedPartial ? [PARTIAL_LIMITATION] : [])];
  return {
    methodology: { version, label: current ? "Website checks" : typeof input.methodologyVersion !== "number" ? "Method not recorded" : supported || version <= 3 ? "Historical score" : "Unsupported method", notice: current ? null : version > CURRENT_METHODOLOGY_VERSION ? UNSUPPORTED_METHOD_NOTE : METHOD_NOTE },
    coverage: {
      pagesScanned: input.pagesScanned,
      partial: resolvedPartial,
      checkedAt: input.checkedAt ?? null,
      requestedLimit: input.coverage?.requestedLimit ?? null,
      attemptedPages: input.coverage?.attemptedPages ?? null,
      successfulPages: input.coverage?.successfulPages ?? pages.length,
      failedPages: input.coverage?.failedPages ?? null,
      skippedPages: input.coverage?.skippedPages ?? null,
      discoveredCandidateUrls: input.coverage?.discoveredCandidateUrls ?? null,
      totalSitePages: input.coverage?.totalSitePages ?? null,
      stopReason: input.coverage?.stopReason ?? null,
      skippedReasons: input.coverage?.skippedReasons ?? {},
      sitemapIncomplete: input.coverage?.sitemapIncomplete ?? false,
      pageSetHash: input.coverage?.pageSetHash ?? null,
      pageSetHashBasis: input.coverage?.pageSetHashBasis ?? null,
    },
    headline: {
      domain: input.domain,
      interpretation: priorityActions[0]?.title ?? "No priority action was identified by these checks. This limited scan does not confirm that the whole website is free of problems.",
    },
    accessSummary: {
      checkedPageCount: pages.length,
      noindexCount: noindexPages.length,
      indexabilityNotAssessedCount: version === 5 ? pages.filter((page) => !page.indexability?.googleDirectives || page.indexability.googleDirectives.noindex === "unknown").length : version > CURRENT_METHODOLOGY_VERSION ? pages.length : 0,
      googleBlockedCount: googleBlocked.length,
      bingBlockedCount: bingBlocked.length,
      googleNotAssessedCount: version === 5 ? pages.filter((page) => page.robotsAccess?.google == null).length : version <= 4 ? unknownRobotsPages.length : pages.length,
      bingNotAssessedCount: version === 5 ? pages.filter((page) => page.robotsAccess?.bing == null).length : version <= 4 ? unknownRobotsPages.length : pages.length,
      homepageIndexDirective,
    },
    directiveObservations: version === 5 ? pages.flatMap((page) => (page.indexability?.googleDirectives?.observations ?? []).map((observation) => ({ url: page.url, ...observation }))) : [],
    priorityActions,
    strengths: strengths.slice(0, 3),
    aiObservations,
    crawlerPolicies,
    limitations,
    findingGroups: reportIssues.map((issue) => ({ category: issue.category, title: issue.title, detail: issue.detail, affectedUrls: issue.affectedUrls, status: issue.status })),
    scoreExplanation: {
      assessed: current ? assessed : scoreMethodSupported && Number.isFinite(input.overallScore),
      score: scoreMethodSupported && Number.isFinite(input.overallScore) && (!current || assessed) ? input.overallScore! : null,
      label: current ? (assessed ? scopedLabel : "Not assessed") : version > CURRENT_METHODOLOGY_VERSION ? "Unsupported method" : "Historical score",
      note: version > CURRENT_METHODOLOGY_VERSION ? UNSUPPORTED_METHOD_NOTE : note,
      scoredCheckTypeCount,
      assessedCategoryCount,
      totalCategoryCount,
    },
    cta: { heading: "Next steps", body: "We can help interpret these findings, identify what matters for your cases, and decide what to fix first.", linkLabel: "Book a conversation", href: CTA_HREF },
  };
}
