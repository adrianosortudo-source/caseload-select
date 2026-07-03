/**
 * analysis.ts
 *
 * The professional diagnostic layer: the enriched result contract, the issue
 * model, and the deterministic internal prospecting summary. Pure and
 * network-free; everything is derived from the per-page scan results, robots
 * rules, and headers. No LLM, no external calls.
 *
 * Backward compatibility: the response keeps the prior fields (categories,
 * overallScore, grade, ai* scores, aiBots, pages, pagesScanned, topFixes) and
 * adds the new ones (issues, internalSummary, severityBreakdown, scanMode).
 * The report UI treats every new field as optional.
 */

import {
  type CheckItem,
  type CategoryResult,
  type AiBotStatus,
  type PageType,
  type ScanMode,
  type ParsedRobots,
  COMMERCIAL_PAGE_TYPES,
  pageTypeLabel,
} from "./engine-core";
import {
  type PageAuditSnapshot,
  type PageIntentResult,
  type SiteIntentResult,
} from "./intent-analysis";
import {
  type PageRenderingSnapshot,
  type SiteRenderingSummary,
} from "./rendering-analysis";

/* ────────────────────────────────────────────────────────
   Per-page enriched signals
   ──────────────────────────────────────────────────────── */

export interface Indexability {
  httpStatus: number;
  redirected: boolean;
  redirectHops: number;
  canonical: string | null;
  canonicalSelf: boolean | null;
  canonicalSameOrigin: boolean | null;
  metaNoindex: boolean;
  metaNofollow: boolean;
  headerNoindex: boolean;
  headerNofollow: boolean;
  indexable: boolean;
  inSitemap: boolean | null;
  mixedSignals: boolean;
}

export interface SchemaSummary {
  blocks: number;
  invalidBlocks: number;
  types: string[];
  hasOrganization: boolean;
  hasLocalBusiness: boolean;
  hasLegalService: boolean;
  hasAttorney: boolean;
  hasPerson: boolean;
  hasBreadcrumb: boolean;
  hasFaq: boolean;
  hasWebsite: boolean;
  hasReview: boolean;
  fields: {
    name: boolean;
    url: boolean;
    telephone: boolean;
    address: boolean;
    areaServed: boolean;
    sameAs: boolean;
    priceRange: boolean;
    openingHours: boolean;
  };
  conflictingEntity: boolean;
}

export interface LawFirmSignals {
  phoneVisible: boolean;
  contactFormPresent: boolean;
  addressVisible: boolean;
  consultationCta: boolean;
  policyPagePresent: boolean;
  practiceAreaIntent: boolean;
  trust: {
    testimonials: boolean;
    reviews: boolean;
    caseResults: boolean;
    awards: boolean;
    credentials: boolean;
  };
}

export interface PageResult {
  url: string;
  title: string | null;
  metaDescription?: string | null;
  pageType: PageType;
  pageScore: number;
  pageGrade: string;
  aiVisibilityScore: number;
  categories: CategoryResult[];
  failCount: number;
  warnCount: number;
  httpStatus: number;
  indexable: boolean;
  indexability: Indexability;
  schema: SchemaSummary;
  lawFirm: LawFirmSignals;
  wordCount: number;
  rendering?: PageRenderingSnapshot;
  pageAudit?: PageAuditSnapshot;
  intentAlignment?: PageIntentResult;
  keyWarnings: string[];
}

export interface TopFix {
  label: string;
  category: string;
  status: "warn" | "fail";
  fix?: string;
  pagesAffected: number;
  totalPages: number;
}

/* ────────────────────────────────────────────────────────
   Issue model
   ──────────────────────────────────────────────────────── */

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Confidence = "high" | "medium" | "low";
export type Effort = "low" | "medium" | "high";

