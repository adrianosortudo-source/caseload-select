import { NextRequest, NextResponse } from "next/server";
import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { Agent } from "undici";

export const runtime = "nodejs";

/* ────────────────────────────────────────────────────────
   Interfaces
   ──────────────────────────────────────────────────────── */

interface CheckItem {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fix?: string;
}

interface CategoryResult {
  name: string;
  score: number;
  maxScore: number;
  items: CheckItem[];
}

interface AiBotStatus {
  name: string;
  blocked: boolean;
  category: "search" | "training";
}

interface RobotsRule {
  type: "allow" | "disallow";
  path: string;
}

interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
}

interface PageResult {
  url: string;
  title: string | null;
  pageScore: number;
  pageGrade: string;
  aiVisibilityScore: number;
  categories: CategoryResult[];
  failCount: number;
  warnCount: number;
}

interface TopFix {
  label: string;
  category: string;
  status: "warn" | "fail";
  fix?: string;
  pagesAffected: number;
  totalPages: number;
}

interface SeoCheckResult {
  domain: string;
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
  topFixes: TopFix[];
  checkedAt: string;
}

/* ────────────────────────────────────────────────────────
   Constants
   ──────────────────────────────────────────────────────── */

const AI_SEARCH_BOTS = [
  { token: "ChatGPT-User", label: "ChatGPT Search" },
  { token: "OAI-SearchBot", label: "OpenAI SearchBot" },
  { token: "PerplexityBot", label: "Perplexity" },
  { token: "Perplexity-User", label: "Perplexity User" },
  { token: "ClaudeBot", label: "Claude" },
  { token: "Claude-SearchBot", label: "Claude Search" },
];

const AI_TRAINING_BOTS = [
  { token: "GPTBot", label: "GPTBot (training)" },
  { token: "CCBot", label: "Common Crawl" },
  { token: "Bytespider", label: "Bytespider" },
  { token: "Meta-ExternalAgent", label: "Meta" },
  { token: "Applebot-Extended", label: "Applebot" },
  { token: "Google-Extended", label: "Google-Extended (AI use)" },
];

const GENERIC_ANCHORS = new Set([
  "click here", "here", "read more", "learn more", "more", "link",
  "this", "go", "see more", "continue", "details", "info",
]);

const CATEGORY_WEIGHTS: Record<string, number> = {
  "On-Page SEO": 25,
  "Schema & Structured Data": 10,
  "AI Visibility": 15,
  "Local SEO": 10,
  "Technical & Security": 20,
  "Performance": 10,
  "Links & Content": 10,
};

/* ────────────────────────────────────────────────────────
   SSRF Guards
   ──────────────────────────────────────────────────────── */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "169.254.169.254",
]);

// Returns true when an IP literal falls in a private, reserved, loopback,
// link-local, CGNAT, or multicast range. Used both as a fast literal check
// and inside the DNS-validating lookup hook below.
function ipInBlockedRange(ip: string): boolean {
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
    if (a >= 224) return true;                                // multicast + reserved (224.0.0.0+)
    return false;
  }
  if (kind === 6) {
    let v = ip.toLowerCase();
    const zone = v.indexOf("%");
    if (zone >= 0) v = v.slice(0, zone);
    if (v === "::1" || v === "::") return true;               // loopback / unspecified
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);  // IPv4-mapped
    if (mapped) return ipInBlockedRange(mapped[1]);
    // First hextet drives the reserved-range checks. Leading "::" means the
    // high bits are zero, so the first group is 0.
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

function isSsrfBlocked(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  // IP literals are validated directly against the range table.
  if (isIP(h) !== 0) return ipInBlockedRange(h);
  return false;
}

// Node net/tls lookup hook (undici forwards connect.lookup straight to the
// socket). Resolving here means validation and the actual connection share
// one DNS result: a hostname that resolves to any blocked IP is refused, and
// the connection is pinned to the validated address, closing the rebinding gap.
//
// The hook must honour the caller's expected callback shape: undici/Node call
// it either in scalar mode, callback(err, address, family), or in all mode,
// callback(err, [{ address, family }]). Returning the wrong shape breaks the
// connection. We always resolve every address (to validate the full set) and
// then answer in whichever shape was requested.
interface DnsAddr { address: string; family: number }
type LookupOptions = { all?: boolean };
type LookupCb = (
  err: NodeJS.ErrnoException | null,
  address: string | DnsAddr[],
  family?: number
) => void;
function validatingLookup(
  hostname: string,
  options: LookupOptions,
  callback: LookupCb
): void {
  const wantsAll = !!(options && options.all);
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) { callback(err, wantsAll ? [] : "", 0); return; }
    const list: DnsAddr[] = Array.isArray(addresses) ? addresses : [];
    if (list.length === 0) { callback(new Error("ssrf_no_address"), wantsAll ? [] : "", 0); return; }
    for (const a of list) {
      if (ipInBlockedRange(a.address)) {
        callback(Object.assign(new Error("ssrf_blocked_ip"), { code: "ESSRFBLOCKED" }), wantsAll ? [] : "", 0);
        return;
      }
    }
    if (wantsAll) callback(null, list);
    else callback(null, list[0].address, list[0].family);
  });
}

const ssrfAgent = new Agent({
  connect: { lookup: validatingLookup, timeout: 8000 },
  headersTimeout: 15000,
  bodyTimeout: 15000,
});

const UA =
  "Mozilla/5.0 (compatible; CaseLoadSelect-SEOCheck/1.0; +https://caseloadselect.ca)";
const SCANNER_TOKEN = "CaseLoadSelect-SEOCheck";
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_RESOURCE_BYTES = 2 * 1024 * 1024;

interface SafeFetchResult {
  res: Response;
  finalUrl: string;
  cleanup: () => void;
}

async function safeFetch(startUrl: string, timeoutMs: number): Promise<SafeFetchResult> {
  let currentUrl = startUrl;
  for (let hop = 0; hop <= 5; hop++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("unsupported_protocol");
    }
    if (isSsrfBlocked(parsed.hostname)) throw new Error("ssrf_blocked");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        signal: controller.signal,
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,text/plain,*/*" },
        redirect: "manual",
        dispatcher: ssrfAgent,
      } as RequestInit & { dispatcher: Agent });
    } catch (e) {
      clearTimeout(timer);
      const code = (e as { cause?: { code?: string } })?.cause?.code;
      if (code === "ESSRFBLOCKED") throw new Error("ssrf_blocked");
      throw e;
    }

    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer);
      if (hop === 5) throw new Error("too_many_redirects");
      const location = res.headers.get("location");
      if (!location) throw new Error("redirect_without_location");
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }
    // Final response: keep the abort timer live so it also bounds body reads.
    return { res, finalUrl: currentUrl, cleanup: () => clearTimeout(timer) };
  }
  throw new Error("too_many_redirects");
}

// Reads a response body with a hard byte cap, aborting the stream once the cap
// is exceeded. The deadline timer from safeFetch stays armed across this read,
// so a stalled body read surfaces as "read_failed" (an abort), kept distinct
// from "too_large" so callers can report the right reason.
type CappedRead =
  | { ok: true; text: string }
  | { ok: false; reason: "too_large" | "read_failed" };

async function readCappedText(res: Response, maxBytes: number): Promise<CappedRead> {
  if (!res.body) {
    try {
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.byteLength <= maxBytes
        ? { ok: true, text: buf.toString("utf8") }
        : { ok: false, reason: "too_large" };
    } catch { return { ok: false, reason: "read_failed" }; }
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) { await reader.cancel(); return { ok: false, reason: "too_large" }; }
        chunks.push(Buffer.from(value));
      }
    }
  } catch { return { ok: false, reason: "read_failed" }; }
  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

async function safeResource(url: string, timeoutMs: number): Promise<string | null> {
  let handle: SafeFetchResult | null = null;
  try {
    const parsed = new URL(url);
    if (isSsrfBlocked(parsed.hostname)) return null;
    handle = await safeFetch(url, timeoutMs);
    if (!handle.res.ok) return null;
    const read = await readCappedText(handle.res, MAX_RESOURCE_BYTES);
    return read.ok ? read.text : null;
  } catch {
    return null;
  } finally {
    handle?.cleanup();
  }
}

/* ────────────────────────────────────────────────────────
   robots.txt Parser (RFC-compliant group semantics)
   ──────────────────────────────────────────────────────── */

function parseRobotsTxt(text: string): ParsedRobots {
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

function robotsPathMatchLength(path: string, pattern: string): number | null {
  if (!pattern) return null;

  const hasEndAnchor = pattern.endsWith("$");
  const base = hasEndAnchor ? pattern.slice(0, -1) : pattern;

  if (!base.includes("*")) {
    if (!path.startsWith(base)) return null;
    if (hasEndAnchor && path !== base) return null;
    return base.length;
  }

  // Wildcard: convert to simple segment matching
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

function checkBotBlockedParsed(parsed: ParsedRobots, botToken: string, path = "/"): boolean {
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
   URL Utilities
   ──────────────────────────────────────────────────────── */

function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/\/.*$/, "");
  d = d.replace(/^www\./, "");
  return d;
}

function normalizePageUrl(href: string, base: string): string | null {
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

function isSameOrigin(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === domain;
  } catch { return false; }
}

function shouldSkipUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (/\.(pdf|jpg|jpeg|png|gif|svg|webp|ico|mp4|mp3|zip|doc|docx|xls|xlsx|css|js|xml|json|txt|woff|woff2|ttf|eot)(\?|$)/.test(path)) return true;
    if ([...parsed.searchParams].length > 2) return true;
    if (/\/(login|logout|admin|wp-admin|wp-login|dashboard|account|cart|checkout|register|sign-?in|sign-?up)/.test(path)) return true;
    return false;
  } catch { return true; }
}

