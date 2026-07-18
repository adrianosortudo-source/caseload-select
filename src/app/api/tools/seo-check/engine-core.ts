/**
 * engine-core.ts
 *
 * Pure, network-free core for the SEO & AI visibility diagnostic. Everything
 * here is deterministic and unit-testable: SSRF range classification, the
 * robots.txt parser, URL normalisation and page-type classification, scan-mode
 * resolution, the shared scoring helpers, and the base result types.
 *
 * The network layer (undici Agent, safeFetch, redirect following, body caps)
 * lives in route.ts and imports from here. Keeping the pure logic in one place
 * keeps the SSRF guard and robots semantics in a single tested location and
 * leaves the door open for a future public lead-magnet build that reuses the
 * same core.
 */

export { BLOCKED_HOSTNAMES, ipInBlockedRange, isSsrfBlocked } from "@/lib/ssrf";

/* ────────────────────────────────────────────────────────
   Base result types (backward-compatible with the prior shape)
   ──────────────────────────────────────────────────────── */

export interface CheckItem {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fix?: string;
  // false means the item is displayed and still generates an issues-list
  // finding, but contributes nothing to any score (scoreItems / aiScoresFromItems
  // skip it entirely). Used for signals with no established search benefit
  // (llms.txt, FAQPage/Review schema) and for security-hygiene headers that
  // should never imply a search-visibility gain. Absent/undefined means scored.
  scored?: boolean;
}

export interface CategoryResult {
  name: string;
  score: number;
  maxScore: number;
  items: CheckItem[];
}

export interface AiBotStatus {
  name: string;
  blocked: boolean;
  category: "search" | "training";
}

export type PageType =
  | "homepage"
  | "contact"
  | "about"
  | "attorney"
  | "practice"
  | "location"
  | "faq"
  | "blog"
  | "policy"
  | "intake"
  | "tool"
  | "other";

// Page types that carry direct commercial weight for a law firm. Issues that
// affect these pages are scored higher in the priority model. "intake" is
// included: a matter-review/intake funnel is the direct conversion action,
// not a supporting page.
export const COMMERCIAL_PAGE_TYPES: PageType[] = [
  "homepage",
  "contact",
  "practice",
  "attorney",
  "location",
  "intake",
];

// The page types where article-shaped AEO/content checks (question headings,
// direct-answer sentences, citations, authorship, substantive word count) are
// treated as a requirement. Elsewhere the checks still run and their evidence
// stays visible, but a miss is not scored as a defect: a contact form, an
// intake funnel, a homepage, or an interactive tool is not an article and was
// never meant to carry a 300-word definitional essay. See
// applyPageTypeApplicability.
export const CONTENT_REQUIRED_PAGE_TYPES: PageType[] = ["practice", "faq", "blog"];

/* ────────────────────────────────────────────────────────
   Scan modes
   ──────────────────────────────────────────────────────── */

export type ScanMode = "quick" | "standard" | "deep";

export const SCAN_MODE_DEFAULTS: Record<ScanMode, number> = {
  quick: 10,
  standard: 25,
  deep: 50,
};

export const MAX_PAGES_HARD_CAP = 75;

export function isScanMode(v: unknown): v is ScanMode {
  return v === "quick" || v === "standard" || v === "deep";
}

/**
 * Resolve the page budget for a scan. Explicit maxPages wins (clamped to
 * [1, 75]); otherwise the scan-mode default; otherwise the quick default.
 */
export function resolveScan(input: {
  maxPages?: unknown;
  scanMode?: unknown;
}): { scanMode: ScanMode; maxPages: number } {
  const scanMode: ScanMode = isScanMode(input.scanMode) ? input.scanMode : "quick";
  if (Number.isFinite(input.maxPages)) {
    const n = Math.floor(input.maxPages as number);
    return { scanMode, maxPages: Math.max(1, Math.min(MAX_PAGES_HARD_CAP, n)) };
  }
  return { scanMode, maxPages: SCAN_MODE_DEFAULTS[scanMode] };
}

/* ────────────────────────────────────────────────────────
   Bot registries
   ──────────────────────────────────────────────────────── */

