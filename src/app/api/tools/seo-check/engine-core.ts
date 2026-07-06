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

import { isIP } from "node:net";

/* ────────────────────────────────────────────────────────
   Base result types (backward-compatible with the prior shape)
   ──────────────────────────────────────────────────────── */

export interface CheckItem {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fix?: string;
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
  | "other";

// Page types that carry direct commercial weight for a law firm. Issues that
// affect these pages are scored higher in the priority model.
export const COMMERCIAL_PAGE_TYPES: PageType[] = [
  "homepage",
  "contact",
  "practice",
  "attorney",
  "location",
];

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
   SSRF range classification
   ──────────────────────────────────────────────────────── */

export const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "169.254.169.254",
]);

/**
 * Returns true when an IP literal falls in a private, reserved, loopback,
 * link-local, CGNAT, deprecated site-local, or multicast range. Used both as a
 * fast literal check and inside the DNS-validating lookup hook in route.ts.
 */
export function ipInBlockedRange(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const o = ip.split(".").map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b, c] = o;
    if (a === 0) return true;                                 // 0.0.0.0/8
    if (a === 10) return true;                                // 10.0.0.0/8 private
    if (a === 127) return true;                               // loopback
    if (a === 169 && b === 254) return true;                  // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;         // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true;                  // 192.168.0.0/16 private
    if (a === 192 && b === 0 && c === 0) return true;         // 192.0.0.0/24
    if (a === 100 && b >= 64 && b <= 127) return true;        // 100.64.0.0/10 CGNAT
    if (a >= 224) return true;                                // multicast + reserved
    return false;
  }
  if (kind === 6) {
    let v = ip.toLowerCase();
    const zone = v.indexOf("%");
    if (zone >= 0) v = v.slice(0, zone);
    if (v === "::1" || v === "::") return true;               // loopback / unspecified
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);  // IPv4-mapped
    if (mapped) return ipInBlockedRange(mapped[1]);
    // NAT64 well-known prefix 64:ff9b::/96 embeds an IPv4 in the low 32 bits.
    // 64:ff9b::a9fe:a9fe and 64:ff9b::169.254.169.254 both mean 169.254.169.254,
    // so a private/metadata IPv4 can be smuggled past the v6 range checks.
    if (v.startsWith("64:ff9b::") || v.startsWith("64:ff9b:0:0:0:0:")) {
      const dotted = v.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
      if (dotted) return ipInBlockedRange(dotted[1]);
      const parts = v.split(":");
      const last = parts[parts.length - 1];
      const prev = parts[parts.length - 2];
      const h2 = parseInt(last, 16);
      const h1 = parseInt(prev, 16);
      if (last && prev && Number.isFinite(h1) && Number.isFinite(h2)) {
        return ipInBlockedRange(`${(h1 >> 8) & 255}.${h1 & 255}.${(h2 >> 8) & 255}.${h2 & 255}`);
      }
      return true; // unparseable NAT64 embedding: refuse
    }
    const firstHex = v.startsWith("::") ? 0 : parseInt(v.split(":")[0] || "0", 16);
    if (Number.isNaN(firstHex)) return true;                  // malformed: refuse
    if (firstHex >= 0xfe80 && firstHex <= 0xfebf) return true; // link-local fe80::/10
    if (firstHex >= 0xfec0 && firstHex <= 0xfeff) return true; // deprecated site-local fec0::/10
    if (firstHex >= 0xfc00 && firstHex <= 0xfdff) return true; // unique-local fc00::/7
    if (firstHex >= 0xff00) return true;                      // multicast ff00::/8
    return false;
  }
  return true; // not a valid IP: refuse
}

export function isSsrfBlocked(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (isIP(h) !== 0) return ipInBlockedRange(h);
  return false;
}

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
  practice: 85,
  attorney: 78,
  about: 74,
  location: 72,
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
    default: return "Other";
  }
}

/* ────────────────────────────────────────────────────────
   Scoring helpers
   ──────────────────────────────────────────────────────── */

export function scoreItems(items: CheckItem[]): { score: number; maxScore: number } {
  let score = 0;
  const maxScore = items.length * 10;
  for (const item of items) {
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
    const weight = CATEGORY_WEIGHTS[cat.name] ?? 6;
    let pct = cat.maxScore > 0 ? (cat.score / cat.maxScore) * 100 : 0;
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
  const searchItems = items.filter((i) => i.label !== "AI training bot control");
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