function scoreUrlPriority(url: string): number {
  try {
    const p = new URL(url).pathname.toLowerCase();
    if (p === "/" || p === "") return 100;
    if (/\/(contact|contact-us)/.test(p)) return 90;
    if (/\/(about|about-us|who-we-are)/.test(p)) return 85;
    if (/\/(practice|practice-areas?|services?|legal-services|areas-of-law|what-we-do)/.test(p)) return 80;
    if (/\/(team|attorneys?|lawyers?|our-team|staff|people)/.test(p)) return 75;
    if (/\/(location|locations|office|offices)/.test(p)) return 70;
    if (/\/(faq|faqs|frequently-asked)/.test(p)) return 65;
    if (/\/(blog|news|resources?|articles?|guides?|insights?)/.test(p)) return 40;
    return 50;
  } catch { return 0; }
}

function extractInternalLinks(html: string, baseUrl: string, domain: string): string[] {
  const seen = new Set<string>();
  const anchors = html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi);
  for (const [, href] of anchors) {
    const normalized = normalizePageUrl(href, baseUrl);
    if (normalized && isSameOrigin(normalized, domain) && !shouldSkipUrl(normalized)) {
      seen.add(normalized);
    }
  }
  return [...seen];
}

function selectAdditionalPages(urls: string[], limit: number): string[] {
  return [...new Set(urls)]
    .filter((u) => !shouldSkipUrl(u))
    .map((u) => ({ url: u, score: scoreUrlPriority(u) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ url }) => url);
}

async function fetchSitemapUrls(sitemapUrl: string, domain: string): Promise<string[]> {
  try {
    const parsed = new URL(sitemapUrl);
    if (isSsrfBlocked(parsed.hostname)) return [];
    const raw = await safeResource(sitemapUrl, 6000);
    if (!raw) return [];
    const urls: string[] = [];
    const locPattern = /<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi;
    for (const [, url] of raw.matchAll(locPattern)) {
      const trimmed = url.trim();
      if (/\.(xml|gz)(\?.*)?$/.test(trimmed)) continue;
      if (isSameOrigin(trimmed, domain)) {
        try { const u = new URL(trimmed); u.hash = ""; urls.push(u.href); } catch { /* skip */ }
      }
      if (urls.length >= 100) break;
    }
    return urls;
  } catch { return []; }
}

/* ────────────────────────────────────────────────────────
   HTML Utilities
   ──────────────────────────────────────────────────────── */

function extractMetaContent(html: string, nameOrProperty: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${nameOrProperty}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${nameOrProperty}["']`, "i"),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractAllTags(html: string, tagName: string): string[] {
  const re = new RegExp(`<${tagName}[^>]*>(.*?)</${tagName}>`, "gis");
  const results: string[] = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, "").trim();
    if (text) results.push(text);
  }
  return results;
}

function extractBodyText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function scoreItems(items: CheckItem[]): { score: number; maxScore: number } {
  let score = 0;
  const maxScore = items.length * 10;
  for (const item of items) {
    if (item.status === "pass") score += 10;
    else if (item.status === "warn") score += 5;
  }
  return { score, maxScore };
}

/* ────────────────────────────────────────────────────────
   1. On-Page SEO (8 checks)
   ──────────────────────────────────────────────────────── */