export interface Issue {
  id: string;
  category: string;
  severity: Severity;
  status: "pass" | "warn" | "fail";
  title: string;
  detail: string;
  fix?: string;
  evidence?: string;
  affectedUrls: string[];
  affectedCount: number;
  totalPages: number;
  pageTypeImpact: PageType[];
  confidence: Confidence;
  effort: Effort;
  priority: number;
  internalNote?: string;
  prospectingAngle?: string;
}

export interface SeverityBreakdown {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface InternalSummary {
  prospectFitScore: number;
  websiteMaturity: "poor" | "basic" | "decent" | "strong";
  urgencyLevel: "low" | "medium" | "high" | "urgent";
  likelyPainPoints: string[];
  strongestOutreachHooks: string[];
  recommendedOpeningAngle: string;
  topRevenueOpportunities: string[];
  technicalBlockers: string[];
  aiVisibilityBlockers: string[];
  localSeoOpportunities: string[];
  trustAndConversionGaps: string[];
}

export interface SeoCheckResult {
  domain: string;
  scanMode: ScanMode;
  pagesScanned: number;
  pages: PageResult[];
  categories: CategoryResult[];
  overallScore: number;
  grade: string;
  aiSearchScore: number;
  aiSearchGrade: string;
  aiPolicyScore: number;
  aiPolicyGrade: string;
  aiBots: AiBotStatus[];
  intentAlignment?: SiteIntentResult;
  renderingSummary?: SiteRenderingSummary;
  topFixes: TopFix[];
  issues: Issue[];
  /** Operator-only. Omitted from public (unauthenticated) responses. */
  internalSummary?: InternalSummary;
  severityBreakdown: SeverityBreakdown;
  /** True when the wall-clock budget was hit before the page target was met. */
  partial?: boolean;
  checkedAt: string;
}

/* ────────────────────────────────────────────────────────
   Severity / effort / confidence catalogs
   ──────────────────────────────────────────────────────── */

// Base severity by category for a hard failure. Warnings drop one level.
const CATEGORY_FAIL_SEVERITY: Record<string, Severity> = {
  "Indexability": "critical",
  "On-Page SEO": "high",
  "Legal Marketing": "high",
  "Intent Alignment": "high",
  "AI Visibility": "high",
  "Schema & Structured Data": "medium",
  "Local SEO": "medium",
  "Technical & Security": "high",
  "Rendering & Crawlability": "medium",
  "Performance": "low",
  "Links & Content": "medium",
};

// Explicit overrides for individual high-stakes checks (by label).
const LABEL_SEVERITY: Record<string, Severity> = {
  "Indexable": "critical",
  "Robots meta (noindex)": "critical",
  "Redirect chain": "low",
  "AI search bot access": "high",
  "HTTPS": "critical",
  "Page title": "high",
  "Meta description": "low",
  "H1 heading": "medium",
  "H2 subheadings": "low",
  "Open Graph tags": "low",
  "Image alt text": "low",
  "Heading hierarchy": "low",
  "Anchor text quality": "low",
  "Content-to-HTML ratio": "low",
  "Phone number visible": "high",
  "Contact path": "high",
  "Mixed indexability signals": "high",
  // Optional content-use policy, not a visibility deficiency. It is captured
  // separately in aiPolicyScore, so it stays low and never tops the fix list.
  "AI training bot control": "low",
  // Emerging, optional AI-readiness file. Low priority by design.
  "llms.txt file": "low",
  // Discoverability gap, not an indexability blocker. Pages not in a sitemap
  // are still crawlable; missing a sitemap is a setup gap, not a suppression.
  // Kept low so a missing sitemap never triggers the "held back" Indexability angle.
  "Sitemap membership": "low",
};

// Optional-policy labels: never raised by the commercial+sitewide coverage
// bump, because choosing not to act on them is a valid default.
const POLICY_LABELS = new Set<string>(["AI training bot control", "llms.txt file", "Sitemap membership"]);
const NO_COVERAGE_BUMP_LABELS = new Set<string>([
  ...POLICY_LABELS,
  "Meta description",
  "H1 heading",
  "H2 subheadings",
  "Open Graph tags",
  "Image alt text",
  "Heading hierarchy",
  "Anchor text quality",
  "Content-to-HTML ratio",
  "Time to first byte",
  "Render-blocking resources",
  "Redirect chain",
]);

const POLICY_RELEVANT_CATEGORIES = new Set<string>(["Indexability", "Technical & Security", "Performance"]);

const EFFORT_BY_CATEGORY: Record<string, Effort> = {
  "Indexability": "low",
  "On-Page SEO": "low",
  "Schema & Structured Data": "medium",
  "AI Visibility": "medium",
  "Legal Marketing": "medium",
  "Intent Alignment": "medium",
  "Local SEO": "low",
  "Technical & Security": "medium",
  "Rendering & Crawlability": "medium",
  "Performance": "high",
  "Links & Content": "medium",
};

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 100,
  high: 70,
  medium: 40,
  low: 18,
  info: 0,
};
const CONFIDENCE_WEIGHT: Record<Confidence, number> = { high: 1, medium: 0.8, low: 0.6 };
const EFFORT_DIVISOR: Record<Effort, number> = { low: 1, medium: 1.25, high: 1.6 };