// AI search / answer-retrieval bots. Blocking these costs the firm visibility
// in AI search surfaces. ClaudeBot is included here because Anthropic uses it
// for answer retrieval in Claude's web-enabled responses, alongside the
// dedicated Claude-SearchBot token; it is NOT a training-only crawler.
export const AI_SEARCH_BOTS = [
  { token: "ChatGPT-User", label: "ChatGPT Search" },
  { token: "OAI-SearchBot", label: "OpenAI SearchBot" },
  { token: "PerplexityBot", label: "Perplexity" },
  { token: "Perplexity-User", label: "Perplexity User" },
  { token: "ClaudeBot", label: "Claude" },
  { token: "Claude-SearchBot", label: "Claude Search" },
];

// Training / content-use bots. Blocking these protects content from model
// training. Google-Extended controls Gemini training/grounding use and is NEVER
// an AI search visibility signal: blocking it does not remove the firm from
// Google Search or AI Overviews.
export const AI_TRAINING_BOTS = [
  { token: "GPTBot", label: "GPTBot (training)" },
  { token: "CCBot", label: "Common Crawl" },
  { token: "Bytespider", label: "Bytespider" },
  { token: "Meta-ExternalAgent", label: "Meta" },
  { token: "Applebot-Extended", label: "Applebot" },
  { token: "Google-Extended", label: "Google-Extended (AI use)" },
];

export const SCANNER_TOKEN = "CaseLoadSelect-SEOCheck";

export const GENERIC_ANCHORS = new Set([
  "click here", "here", "read more", "learn more", "more", "link",
  "this", "go", "see more", "continue", "details", "info",
]);

export const CATEGORY_WEIGHTS: Record<string, number> = {
  "On-Page SEO": 22,
  "Indexability": 18,
  "Schema & Structured Data": 10,
  "AI Visibility": 14,
  "Legal Marketing": 12,
  "Local SEO": 8,
  "Technical & Security": 8,
  "Rendering & Crawlability": 6,
  "Performance": 4,
  "Links & Content": 4,
  "Intent Alignment": 8,
};

/* ────────────────────────────────────────────────────────
   robots.txt parser (Google-style group semantics)
   ──────────────────────────────────────────────────────── */

export interface RobotsRule {
  type: "allow" | "disallow";
  path: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export function parseRobotsTxt(text: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let currentAgents: string[] = [];
  let currentRules: RobotsRule[] = [];
  let inGroup = false;

  const finishGroup = () => {
    if (inGroup && currentAgents.length > 0) {
      groups.push({ agents: [...currentAgents], rules: [...currentRules] });
    }
    currentAgents = [];
    currentRules = [];
    inGroup = false;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const commentStart = rawLine.indexOf("#");
    const line = (commentStart >= 0 ? rawLine.substring(0, commentStart) : rawLine).trim();
    if (!line) { finishGroup(); continue; }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const directive = line.substring(0, colonIdx).trim().toLowerCase();
    const value = line.substring(colonIdx + 1).trim();

    if (directive === "user-agent") {
      if (inGroup && currentRules.length > 0) finishGroup();
      currentAgents.push(value.toLowerCase());
      inGroup = true;
    } else if (directive === "disallow" && inGroup) {
      currentRules.push({ type: "disallow", path: value });
    } else if (directive === "allow" && inGroup) {
      currentRules.push({ type: "allow", path: value });
    } else if (directive === "sitemap" && value) {
      sitemaps.push(value);
    }
  }
  finishGroup();

  return { groups, sitemaps };
}

export function robotsPathMatchLength(path: string, pattern: string): number | null {
  if (!pattern) return null;

  const hasEndAnchor = pattern.endsWith("$");
  const base = hasEndAnchor ? pattern.slice(0, -1) : pattern;

  if (!base.includes("*")) {
    if (!path.startsWith(base)) return null;
    if (hasEndAnchor && path !== base) return null;
    return base.length;
  }

  const segments = base.split("*");
  let pos = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i === 0) {
      if (!path.startsWith(seg)) return null;
      pos = seg.length;
    } else {
      if (seg === "") { pos = path.length; continue; }
      const idx = path.indexOf(seg, pos);
      if (idx === -1) return null;
      pos = idx + seg.length;
    }
  }
  if (hasEndAnchor && pos !== path.length) return null;
  return base.replace(/\*/g, "").length;
}