function checkOnPageSeo(html: string): CategoryResult {
  const items: CheckItem[] = [];

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  if (!title) {
    items.push({ label: "Page title", status: "fail", detail: "Missing. Every page needs a unique <title> tag.", fix: "Add a <title> tag inside your <head>. Aim for 50-60 characters with your main keyword near the front." });
  } else if (title.length < 30) {
    items.push({ label: "Page title", status: "warn", detail: `Too short (${title.length} chars). Aim for 50-60 characters.`, fix: "Expand the title to include your main keyword and a brief value proposition." });
  } else if (title.length > 65) {
    items.push({ label: "Page title", status: "warn", detail: `Too long (${title.length} chars). Google truncates after ~60 characters.`, fix: "Trim to under 60 characters. Put the most important keyword first." });
  } else {
    items.push({ label: "Page title", status: "pass", detail: `Good length (${title.length} chars).` });
  }

  const desc = extractMetaContent(html, "description");
  if (!desc) {
    items.push({ label: "Meta description", status: "fail", detail: "Missing. This is the snippet Google shows in search results.", fix: "Add <meta name=\"description\" content=\"...\"> in your <head>. Write 120-160 characters describing what this page offers." });
  } else if (desc.length < 70) {
    items.push({ label: "Meta description", status: "warn", detail: `Short (${desc.length} chars). Aim for 120-160 characters.`, fix: "Expand to 120-160 characters. Lead with your most compelling value proposition." });
  } else if (desc.length > 170) {
    items.push({ label: "Meta description", status: "warn", detail: `Long (${desc.length} chars). May be truncated in search results.`, fix: "Trim to under 160 characters so the full description shows in search results." });
  } else {
    items.push({ label: "Meta description", status: "pass", detail: `Good length (${desc.length} chars).` });
  }

  const h1s = extractAllTags(html, "h1");
  if (h1s.length === 0) {
    items.push({ label: "H1 heading", status: "fail", detail: "No H1 found. The main heading signals your page topic to search engines.", fix: "Add a single <h1> tag as your main page heading. It should clearly state the page's primary topic." });
  } else if (h1s.length > 1) {
    items.push({ label: "H1 heading", status: "warn", detail: `${h1s.length} H1 tags found. Best practice is one per page.`, fix: "Keep one H1 for the main heading. Convert others to H2 or H3." });
  } else {
    items.push({ label: "H1 heading", status: "pass", detail: "Single H1 present." });
  }

  const h2s = extractAllTags(html, "h2");
  if (h2s.length === 0) {
    items.push({ label: "H2 subheadings", status: "warn", detail: "No H2 tags. Subheadings help structure content for readers and crawlers.", fix: "Add H2 tags to break your content into scannable sections." });
  } else {
    items.push({ label: "H2 subheadings", status: "pass", detail: `${h2s.length} H2 tag${h2s.length > 1 ? "s" : ""} found.` });
  }

  const hasCanonical = /<link[^>]+rel=["']canonical["']/i.test(html);
  if (!hasCanonical) {
    items.push({ label: "Canonical tag", status: "warn", detail: "Missing. Prevents duplicate content issues across URL variations.", fix: "Add <link rel=\"canonical\" href=\"...\"> in your <head> pointing to the preferred URL for this page." });
  } else {
    items.push({ label: "Canonical tag", status: "pass", detail: "Present." });
  }

  const ogTitle = extractMetaContent(html, "og:title");
  const ogDesc = extractMetaContent(html, "og:description");
  const ogImage = extractMetaContent(html, "og:image");
  const ogCount = [ogTitle, ogDesc, ogImage].filter(Boolean).length;
  if (ogCount === 0) {
    items.push({ label: "Open Graph tags", status: "fail", detail: "None found. These control how your site appears when shared on social media.", fix: "Add og:title, og:description, and og:image meta tags in your <head>." });
  } else if (ogCount < 3) {
    const missing = [!ogTitle && "og:title", !ogDesc && "og:description", !ogImage && "og:image"].filter(Boolean).join(", ");
    items.push({ label: "Open Graph tags", status: "warn", detail: `Partial (${ogCount}/3). Missing: ${missing}.`, fix: `Add the missing tags: ${missing}.` });
  } else {
    items.push({ label: "Open Graph tags", status: "pass", detail: "Title, description, and image all present." });
  }

  const imgTags = html.match(/<img[^>]*>/gi) || [];
  const imgsWithoutAlt = imgTags.filter((tag) => !/alt=["'][^"']+["']/i.test(tag));
  if (imgTags.length === 0) {
    items.push({ label: "Image alt text", status: "pass", detail: "No images found to check." });
  } else if (imgsWithoutAlt.length === 0) {
    items.push({ label: "Image alt text", status: "pass", detail: `All ${imgTags.length} images have alt text.` });
  } else {
    const pct = Math.round((imgsWithoutAlt.length / imgTags.length) * 100);
    items.push({ label: "Image alt text", status: pct > 50 ? "fail" : "warn", detail: `${imgsWithoutAlt.length} of ${imgTags.length} images (${pct}%) missing alt text.`, fix: "Add descriptive alt attributes to every <img> tag. Describe what the image shows." });
  }

  const langAttr = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  if (langAttr) {
    items.push({ label: "HTML lang attribute", status: "pass", detail: `Set to "${langAttr[1]}". Helps search engines serve the right audience.` });
  } else {
    items.push({ label: "HTML lang attribute", status: "warn", detail: "Missing. Tells browsers and search engines the page's primary language.", fix: "Add lang=\"en\" (or your language code) to the <html> tag." });
  }

  const { score, maxScore } = scoreItems(items);
  return { name: "On-Page SEO", score, maxScore, items };
}

/* ────────────────────────────────────────────────────────
   2. Schema & Structured Data (6 checks)
   ──────────────────────────────────────────────────────── */

function checkSchemaMarkup(html: string): CategoryResult {
  const items: CheckItem[] = [];
  const scriptTags = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const allSchemaText = scriptTags.join(" ").toLowerCase();

  if (scriptTags.length === 0) {
    items.push({ label: "JSON-LD structured data", status: "fail", detail: "No JSON-LD blocks found. Structured data is the foundation of rich results.", fix: "Add at least one <script type=\"application/ld+json\"> block with your business information." });
  } else {
    items.push({ label: "JSON-LD structured data", status: "pass", detail: `${scriptTags.length} JSON-LD block${scriptTags.length > 1 ? "s" : ""} found.` });
  }

  const hasLocalBusiness = allSchemaText.includes('"localbusiness"') || allSchemaText.includes('"attorney"') || allSchemaText.includes('"legalservice"') || allSchemaText.includes('"lawfirm"');
  if (hasLocalBusiness) {
    items.push({ label: "LocalBusiness / Attorney schema", status: "pass", detail: "Business entity structured data found." });
  } else {
    items.push({ label: "LocalBusiness / Attorney schema", status: "fail", detail: "Not found. This tells Google your firm is a real business with a physical location.", fix: "Add a LocalBusiness or Attorney JSON-LD block with name, address, phone, and opening hours." });
  }

  const hasFaq = allSchemaText.includes('"faqpage"');
  if (hasFaq) {
    items.push({ label: "FAQPage schema", status: "pass", detail: "Present. Eligible for FAQ rich results in Google." });
  } else {
    items.push({ label: "FAQPage schema", status: "warn", detail: "Not found. FAQ schema can earn rich snippets and feeds AI answer engines.", fix: "Add FAQPage structured data wrapping your most common client questions and answers." });
  }

  const hasReview = allSchemaText.includes('"review"') || allSchemaText.includes('"aggregaterating"');
  if (hasReview) {
    items.push({ label: "Review / Rating schema", status: "pass", detail: "Review markup found. Eligible for star ratings in search results." });
  } else {
    items.push({ label: "Review / Rating schema", status: "warn", detail: "Not found. Review schema can display star ratings in search results.", fix: "Add AggregateRating or individual Review schema for your client testimonials." });
  }

  const hasBreadcrumb = allSchemaText.includes('"breadcrumblist"');
  if (hasBreadcrumb) {
    items.push({ label: "Breadcrumb schema", status: "pass", detail: "Present. Helps Google understand site hierarchy." });
  } else {
    items.push({ label: "Breadcrumb schema", status: "warn", detail: "Not found. Breadcrumb markup improves site hierarchy signals.", fix: "Add BreadcrumbList JSON-LD showing the page's position in your site structure." });
  }

  let validCount = 0;
  let invalidCount = 0;
  for (const tag of scriptTags) {
    const jsonStr = tag.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "").trim();
    try { JSON.parse(jsonStr); validCount++; } catch { invalidCount++; }
  }
  if (scriptTags.length === 0) {
    items.push({ label: "JSON-LD validity", status: "fail", detail: "No blocks to validate.", fix: "Add valid JSON-LD structured data to your page." });
  } else if (invalidCount > 0) {
    items.push({ label: "JSON-LD validity", status: "fail", detail: `${invalidCount} of ${scriptTags.length} blocks have JSON parse errors.`, fix: "Fix the malformed JSON in your structured data blocks. Use Google's Rich Results Test to validate." });
  } else {
    items.push({ label: "JSON-LD validity", status: "pass", detail: `All ${validCount} block${validCount > 1 ? "s" : ""} parse correctly.` });
  }

  const { score, maxScore } = scoreItems(items);
  return { name: "Schema & Structured Data", score, maxScore, items };
}

/* ────────────────────────────────────────────────────────
   3. AI Visibility (10 checks)
   ──────────────────────────────────────────────────────── */