function dropSeverity(s: Severity): Severity {
  const order: Severity[] = ["critical", "high", "medium", "low", "info"];
  const i = order.indexOf(s);
  return order[Math.min(order.length - 1, i + 1)];
}

function severityFor(category: string, label: string, status: "warn" | "fail", detail = ""): Severity {
  let base = LABEL_SEVERITY[label] ?? CATEGORY_FAIL_SEVERITY[category] ?? "medium";
  if (label === "Page title" && /(too long|too short|may be truncated)/i.test(detail)) base = "medium";
  return status === "fail" ? base : dropSeverity(base);
}

/** Internal note + outreach angle, derived from category and severity. */
function internalAngle(category: string, severity: Severity): { note: string; angle: string } {
  const c = category;
  if (c === "Indexability") {
    return {
      note: "Indexability blocker. If real, pages are invisible to search regardless of content quality. Strong, concrete opener.",
      angle: "Some of the firm's pages appear to be held back from search engines by a technical setting, not by content. That is usually a quick fix with an outsized payoff.",
    };
  }
  if (c === "AI Visibility") {
    return {
      note: "AI search readiness gap. Good differentiator: most firms have not thought about AI answer engines yet.",
      angle: "The site has useful material, but it is not packaged in a way AI search systems can confidently read and cite. That is becoming the new front door for high-intent legal questions.",
    };
  }
  if (c === "Legal Marketing") {
    return {
      note: "Conversion / trust gap specific to legal intake. Ties directly to signed-case value, not vanity metrics.",
      angle: "Visitors who are ready to act do not have an obvious next step or enough trust cues to take it. That is signed cases leaking out, not a traffic problem.",
    };
  }
  if (c === "Intent Alignment") {
    return {
      note: "Matter-intent gap. Strong prospecting evidence because it ties the audit to the exact work the firm says it wants.",
      angle: "The site does not yet have a page that clearly owns the priority matter and location in client language. That makes the firm's best-fit work harder to find and easier for competitors to frame first.",
    };
  }
  if (c === "Local SEO") {
    return {
      note: "Local visibility gap. Relevant for firms that depend on a city/region catchment.",
      angle: "The firm is not sending clear local signals, so it is competing for attention in its own city with one hand tied.",
    };
  }
  if (c === "Schema & Structured Data") {
    return {
      note: "Structured-data readiness gap. Affects both Google rich results eligibility and AI extraction.",
      angle: "Search and AI systems are reading the site without the structured cues that tell them who the firm is and what it does. Adding that is mechanical, not creative.",
    };
  }
  if (c === "On-Page SEO") {
    return {
      note: "Core on-page gap. Cheap to fix, common across the site, easy to demonstrate in a screenshot.",
      angle: "Several pages are missing the basic on-page signals search engines expect first. The content is there; the packaging is not.",
    };
  }
  if (c === "Technical & Security") {
    return {
      note: "Technical / security gap. Useful as a credibility opener; signals the site has not been maintained.",
      angle: "A few technical and security basics are not in place. On their own they are small, together they signal a site that has not had recent attention.",
    };
  }
  if (c === "Rendering & Crawlability") {
    return {
      note: "Rendering risk. Use this to avoid overclaiming when raw HTML may not show what a browser shows.",
      angle: "The site appears to rely on JavaScript for some visible content, which can make search and AI extraction less reliable unless critical copy is server-rendered.",
    };
  }
  if (c === "Performance") {
    return {
      note: "Performance gap. Lower priority for cold outreach unless severe; keep as supporting evidence.",
      angle: "The site is slower than it needs to be in places, which can frustrate visitors; page speed is also a known search signal.",
    };
  }
  return {
    note: "Supporting finding. Use as evidence, not as the lead.",
    angle: "A handful of smaller issues add up to a site that is not working as hard as it could for the firm.",
  };
}