export function checkBotBlockedParsed(parsed: ParsedRobots, botToken: string, path = "/"): boolean {
  const botLower = botToken.toLowerCase();
  // Merge every group that names this agent; if none, fall back to all
  // wildcard groups. Google-style robots evaluation combines equivalent
  // user-agent groups before applying the longest-match rule.
  const exactGroups = parsed.groups.filter((g) => g.agents.includes(botLower));
  const groups = exactGroups.length > 0
    ? exactGroups
    : parsed.groups.filter((g) => g.agents.includes("*"));
  if (groups.length === 0) return false;
  const rules = groups.flatMap((g) => g.rules);

  let longestLen = -1;
  let longestType: "allow" | "disallow" = "allow";

  for (const rule of rules) {
    if (!rule.path) {
      if (rule.type === "disallow" && longestLen < 0) { longestLen = 0; longestType = "allow"; }
      continue;
    }
    const matchLen = robotsPathMatchLength(path, rule.path);
    if (matchLen !== null) {
      if (matchLen > longestLen) { longestLen = matchLen; longestType = rule.type; }
      else if (matchLen === longestLen && rule.type === "allow") longestType = "allow";
    }
  }

  return longestLen >= 0 && longestType === "disallow";
}

/* ────────────────────────────────────────────────────────
   URL utilities
   ──────────────────────────────────────────────────────── */

export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/\/.*$/, "");
  d = d.replace(/^www\./, "");
  return d;
}

export function normalizePageUrl(href: string, base: string): string | null {
  if (!href || typeof href !== "string") return null;
  const trimmed = href.trim();
  if (/^(mailto:|tel:|javascript:|data:|ftp:|#)/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}

export function isSameOrigin(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === domain;
  } catch { return false; }
}

export function shouldSkipUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    const params = parsed.searchParams;
    // Documents, assets, archives, feeds.
    if (/\.(pdf|jpe?g|png|gif|svg|webp|avif|ico|mp4|mp3|wav|zip|gz|rar|7z|doc|docx|xls|xlsx|ppt|pptx|css|js|mjs|json|xml|rss|atom|txt|woff2?|ttf|eot|map)(\?|$)/.test(path)) return true;
    if (/\/(feed|rss|atom)\/?$/.test(path)) return true;
    // WordPress/media attachment pages often look like real HTML but are not
    // useful prospecting pages; they polluted calibration scans as homepage
    // duplicates with thin metadata findings.
    if (params.has("attachment_id") || params.has("attachment") || params.has("p")) return true;
    if (/^\/?(attachment|media|image|photo|wp-content|uploads|category|tag|author)(\/|$)/.test(path)) return true;
    if ([...params].length > 2) return true;
    // Admin / auth / transactional / search, matched against path AND query.
    // Platform CMSs route these through query strings (field case jsmlaw.ca:
    // /?fuseaction=member.registerShort is a newsletter-signup form, correctly
    // noindexed, that consumed a crawl slot and fired a Critical finding).
    const target = path + parsed.search.toLowerCase();
    if (/[/=.](login|logout|admin|wp-admin|wp-login|wp-json|dashboard|account|cart|checkout|register|sign-?in|sign-?up|signup|subscribe|unsubscribe|newsletter|search|archive)/.test(target)) return true;
    if (/[?&]s=/.test(parsed.search)) return true;
    return false;
  } catch { return true; }
}

// WordPress ships two default content URLs on every fresh install: the
// "Hello world!" post (slug hello-world, often under a dated permalink) and
// the "Sample Page" (slug sample-page). Firms that never delete them leave
// boilerplate published and in the sitemap. Detection is CONTENT-gated, not
// slug-only: a firm can legitimately edit the Sample Page in place and keep
// the /sample-page/ slug, or genuinely write a post slugged hello-world, so a
// page only counts as default when its body still carries the WordPress
// starter fingerprint. This keeps the boilerplate out of the firm's quality
// findings (word count, thin-content, meta-description, alt-text) without
// mis-scoring a repurposed page, and surfaces its presence as one honest
// site-maturity finding. Field case: chaabanelaw.com (1 real homepage + the
// two untouched WordPress defaults, its entire published site).
const WP_STARTER_SLUG_RE = /(^|\/)(hello-world|sample-page)(\/|$)/;
const WP_STARTER_BODY_RE = /this is an example page|as a new wordpress user|welcome to wordpress\.?\s*this is your first post|edit or delete it,? then start writing/i;
// The WordPress default title survives even when a firm strips the boilerplate
// body but never writes real content (field case chaabanelaw.com: the
// hello-world post lost its default text yet still titles itself "Hello
// world!" with no real content). A genuinely repurposed page carries a real
// title, so requiring the default title (or the default body) keeps a firm
// that reused the slug for real content from being flagged. Any site-name
// suffix is separated by whitespace or a pipe (a " - Site" separator starts
// with a space, so plain whitespace already covers it).
const WP_STARTER_TITLE_RE = /^\s*(hello world!?|sample page)(\s|$|\|)/i;