function checkAiVisibility(
  html: string,
  parsedRobots: ParsedRobots | null,
  llmsTxt: string | null
): CategoryResult {
  const items: CheckItem[] = [];
  const bodyText = extractBodyText(html);

  if (!parsedRobots) {
    items.push({ label: "AI search bot access", status: "warn", detail: "No robots.txt found. AI crawlers can access your site, but you have no explicit policy.", fix: "Create a robots.txt file that explicitly allows AI search crawlers (ChatGPT-User, PerplexityBot, ClaudeBot)." });
  } else {
    const blockedSearch = AI_SEARCH_BOTS.filter((b) => checkBotBlockedParsed(parsedRobots, b.token));
    if (blockedSearch.length === 0) {
      items.push({ label: "AI search bot access", status: "pass", detail: "All major AI search crawlers can access your site." });
    } else if (blockedSearch.length <= 2) {
      items.push({ label: "AI search bot access", status: "warn", detail: `${blockedSearch.length} AI search crawler${blockedSearch.length > 1 ? "s" : ""} blocked: ${blockedSearch.map((b) => b.label).join(", ")}.`, fix: "Unblock AI search crawlers in robots.txt. These are the bots that cite your content in AI search results." });
    } else {
      items.push({ label: "AI search bot access", status: "fail", detail: `${blockedSearch.length} of ${AI_SEARCH_BOTS.length} AI search crawlers blocked. Your content won't appear in AI search results.`, fix: "Remove Disallow rules for AI search bots (ChatGPT-User, PerplexityBot, ClaudeBot) in robots.txt." });
    }
  }

  if (!parsedRobots) {
    items.push({ label: "AI training bot control", status: "warn", detail: "No robots.txt. You have no control over AI training crawlers using your content.", fix: "Add a robots.txt with Disallow rules for training-only bots (GPTBot, CCBot) to protect your content from unauthorized training." });
  } else {
    const blockedTraining = AI_TRAINING_BOTS.filter((b) => checkBotBlockedParsed(parsedRobots, b.token));
    if (blockedTraining.length >= 3) {
      items.push({ label: "AI training bot control", status: "pass", detail: `${blockedTraining.length} training-only crawlers blocked. Good practice to protect your content.` });
    } else if (blockedTraining.length > 0) {
      items.push({ label: "AI training bot control", status: "warn", detail: `Only ${blockedTraining.length} of ${AI_TRAINING_BOTS.length} training crawlers blocked.`, fix: "Block additional training-only bots (GPTBot, CCBot, Bytespider) in robots.txt to protect content from unauthorized training use." });
    } else {
      items.push({ label: "AI training bot control", status: "warn", detail: "No training-only crawlers blocked. Your content may be used to train AI models.", fix: "Add Disallow rules for GPTBot, CCBot, and Bytespider in robots.txt if you want to protect content from AI training." });
    }
  }

  if (llmsTxt && llmsTxt.length > 50) {
    items.push({ label: "llms.txt file", status: "pass", detail: "Present. Provides AI-friendly content guidance to language models." });
  } else {
    items.push({ label: "llms.txt file", status: "warn", detail: "Not found. An emerging standard that helps AI models understand your site structure.", fix: "Create a /llms.txt file with a Markdown summary of your site, key URLs, and content hierarchy." });
  }

  const h2s = extractAllTags(html, "h2");
  const h3s = extractAllTags(html, "h3");
  const questionHeadings = [...h2s, ...h3s].filter(
    (h) => h.endsWith("?") || /^(what|how|when|where|why|who|can|do|does|is|are|should|will)\b/i.test(h)
  );
  if (questionHeadings.length >= 3) {
    items.push({ label: "Question-format headings", status: "pass", detail: `${questionHeadings.length} question headings found. These match how people ask AI assistants.` });
  } else if (questionHeadings.length > 0) {
    items.push({ label: "Question-format headings", status: "warn", detail: `Only ${questionHeadings.length} question heading${questionHeadings.length > 1 ? "s" : ""}. More improves AI citation likelihood.`, fix: "Reframe section headings as questions people actually ask, like \"What happens if...\" or \"How long does...\"" });
  } else {
    items.push({ label: "Question-format headings", status: "fail", detail: "No question-format headings. AI models look for Q&A patterns to extract answers.", fix: "Add H2 or H3 headings phrased as questions. These directly match queries people type into AI search." });
  }

  const sentences = bodyText.split(/[.!?]+/).filter((s) => s.trim().length > 20);
  const directAnswers = sentences.filter((s) => /\b(is|are|means|refers to|defined as|consists of|requires|involves)\b/i.test(s));
  if (directAnswers.length >= 5) {
    items.push({ label: "Direct-answer sentences", status: "pass", detail: "Content includes clear definitional sentences that AI models can extract as answers." });
  } else if (directAnswers.length > 0) {
    items.push({ label: "Direct-answer sentences", status: "warn", detail: "Some direct-answer content found. Adding more clear definitions improves AI citability.", fix: "Write more sentences that directly answer questions: \"X is...\", \"X means...\", \"X requires...\"" });
  } else {
    items.push({ label: "Direct-answer sentences", status: "fail", detail: "No direct-answer patterns detected. AI models prefer content that directly answers questions.", fix: "Include explicit definitional sentences. Example: \"A power of attorney is a legal document that...\"" });
  }

  const scriptTags = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const allSchemaText = scriptTags.join(" ").toLowerCase();
  const hasAuthorMeta = extractMetaContent(html, "author") !== null;
  const hasAuthorSchema = allSchemaText.includes('"author"');
  if (hasAuthorMeta || hasAuthorSchema) {
    items.push({ label: "Author attribution", status: "pass", detail: "Author metadata found. Supports E-E-A-T signals that AI models use for source credibility." });
  } else {
    items.push({ label: "Author attribution", status: "warn", detail: "No author metadata. AI models weight content from identified, credible authors.", fix: "Add <meta name=\"author\" content=\"...\"> or include author in your JSON-LD schema." });
  }

  const allHeadings = [...extractAllTags(html, "h1"), ...h2s, ...h3s];
  const hasEntityTerms = allHeadings.some((h) =>
    /\b(lawyer|attorney|law firm|legal|solicitor|barrister|counsel|practice|litigation|real estate|immigration|criminal|family|corporate|employment|estate|tax|personal injury|wills|probate)\b/i.test(h)
  );
  if (hasEntityTerms) {
    items.push({ label: "Practice-area entity signals", status: "pass", detail: "Headings contain legal practice-area terms. Helps AI associate your firm with specific services." });
  } else {
    items.push({ label: "Practice-area entity signals", status: "warn", detail: "Headings lack specific practice-area terms. Explicit entity naming helps AI categorize your firm.", fix: "Include specific practice-area terms in your headings: \"Real Estate Lawyer\", \"Immigration Law\", etc." });
  }

  const hasLocationSignal = /\b(toronto|ontario|gta|canada|canadian|mississauga|brampton|markham|scarborough|north york|etobicoke|hamilton|ottawa|vancouver|calgary|edmonton|montreal|new york|los angeles|chicago|london|sydney)\b/i.test(bodyText);
  if (hasLocationSignal) {
    items.push({ label: "Geographic entity signals", status: "pass", detail: "Location terms found in content. AI models use these to serve geo-relevant answers." });
  } else {
    items.push({ label: "Geographic entity signals", status: "warn", detail: "No strong geographic signals. Local AI answers depend on location entity recognition.", fix: "Mention your city and region in body copy and headings. AI models use location terms for geo-specific answers." });
  }

  const semanticTags = ["<header", "<nav", "<main", "<article", "<section", "<footer"];
  const foundSemantic = semanticTags.filter((tag) => html.toLowerCase().includes(tag));
  if (foundSemantic.length >= 4) {
    items.push({ label: "Semantic HTML structure", status: "pass", detail: `${foundSemantic.length} semantic elements found. Helps AI models understand page structure.` });
  } else if (foundSemantic.length >= 2) {
    items.push({ label: "Semantic HTML structure", status: "warn", detail: `Only ${foundSemantic.length} semantic elements. Using more helps AI parse your content structure.`, fix: "Replace generic <div> containers with semantic tags: <header>, <nav>, <main>, <article>, <section>, <footer>." });
  } else {
    items.push({ label: "Semantic HTML structure", status: "fail", detail: "Minimal semantic HTML. AI models struggle to parse content structure from div-only pages.", fix: "Use semantic HTML elements: <header>, <nav>, <main>, <article>, <section>, <footer>." });
  }

  const hasDateModified = allSchemaText.includes('"datemodified"') || allSchemaText.includes('"datepublished"');
  const hasLastModified = extractMetaContent(html, "last-modified") !== null || extractMetaContent(html, "article:modified_time") !== null;
  if (hasDateModified || hasLastModified) {
    items.push({ label: "Content freshness signals", status: "pass", detail: "Date metadata found. AI models prefer recent, dated content." });
  } else {
    items.push({ label: "Content freshness signals", status: "warn", detail: "No date metadata. AI models use publication dates to assess content relevance.", fix: "Add datePublished and dateModified to your JSON-LD schema, or use <meta property=\"article:modified_time\">." });
  }

  const { score, maxScore } = scoreItems(items);
  return { name: "AI Visibility", score, maxScore, items };
}

/* ────────────────────────────────────────────────────────
   4. Local SEO (5 checks)
   ──────────────────────────────────────────────────────── */