/* ────────────────────────────────────────────────────────
   Issue builder
   ──────────────────────────────────────────────────────── */

let issueSeq = 0;
function slug(category: string, label: string): string {
  const base = `${category}-${label}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `issue-${issueSeq++}`;
}

/**
 * Build the de-duplicated, priority-ranked issue list from the per-page
 * categories. Each (category, label) becomes one issue, aggregated across the
 * pages where it is non-pass (worst status wins), enriched with severity,
 * confidence, effort, affected page types, and a priority score.
 */
export function buildIssues(pages: PageResult[]): Issue[] {
  const totalPages = pages.length || 1;
  type Acc = {
    category: string;
    label: string;
    status: "warn" | "fail";
    fix?: string;
    detail: string;
    urls: Set<string>;
    types: Set<PageType>;
  };
  const map = new Map<string, Acc>();

  for (const page of pages) {
    for (const cat of page.categories) {
      if (page.pageType === "policy" && !POLICY_RELEVANT_CATEGORIES.has(cat.name)) continue;
      for (const item of cat.items) {
        if (item.status === "pass") continue;
        // Avoid double-counting schema absence: when no JSON-LD exists, the
        // "structured data" issue already carries the actionable finding.
        if (cat.name === "Schema & Structured Data" && item.label === "JSON-LD validity" && /no blocks to validate/i.test(item.detail)) continue;
        const key = `${cat.name}::${item.label}`;
        const existing = map.get(key);
        if (!existing) {
          map.set(key, {
            category: cat.name,
            label: item.label,
            status: item.status,
            fix: item.fix,
            detail: item.detail,
            urls: new Set([page.url]),
            types: new Set([page.pageType]),
          });
        } else {
          existing.urls.add(page.url);
          existing.types.add(page.pageType);
          if (item.status === "fail") {
            existing.status = "fail";
            // Prefer a failing instance's detail/fix as representative.
            existing.detail = item.detail;
            if (item.fix) existing.fix = item.fix;
          }
        }
      }
    }
  }

  const issues: Issue[] = [];
  for (const acc of map.values()) {
    const affectedCount = acc.urls.size;
    const pageTypeImpact = [...acc.types];
    const hitsCommercial = pageTypeImpact.some((t) => COMMERCIAL_PAGE_TYPES.includes(t));

    let severity = severityFor(acc.category, acc.label, acc.status, acc.detail);
    // Bump one level when the issue lands on commercial pages and is sitewide.
    // The coverage bump does NOT manufacture "critical": that tier is reserved
    // for explicitly critical checks (noindex, HTTPS, missing contact path),
    // so a sitewide minor finding caps at "high".
    if (hitsCommercial && affectedCount >= Math.max(2, Math.ceil(totalPages / 2)) && severity !== "critical" && !NO_COVERAGE_BUMP_LABELS.has(acc.label)) {
      const order: Severity[] = ["critical", "high", "medium", "low", "info"];
      const bumped = order[Math.max(0, order.indexOf(severity) - 1)];
      severity = bumped === "critical" ? "high" : bumped;
    }

    const confidence: Confidence = acc.category === "Performance" ? "medium" : "high";
    const effort = EFFORT_BY_CATEGORY[acc.category] ?? "medium";

    // Priority: severity x confidence x coverage, divided by effort.
    const coverage = 0.6 + 0.4 * (affectedCount / totalPages);
    const commercialBoost = hitsCommercial ? 1.2 : 1;
    const priority = Math.round(
      (SEVERITY_WEIGHT[severity] * CONFIDENCE_WEIGHT[confidence] * coverage * commercialBoost) /
        EFFORT_DIVISOR[effort]
    );

    const { note, angle } = internalAngle(acc.category, severity);
    const evidence = affectedCount === 1
      ? `1 page: ${[...acc.urls][0]}`
      : `${affectedCount} of ${totalPages} pages, including ${distinctEvidencePaths([...acc.urls]).slice(0, 3).join(", ")}`;

    issues.push({
      id: slug(acc.category, acc.label),
      category: acc.category,
      severity,
      status: acc.status,
      title: acc.label,
      detail: acc.detail,
      fix: acc.fix,
      evidence,
      affectedUrls: [...acc.urls],
      affectedCount,
      totalPages,
      pageTypeImpact,
      confidence,
      effort,
      priority,
      internalNote: note,
      prospectingAngle: angle,
    });
  }

  return issues.sort((a, b) => b.priority - a.priority);
}

function safePath(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname || "/";
    if (u.search) {
      const params = u.searchParams;
      if (params.has("attachment_id")) return `${path}?attachment_id=${params.get("attachment_id")}`;
      if (params.has("p")) return `${path}?p=${params.get("p")}`;
      return `${path}${u.search}`;
    }
    return path;
  } catch { return url; }
}

function distinctEvidencePaths(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const path = safePath(url);
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out.length > 0 ? out : urls.map(safePath);
}

export function severityBreakdown(issues: Issue[]): SeverityBreakdown {
  const b: SeverityBreakdown = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const i of issues) b[i.severity]++;
  return b;
}

/**
 * Site-level structural issues that no single page check can see: whether the
 * firm has a contact path, practice-area pages, an attorney/team page, and a
 * sitemap. These complement the per-page issues from buildIssues.
 */
export function buildSiteStructureIssues(pages: PageResult[], hasSitemap: boolean): Issue[] {
  const totalPages = pages.length || 1;
  const home = pages[0];
  const out: Issue[] = [];
  const hasType = (t: PageType) => pages.some((p) => p.pageType === t);

  // Firms name practice pages by the matter itself (/corporate, /real-estate),
  // which the URL classifier tags "other", so do not rely on pageType alone:
  // a non-utility page with practice-area intent counts as a practice page.
  const hasPractice = hasType("practice") ||
    pages.some((p) => p.pageType === "other" && p.lawFirm.practiceAreaIntent);
  // Team info often lives on /about rather than a dedicated /team URL; treat
  // Person/Attorney schema anywhere as evidence the firm names its lawyers.
  const hasTeamSignal = hasType("attorney") ||
    pages.some((p) => p.schema.hasPerson || p.schema.hasAttorney);

  const push = (
    id: string, category: string, severity: Severity, title: string, detail: string,
    fix: string, effort: Effort, note: string, angle: string, basePriority: number
  ) => {
    out.push({
      id, category, severity, status: "fail", title, detail, fix,
      evidence: `Site structure across ${totalPages} scanned page${totalPages > 1 ? "s" : ""}`,
      affectedUrls: [home.url], affectedCount: 1, totalPages,
      pageTypeImpact: ["homepage"], confidence: "high", effort, priority: basePriority,
      internalNote: note, prospectingAngle: angle,
    });
  };

  const hasContactPath = hasType("contact") || home.lawFirm.contactFormPresent || home.lawFirm.phoneVisible;
  if (!hasContactPath) {
    push("structure-contact", "Legal Marketing", "high", "No clear contact path",
      "No contact page, on-page form, or visible phone number was found across the scanned pages.",
      "Add a dedicated contact page and surface a phone number and form sitewide.",
      "low", "Intake leak. A firm with no obvious contact path is losing signed cases at the door.",
      "There is no obvious way for a ready-to-act visitor to reach the firm. That is signed cases walking, not a traffic problem.", 88);
  }

  if (!hasPractice) {
    push("structure-practice", "Legal Marketing", "high", "No practice-area pages found",
      "No dedicated practice-area or service pages were found. These are the pages high-intent clients search for.",
      "Build a page per core practice area, each targeting the specific matter language clients use.",
      "high", "Big revenue lever. Practice-area pages are where high-value matter searches land.",
      "The firm's highest-value services do not have their own pages, so the searches that matter most have nowhere to land.", 84);
  }

  if (!hasTeamSignal) {
    push("structure-attorney", "AI Visibility", "medium", "No attorney / team page found",
      "No attorney or team page was found. These pages carry the expertise and authorship signals search and AI weight.",
      "Add an attorney/team page with each lawyer's bio, credentials, and Person schema.",
      "medium", "Authority and AI-authorship gap. Easy to package, helps E-E-A-T and AI sourcing.",
      "There is no page establishing who the lawyers are, which is exactly the expertise signal search and AI systems look for.", 58);
  }

  if (!hasSitemap) {
    push("structure-sitemap", "Indexability", "medium", "No XML sitemap found",
      "No XML sitemap was found at the default location or in robots.txt. Search engines have no map of the site.",
      "Publish an XML sitemap listing important pages and reference it from robots.txt.",
      "low", "Quick technical win. Signals an unmaintained setup; cheap to fix and easy to show.",
      "The site has no sitemap, so search engines are discovering pages by luck rather than by a map the firm controls.", 56);
  }

  return out;
}

/* ────────────────────────────────────────────────────────
   Deterministic internal prospecting summary
   ──────────────────────────────────────────────────────── */

function uniq(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}

export function buildInternalSummary(
  pages: PageResult[],
  issues: Issue[],
  overallScore: number,
  aiSearchScore: number
): InternalSummary {
  const totalPages = pages.length || 1;
  const home = pages[0];
  const crit = issues.filter((i) => i.severity === "critical");
  const high = issues.filter((i) => i.severity === "high");

  const byCat = (cat: string) => issues.filter((i) => i.category === cat);

  // Website maturity from headline score, breadth, and structured data.
  const hasSchema = pages.some((p) => p.schema.blocks > 0 && p.schema.invalidBlocks === 0);
  let websiteMaturity: InternalSummary["websiteMaturity"];
  if (overallScore < 35 || totalPages <= 1) websiteMaturity = "poor";
  else if (overallScore < 55 || !hasSchema) websiteMaturity = "basic";
  else if (overallScore < 75) websiteMaturity = "decent";
  else websiteMaturity = "strong";

  // Urgency from count of critical / high blockers.
  let urgencyLevel: InternalSummary["urgencyLevel"];
  if (crit.length >= 2) urgencyLevel = "urgent";
  else if (crit.length === 1 || high.length >= 4) urgencyLevel = "high";
  else if (high.length >= 1) urgencyLevel = "medium";
  else urgencyLevel = "low";

  // Prospect fit: a real site with clear, fixable gaps is the best target.
  // Poor sites (little to work with) and strong sites (little to sell) score
  // lower; basic and decent score highest, lifted by the volume of high-value
  // fixable gaps and dampened by sheer effort.
  let fit = 50;
  fit += { poor: -18, basic: 18, decent: 12, strong: -14 }[websiteMaturity];
  fit += Math.min(20, (crit.length * 7) + (high.length * 3));
  if (aiSearchScore < 50) fit += 6;
  if (byCat("Legal Marketing").length > 0) fit += 6;
  if (byCat("Local SEO").length > 0) fit += 4;
  const prospectFitScore = Math.max(0, Math.min(100, Math.round(fit)));

  // Pain points: categories with the most weighted findings, human phrasing.
  const painByCat: Array<[string, string]> = [
    ["Indexability", "Pages held back from search engines by technical settings"],
    ["AI Visibility", "Not positioned to be found or cited in AI search"],
    ["Legal Marketing", "Intake and trust cues are thin for a firm site"],
    ["On-Page SEO", "Core on-page signals missing across multiple pages"],
    ["Local SEO", "Weak local signals for the firm's catchment"],
    ["Schema & Structured Data", "No structured data for search and AI to read"],
    ["Technical & Security", "Technical and security basics not in place"],
  ];
  const likelyPainPoints = uniq(
    painByCat
      .filter(([cat]) => byCat(cat).some((i) => i.severity === "critical" || i.severity === "high" || i.severity === "medium"))
      .map(([, phrase]) => phrase)
  ).slice(0, 5);

  // Outreach hooks: the prospecting angle of the top-priority issues, de-duped
  // by angle text.
  const strongestOutreachHooks = uniq(
    issues.slice(0, 6).map((i) => i.prospectingAngle || "")
  ).slice(0, 3);

  // Opening angle: lead with the single highest-priority blocker category.
  const lead = issues[0];
  const recommendedOpeningAngle = lead
    ? lead.prospectingAngle ||
      "Open on the firm's strongest practice area and where its site is quietly underselling it."
    : "The site is in good shape. Open on growth and case selection rather than fixing problems.";

  const revenueCats = ["Legal Marketing", "Local SEO", "On-Page SEO", "AI Visibility"];
  const topRevenueOpportunities = uniq(
    issues
      .filter((i) => revenueCats.includes(i.category) && (i.severity === "critical" || i.severity === "high"))
      .slice(0, 4)
      .map((i) => `${i.title} (${i.category})`)
  );

  const technicalBlockers = uniq(
    issues
      .filter((i) => (i.category === "Indexability" || i.category === "Technical & Security") && i.status === "fail")
      .map((i) => i.title)
  ).slice(0, 5);

  const aiVisibilityBlockers = uniq(
    byCat("AI Visibility").filter((i) => i.status === "fail" || i.severity === "high").map((i) => i.title)
  ).slice(0, 5);

  const localSeoOpportunities = uniq(byCat("Local SEO").map((i) => i.title)).slice(0, 5);

  const trustGaps: string[] = [];
  if (!home.lawFirm.consultationCta) trustGaps.push("No clear consultation call to action");
  if (!home.lawFirm.phoneVisible) trustGaps.push("No visible phone number");
  if (!home.lawFirm.contactFormPresent) trustGaps.push("No on-page contact form");
  if (!pages.some((p) => p.lawFirm.trust.testimonials || p.lawFirm.trust.reviews)) trustGaps.push("No testimonials or reviews surfaced");
  if (!pages.some((p) => p.lawFirm.trust.credentials)) trustGaps.push("No bar or credential signals surfaced");
  const trustAndConversionGaps = uniq(trustGaps).slice(0, 5);

  return {
    prospectFitScore,
    websiteMaturity,
    urgencyLevel,
    likelyPainPoints,
    strongestOutreachHooks,
    recommendedOpeningAngle,
    topRevenueOpportunities,
    technicalBlockers,
    aiVisibilityBlockers,
    localSeoOpportunities,
    trustAndConversionGaps,
  };
}

/** Human label for a page type (re-exported for the UI). */
export { pageTypeLabel };