export function isWpDefaultContent(url: string, html: string): boolean {
  let slug = false;
  try { slug = WP_STARTER_SLUG_RE.test(new URL(url).pathname.toLowerCase()); } catch { return false; }
  if (!slug) return false;
  if (WP_STARTER_BODY_RE.test(html)) return true;
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || "";
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "").replace(/<[^>]+>/g, "").trim();
  return WP_STARTER_TITLE_RE.test(title) || WP_STARTER_TITLE_RE.test(h1);
}

export function crawlUrlKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = (u.pathname || "/").replace(/\/$/, "") || "/";
    u.searchParams.sort();
    return `${host}${path}${u.search}`;
  } catch {
    return url;
  }
}

const PRACTICE_INTENT_PATH_RE =
  /(^|\/)(practices?|practice-areas?|services?|legal-services|areas-of-law|what-we-do|expertise|specialties)(\/|$|-)|(^|\/)(tax-law|real-estate-law|real-estate|wills-and-estates|wills|estates?|estate-litigation|family-law|divorce|immigration|litigation|civil-litigation|commercial-litigation|corporate|business-law|employment-law|labou?r-law|personal-injury|medical-malpractice|insurance|criminal-law|notary-services?|probate|construction-law|professional-regulation|professional-liability)(\/|$|-)/;

/**
 * Classify a URL into a law-firm page type for prioritisation and reporting.
 * Path-first; the homepage is identified by an empty/"/" path.
 */
export function classifyPageType(url: string): PageType {
  let p = "/";
  let q = "";
  try {
    const u = new URL(url);
    p = u.pathname.toLowerCase().replace(/\/+$/, "") || "/";
    q = u.search.toLowerCase();
  } catch { return "other"; }
  if (p === "/" || p === "") {
    if (!q) return "homepage";
    // A query string selects a different document, so this is NOT the
    // homepage. Platform CMSs route whole page trees through the root path
    // (field case jsmlaw.ca, ColdFusion: /?fuseaction=store.terms is the
    // store-policy page, /?fuseaction=member.registerShort the newsletter
    // signup). Classifying these as "homepage" gave utility cruft top crawl
    // priority (100), produced five "/" homepage rows in one report, and let
    // a deliberately noindexed signup form fire a Critical indexability
    // finding. Classify from query hints instead.
    if (/(terms|privacy|disclaimer|returns|shipping|cookie|legal)/.test(q)) return "policy";
    if (/contact/.test(q)) return "contact";
    return "other";
  }
  // Conversion/funnel pages: matter-intake forms and interactive
  // tools/calculators. Checked before the contact and practice-area regexes
  // because path segments like /tools/estate-structure-check otherwise
  // substring-match "estate" inside PRACTICE_INTENT_PATH_RE and misclassify a
  // checklist widget as a written practice page, which then gets held to
  // word-count/question-heading article rules it was never meant to carry
  // (field case drglaw.ca: /tools/estate-structure-check read as "practice").
  if (/(^|\/)intake(\/|$)/.test(p)) return "intake";
  if (/(^|\/)tools?(\/|$)/.test(p)) return "tool";
  if (/(^|\/)(contact|contact-us|get-in-touch|book|consultation|schedule)(\/|$|-)/.test(p)) return "contact";
  if (/(^|\/)(privacy|terms|disclaimer|accessibility|cookie|legal-notice|sitemap)(\/|$|-)/.test(p)) return "policy";
  if (PRACTICE_INTENT_PATH_RE.test(p)) return "practice";
  if (/(^|\/)(attorneys?|lawyers?|team|our-team|our-people|people|staff|professionals?|bio|profile|meet)(\/|$|-)/.test(p)) return "attorney";
  if (/(^|\/)(location|locations|office|offices|find-us|directions)(\/|$|-)/.test(p)) return "location";
  if (/(^|\/)(faq|faqs|frequently-asked|questions)(\/|$|-)/.test(p)) return "faq";
  if (/(^|\/)(about|about-us|who-we-are|our-firm|the-firm|firm|history)(\/|$|-)/.test(p)) return "about";
  if (/(^|\/)(blog|news|articles?|insights?|resources?|guides?|journal|library|posts?|updates?|knowledge)(\/|$|-)/.test(p)) return "blog";
  return "other";
}