function checkLocalSeo(html: string): CategoryResult {
  const items: CheckItem[] = [];
  const bodyText = html.replace(/<[^>]+>/g, " ");

  const phonePattern = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
  if (phonePattern.test(bodyText)) {
    items.push({ label: "Phone number visible", status: "pass", detail: "Phone number found on page." });
  } else {
    items.push({ label: "Phone number visible", status: "fail", detail: "No phone number found. Local SEO requires visible NAP (Name, Address, Phone).", fix: "Add your firm's phone number in the header, footer, or contact section." });
  }

  const addressPattern = /\d+\s+[\w\s]+(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|way|lane|ln|court|ct|place|pl|suite|ste|unit|floor)\b/i;
  if (addressPattern.test(bodyText)) {
    items.push({ label: "Street address visible", status: "pass", detail: "Physical address found on page." });
  } else {
    items.push({ label: "Street address visible", status: "warn", detail: "No street address detected. Physical address strengthens local search ranking.", fix: "Add your full street address to the footer or contact page." });
  }

  if (/google\.com\/maps|maps\.googleapis\.com|gmp-map/i.test(html)) {
    items.push({ label: "Google Maps embed", status: "pass", detail: "Maps integration found." });
  } else {
    items.push({ label: "Google Maps embed", status: "warn", detail: "No Google Maps embed. Embedding a map reinforces location authority.", fix: "Add a Google Maps embed showing your office location." });
  }

  const scriptTags = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const allSchemaText = scriptTags.join(" ").toLowerCase();
  if (allSchemaText.includes('"telephone"') || allSchemaText.includes('"address"')) {
    items.push({ label: "NAP in structured data", status: "pass", detail: "Contact info found in JSON-LD." });
  } else {
    items.push({ label: "NAP in structured data", status: "fail", detail: "No NAP in structured data. Put your firm's contact info in LocalBusiness JSON-LD.", fix: "Add telephone, address, and name properties to your LocalBusiness JSON-LD schema." });
  }

  if (/google\.com\/(maps\/place|search\?.*business|business)/i.test(html) || /g\.page\//i.test(html)) {
    items.push({ label: "Google Business Profile link", status: "pass", detail: "GBP link found. Cross-linking strengthens both your site and GBP." });
  } else {
    items.push({ label: "Google Business Profile link", status: "warn", detail: "No link to Google Business Profile. Cross-linking improves local authority.", fix: "Add a link to your Google Business Profile in the footer or contact section." });
  }

  const { score, maxScore } = scoreItems(items);
  return { name: "Local SEO", score, maxScore, items };
}

/* ────────────────────────────────────────────────────────
   5. Technical & Security (8 checks)
   ──────────────────────────────────────────────────────── */

function checkTechnicalSecurity(html: string, url: string, headers: Headers): CategoryResult {
  const items: CheckItem[] = [];

  const isHttps = url.startsWith("https://");
  if (isHttps) {
    items.push({ label: "HTTPS", status: "pass", detail: "Site loads over HTTPS." });
  } else {
    items.push({ label: "HTTPS", status: "fail", detail: "Site loads over HTTP. Google penalizes non-HTTPS sites.", fix: "Install an SSL certificate and redirect all HTTP traffic to HTTPS." });
  }

  const httpResources = html.match(/(?:src|href)=["']http:\/\//gi) || [];
  if (httpResources.length === 0) {
    items.push({ label: "Mixed content", status: "pass", detail: "No insecure HTTP resources detected." });
  } else {
    items.push({ label: "Mixed content", status: "warn", detail: `${httpResources.length} HTTP resource${httpResources.length > 1 ? "s" : ""} on an HTTPS page.`, fix: "Change all http:// resource URLs to https:// or use protocol-relative URLs." });
  }

  const hsts = headers.get("strict-transport-security");
  if (hsts) {
    const maxAge = parseInt(hsts.match(/max-age=(\d+)/)?.[1] || "0");
    if (maxAge >= 31536000) {
      items.push({ label: "HSTS header", status: "pass", detail: "Present with max-age of at least one year." });
    } else {
      items.push({ label: "HSTS header", status: "warn", detail: `Present but max-age is low (${maxAge}s). Recommended: at least 31536000 (1 year).`, fix: "Set Strict-Transport-Security: max-age=31536000; includeSubDomains in your server config." });
    }
  } else {
    items.push({ label: "HSTS header", status: "warn", detail: "Missing. HSTS tells browsers to always use HTTPS.", fix: "Add Strict-Transport-Security: max-age=31536000; includeSubDomains to your server's response headers." });
  }

  const xcto = headers.get("x-content-type-options");
  if (xcto?.toLowerCase() === "nosniff") {
    items.push({ label: "X-Content-Type-Options", status: "pass", detail: "Set to nosniff. Prevents MIME-type sniffing attacks." });
  } else {
    items.push({ label: "X-Content-Type-Options", status: "warn", detail: "Missing or incorrect. Prevents browsers from MIME-sniffing responses.", fix: "Add X-Content-Type-Options: nosniff to your server's response headers." });
  }

  const csp = headers.get("content-security-policy");
  if (csp) {
    items.push({ label: "Content-Security-Policy", status: "pass", detail: "Present. Reduces the risk of XSS and injection attacks." });
  } else {
    items.push({ label: "Content-Security-Policy", status: "warn", detail: "Missing. CSP helps prevent cross-site scripting attacks.", fix: "Configure a Content-Security-Policy header. Start with a report-only mode to identify issues." });
  }

  const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  if (hasViewport) {
    items.push({ label: "Viewport meta tag", status: "pass", detail: "Present. Required for proper mobile rendering." });
  } else {
    items.push({ label: "Viewport meta tag", status: "fail", detail: "Missing. Without it, your site renders at desktop width on mobile.", fix: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> in your <head>." });
  }

  const robotsContent = extractMetaContent(html, "robots") || "";
  const xRobotsTag = headers.get("x-robots-tag") || "";
  const isNoindex = robotsContent.toLowerCase().includes("noindex") || xRobotsTag.toLowerCase().includes("noindex");
  if (isNoindex) {
    items.push({ label: "Robots meta (noindex)", status: "fail", detail: "Page is set to noindex. Search engines will not include this page in results.", fix: "Remove the noindex directive from your meta robots tag or X-Robots-Tag header." });
  } else {
    items.push({ label: "Robots meta", status: "pass", detail: "Page is indexable." });
  }

  const encoding = headers.get("content-encoding");
  if (encoding && /gzip|br|deflate/i.test(encoding)) {
    items.push({ label: "Compression", status: "pass", detail: `${encoding.toUpperCase()} compression active. Reduces page load time.` });
  } else {
    items.push({ label: "Compression", status: "warn", detail: "No compression detected. Gzip or Brotli compression reduces transfer size.", fix: "Enable gzip or Brotli compression on your web server for text-based resources." });
  }

  const { score, maxScore } = scoreItems(items);
  return { name: "Technical & Security", score, maxScore, items };
}

/* ────────────────────────────────────────────────────────
   6. Performance (6 checks)
   ──────────────────────────────────────────────────────── */

function checkPerformance(html: string, headers: Headers, ttfbMs: number, pageHostname: string): CategoryResult {
  const items: CheckItem[] = [];

  if (ttfbMs === 0) {
    items.push({ label: "Time to first byte", status: "warn", detail: "Could not measure response time for this page.", fix: "Improve TTFB with server-side caching, CDN, or a faster hosting provider." });
  } else {
    const ttfbRound = Math.round(ttfbMs);
    if (ttfbMs < 200) {
      items.push({ label: "Time to first byte", status: "pass", detail: `Fast (${ttfbRound}ms). Google recommends under 200ms.` });
    } else if (ttfbMs < 600) {
      items.push({ label: "Time to first byte", status: "warn", detail: `Moderate (${ttfbRound}ms). Under 200ms is ideal.`, fix: "Improve TTFB with server-side caching, CDN, or a faster hosting provider." });
    } else {
      items.push({ label: "Time to first byte", status: "fail", detail: `Slow (${ttfbRound}ms). Over 600ms hurts both experience and ranking.`, fix: "Investigate server response time. Common fixes: enable caching, use a CDN, upgrade hosting." });
    }
  }

  const htmlSizeKb = Math.round(html.length / 1024);
  if (htmlSizeKb <= 100) {
    items.push({ label: "HTML document size", status: "pass", detail: `${htmlSizeKb} KB. Lightweight and efficient.` });
  } else if (htmlSizeKb <= 250) {
    items.push({ label: "HTML document size", status: "warn", detail: `${htmlSizeKb} KB. Consider reducing inline styles or scripts.`, fix: "Move large inline CSS and JavaScript to external files. Remove unused code." });
  } else {
    items.push({ label: "HTML document size", status: "fail", detail: `${htmlSizeKb} KB. Oversized HTML slows initial rendering.`, fix: "Reduce HTML size by externalizing CSS/JS, removing unused markup, and minifying the output." });
  }

  const headHtml = html.match(/<head[\s\S]*?<\/head>/i)?.[0] || "";
  const blockingScripts = (headHtml.match(/<script(?![^>]*(?:async|defer|type=["']module["']))[^>]*src=/gi) || []).length;
  const blockingStyles = (headHtml.match(/<link[^>]+rel=["']stylesheet["'](?![^>]*media=["'](?:print|none))/gi) || []).length;
  const totalBlocking = blockingScripts + blockingStyles;
  if (totalBlocking === 0) {
    items.push({ label: "Render-blocking resources", status: "pass", detail: "No render-blocking scripts or stylesheets in <head>." });
  } else if (totalBlocking <= 3) {
    items.push({ label: "Render-blocking resources", status: "warn", detail: `${totalBlocking} render-blocking resource${totalBlocking > 1 ? "s" : ""} in <head> (${blockingScripts} script${blockingScripts !== 1 ? "s" : ""}, ${blockingStyles} stylesheet${blockingStyles !== 1 ? "s" : ""}).`, fix: "Add async or defer to scripts. Use media=\"print\" for non-critical stylesheets." });
  } else {
    items.push({ label: "Render-blocking resources", status: "fail", detail: `${totalBlocking} render-blocking resources in <head>. This delays page rendering.`, fix: "Add async/defer to scripts, inline critical CSS, and load non-critical stylesheets asynchronously." });
  }

  const imgTags = html.match(/<img[^>]*>/gi) || [];
  const imgsMissingDims = imgTags.filter((tag) => !/width=/i.test(tag) || !/height=/i.test(tag));
  if (imgTags.length === 0) {
    items.push({ label: "Image dimensions", status: "pass", detail: "No images to check." });
  } else if (imgsMissingDims.length === 0) {
    items.push({ label: "Image dimensions", status: "pass", detail: `All ${imgTags.length} images have width and height attributes. Prevents layout shift.` });
  } else {
    const pct = Math.round((imgsMissingDims.length / imgTags.length) * 100);
    items.push({ label: "Image dimensions", status: pct > 50 ? "fail" : "warn", detail: `${imgsMissingDims.length} of ${imgTags.length} images missing width/height attributes. This causes layout shift (CLS).`, fix: "Add explicit width and height attributes to every <img> tag to reserve space during loading." });
  }

  const preconnects = (html.match(/<link[^>]+rel=["']preconnect["']/gi) || []).length;
  const preloads = (html.match(/<link[^>]+rel=["']preload["']/gi) || []).length;
  const totalHints = preconnects + preloads;
  if (totalHints >= 2 && totalHints <= 6) {
    items.push({ label: "Resource hints", status: "pass", detail: `${preconnects} preconnect, ${preloads} preload. Good use of resource hints.` });
  } else if (totalHints > 6) {
    items.push({ label: "Resource hints", status: "warn", detail: `${totalHints} resource hints found. Too many preconnects can hurt performance.`, fix: "Limit preconnect to 2-4 critical origins. Excessive hints compete for bandwidth." });
  } else if (totalHints > 0) {
    items.push({ label: "Resource hints", status: "warn", detail: `Only ${totalHints} resource hint${totalHints > 1 ? "s" : ""}. Consider adding preconnect for critical third-party origins.`, fix: "Add <link rel=\"preconnect\"> for key third-party domains (fonts, analytics, CDN)." });
  } else {
    items.push({ label: "Resource hints", status: "warn", detail: "No resource hints found.", fix: "Add <link rel=\"preconnect\"> for critical third-party domains to speed up resource loading." });
  }

  const allScripts = html.match(/<script[^>]+src=["']([^"']+)["']/gi) || [];
  const thirdPartyDomains = new Set<string>();
  for (const tag of allScripts) {
    const src = tag.match(/src=["']([^"']+)["']/i)?.[1];
    if (src) {
      try {
        const u = new URL(src, `https://${pageHostname}`);
        const scriptHost = u.hostname.replace(/^www\./, "");
        if (scriptHost !== pageHostname) thirdPartyDomains.add(scriptHost);
      } catch { /* skip malformed */ }
    }
  }
  const tpCount = thirdPartyDomains.size;
  if (tpCount <= 3) {
    items.push({ label: "Third-party scripts", status: "pass", detail: `${tpCount} external script domain${tpCount !== 1 ? "s" : ""}. Minimal third-party load.` });
  } else if (tpCount <= 8) {
    items.push({ label: "Third-party scripts", status: "warn", detail: `${tpCount} external script domains. Each adds DNS lookups and connection overhead.`, fix: "Audit third-party scripts. Remove any that aren't actively used. Defer non-critical ones." });
  } else {
    items.push({ label: "Third-party scripts", status: "fail", detail: `${tpCount} external script domains. Excessive third-party scripts significantly slow page load.`, fix: "Reduce to under 5 external domains. Remove unused trackers and widgets, defer the rest." });
  }

  const { score, maxScore } = scoreItems(items);
  return { name: "Performance", score, maxScore, items };
}

/* ────────────────────────────────────────────────────────
   7. Links & Content (6 checks)
   ──────────────────────────────────────────────────────── */

function checkLinksContent(html: string, pageHostname: string): CategoryResult {
  const items: CheckItem[] = [];
  const bodyText = extractBodyText(html);
  const words = countWords(bodyText);

  if (words >= 300) {
    items.push({ label: "Word count", status: "pass", detail: `${words.toLocaleString()} words. Sufficient content for search engines to index.` });
  } else if (words >= 200) {
    items.push({ label: "Word count", status: "warn", detail: `${words} words. Thin content may rank poorly.`, fix: "Expand the page content to at least 300 words. Add detail about your services, process, or expertise." });
  } else {
    items.push({ label: "Word count", status: "fail", detail: `${words} words. Very thin content signals low value to search engines.`, fix: "Add substantive content: explain your services, answer common questions, describe your process." });
  }

  const headingPattern = /<h([1-6])[^>]*>/gi;
  const headingLevels: number[] = [];
  let hm;
  while ((hm = headingPattern.exec(html)) !== null) {
    headingLevels.push(parseInt(hm[1]));
  }
  let skipped = false;
  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] > headingLevels[i - 1] + 1) { skipped = true; break; }
  }
  if (headingLevels.length === 0) {
    items.push({ label: "Heading hierarchy", status: "fail", detail: "No headings found. Headings provide content structure for both users and search engines.", fix: "Add a heading structure: H1 for the main title, H2 for sections, H3 for sub-sections." });
  } else if (skipped) {
    items.push({ label: "Heading hierarchy", status: "warn", detail: "Heading levels are skipped (e.g., H1 followed by H3). This weakens document structure signals.", fix: "Use sequential heading levels without skipping. Go H1, H2, H3 in order, not H1 to H3 directly." });
  } else {
    items.push({ label: "Heading hierarchy", status: "pass", detail: "Heading levels follow a proper sequence." });
  }

  const anchorTags = html.match(/<a[^>]+href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi) || [];
  let internalCount = 0;
  let externalCount = 0;
  const genericAnchors: string[] = [];

  for (const tag of anchorTags) {
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    const textMatch = tag.match(/>([\s\S]*?)<\/a>/i);
    const href = hrefMatch?.[1] || "";
    const text = (textMatch?.[1] || "").replace(/<[^>]+>/g, "").trim().toLowerCase();

    if (href.startsWith("/") || href.startsWith("#") || href.startsWith("./")) {
      internalCount++;
    } else if (href.startsWith("http")) {
      try {
        const linkHost = new URL(href).hostname.replace(/^www\./, "");
        if (linkHost === pageHostname) { internalCount++; } else { externalCount++; }
      } catch { /* skip malformed */ }
    }

    if (text && GENERIC_ANCHORS.has(text)) genericAnchors.push(text);
  }

  if (internalCount >= 3) {
    items.push({ label: "Internal links", status: "pass", detail: `${internalCount} internal links found. Good internal linking structure.` });
  } else if (internalCount > 0) {
    items.push({ label: "Internal links", status: "warn", detail: `Only ${internalCount} internal link${internalCount > 1 ? "s" : ""}. More internal links help distribute authority.`, fix: "Add links to other relevant pages on your site. Link from service pages to related practice areas." });
  } else {
    items.push({ label: "Internal links", status: "fail", detail: "No internal links detected. Internal linking is critical for SEO.", fix: "Add links to your other pages: practice areas, about, contact, blog posts." });
  }

  const textLen = bodyText.length;
  const htmlLen = html.length;
  const ratio = htmlLen > 0 ? Math.round((textLen / htmlLen) * 100) : 0;
  if (ratio >= 15) {
    items.push({ label: "Content-to-HTML ratio", status: "pass", detail: `${ratio}% text content. Good balance of content vs. markup.` });
  } else if (ratio >= 8) {
    items.push({ label: "Content-to-HTML ratio", status: "warn", detail: `${ratio}% text content. Low ratio suggests the page is heavy on code, light on content.`, fix: "Add more text content relative to your HTML markup. Remove unused code and excess whitespace." });
  } else {
    items.push({ label: "Content-to-HTML ratio", status: "fail", detail: `${ratio}% text content. Very code-heavy page with minimal visible content.`, fix: "Add substantive text content. A page with mostly code and little text signals low value to search engines." });
  }

  if (genericAnchors.length === 0) {
    items.push({ label: "Anchor text quality", status: "pass", detail: "No generic anchor text found. Links use descriptive text." });
  } else if (genericAnchors.length <= 2) {
    items.push({ label: "Anchor text quality", status: "warn", detail: `${genericAnchors.length} link${genericAnchors.length > 1 ? "s" : ""} with generic text ("${genericAnchors[0]}"). Descriptive anchor text improves SEO.`, fix: "Replace \"click here\" and \"learn more\" with descriptive text that says where the link goes." });
  } else {
    items.push({ label: "Anchor text quality", status: "fail", detail: `${genericAnchors.length} links with generic text. Search engines use anchor text to understand linked content.`, fix: "Replace all \"click here\", \"read more\", \"learn more\" links with descriptive anchor text." });
  }

  if (externalCount >= 1) {
    items.push({ label: "External links", status: "pass", detail: `${externalCount} outbound link${externalCount > 1 ? "s" : ""} found. External links to authoritative sources add credibility.` });
  } else {
    items.push({ label: "External links", status: "warn", detail: "No outbound links. Linking to authoritative external sources adds credibility.", fix: "Link to relevant external resources: government sites, law society, court resources." });
  }

  const { score, maxScore } = scoreItems(items);
  return { name: "Links & Content", score, maxScore, items };
}

/* ────────────────────────────────────────────────────────
   Scoring
   ──────────────────────────────────────────────────────── */

function computeGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "A-";
  if (score >= 70) return "B+";
  if (score >= 60) return "B";
  if (score >= 50) return "C+";
  if (score >= 40) return "C";
  if (score >= 30) return "D";
  return "F";
}

function computeWeightedScore(categories: CategoryResult[]): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const cat of categories) {
    const weight = CATEGORY_WEIGHTS[cat.name] || 10;
    const pct = cat.maxScore > 0 ? (cat.score / cat.maxScore) * 100 : 0;
    weightedSum += pct * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
}

/* ────────────────────────────────────────────────────────
   Page Scanning
   ──────────────────────────────────────────────────────── */

function buildPageResult(
  html: string,
  finalUrl: string,
  headers: Headers,
  ttfbMs: number,
  parsedRobots: ParsedRobots | null,
  llmsTxt: string | null
): PageResult {
  const pageHostname = new URL(finalUrl).hostname.replace(/^www\./, "");
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;

  const categories: CategoryResult[] = [
    checkOnPageSeo(html),
    checkSchemaMarkup(html),
    checkAiVisibility(html, parsedRobots, llmsTxt),
    checkLocalSeo(html),
    checkTechnicalSecurity(html, finalUrl, headers),
    checkPerformance(html, headers, ttfbMs, pageHostname),
    checkLinksContent(html, pageHostname),
  ];

  const pageScore = computeWeightedScore(categories);
  const pageGrade = computeGrade(pageScore);

  const aiCat = categories.find((c) => c.name === "AI Visibility")!;
  const aiVisibilityScore = aiCat.maxScore > 0 ? Math.round((aiCat.score / aiCat.maxScore) * 100) : 0;

  const allItems = categories.flatMap((c) => c.items);
  const failCount = allItems.filter((i) => i.status === "fail").length;
  const warnCount = allItems.filter((i) => i.status === "warn").length;

  return { url: finalUrl, title, pageScore, pageGrade, aiVisibilityScore, categories, failCount, warnCount };
}

async function scanPage(
  url: string,
  parsedRobots: ParsedRobots | null,
  llmsTxt: string | null
): Promise<PageResult | null> {
  let handle: SafeFetchResult | null = null;
  try {
    const t0 = Date.now();
    handle = await safeFetch(url, 12000);
    const ttfbMs = Date.now() - t0;
    const { res, finalUrl } = handle;
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html") && !ct.includes("xhtml")) return null;
    const read = await readCappedText(res, MAX_HTML_BYTES);
    if (!read.ok) return null;
    return buildPageResult(read.text, finalUrl, res.headers, ttfbMs, parsedRobots, llmsTxt);
  } catch { return null; }
  finally { handle?.cleanup(); }
}

/* ────────────────────────────────────────────────────────
   Site Aggregation
   ──────────────────────────────────────────────────────── */

function computeTopFixes(pages: PageResult[], limit: number): TopFix[] {
  const fixMap = new Map<string, {
    status: "warn" | "fail";
    category: string;
    fix?: string;
    pagesAffected: Set<string>;
  }>();

  for (const page of pages) {
    for (const cat of page.categories) {
      for (const item of cat.items) {
        if (item.status === "pass") continue;
        const key = `${cat.name}::${item.label}`;
        const existing = fixMap.get(key);
        if (!existing) {
          fixMap.set(key, { status: item.status, category: cat.name, fix: item.fix, pagesAffected: new Set([page.url]) });
        } else {
          existing.pagesAffected.add(page.url);
          if (item.status === "fail") existing.status = "fail";
        }
      }
    }
  }

  return [...fixMap.entries()]
    .map(([key, v]) => ({
      label: key.split("::")[1],
      category: v.category,
      status: v.status,
      fix: v.fix,
      pagesAffected: v.pagesAffected.size,
      totalPages: pages.length,
    }))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "fail" ? -1 : 1;
      return b.pagesAffected - a.pagesAffected;
    })
    .slice(0, limit);
}

// Splits an AI Visibility category's items into the two independent scores:
// search visibility (every item except training-bot control) and content
// policy (the training-bot control item alone).
function aiScoresFromItems(items: CheckItem[]): { search: number; policy: number } {
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

function aggregateSite(
  domain: string,
  pages: PageResult[],
  parsedRobots: ParsedRobots | null
): SeoCheckResult {
  const catNames = pages[0].categories.map((c) => c.name);

  const aggregatedCategories: CategoryResult[] = catNames.map((name) => {
    const pageCats = pages.map((p) => p.categories.find((c) => c.name === name)).filter((c): c is CategoryResult => !!c);
    const avgPct = pageCats.reduce((sum, c) => sum + (c.maxScore > 0 ? c.score / c.maxScore : 0), 0) / pageCats.length;

    const allLabels = [...new Set(pageCats.flatMap((c) => c.items.map((i) => i.label)))];
    const items: CheckItem[] = allLabels.map((label) => {
      const instances = pageCats.flatMap((c) => c.items.filter((i) => i.label === label));
      const failCount = instances.filter((i) => i.status === "fail").length;
      const warnCount = instances.filter((i) => i.status === "warn").length;
      const status: "pass" | "warn" | "fail" = failCount > 0 ? "fail" : warnCount > 0 ? "warn" : "pass";
      const representative = instances.find((i) => i.status === "fail") ?? instances.find((i) => i.status === "warn") ?? instances[0];
      let detail = representative.detail;
      if (pages.length > 1) {
        const affected = failCount || warnCount;
        if (affected > 0 && affected < pages.length) detail += ` (${affected} of ${pages.length} pages)`;
        else if (affected === pages.length && pages.length > 1) detail += ` (all ${pages.length} pages)`;
      }
      return { label, status, detail, fix: representative.fix };
    });

    const maxScore = items.length * 10;
    const score = Math.round(avgPct * maxScore);
    return { name, score, maxScore, items };
  });

  const overallScore = computeWeightedScore(aggregatedCategories);
  const grade = computeGrade(overallScore);

  // AI scores are averaged across the scanned pages, not derived from the
  // worst-of aggregated items: one weak page should not collapse the whole
  // site's AI visibility reading.
  const perPageAi = pages.map((p) => {
    const ai = p.categories.find((c) => c.name === "AI Visibility");
    return aiScoresFromItems(ai ? ai.items : []);
  });
  const aiSearchScore = perPageAi.length > 0
    ? Math.round(perPageAi.reduce((sum, a) => sum + a.search, 0) / perPageAi.length)
    : 0;
  const aiSearchGrade = computeGrade(aiSearchScore);

  const aiPolicyScore = perPageAi.length > 0
    ? Math.round(perPageAi.reduce((sum, a) => sum + a.policy, 0) / perPageAi.length)
    : 50;
  const aiPolicyGrade = computeGrade(aiPolicyScore);

  const aiBots: AiBotStatus[] = [
    ...AI_SEARCH_BOTS.map((b) => ({
      name: b.label,
      blocked: parsedRobots ? checkBotBlockedParsed(parsedRobots, b.token) : false,
      category: "search" as const,
    })),
    ...AI_TRAINING_BOTS.map((b) => ({
      name: b.label,
      blocked: parsedRobots ? checkBotBlockedParsed(parsedRobots, b.token) : false,
      category: "training" as const,
    })),
  ];

  const topFixes = computeTopFixes(pages, 5);

  return {
    domain,
    pagesScanned: pages.length,
    pages,
    categories: aggregatedCategories,
    overallScore,
    grade,
    aiSearchScore,
    aiSearchGrade,
    aiPolicyScore,
    aiPolicyGrade,
    aiBots,
    topFixes,
    checkedAt: new Date().toISOString(),
  };
}

/* ────────────────────────────────────────────────────────
   POST Handler
   ──────────────────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawDomain = body.domain;
    const maxPages = Number.isFinite(body?.maxPages)
      ? Math.max(1, Math.min(10, Math.floor(body.maxPages)))
      : 5;

    if (!rawDomain || typeof rawDomain !== "string") {
      return NextResponse.json({ error: "Domain is required." }, { status: 400 });
    }

    const domain = normalizeDomain(rawDomain);
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
      return NextResponse.json({ error: "Invalid domain format." }, { status: 400 });
    }

    if (isSsrfBlocked(domain)) {
      return NextResponse.json({ error: "That domain cannot be checked." }, { status: 400 });
    }

    const homeUrl = `https://${domain}`;

    const [robotsRaw, llmsTxt] = await Promise.all([
      safeResource(`https://${domain}/robots.txt`, 5000),
      safeResource(`https://${domain}/llms.txt`, 5000),
    ]);
    const parsedRobots = robotsRaw ? parseRobotsTxt(robotsRaw) : null;

    // Scan homepage: establishes TTFB, extracts HTML for link discovery
    let homePage: PageResult;
    let homeHtml: string;
    let homeHandle: SafeFetchResult | null = null;
    try {
      const t0 = Date.now();
      homeHandle = await safeFetch(homeUrl, 15000);
      const { res, finalUrl } = homeHandle;
      const ttfbMs = Date.now() - t0;

      if (!res.ok) {
        return NextResponse.json(
          { error: `Could not reach ${domain} (HTTP ${res.status}). Check the domain and try again.` },
          { status: 422 }
        );
      }

      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("html") && !ct.includes("xhtml")) {
        return NextResponse.json(
          { error: `${domain} returned a non-HTML response. Only websites can be checked.` },
          { status: 422 }
        );
      }

      const read = await readCappedText(res, MAX_HTML_BYTES);
      if (!read.ok) {
        const error = read.reason === "too_large"
          ? `${domain} returned a page that is too large to scan.`
          : `${domain} took too long to respond or closed the connection. Try again in a moment.`;
        return NextResponse.json({ error }, { status: 422 });
      }

      homeHtml = read.text;
      homePage = buildPageResult(read.text, finalUrl, res.headers, ttfbMs, parsedRobots, llmsTxt);
    } catch (fetchErr: unknown) {
      const msg = fetchErr instanceof Error ? fetchErr.message : "unknown";
      if (msg === "ssrf_blocked") return NextResponse.json({ error: "That domain cannot be checked." }, { status: 400 });
      if (msg === "too_many_redirects") return NextResponse.json({ error: `${domain} redirected too many times.` }, { status: 422 });
      if (msg.includes("abort") || msg.includes("AbortError")) {
        return NextResponse.json({ error: `${domain} took too long to respond. Try again in a moment.` }, { status: 422 });
      }
      return NextResponse.json({ error: `Could not connect to ${domain}. Verify the domain is correct and the site is live.` }, { status: 422 });
    } finally {
      homeHandle?.cleanup();
    }

    const pageResults: PageResult[] = [homePage];

    // Discover and scan additional pages
    if (maxPages > 1) {
      const discovered = new Set<string>();

      for (const u of extractInternalLinks(homeHtml, homePage.url, domain)) discovered.add(u);
      for (const u of await fetchSitemapUrls(`https://${domain}/sitemap.xml`, domain)) discovered.add(u);

      if (parsedRobots) {
        // Only follow robots-declared sitemaps that stay on the firm's own host.
        const sameOriginSitemaps = parsedRobots.sitemaps.filter((s) => isSameOrigin(s, domain)).slice(0, 2);
        for (const sitemapUrl of sameOriginSitemaps) {
          for (const u of await fetchSitemapUrls(sitemapUrl, domain)) discovered.add(u);
        }
      }

      discovered.delete(homePage.url);
      discovered.delete(homeUrl);
      discovered.delete(homeUrl + "/");

      const candidates = selectAdditionalPages([...discovered], maxPages - 1);
      // Respect the site's robots rules for our own scanner on discovered
      // pages. The homepage is always scanned (it is the firm's own front door).
      const additional = parsedRobots
        ? candidates.filter((u) => {
            try { return !checkBotBlockedParsed(parsedRobots, SCANNER_TOKEN, new URL(u).pathname); }
            catch { return false; }
          })
        : candidates;
      for (const pageUrl of additional) {
        const result = await scanPage(pageUrl, parsedRobots, llmsTxt);
        if (result) pageResults.push(result);
      }
    }

    const siteResult = aggregateSite(domain, pageResults, parsedRobots);
    return NextResponse.json(siteResult);
  } catch {
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