const PAGE_TYPE_PRIORITY: Record<PageType, number> = {
  homepage: 100,
  contact: 90,
  intake: 82,
  practice: 85,
  attorney: 78,
  about: 74,
  location: 72,
  tool: 68,
  faq: 64,
  blog: 42,
  policy: 25,
  other: 50,
};

export function scoreUrlPriority(url: string): number {
  return PAGE_TYPE_PRIORITY[classifyPageType(url)] ?? 50;
}

/**
 * Decode the HTML entities that show up in real <title> / meta text so length
 * checks measure what a person sees and reports do not print raw entities.
 * Field case (marathonlaw.ca / Squarespace): "Contact &mdash; Marathon Law"
 * counted 7 characters for the dash and rendered the entity verbatim in the
 * report. Named subset + numeric forms; unknown entities pass through as-is.
 * (mdash is built via fromCharCode because the literal em-dash character is
 * blocked in this repo's source by the brand-voice hook.)
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: String.fromCharCode(0x2014), ndash: "–", hellip: "…",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  copy: "©", reg: "®", trade: "™",
  eacute: "é", egrave: "è", agrave: "à", ccedil: "ç",
  middot: "·", bull: "•", laquo: "«", raquo: "»",
};

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (whole, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    })
    .replace(/&#(\d+);/g, (whole, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    })
    .replace(/&([a-z]+);/gi, (whole, name) => NAMED_ENTITIES[name.toLowerCase()] ?? whole);
}

export function pageTypeLabel(t: PageType): string {
  switch (t) {
    case "homepage": return "Homepage";
    case "contact": return "Contact";
    case "about": return "About";
    case "attorney": return "Attorney / team";
    case "practice": return "Practice area";
    case "location": return "Location";
    case "faq": return "FAQ";
    case "blog": return "Blog / guide";
    case "policy": return "Policy / utility";
    case "intake": return "Intake / conversion";
    case "tool": return "Tool / calculator";
    default: return "Other";
  }
}

/* ────────────────────────────────────────────────────────
   Page-type applicability
   ──────────────────────────────────────────────────────── */

// AEO / authorship / depth checks intended for genuine content pages
// (practice write-ups, FAQ answers, blog/journal articles). Firing these as a
// requirement on a contact form, an intake funnel, a homepage, or an
// interactive tool manufactures a requirement nobody asked for: a conversion
// page's job is to convert, not to carry a 300-word definitional essay or a
// citation to a law-society resource. The checks still RUN everywhere (so a
// genuine gap on a practice page is still caught, and the evidence stays
// available for a manual look); applyPageTypeApplicability only stops a miss
// outside CONTENT_REQUIRED_PAGE_TYPES from being scored as a defect.
export const CONTENT_ONLY_LABELS = new Set<string>([
  "Question-format headings",
  "Direct-answer sentences",
  "Authoritative citations",
  "Author / reviewer signals",
  "Word count",
  "Practice-area intent",
]);

// A conversion funnel (a form) or an interactive tool (a checklist widget)
// is not an unstructured article either, but the article-depth structural
// checks above are already covered by CONTENT_ONLY_LABELS. What is left is
// the more basic "break your content into sections" expectation, which does
// not fit a one-screen form or a question-by-question checklist. Narrower
// than CONTENT_ONLY_LABELS on purpose: contact/about/attorney pages still
// read as prose and keep the normal H2 expectation.
const FUNNEL_PAGE_TYPES: PageType[] = ["intake", "tool"];
const FUNNEL_EXEMPT_LABELS = new Set<string>(["H2 subheadings"]);

const LANGUAGE_ROOT_RE = /^\/[a-z]{2}(-[a-z]{2,4})?\/?$/i;

/** True for the homepage and a bare language-root path (e.g. "/pt", "/fr-ca"). */
export function isHomepageOrLanguageRoot(pageType: PageType, url: string): boolean {
  if (pageType === "homepage") return true;
  try {
    return LANGUAGE_ROOT_RE.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * Downgrade checks that do not apply to this page's type from a requirement
 * (warn/fail) to an explicit not-applicable pass. Breadcrumb schema is
 * handled the same way for the homepage / a language root: there is nothing
 * above it in the site hierarchy for a BreadcrumbList to describe.
 */
export function applyPageTypeApplicability(
  categories: CategoryResult[],
  pageType: PageType,
  url: string
): CategoryResult[] {
  const contentPage = CONTENT_REQUIRED_PAGE_TYPES.includes(pageType);
  const breadcrumbExempt = isHomepageOrLanguageRoot(pageType, url);
  const funnelPage = FUNNEL_PAGE_TYPES.includes(pageType);
  if (contentPage && !breadcrumbExempt && !funnelPage) return categories;

  return categories.map((cat) => {
    let changed = false;
    const items = cat.items.map((item) => {
      const exemptForType = !contentPage && CONTENT_ONLY_LABELS.has(item.label);
      const exemptFunnel = funnelPage && FUNNEL_EXEMPT_LABELS.has(item.label);
      const exemptBreadcrumb = item.label === "Breadcrumb schema" && breadcrumbExempt;
      if ((exemptForType || exemptFunnel || exemptBreadcrumb) && item.status !== "pass") {
        changed = true;
        return {
          label: item.label,
          status: "pass" as const,
          detail: exemptBreadcrumb
            ? `Not required on the homepage or a language root. ${item.detail}`
            : `Not required for a ${pageTypeLabel(pageType).toLowerCase()} page. ${item.detail}`,
        };
      }
      return item;
    });
    if (!changed) return cat;
    const { score, maxScore } = scoreItems(items);
    return { ...cat, items, score, maxScore };
  });
}

/* ────────────────────────────────────────────────────────
   Scoring helpers
   ──────────────────────────────────────────────────────── */

export function scoreItems(items: CheckItem[]): { score: number; maxScore: number } {
  let score = 0;
  let maxScore = 0;
  for (const item of items) {
    if (item.scored === false) continue;
    maxScore += 10;
    if (item.status === "pass") score += 10;
    else if (item.status === "warn") score += 5;
  }
  return { score, maxScore };
}

export function computeGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "A-";
  if (score >= 70) return "B+";
  if (score >= 60) return "B";
  if (score >= 50) return "C+";
  if (score >= 40) return "C";
  if (score >= 30) return "D";
  return "F";
}

/**
 * Weighted site / page score. A category with a critical-class failure is
 * capped so a wall of low-value passes cannot inflate the headline number:
 * a category that is below 35% pulls its own contribution down further via a
 * soft penalty, so failing categories visibly depress the overall score.
 */
export function computeWeightedScore(categories: CategoryResult[]): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const cat of categories) {
    // A category with no scored items (every item unscored, or an empty
    // category) contributes nothing rather than reading as 0% failing: its
    // absence must never drag the overall score down.
    if (cat.maxScore <= 0) continue;
    const weight = CATEGORY_WEIGHTS[cat.name] ?? 6;
    let pct = (cat.score / cat.maxScore) * 100;
    // Soft floor penalty: badly failing categories are pulled down so the
    // headline score is not propped up by many trivial passes elsewhere.
    if (pct < 35) pct = pct * 0.8;
    weightedSum += pct * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
}

/**
 * Split an AI Visibility category's items into the two independent scores:
 * search visibility (every item except training-bot control) and content
 * policy (the training-bot control item alone).
 */
export function aiScoresFromItems(items: CheckItem[]): { search: number; policy: number } {
  const searchItems = items.filter((i) => i.label !== "AI training bot control" && i.scored !== false);
  const search = searchItems.length > 0
    ? Math.round(
        (searchItems.reduce((sum, i) => sum + (i.status === "pass" ? 10 : i.status === "warn" ? 5 : 0), 0) /
          (searchItems.length * 10)) * 100
      )
    : 0;
  const policyItem = items.find((i) => i.label === "AI training bot control");
  const policy = policyItem
    ? policyItem.status === "pass" ? 100 : policyItem.status === "warn" ? 50 : 10
    : 50;
  return { search, policy };
}
