/**
 * /api/tools/seo-check
 *
 * Bounded professional SEO + AI visibility diagnostic. Crawls a law-firm site
 * (scan modes: quick 10 / standard 25 / deep 50, hard cap 75), runs per-page
 * analyzers across nine categories, and returns a backward-compatible report
 * plus a professional issue model and an internal prospecting summary.
 *
 * Network + SSRF live here; the pure logic (SSRF ranges, robots, URL/page-type
 * helpers, scoring) lives in engine-core.ts and the issue / prospecting model
 * lives in analysis.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { lookup as dnsLookup } from "node:dns";
import { Agent } from "undici";

import {
  type CheckItem,
  type CategoryResult,
  type AiBotStatus,
  type ParsedRobots,
  AI_SEARCH_BOTS,
  AI_TRAINING_BOTS,
  SCANNER_TOKEN,
  GENERIC_ANCHORS,
  ipInBlockedRange,
  isSsrfBlocked,
  parseRobotsTxt,
  checkBotBlockedParsed,
  normalizeDomain,
  normalizePageUrl,
  isSameOrigin,
  shouldSkipUrl,
  crawlUrlKey,
  scoreUrlPriority,
  classifyPageType,
  decodeHtmlEntities,
  resolveScan,
  computeGrade,
  computeWeightedScore,
  scoreItems,
  aiScoresFromItems,
} from "./engine-core";

import {
  type PageResult,
  type Indexability,
  type SchemaSummary,
  type LawFirmSignals,
  type TopFix,
  type SeoCheckResult,
  buildIssues,
  buildSiteStructureIssues,
  buildInternalSummary,
  severityBreakdown,
  computeDiscoveryConfidence,
  compareIssuesByPriority,
} from "./analysis";
import { saveSeoCheckRunBestEffort } from "./save-run";
import {
  type NormalizedIntent,
  aggregateIntentAlignment,
  analyzePageIntent,
  buildIntentCategory,
  buildPageAuditSnapshot,
  normalizeIntentInput,
} from "./intent-analysis";
import {
  aggregateRenderingSummary,
  analyzeRenderingSnapshot,
  buildRenderingCategory,
} from "./rendering-analysis";
import { SCAN_MODE_DEFAULTS } from "./engine-core";
import { getOperatorSession } from "@/lib/portal-auth";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";
// Deep scans walk up to 50 pages sequentially; allow headroom on Vercel Pro.
export const maxDuration = 300;

/* ────────────────────────────────────────────────────────
   SSRF-protected fetch (DNS-validating, pinning, byte-capped)
   ──────────────────────────────────────────────────────── */

interface DnsAddr { address: string; family: number }
type LookupOptions = { all?: boolean };
type LookupCb = (
  err: NodeJS.ErrnoException | null,
  address: string | DnsAddr[],
  family?: number
) => void;

// Resolves every address and refuses the hostname if any resolves into a
// blocked range; pins the connection to the validated set, closing the DNS
// rebinding gap. Honours the caller's expected callback shape (scalar vs all).
function validatingLookup(hostname: string, options: LookupOptions, callback: LookupCb): void {
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
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_RESOURCE_BYTES = 2 * 1024 * 1024;

interface SafeFetchResult {
  res: Response;
  finalUrl: string;
  redirectHops: number;
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
    return { res, finalUrl: currentUrl, redirectHops: hop, cleanup: () => clearTimeout(timer) };
  }
  throw new Error("too_many_redirects");
}

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
   Sitemap fetch + link extraction
   ──────────────────────────────────────────────────────── */

async function fetchSitemapUrls(sitemapUrl: string, domain: string, depth = 0): Promise<string[]> {
  try {
    const parsed = new URL(sitemapUrl);
    if (isSsrfBlocked(parsed.hostname)) return [];
    const raw = await safeResource(sitemapUrl, 6000);
    if (!raw) return [];
    const urls: string[] = [];
    const childSitemaps: string[] = [];
    const locPattern = /<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi;
    for (const [, url] of raw.matchAll(locPattern)) {
      const trimmed = url.trim();
      if (/\.(xml|gz)(\?.*)?$/.test(trimmed)) {
        // Sitemap index entry: collect for recursive fetch (one level only).
        if (depth === 0 && isSameOrigin(trimmed, domain)) childSitemaps.push(trimmed);
        continue;
      }
      if (isSameOrigin(trimmed, domain)) {
        try { const u = new URL(trimmed); u.hash = ""; urls.push(u.href); } catch { /* skip */ }
      }
      if (urls.length >= 200) break;
    }
    if (depth === 0) {
      for (const child of childSitemaps.slice(0, 5)) {
        const childUrls = await fetchSitemapUrls(child, domain, 1);
        for (const u of childUrls) urls.push(u);
        if (urls.length >= 500) break;
      }
    }
    return urls;
  } catch { return []; }
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

/* ────────────────────────────────────────────────────────
   HTML utilities
   ──────────────────────────────────────────────────────── */

function extractMetaContent(html: string, nameOrProperty: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${nameOrProperty}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${nameOrProperty}["']`, "i"),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    // Decode entities so length checks and report text see what a person sees.
    if (m) return decodeHtmlEntities(m[1]);
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

function extractCanonical(html: string): string | null {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i);
  if (!m) return null;
  const href = m[0].match(/href=["']([^"']+)["']/i);
  return href ? href[1].trim() : null;
}

/* ────────────────────────────────────────────────────────
   Structured-data extraction (JSON-LD)
   ──────────────────────────────────────────────────────── */

// Iterative, bounded walkers. A hostile but valid JSON-LD block with deep
// nesting must not overflow the stack or run away, so we cap depth and the
// total node count instead of recursing.
const MAX_SCHEMA_DEPTH = 64;
const MAX_SCHEMA_NODES = 5000;

function collectTypes(root: unknown, out: Set<string>): void {
  const stack: Array<{ node: unknown; depth: number }> = [{ node: root, depth: 0 }];
  let visited = 0;
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (!node || typeof node !== "object" || depth > MAX_SCHEMA_DEPTH) continue;
    if (++visited > MAX_SCHEMA_NODES) break;
    if (Array.isArray(node)) {
      for (const n of node) stack.push({ node: n, depth: depth + 1 });
      continue;
    }
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    if (typeof t === "string") out.add(t.toLowerCase());
    else if (Array.isArray(t)) for (const x of t) if (typeof x === "string") out.add(x.toLowerCase());
    for (const key of Object.keys(obj)) stack.push({ node: obj[key], depth: depth + 1 });
  }
}

function hasKeyDeep(root: unknown, keys: string[]): boolean {
  const stack: Array<{ node: unknown; depth: number }> = [{ node: root, depth: 0 }];
  let visited = 0;
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (!node || typeof node !== "object" || depth > MAX_SCHEMA_DEPTH) continue;
    if (++visited > MAX_SCHEMA_NODES) break;
    if (Array.isArray(node)) {
      for (const n of node) stack.push({ node: n, depth: depth + 1 });
      continue;
    }
    const obj = node as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      if (keys.includes(k.toLowerCase())) {
        const v = obj[k];
        if (v !== null && v !== undefined && v !== "") return true;
      }
      stack.push({ node: obj[k], depth: depth + 1 });
    }
  }
  return false;
}

function extractSchemaSummary(html: string): SchemaSummary {
  const scriptTags = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const types = new Set<string>();
  let invalidBlocks = 0;
  const parsed: unknown[] = [];
  for (const tag of scriptTags) {
    const jsonStr = tag.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "").trim();
    try {
      const obj = JSON.parse(jsonStr);
      parsed.push(obj);
      collectTypes(obj, types);
    } catch { invalidBlocks++; }
  }
  const t = (name: string) => types.has(name);
  const orgLike = (t("organization") ? 1 : 0) + (t("localbusiness") ? 1 : 0) + (t("legalservice") ? 1 : 0) + (t("attorney") ? 1 : 0);
  return {
    blocks: scriptTags.length,
    invalidBlocks,
    types: [...types],
    hasOrganization: t("organization"),
    hasLocalBusiness: t("localbusiness"),
    hasLegalService: t("legalservice"),
    hasAttorney: t("attorney"),
    hasPerson: t("person"),
    hasBreadcrumb: t("breadcrumblist"),
    hasFaq: t("faqpage"),
    hasWebsite: t("website"),
    hasReview: t("review") || t("aggregaterating"),
    fields: {
      name: hasKeyDeep(parsed, ["name"]),
      url: hasKeyDeep(parsed, ["url"]),
      telephone: hasKeyDeep(parsed, ["telephone"]),
      address: hasKeyDeep(parsed, ["address"]),
      areaServed: hasKeyDeep(parsed, ["areaserved"]),
      sameAs: hasKeyDeep(parsed, ["sameas"]),
      priceRange: hasKeyDeep(parsed, ["pricerange"]),
      openingHours: hasKeyDeep(parsed, ["openinghours", "openinghoursspecification"]),
    },
    // Two or more distinct top-level business-entity types can confuse parsers.
    conflictingEntity: orgLike >= 2,
  };
}

/* ────────────────────────────────────────────────────────
   Law-firm signal extraction
   ──────────────────────────────────────────────────────── */

const PHONE_RE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const ADDRESS_RE = /\d+\s+[\w\s]+(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|way|lane|ln|court|ct|place|pl|suite|ste|unit|floor)\b/i;

function extractLawFirmSignals(html: string, schema: SchemaSummary): LawFirmSignals {
  const bodyText = extractBodyText(html);
  const bodyLower = bodyText.toLowerCase();
  const anchorText = (html.match(/<a[^>]*>([\s\S]*?)<\/a>/gi) || []).map((a) => a.replace(/<[^>]+>/g, " ").toLowerCase()).join(" ");
  const buttonText = (html.match(/<button[^>]*>([\s\S]*?)<\/button>/gi) || []).map((b) => b.replace(/<[^>]+>/g, " ").toLowerCase()).join(" ");
  const cta = anchorText + " " + buttonText;

  // Modern law firm sites render CTA text client-side (React/Next.js). Scan
  // href attributes for intake anchors: present in SSR HTML even when the
  // button label is injected after hydration.
  // Use matchAll to capture group 1 (the URL value only, not the full href="..." attribute).
  const anchorHrefs = [...html.matchAll(/\bhref=["']([^"']+)["']/gi)].map((m) => m[1].toLowerCase());
  const hasIntakeAnchor = anchorHrefs.some(
    (h) => /#(matter-review|intake|contact|book|schedule|consultation|get-started|form)/.test(h) ||
      /\/(book|contact|schedule|consultation)/.test(h)
  );

  // Intake widgets (CaseLoad Screen, Typeform, Calendly, etc.) embed as iframes
  // rather than native <form> elements. Treat an intake-looking iframe as a form.
  const iframeSrcs = [...html.matchAll(/<iframe[^>]*src=["']([^"']+)["']/gi)].map((m) => m[1].toLowerCase());
  const hasIntakeIframe = iframeSrcs.some(
    (s) => /(widget-public|widget\/|intake|calendly\.com|typeform\.com|jotform\.com|cognitoforms|formstack)/.test(s)
  );

  const hasForm = /<form[\s\S]*?(<input|<textarea|<select)/i.test(html) ||
    /mailto:/i.test(html) ||
    hasIntakeIframe;

  const consultationCta =
    hasIntakeAnchor ||
    hasIntakeIframe ||
    /(free consultation|book a consultation|schedule a consultation|request a consultation|book a call|schedule a call|get started|request a quote|contact us|talk to (a|an) (lawyer|attorney)|speak (to|with) (a|an) (lawyer|attorney))/i.test(cta);

  return {
    phoneVisible: PHONE_RE.test(bodyText),
    contactFormPresent: hasForm,
    addressVisible: ADDRESS_RE.test(bodyText) || schema.fields.address,
    consultationCta,
    policyPagePresent: /href=["'][^"']*(privacy|terms|disclaimer)/i.test(html),
    practiceAreaIntent: /\b(lawyer|attorney|law firm|legal|solicitor|barrister|counsel|litigation|real estate|immigration|criminal|family law|corporate|employment|estate|wills|probate|personal injury)\b/i.test(bodyText),
    trust: {
      // Trust signals must be VISIBLE to a person, so they scan the extracted
      // body text, not the raw HTML. Field bug (marathonlaw.ca): scanning the
      // full HTML matched "rating" inside Squarespace's script-config JSON and
      // credited reviews the page does not show. Word-bounded "ratings?" also
      // stops crediting unrelated words that merely contain the substring.
      testimonials: /(testimonial|what our clients say|client stories|in their words)/i.test(bodyLower),
      reviews: /(google reviews?|client reviews?|\d+(\.\d+)?\s*(star|\/\s*5)|★|\bratings?\b)/i.test(bodyLower) || schema.hasReview,
      caseResults: /(case results|verdicts|settlements|results we|recovered|successful outcomes|notable cases)/i.test(bodyLower),
      awards: /(super lawyers|best lawyers|martindale|avvo|rising star|award|recognized by|top \d+)/i.test(bodyLower),
      credentials: /(law society|lso\b|bar association|called to the bar|member of the|llb|juris doctor|\bj\.?d\.?\b|barrister|solicitor)/i.test(bodyLower),
    },
  };
}

/* ════════════════════════════════════════════════════════
   Category analyzers
   ════════════════════════════════════════════════════════ */

/* 1. On-Page SEO */
function checkOnPageSeo(html: string): CategoryResult {
  const items: CheckItem[] = [];

  const rawTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const title = rawTitle ? decodeHtmlEntities(rawTitle) : rawTitle;
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

/* 2. Indexability */
function checkIndexability(idx: Indexability, robotsAllowed: { scanner: boolean; google: boolean; bing: boolean }): CategoryResult {
  const items: CheckItem[] = [];

  items.push({ label: "HTTP status", status: "pass", detail: `Returned HTTP ${idx.httpStatus}.` });

  if (idx.redirectHops === 0) {
    items.push({ label: "Redirect chain", status: "pass", detail: "Served directly with no redirect." });
  } else if (idx.redirectHops <= 2) {
    items.push({ label: "Redirect chain", status: "warn", detail: `${idx.redirectHops} redirect hop${idx.redirectHops > 1 ? "s" : ""} before the final page.`, fix: "Point internal links at the final URL so visitors and crawlers skip the redirects." });
  } else {
    items.push({ label: "Redirect chain", status: "fail", detail: `${idx.redirectHops} redirect hops. Long chains waste crawl budget and slow the page.`, fix: "Collapse the redirect chain to a single hop and update internal links to the final URL." });
  }

  if (idx.metaNoindex || idx.headerNoindex) {
    items.push({ label: "Indexable", status: "fail", detail: `Page is set to noindex (${idx.metaNoindex ? "meta robots" : "X-Robots-Tag"}). Search engines will drop it from results.`, fix: "Remove the noindex directive if this page should rank." });
  } else {
    items.push({ label: "Indexable", status: "pass", detail: "No noindex directive. Page is eligible to be indexed." });
  }

  if (idx.metaNofollow || idx.headerNofollow) {
    items.push({ label: "Followable links", status: "warn", detail: "Page carries a nofollow directive, so link equity does not pass from it.", fix: "Remove the nofollow directive unless you intentionally seal off this page." });
  } else {
    items.push({ label: "Followable links", status: "pass", detail: "Links on this page are followable." });
  }

  if (!idx.canonical) {
    items.push({ label: "Canonical tag", status: "warn", detail: "No canonical tag. Duplicate URL variations can split ranking signals.", fix: "Add <link rel=\"canonical\"> pointing to the preferred URL for this page." });
  } else if (idx.canonicalSameOrigin === false) {
    items.push({ label: "Canonical tag", status: "fail", detail: "Canonical points to a different domain. This can deindex the page in favour of another site.", fix: "Point the canonical at the correct URL on this same domain." });
  } else if (idx.canonicalSelf === false) {
    items.push({ label: "Canonical tag", status: "warn", detail: "Canonical points to a different page. Confirm that is intentional consolidation, not an error.", fix: "Set a self-referencing canonical unless this page is a deliberate duplicate of another." });
  } else {
    items.push({ label: "Canonical tag", status: "pass", detail: "Self-referencing canonical present." });
  }

  if (idx.mixedSignals) {
    items.push({ label: "Mixed indexability signals", status: "fail", detail: "Conflicting signals (for example noindex together with a canonical). Search engines may handle the page unpredictably.", fix: "Decide whether the page should be indexed and make the canonical and robots directives agree." });
  } else {
    items.push({ label: "Mixed indexability signals", status: "pass", detail: "Indexability signals are consistent." });
  }

  if (robotsAllowed.scanner && robotsAllowed.google && robotsAllowed.bing) {
    items.push({ label: "robots.txt crawl access", status: "pass", detail: "Googlebot and Bingbot are allowed to crawl this path." });
  } else {
    const blocked = [!robotsAllowed.google && "Googlebot", !robotsAllowed.bing && "Bingbot"].filter(Boolean).join(", ");
    items.push({ label: "robots.txt crawl access", status: blocked ? "fail" : "warn", detail: blocked ? `Blocked for ${blocked} in robots.txt.` : "Crawl access is restricted for some agents.", fix: "Remove the Disallow rule for this path so search engines can crawl it." });
  }

  if (idx.inSitemap === null) {
    items.push({ label: "Sitemap membership", status: "warn", detail: "No sitemap found, so this page is not listed for discovery.", fix: "Publish an XML sitemap that lists your important pages and reference it in robots.txt." });
  } else if (idx.inSitemap) {
    items.push({ label: "Sitemap membership", status: "pass", detail: "Page is listed in the XML sitemap." });
  } else {
    items.push({ label: "Sitemap membership", status: "warn", detail: "Page is not listed in the XML sitemap.", fix: "Add this page to your XML sitemap so search engines discover it reliably." });
  }

  const { score, maxScore } = scoreItems(items);
  return { name: "Indexability", score, maxScore, items };
}

/* 3. Schema & Structured Data */
function checkSchemaMarkup(schema: SchemaSummary): CategoryResult {
  const items: CheckItem[] = [];

  if (schema.blocks === 0) {
    items.push({ label: "JSON-LD structured data", status: "fail", detail: "No JSON-LD blocks found. Structured data is how search and AI read who you are.", fix: "Add at least one <script type=\"application/ld+json\"> block with your business information." });
  } else {
    items.push({ label: "JSON-LD structured data", status: "pass", detail: `${schema.blocks} JSON-LD block${schema.blocks > 1 ? "s" : ""} found.` });
  }

  if (schema.blocks === 0) {
    items.push({ label: "JSON-LD validity", status: "fail", detail: "No blocks to validate.", fix: "Add valid JSON-LD structured data to your page." });
  } else if (schema.invalidBlocks > 0) {
    items.push({ label: "JSON-LD validity", status: "fail", detail: `${schema.invalidBlocks} of ${schema.blocks} blocks have JSON parse errors.`, fix: "Fix the malformed JSON in your structured data blocks. Validate with Google's Rich Results Test." });
  } else {
    items.push({ label: "JSON-LD validity", status: "pass", detail: `All ${schema.blocks} block${schema.blocks > 1 ? "s" : ""} parse correctly.` });
  }

  const hasBusiness = schema.hasLocalBusiness || schema.hasLegalService || schema.hasAttorney || schema.hasOrganization;
  if (hasBusiness) {
    items.push({ label: "Business / LegalService schema", status: "pass", detail: "Business entity structured data found." });
  } else {
    items.push({ label: "Business / LegalService schema", status: "fail", detail: "No Organization, LocalBusiness, LegalService, or Attorney type found.", fix: "Add a LegalService or LocalBusiness JSON-LD block with name, address, phone, and area served." });
  }

  if (hasBusiness) {
    const want: Array<[boolean, string]> = [
      [schema.fields.name, "name"], [schema.fields.url, "url"], [schema.fields.telephone, "telephone"],
      [schema.fields.address, "address"], [schema.fields.areaServed, "areaServed"], [schema.fields.sameAs, "sameAs"],
    ];
    const missing = want.filter(([has]) => !has).map(([, k]) => k);
    if (missing.length === 0) {
      items.push({ label: "Business schema fields", status: "pass", detail: "Core fields present: name, url, telephone, address, areaServed, sameAs." });
    } else if (missing.length <= 2) {
      items.push({ label: "Business schema fields", status: "warn", detail: `Missing field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`, fix: `Add the missing JSON-LD field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.` });
    } else {
      items.push({ label: "Business schema fields", status: "fail", detail: `Several core fields missing: ${missing.join(", ")}.`, fix: `Complete the business schema with: ${missing.join(", ")}.` });
    }
  } else {
    items.push({ label: "Business schema fields", status: "fail", detail: "No business entity to evaluate fields on.", fix: "Add a LegalService or LocalBusiness block first, then populate name, address, telephone, and areaServed." });
  }

  if (schema.hasFaq) {
    items.push({ label: "FAQPage schema", status: "pass", detail: "Present. Supports FAQ readiness for search and AI answers." });
  } else {
    items.push({ label: "FAQPage schema", status: "warn", detail: "Not found. FAQ schema packages common questions for search and AI answer engines.", fix: "Add FAQPage structured data wrapping your most common client questions and answers." });
  }

  if (schema.hasReview) {
    items.push({ label: "Review / Rating schema", status: "pass", detail: "Review markup found. Supports star-rating readiness in search results." });
  } else {
    items.push({ label: "Review / Rating schema", status: "warn", detail: "Not found. Review schema can support star ratings in search results.", fix: "Add AggregateRating or Review schema for your client testimonials." });
  }

  if (schema.hasBreadcrumb) {
    items.push({ label: "Breadcrumb schema", status: "pass", detail: "Present. Helps search engines read site hierarchy." });
  } else {
    items.push({ label: "Breadcrumb schema", status: "warn", detail: "Not found. Breadcrumb markup improves site hierarchy signals.", fix: "Add BreadcrumbList JSON-LD showing the page's position in your site structure." });
  }

  if (schema.conflictingEntity) {
    items.push({ label: "Schema conflicts", status: "warn", detail: "Two or more business entity types declared. Conflicting entities can confuse parsers.", fix: "Consolidate to a single primary business entity type (for example LegalService) and reference others through it." });
  } else {
    items.push({ label: "Schema conflicts", status: "pass", detail: "No conflicting business entity declarations." });
  }

  const { score, maxScore } = scoreItems(items);
  return { name: "Schema & Structured Data", score, maxScore, items };
}

/* 4. AI Visibility */
function checkAiVisibility(html: string, parsedRobots: ParsedRobots | null, llmsTxt: string | null, schema: SchemaSummary): CategoryResult {
  const items: CheckItem[] = [];
  const bodyText = extractBodyText(html);

  if (!parsedRobots) {
    items.push({ label: "AI search bot access", status: "warn", detail: "No robots.txt found. AI crawlers can access your site, but you have no explicit policy.", fix: "Create a robots.txt that explicitly allows AI search crawlers (ChatGPT-User, PerplexityBot, ClaudeBot)." });
  } else {
    const blockedSearch = AI_SEARCH_BOTS.filter((b) => checkBotBlockedParsed(parsedRobots, b.token));
    if (blockedSearch.length === 0) {
      items.push({ label: "AI search bot access", status: "pass", detail: "All major AI search crawlers can access your site." });
    } else if (blockedSearch.length <= 2) {
      items.push({ label: "AI search bot access", status: "warn", detail: `${blockedSearch.length} AI search crawler${blockedSearch.length > 1 ? "s" : ""} blocked: ${blockedSearch.map((b) => b.label).join(", ")}.`, fix: "Unblock AI search crawlers in robots.txt. These bots cite your content in AI search results." });
    } else {
      items.push({ label: "AI search bot access", status: "fail", detail: `${blockedSearch.length} of ${AI_SEARCH_BOTS.length} AI search crawlers blocked. Your content will not surface in AI search.`, fix: "Remove Disallow rules for AI search bots (ChatGPT-User, PerplexityBot, ClaudeBot) in robots.txt." });
    }
  }

  if (!parsedRobots) {
    items.push({ label: "AI training bot control", status: "warn", detail: "No robots.txt. You have no control over AI training crawlers using your content.", fix: "Add a robots.txt with Disallow rules for training-only bots (GPTBot, CCBot) to control training use." });
  } else {
    const blockedTraining = AI_TRAINING_BOTS.filter((b) => checkBotBlockedParsed(parsedRobots, b.token));
    if (blockedTraining.length >= 3) {
      items.push({ label: "AI training bot control", status: "pass", detail: `${blockedTraining.length} training-only crawlers blocked. Deliberate control of training use.` });
    } else if (blockedTraining.length > 0) {
      items.push({ label: "AI training bot control", status: "warn", detail: `Only ${blockedTraining.length} of ${AI_TRAINING_BOTS.length} training crawlers blocked.`, fix: "Block additional training-only bots (GPTBot, CCBot, Bytespider) in robots.txt to control training use." });
    } else {
      items.push({ label: "AI training bot control", status: "warn", detail: "No training-only crawlers blocked. Your content may be used to train AI models.", fix: "Add Disallow rules for GPTBot, CCBot, and Bytespider in robots.txt if you want to control AI training use." });
    }
  }

  const orgDesc = extractMetaContent(html, "description");
  if ((schema.hasOrganization || schema.hasLocalBusiness || schema.hasLegalService) && schema.fields.name) {
    items.push({ label: "Entity description", status: "pass", detail: "A named business entity is described in structured data for AI to read." });
  } else if (orgDesc) {
    items.push({ label: "Entity description", status: "warn", detail: "A meta description exists, but no named business entity is described in structured data.", fix: "Add a LegalService or Organization schema block with a clear name and description." });
  } else {
    items.push({ label: "Entity description", status: "fail", detail: "No clear entity description for AI systems to read.", fix: "Add a structured-data entity with a name and description, and a strong meta description." });
  }

  if (schema.hasAttorney || schema.hasPerson) {
    items.push({ label: "Attorney / person schema", status: "pass", detail: "Attorney or Person schema present. Supports authorship and expertise signals." });
  } else {
    items.push({ label: "Attorney / person schema", status: "warn", detail: "No Attorney or Person schema. AI systems weight identified, credentialed authors.", fix: "Add Attorney or Person schema for the firm's lawyers, linked to the business entity." });
  }

  const h2s = extractAllTags(html, "h2");
  const h3s = extractAllTags(html, "h3");
  const questionHeadings = [...h2s, ...h3s].filter(
    (h) => h.endsWith("?") || /^(what|how|when|where|why|who|can|do|does|is|are|should|will)\b/i.test(h)
  );
  if (questionHeadings.length >= 3) {
    items.push({ label: "Question-format headings", status: "pass", detail: `${questionHeadings.length} question headings found. These match how people ask AI assistants.` });
  } else if (questionHeadings.length > 0) {
    items.push({ label: "Question-format headings", status: "warn", detail: `Only ${questionHeadings.length} question heading${questionHeadings.length > 1 ? "s" : ""}. More can help AI systems pull answers from the page.`, fix: "Reframe section headings as questions people actually ask, like \"What happens if...\" or \"How long does...\"" });
  } else {
    items.push({ label: "Question-format headings", status: "fail", detail: "No question-format headings. AI models look for Q&A patterns to extract answers.", fix: "Add H2 or H3 headings phrased as questions that match queries people type into AI search." });
  }

  const sentences = bodyText.split(/[.!?]+/).filter((s) => s.trim().length > 20);
  const directAnswers = sentences.filter((s) => /\b(is|are|means|refers to|defined as|consists of|requires|involves)\b/i.test(s));
  if (directAnswers.length >= 5) {
    items.push({ label: "Direct-answer sentences", status: "pass", detail: "Content includes clear definitional sentences that AI models can extract as answers." });
  } else if (directAnswers.length > 0) {
    items.push({ label: "Direct-answer sentences", status: "warn", detail: "Some direct-answer content found. Adding more clear definitions can help AI systems extract answers.", fix: "Write more sentences that directly answer questions: \"X is...\", \"X means...\", \"X requires...\"" });
  } else {
    items.push({ label: "Direct-answer sentences", status: "fail", detail: "No direct-answer patterns detected. AI models prefer content that directly answers questions.", fix: "Include explicit definitional sentences. Example: \"A power of attorney is a legal document that...\"" });
  }

  const anchorTags = html.match(/<a[^>]+href=["']https?:\/\/([^"']+)["']/gi) || [];
  const authoritative = anchorTags.filter((a) => /\.(gov|edu)|canlii|justice|courts?|lawsociety|cba\.org|ontario\.ca|canada\.ca/i.test(a));
  if (authoritative.length >= 1) {
    items.push({ label: "Authoritative citations", status: "pass", detail: `${authoritative.length} link${authoritative.length > 1 ? "s" : ""} to authoritative sources. Supports credibility for AI sourcing.` });
  } else {
    items.push({ label: "Authoritative citations", status: "warn", detail: "No outbound links to authoritative legal sources.", fix: "Link to government, court, or law-society resources where relevant. Corroborating links are a useful credibility signal." });
  }

  const hasAuthorMeta = extractMetaContent(html, "author") !== null;
  if (hasAuthorMeta || schema.hasPerson || schema.hasAttorney) {
    items.push({ label: "Author / reviewer signals", status: "pass", detail: "Author or reviewer attribution found. Supports source credibility for AI." });
  } else {
    items.push({ label: "Author / reviewer signals", status: "warn", detail: "No author or reviewer attribution. Identified authorship is a useful credibility signal for search and AI.", fix: "Add author metadata or Person schema, and a reviewed-by line where a lawyer has checked the content." });
  }

  if (llmsTxt && llmsTxt.length > 50) {
    items.push({ label: "llms.txt file", status: "pass", detail: "Present. Provides AI-friendly content guidance, a small positive signal." });
  } else {
    items.push({ label: "llms.txt file", status: "warn", detail: "Not found. An emerging, optional file that summarises your site for AI models.", fix: "Optionally add a /llms.txt with a short Markdown summary of your site and key URLs. Low priority." });
  }

  const semanticTags = ["<header", "<nav", "<main", "<article", "<section", "<footer"];
  const foundSemantic = semanticTags.filter((tag) => html.toLowerCase().includes(tag));
  if (foundSemantic.length >= 4) {
    items.push({ label: "Semantic HTML structure", status: "pass", detail: `${foundSemantic.length} semantic elements found. Helps AI parse page structure.` });
  } else if (foundSemantic.length >= 2) {
    items.push({ label: "Semantic HTML structure", status: "warn", detail: `Only ${foundSemantic.length} semantic elements. More helps AI parse content structure.`, fix: "Use semantic tags: <header>, <nav>, <main>, <article>, <section>, <footer>." });
  } else {
    items.push({ label: "Semantic HTML structure", status: "fail", detail: "Minimal semantic HTML. AI models struggle to parse div-only pages.", fix: "Use semantic HTML elements instead of generic containers." });
  }

  const { score, maxScore } = scoreItems(items);
  return { name: "AI Visibility", score, maxScore, items };
}

/* 5. Legal Marketing */
function checkLegalMarketing(signals: LawFirmSignals): CategoryResult {
  const items: CheckItem[] = [];

  items.push(signals.phoneVisible
    ? { label: "Phone number visible", status: "pass", detail: "A phone number is visible on the page." }
    : { label: "Phone number visible", status: "fail", detail: "No phone number found. Intake depends on an obvious way to call.", fix: "Show the firm's phone number in the header and footer of every page." });

  items.push(signals.contactFormPresent
    ? { label: "Contact form / direct contact", status: "pass", detail: "A contact form or direct email path is present." }
    : { label: "Contact form / direct contact", status: "warn", detail: "No on-page contact form or email link found.", fix: "Add a short contact form or a clear email link so visitors can reach the firm without leaving the page." });

  items.push(signals.consultationCta
    ? { label: "Consultation call to action", status: "pass", detail: "A consultation or contact call to action is present." }
    : { label: "Consultation call to action", status: "fail", detail: "No clear consultation call to action. Ready-to-act visitors have no obvious next step.", fix: "Add a prominent call to action such as \"Book a consultation\" near the top of the page." });

  items.push(signals.addressVisible
    ? { label: "Address / NAP", status: "pass", detail: "A street address is visible." }
    : { label: "Address / NAP", status: "warn", detail: "No street address detected. NAP consistency supports local trust and search.", fix: "Show the firm's full address in the footer and on the contact page." });

  const trust = signals.trust;
  const trustCount = [trust.testimonials, trust.reviews, trust.caseResults, trust.awards, trust.credentials].filter(Boolean).length;
  if (trustCount >= 3) {
    items.push({ label: "Trust signals", status: "pass", detail: `${trustCount} of 5 trust signal types present (testimonials, reviews, results, awards, credentials).` });
  } else if (trustCount >= 1) {
    items.push({ label: "Trust signals", status: "warn", detail: `Only ${trustCount} of 5 trust signal types found. Trust cues lift intake conversion.`, fix: "Surface testimonials, reviews, notable results, awards, and bar credentials where visitors can see them." });
  } else {
    items.push({ label: "Trust signals", status: "fail", detail: "No trust signals found (testimonials, reviews, results, awards, credentials).", fix: "Add client testimonials, review counts, and bar credentials. These cues carry intake decisions." });
  }

  items.push(signals.practiceAreaIntent
    ? { label: "Practice-area intent", status: "pass", detail: "Content clearly signals legal practice areas." }
    : { label: "Practice-area intent", status: "warn", detail: "Content does not clearly state practice areas.", fix: "State the firm's practice areas plainly in headings and body copy." });

  items.push(signals.policyPagePresent
    ? { label: "Policy / disclaimer pages", status: "pass", detail: "Privacy, terms, or disclaimer links are present." }
    : { label: "Policy / disclaimer pages", status: "warn", detail: "No privacy, terms, or disclaimer link found.", fix: "Add privacy policy and disclaimer pages, linked in the footer. Expected for a professional firm site." });

  const { score, maxScore } = scoreItems(items);
  return { name: "Legal Marketing", score, maxScore, items };
}

/* 6. Local SEO */
function checkLocalSeo(html: string, schema: SchemaSummary): CategoryResult {
  const items: CheckItem[] = [];
  const bodyText = html.replace(/<[^>]+>/g, " ");

  items.push(PHONE_RE.test(bodyText)
    ? { label: "Phone number (NAP)", status: "pass", detail: "Phone number found on page." }
    : { label: "Phone number (NAP)", status: "fail", detail: "No phone number found. Local SEO depends on visible NAP.", fix: "Add the firm's phone number to the header or footer." });

  items.push(ADDRESS_RE.test(bodyText)
    ? { label: "Street address (NAP)", status: "pass", detail: "Physical address found on page." }
    : { label: "Street address (NAP)", status: "warn", detail: "No street address detected. A physical address strengthens local ranking.", fix: "Add the full street address to the footer or contact page." });

  items.push(/google\.com\/maps|maps\.googleapis\.com|gmp-map/i.test(html)
    ? { label: "Google Maps embed", status: "pass", detail: "Maps integration found." }
    : { label: "Google Maps embed", status: "warn", detail: "No Google Maps embed. A map reinforces location authority.", fix: "Embed a Google Map showing the office location." });

  items.push((schema.fields.telephone || schema.fields.address)
    ? { label: "NAP in structured data", status: "pass", detail: "Contact info found in JSON-LD." }
    : { label: "NAP in structured data", status: "fail", detail: "No NAP in structured data.", fix: "Add telephone, address, and name to a LocalBusiness or LegalService schema block." });

  // maps/dir directions links embed the firm's Google place ID, so they tie
  // the site to its GBP entity just like a maps/place link does. Field case
  // marathonlaw.ca: two /maps/dir/ office links were on the page yet the
  // finding claimed no GBP link at all.
  items.push((/google\.com\/(maps\/(place|dir)|search\?.*business|business)/i.test(html) || /g\.page\//i.test(html) || /maps\.app\.goo\.gl|goo\.gl\/maps/i.test(html))
    ? { label: "Google Business Profile link", status: "pass", detail: "GBP link found. Cross-linking strengthens local authority." }
    : { label: "Google Business Profile link", status: "warn", detail: "No link to Google Business Profile.", fix: "Link to the firm's Google Business Profile in the footer or contact section." });

  const { score, maxScore } = scoreItems(items);
  return { name: "Local SEO", score, maxScore, items };
}

/* 7. Technical & Security */
function checkTechnicalSecurity(html: string, url: string, headers: Headers): CategoryResult {
  const items: CheckItem[] = [];

  items.push(url.startsWith("https://")
    ? { label: "HTTPS", status: "pass", detail: "Site loads over HTTPS." }
    : { label: "HTTPS", status: "fail", detail: "Site loads over HTTP. Google penalises non-HTTPS sites.", fix: "Install an SSL certificate and redirect all HTTP traffic to HTTPS." });

  const httpResources = html.match(/(?:src|href)=["']http:\/\//gi) || [];
  items.push(httpResources.length === 0
    ? { label: "Mixed content", status: "pass", detail: "No insecure HTTP resources detected." }
    : { label: "Mixed content", status: "warn", detail: `${httpResources.length} HTTP resource${httpResources.length > 1 ? "s" : ""} on an HTTPS page.`, fix: "Change all http:// resource URLs to https:// or use protocol-relative URLs." });

  const hsts = headers.get("strict-transport-security");
  if (hsts) {
    const maxAge = parseInt(hsts.match(/max-age=(\d+)/)?.[1] || "0");
    items.push(maxAge >= 31536000
      ? { label: "HSTS header", status: "pass", detail: "Present with max-age of at least one year." }
      : { label: "HSTS header", status: "warn", detail: `Present but max-age is low (${maxAge}s). Recommended: at least 31536000.`, fix: "Set Strict-Transport-Security: max-age=31536000; includeSubDomains." });
  } else {
    items.push({ label: "HSTS header", status: "warn", detail: "Missing. HSTS tells browsers to always use HTTPS.", fix: "Add Strict-Transport-Security: max-age=31536000; includeSubDomains to response headers." });
  }

  const xcto = headers.get("x-content-type-options");
  items.push(xcto?.toLowerCase() === "nosniff"
    ? { label: "X-Content-Type-Options", status: "pass", detail: "Set to nosniff." }
    : { label: "X-Content-Type-Options", status: "warn", detail: "Missing or incorrect. Prevents MIME-type sniffing.", fix: "Add X-Content-Type-Options: nosniff to response headers." });

  const csp = headers.get("content-security-policy");
  items.push(csp
    ? { label: "Content-Security-Policy", status: "pass", detail: "Present. Reduces the risk of injection attacks." }
    : { label: "Content-Security-Policy", status: "warn", detail: "Missing. CSP helps prevent cross-site scripting.", fix: "Configure a Content-Security-Policy header, starting in report-only mode." });

  items.push(/<meta[^>]+name=["']viewport["']/i.test(html)
    ? { label: "Viewport meta tag", status: "pass", detail: "Present. Required for mobile rendering." }
    : { label: "Viewport meta tag", status: "fail", detail: "Missing. Without it, the site renders at desktop width on mobile.", fix: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">." });

  const encoding = headers.get("content-encoding");
  items.push(encoding && /gzip|br|deflate/i.test(encoding)
    ? { label: "Compression", status: "pass", detail: `${encoding.toUpperCase()} compression active.` }
    : { label: "Compression", status: "warn", detail: "No compression detected. Gzip or Brotli reduces transfer size.", fix: "Enable gzip or Brotli compression for text resources." });

  const { score, maxScore } = scoreItems(items);
  return { name: "Technical & Security", score, maxScore, items };
}

/* 8. Performance */
function checkPerformance(html: string, ttfbMs: number, pageHostname: string): CategoryResult {
  const items: CheckItem[] = [];

  if (ttfbMs === 0) {
    items.push({ label: "Time to first byte", status: "warn", detail: "Could not measure response time for this page.", fix: "Improve TTFB with caching, a CDN, or faster hosting." });
  } else {
    const ttfbRound = Math.round(ttfbMs);
    if (ttfbMs < 400) items.push({ label: "Time to first byte", status: "pass", detail: `Fast (${ttfbRound}ms).` });
    else if (ttfbMs < 900) items.push({ label: "Time to first byte", status: "warn", detail: `Moderate (${ttfbRound}ms).`, fix: "Improve TTFB with caching, a CDN, or faster hosting." });
    else items.push({ label: "Time to first byte", status: "fail", detail: `Slow (${ttfbRound}ms).`, fix: "Investigate server response time: caching, CDN, hosting upgrade." });
  }

  const htmlSizeKb = Math.round(html.length / 1024);
  if (htmlSizeKb <= 150) items.push({ label: "HTML document size", status: "pass", detail: `${htmlSizeKb} KB.` });
  else if (htmlSizeKb <= 350) items.push({ label: "HTML document size", status: "warn", detail: `${htmlSizeKb} KB. Consider reducing inline styles or scripts.`, fix: "Move large inline CSS and JavaScript to external files." });
  else items.push({ label: "HTML document size", status: "fail", detail: `${htmlSizeKb} KB. Oversized HTML slows rendering.`, fix: "Reduce HTML size by externalising CSS/JS and removing unused markup." });

  const headHtml = html.match(/<head[\s\S]*?<\/head>/i)?.[0] || "";
  const blockingScripts = (headHtml.match(/<script(?![^>]*(?:async|defer|type=["']module["']))[^>]*src=/gi) || []).length;
  const blockingStyles = (headHtml.match(/<link[^>]+rel=["']stylesheet["'](?![^>]*media=["'](?:print|none))/gi) || []).length;
  const totalBlocking = blockingScripts + blockingStyles;
  if (totalBlocking === 0) items.push({ label: "Render-blocking resources", status: "pass", detail: "No render-blocking scripts or stylesheets in <head>." });
  else if (totalBlocking <= 4) items.push({ label: "Render-blocking resources", status: "warn", detail: `${totalBlocking} render-blocking resource${totalBlocking > 1 ? "s" : ""} in <head>.`, fix: "Add async or defer to scripts. Use media=\"print\" for non-critical stylesheets." });
  else items.push({ label: "Render-blocking resources", status: "fail", detail: `${totalBlocking} render-blocking resources in <head>.`, fix: "Defer scripts and load non-critical stylesheets asynchronously." });

  const allScripts = html.match(/<script[^>]+src=["']([^"']+)["']/gi) || [];
  const thirdPartyDomains = new Set<string>();
  for (const tag of allScripts) {
    const src = tag.match(/src=["']([^"']+)["']/i)?.[1];
    if (src) {
      try {
        const u = new URL(src, `https://${pageHostname}`);
        const scriptHost = u.hostname.replace(/^www\./, "");
        if (scriptHost !== pageHostname) thirdPartyDomains.add(scriptHost);
      } catch { /* skip */ }
    }
  }
  const tpCount = thirdPartyDomains.size;
  if (tpCount <= 4) items.push({ label: "Third-party scripts", status: "pass", detail: `${tpCount} external script domain${tpCount !== 1 ? "s" : ""}.` });
  else if (tpCount <= 9) items.push({ label: "Third-party scripts", status: "warn", detail: `${tpCount} external script domains.`, fix: "Audit third-party scripts. Remove unused ones and defer the rest." });
  else items.push({ label: "Third-party scripts", status: "fail", detail: `${tpCount} external script domains.`, fix: "Reduce to under 5 external domains. Remove unused trackers." });

  const { score, maxScore } = scoreItems(items);
  return { name: "Performance", score, maxScore, items };
}

/* 9. Links & Content */
function checkLinksContent(html: string, pageHostname: string): CategoryResult {
  const items: CheckItem[] = [];
  const bodyText = extractBodyText(html);
  const words = countWords(bodyText);

  if (words >= 300) items.push({ label: "Word count", status: "pass", detail: `${words.toLocaleString()} words.` });
  else if (words >= 200) items.push({ label: "Word count", status: "warn", detail: `${words} words. Thin content may rank poorly.`, fix: "Expand to at least 300 words of substantive content." });
  else items.push({ label: "Word count", status: "fail", detail: `${words} words. Very thin content signals low value.`, fix: "Add substantive content: services, common questions, process." });

  const headingPattern = /<h([1-6])[^>]*>/gi;
  const headingLevels: number[] = [];
  let hm;
  while ((hm = headingPattern.exec(html)) !== null) headingLevels.push(parseInt(hm[1]));
  let skipped = false;
  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] > headingLevels[i - 1] + 1) { skipped = true; break; }
  }
  if (headingLevels.length === 0) items.push({ label: "Heading hierarchy", status: "fail", detail: "No headings found.", fix: "Add an H1, then H2 and H3 sections in order." });
  else if (skipped) items.push({ label: "Heading hierarchy", status: "warn", detail: "Heading levels are skipped (for example H1 then H3).", fix: "Use sequential heading levels without skipping." });
  else items.push({ label: "Heading hierarchy", status: "pass", detail: "Heading levels follow a proper sequence." });

  const anchorTags = html.match(/<a[^>]+href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi) || [];
  let internalCount = 0;
  let externalCount = 0;
  const genericAnchors: string[] = [];
  for (const tag of anchorTags) {
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    const textMatch = tag.match(/>([\s\S]*?)<\/a>/i);
    const href = hrefMatch?.[1] || "";
    const text = (textMatch?.[1] || "").replace(/<[^>]+>/g, "").trim().toLowerCase();
    if (href.startsWith("/") || href.startsWith("#") || href.startsWith("./")) internalCount++;
    else if (href.startsWith("http")) {
      try {
        const linkHost = new URL(href).hostname.replace(/^www\./, "");
        if (linkHost === pageHostname) internalCount++; else externalCount++;
      } catch { /* skip */ }
    }
    if (text && GENERIC_ANCHORS.has(text)) genericAnchors.push(text);
  }

  if (internalCount >= 3) items.push({ label: "Internal links", status: "pass", detail: `${internalCount} internal links found.` });
  else if (internalCount > 0) items.push({ label: "Internal links", status: "warn", detail: `Only ${internalCount} internal link${internalCount > 1 ? "s" : ""}.`, fix: "Link to related pages: practice areas, about, contact." });
  else items.push({ label: "Internal links", status: "fail", detail: "No internal links detected.", fix: "Add links to your other pages." });

  const ratio = html.length > 0 ? Math.round((bodyText.length / html.length) * 100) : 0;
  if (ratio >= 15) items.push({ label: "Content-to-HTML ratio", status: "pass", detail: `${ratio}% text content.` });
  else if (ratio >= 8) items.push({ label: "Content-to-HTML ratio", status: "warn", detail: `${ratio}% text content. Page is heavy on code.`, fix: "Add more text relative to markup; remove unused code." });
  else items.push({ label: "Content-to-HTML ratio", status: "fail", detail: `${ratio}% text content. Very code-heavy page.`, fix: "Add substantive text content." });

  if (genericAnchors.length === 0) items.push({ label: "Anchor text quality", status: "pass", detail: "Links use descriptive text." });
  else if (genericAnchors.length <= 2) items.push({ label: "Anchor text quality", status: "warn", detail: `${genericAnchors.length} link${genericAnchors.length > 1 ? "s" : ""} with generic text.`, fix: "Replace \"click here\" and \"learn more\" with descriptive text." });
  else items.push({ label: "Anchor text quality", status: "fail", detail: `${genericAnchors.length} links with generic text.`, fix: "Replace generic links with descriptive anchor text." });

  items.push(externalCount >= 1
    ? { label: "External links", status: "pass", detail: `${externalCount} outbound link${externalCount > 1 ? "s" : ""} found.` }
    : { label: "External links", status: "warn", detail: "No outbound links. Links to authoritative sources add credibility.", fix: "Link to relevant external resources: government, law society, courts." });

  const { score, maxScore } = scoreItems(items);
  return { name: "Links & Content", score, maxScore, items };
}

/* ────────────────────────────────────────────────────────
   Page assembly
   ──────────────────────────────────────────────────────── */

function buildIndexability(
  html: string,
  headers: Headers,
  finalUrl: string,
  requestedUrl: string,
  redirectHops: number,
  domain: string,
  sitemapSet: Set<string> | null
): Indexability {
  const metaRobots = (extractMetaContent(html, "robots") || "").toLowerCase();
  const xRobots = (headers.get("x-robots-tag") || "").toLowerCase();
  const metaNoindex = metaRobots.includes("noindex");
  const metaNofollow = metaRobots.includes("nofollow");
  const headerNoindex = xRobots.includes("noindex");
  const headerNofollow = xRobots.includes("nofollow");

  const canonicalRaw = extractCanonical(html);
  let canonical: string | null = null;
  let canonicalSelf: boolean | null = null;
  let canonicalSameOrigin: boolean | null = null;
  if (canonicalRaw) {
    canonical = canonicalRaw;
    try {
      const cu = new URL(canonicalRaw, finalUrl);
      cu.hash = "";
      const fu = new URL(finalUrl); fu.hash = "";
      canonicalSelf = cu.href.replace(/\/$/, "") === fu.href.replace(/\/$/, "");
      canonicalSameOrigin = isSameOrigin(cu.href, domain);
    } catch { canonicalSelf = null; canonicalSameOrigin = null; }
  }

  const noindex = metaNoindex || headerNoindex;
  const mixedSignals = (noindex && !!canonicalRaw) || canonicalSameOrigin === false;

  let inSitemap: boolean | null = null;
  if (sitemapSet && sitemapSet.size > 0) {
    // sitemapSet is keyed with the same canonical crawl key used for dedupe.
    inSitemap = sitemapSet.has(crawlUrlKey(finalUrl));
    // The homepage never depends on a sitemap listing for discovery, and some
    // platforms list it under an alias slug rather than the root (Squarespace
    // lists /home while serving the site at /, field case marathonlaw.ca).
    // Reporting "homepage not listed in the sitemap" is noise, so the root
    // path always counts as covered.
    if (!inSitemap) {
      try { if ((new URL(finalUrl).pathname || "/") === "/") inSitemap = true; } catch { /* keep computed value */ }
    }
  }

  return {
    httpStatus: 200,
    redirected: redirectHops > 0 || finalUrl !== requestedUrl,
    redirectHops,
    canonical,
    canonicalSelf,
    canonicalSameOrigin,
    metaNoindex,
    metaNofollow,
    headerNoindex,
    headerNofollow,
    indexable: !noindex,
    inSitemap,
    mixedSignals,
  };
}

function robotsAllowedFor(parsedRobots: ParsedRobots | null, path: string): { scanner: boolean; google: boolean; bing: boolean } {
  if (!parsedRobots) return { scanner: true, google: true, bing: true };
  return {
    scanner: !checkBotBlockedParsed(parsedRobots, SCANNER_TOKEN, path),
    google: !checkBotBlockedParsed(parsedRobots, "Googlebot", path),
    bing: !checkBotBlockedParsed(parsedRobots, "Bingbot", path),
  };
}

function buildPageResult(
  html: string,
  finalUrl: string,
  requestedUrl: string,
  headers: Headers,
  ttfbMs: number,
  redirectHops: number,
  domain: string,
  parsedRobots: ParsedRobots | null,
  llmsTxt: string | null,
  sitemapSet: Set<string> | null,
  intent: NormalizedIntent | null
): PageResult {
  const pageHostname = new URL(finalUrl).hostname.replace(/^www\./, "");
  const rawPageTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;
  const title = rawPageTitle ? decodeHtmlEntities(rawPageTitle) : null;
  const pageType = classifyPageType(finalUrl);

  const schema = extractSchemaSummary(html);
  const lawFirm = extractLawFirmSignals(html, schema);
  const idx = buildIndexability(html, headers, finalUrl, requestedUrl, redirectHops, domain, sitemapSet);
  const bodyText = extractBodyText(html);
  const wordCount = countWords(bodyText);
  const rendering = analyzeRenderingSnapshot(html, wordCount);
  const pageAudit = buildPageAuditSnapshot(html);
  const intentAlignment = intent
    ? analyzePageIntent({ html, url: finalUrl, title, wordCount, schemaTypes: schema.types, intent })
    : undefined;
  const path = (() => { try { return new URL(finalUrl).pathname || "/"; } catch { return "/"; } })();
  const robotsAllowed = robotsAllowedFor(parsedRobots, path);

  const categories: CategoryResult[] = [
    checkOnPageSeo(html),
    checkIndexability(idx, robotsAllowed),
    checkSchemaMarkup(schema),
    checkAiVisibility(html, parsedRobots, llmsTxt, schema),
    checkLegalMarketing(lawFirm),
    checkLocalSeo(html, schema),
    checkTechnicalSecurity(html, finalUrl, headers),
    buildRenderingCategory(rendering),
    checkPerformance(html, ttfbMs, pageHostname),
    checkLinksContent(html, pageHostname),
  ];
  const intentCategory = buildIntentCategory(intentAlignment ?? null);
  if (intentCategory) categories.push(intentCategory);

  const pageScore = computeWeightedScore(categories);
  const pageGrade = computeGrade(pageScore);

  const aiCat = categories.find((c) => c.name === "AI Visibility");
  const aiVisibilityScore = aiCat && aiCat.maxScore > 0 ? Math.round((aiCat.score / aiCat.maxScore) * 100) : 0;

  const allItems = categories.flatMap((c) => c.items);
  const failCount = allItems.filter((i) => i.status === "fail").length;
  const warnCount = allItems.filter((i) => i.status === "warn").length;
  const keyWarnings = allItems.filter((i) => i.status === "fail").slice(0, 3).map((i) => i.label);

  return {
    url: finalUrl,
    title,
    metaDescription: pageAudit.metaDescription,
    pageType,
    pageScore,
    pageGrade,
    aiVisibilityScore,
    categories,
    failCount,
    warnCount,
    httpStatus: idx.httpStatus,
    indexable: idx.indexable,
    indexability: idx,
    schema,
    lawFirm,
    wordCount,
    rendering,
    pageAudit,
    intentAlignment,
    keyWarnings,
  };
}

async function scanPage(
  url: string,
  domain: string,
  parsedRobots: ParsedRobots | null,
  llmsTxt: string | null,
  sitemapSet: Set<string> | null,
  intent: NormalizedIntent | null
): Promise<{ page: PageResult; html: string } | null> {
  let handle: SafeFetchResult | null = null;
  try {
    const t0 = Date.now();
    handle = await safeFetch(url, 12000);
    const ttfbMs = Date.now() - t0;
    const { res, finalUrl, redirectHops } = handle;
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html") && !ct.includes("xhtml")) return null;
    const read = await readCappedText(res, MAX_HTML_BYTES);
    if (!read.ok) return null;
    const page = buildPageResult(read.text, finalUrl, url, res.headers, ttfbMs, redirectHops, domain, parsedRobots, llmsTxt, sitemapSet, intent);
    return { page, html: read.text };
  } catch { return null; }
  finally { handle?.cleanup(); }
}

/* ────────────────────────────────────────────────────────
   Site aggregation (backward-compatible categories + AI scores)
   ──────────────────────────────────────────────────────── */

function computeTopFixes(pages: PageResult[], limit: number): TopFix[] {
  const fixMap = new Map<string, { status: "warn" | "fail"; category: string; fix?: string; pagesAffected: Set<string> }>();
  for (const page of pages) {
    for (const cat of page.categories) {
      for (const item of cat.items) {
        if (item.status === "pass") continue;
        const key = `${cat.name}::${item.label}`;
        const existing = fixMap.get(key);
        if (!existing) fixMap.set(key, { status: item.status, category: cat.name, fix: item.fix, pagesAffected: new Set([page.url]) });
        else { existing.pagesAffected.add(page.url); if (item.status === "fail") existing.status = "fail"; }
      }
    }
  }
  return [...fixMap.entries()]
    .map(([key, v]) => ({ label: key.split("::")[1], category: v.category, status: v.status, fix: v.fix, pagesAffected: v.pagesAffected.size, totalPages: pages.length }))
    .sort((a, b) => { if (a.status !== b.status) return a.status === "fail" ? -1 : 1; return b.pagesAffected - a.pagesAffected; })
    .slice(0, limit);
}

function aggregateCategories(pages: PageResult[]): CategoryResult[] {
  const catNames = pages[0].categories.map((c) => c.name);
  return catNames.map((name) => {
    const pageCats = pages.map((p) => p.categories.find((c) => c.name === name)).filter((c): c is CategoryResult => !!c);
    const avgPct = pageCats.length > 0
      ? pageCats.reduce((sum, c) => sum + (c.maxScore > 0 ? c.score / c.maxScore : 0), 0) / pageCats.length
      : 0;
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
        else if (affected === pages.length) detail += ` (all ${pages.length} pages)`;
      }
      return { label, status, detail, fix: representative.fix };
    });
    const maxScore = items.length * 10;
    const score = Math.round(avgPct * maxScore);
    return { name, score, maxScore, items };
  });
}

/* ────────────────────────────────────────────────────────
   Bounded BFS crawl
   ──────────────────────────────────────────────────────── */

const DEPTH_BY_BUDGET = (maxPages: number): number => (maxPages <= 10 ? 2 : maxPages <= 25 ? 3 : 4);
const FANOUT_PER_PAGE = 30;
const FRONTIER_CAP = 600;

// Dedupe / membership key. URL already lowercases scheme + host; we strip the
// fragment and a trailing slash but PRESERVE path and query case, because URL
// paths can be case-sensitive and this key is also reused as a fetch URL.
/* ────────────────────────────────────────────────────────
   POST handler
   ──────────────────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawDomain = body?.domain;

    // Only operators may request standard/deep scans or large page budgets.
    // Unauthenticated (public lead-magnet) callers are capped to quick mode and
    // rate-limited, since each scan is an expensive arbitrary-domain crawl.
    const operatorSession = await getOperatorSession();
    const isOperator = !!operatorSession;
    if (!isOperator) {
      const decision = await checkRateLimit("seoCheck", ipFromRequest(req));
      if (!decision.ok) {
        return NextResponse.json(
          { error: "Too many scans from this network. Try again in a few minutes." },
          { status: 429, headers: rateLimitHeaders(decision) }
        );
      }
    }

    let { scanMode, maxPages } = resolveScan({ maxPages: body?.maxPages, scanMode: body?.scanMode });
    if (!isOperator) {
      scanMode = "quick";
      maxPages = Math.min(maxPages, SCAN_MODE_DEFAULTS.quick);
    }

    if (!rawDomain || typeof rawDomain !== "string") {
      return NextResponse.json({ error: "Domain is required." }, { status: 400 });
    }
    const intent = isOperator ? normalizeIntentInput({
      targetKeyword: body?.targetKeyword,
      targetMatter: body?.targetMatter,
      targetLocation: body?.targetLocation,
      targetAudience: body?.targetAudience,
    }) : null;
    const domain = normalizeDomain(rawDomain);
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
      return NextResponse.json({ error: "Invalid domain format." }, { status: 400 });
    }
    if (isSsrfBlocked(domain)) {
      return NextResponse.json({ error: "That domain cannot be checked." }, { status: 400 });
    }

    // Overall wall-clock budget so deep crawls return partial results instead of
    // hitting the function ceiling with nothing.
    const startedAt = Date.now();
    const CRAWL_BUDGET_MS = 230_000;

    const homeUrl = `https://${domain}`;

    const [robotsRaw, llmsTxt] = await Promise.all([
      safeResource(`https://${domain}/robots.txt`, 5000),
      safeResource(`https://${domain}/llms.txt`, 5000),
    ]);
    const parsedRobots = robotsRaw ? parseRobotsTxt(robotsRaw) : null;

    // Collect sitemap URLs (default location + same-origin robots-declared).
    // Two structures on purpose: the KEY SET answers "is this page listed in
    // the sitemap" (membership must be normalization-insensitive), while the
    // RAW URL LIST feeds the crawl frontier. Field bug (marathonlaw.ca): the
    // frontier was fed the keys, which are scheme-less (host/path), so
    // new URL() threw inside enqueue and every sitemap-only URL was silently
    // dropped: sitemap discovery contributed nothing to any crawl.
    const sitemapUrls = new Set<string>();
    const sitemapRawUrls: string[] = [];
    const collectSitemapUrl = (u: string) => {
      const key = crawlUrlKey(u);
      if (!sitemapUrls.has(key)) {
        sitemapUrls.add(key);
        sitemapRawUrls.push(u);
      }
    };
    for (const u of await fetchSitemapUrls(`https://${domain}/sitemap.xml`, domain)) collectSitemapUrl(u);
    if (parsedRobots) {
      const sameOriginSitemaps = parsedRobots.sitemaps.filter((s) => isSameOrigin(s, domain)).slice(0, 3);
      for (const sm of sameOriginSitemaps) {
        for (const u of await fetchSitemapUrls(sm, domain)) collectSitemapUrl(u);
      }
    }
    const sitemapSet = sitemapUrls.size > 0 ? sitemapUrls : null;

    // Scan homepage first.
    let homePage: PageResult;
    let homeHtml: string;
    let homeHandle: SafeFetchResult | null = null;
    try {
      const t0 = Date.now();
      homeHandle = await safeFetch(homeUrl, 15000);
      const { res, finalUrl, redirectHops } = homeHandle;
      const ttfbMs = Date.now() - t0;
      if (!res.ok) {
        return NextResponse.json({ error: `Could not reach ${domain} (HTTP ${res.status}). Check the domain and try again.` }, { status: 422 });
      }
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("html") && !ct.includes("xhtml")) {
        return NextResponse.json({ error: `${domain} returned a non-HTML response. Only websites can be checked.` }, { status: 422 });
      }
      const read = await readCappedText(res, MAX_HTML_BYTES);
      if (!read.ok) {
        const error = read.reason === "too_large"
          ? `${domain} returned a page that is too large to scan.`
          : `${domain} took too long to respond or closed the connection. Try again in a moment.`;
        return NextResponse.json({ error }, { status: 422 });
      }
      homeHtml = read.text;
      homePage = buildPageResult(read.text, finalUrl, homeUrl, res.headers, ttfbMs, redirectHops, domain, parsedRobots, llmsTxt, sitemapSet, intent);
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

    const pages: PageResult[] = [homePage];
    let partial = false;

    // Count of same-origin links the homepage's OWN server HTML links to.
    // Feeds discoveryConfidence: a site with near-zero on-page links and no
    // sitemap safety net cannot be reliably crawled, so absence findings
    // ("no practice pages", "no team page") get downgraded rather than
    // reported at full confidence.
    let homeInternalLinkCount = 0;

    if (maxPages > 1) {
      const maxDepth = DEPTH_BY_BUDGET(maxPages);
      const visited = new Set<string>([crawlUrlKey(homePage.url), crawlUrlKey(homeUrl)]);
      // Frontier of candidate URLs with crawl depth.
      const frontier: Array<{ url: string; depth: number; score: number }> = [];
      const enqueue = (url: string, depth: number) => {
        if (frontier.length >= FRONTIER_CAP) return;
        const key = crawlUrlKey(url);
        if (visited.has(key)) return;
        if (!isSameOrigin(url, domain) || shouldSkipUrl(url)) return;
        // Respect robots for our own scanner on discovered pages.
        if (parsedRobots) {
          try { if (checkBotBlockedParsed(parsedRobots, SCANNER_TOKEN, new URL(url).pathname)) return; } catch { return; }
        }
        if (frontier.some((f) => crawlUrlKey(f.url) === key)) return;
        frontier.push({ url, depth, score: scoreUrlPriority(url) });
      };

      const homeLinks = extractInternalLinks(homeHtml, homePage.url, domain);
      homeInternalLinkCount = homeLinks.length;
      for (const u of homeLinks) enqueue(u, 1);
      for (const u of sitemapRawUrls) enqueue(u, 1);

      while (pages.length < maxPages && frontier.length > 0) {
        // Stop early (with partial results) if the wall-clock budget is spent.
        if (Date.now() - startedAt > CRAWL_BUDGET_MS) { partial = true; break; }
        // Pick the highest-priority candidate.
        let bestIdx = 0;
        for (let i = 1; i < frontier.length; i++) if (frontier[i].score > frontier[bestIdx].score) bestIdx = i;
        const next = frontier.splice(bestIdx, 1)[0];
        const key = crawlUrlKey(next.url);
        if (visited.has(key)) continue;
        visited.add(key);

        const scanned = await scanPage(next.url, domain, parsedRobots, llmsTxt, sitemapSet, intent);
        if (!scanned) continue;
        visited.add(crawlUrlKey(scanned.page.url));
        pages.push(scanned.page);

        // Expand discovery from this page if depth allows.
        if (next.depth < maxDepth) {
          for (const u of extractInternalLinks(scanned.html, scanned.page.url, domain)) enqueue(u, next.depth + 1);
        }
      }
    }

    // Backward-compatible aggregation.
    const aggregatedCategories = aggregateCategories(pages);
    const overallScore = computeWeightedScore(aggregatedCategories);
    const grade = computeGrade(overallScore);

    const perPageAi = pages.map((p) => {
      const ai = p.categories.find((c) => c.name === "AI Visibility");
      return aiScoresFromItems(ai ? ai.items : []);
    });
    const aiSearchScore = perPageAi.length > 0 ? Math.round(perPageAi.reduce((s, a) => s + a.search, 0) / perPageAi.length) : 0;
    const aiPolicyScore = perPageAi.length > 0 ? Math.round(perPageAi.reduce((s, a) => s + a.policy, 0) / perPageAi.length) : 50;

    const aiBots: AiBotStatus[] = [
      ...AI_SEARCH_BOTS.map((b) => ({ name: b.label, blocked: parsedRobots ? checkBotBlockedParsed(parsedRobots, b.token) : false, category: "search" as const })),
      ...AI_TRAINING_BOTS.map((b) => ({ name: b.label, blocked: parsedRobots ? checkBotBlockedParsed(parsedRobots, b.token) : false, category: "training" as const })),
    ];
    const intentAlignment = aggregateIntentAlignment(pages);
    const renderingSummary = aggregateRenderingSummary(pages);

    const topFixes = computeTopFixes(pages, 5);

    // Professional layer.
    const discoveryConfidence = computeDiscoveryConfidence(pages.length, sitemapSet?.size ?? 0, homeInternalLinkCount, maxPages);
    const pageIssues = buildIssues(pages);
    const structureIssues = buildSiteStructureIssues(pages, !!sitemapSet, parsedRobots, discoveryConfidence);
    const issues = [...pageIssues, ...structureIssues].sort(compareIssuesByPriority);
    const internalSummary = buildInternalSummary(pages, issues, overallScore, aiSearchScore);
    const breakdown = severityBreakdown(issues);

    // The internal prospecting layer (summary + per-issue internal notes and
    // outreach angles) is operator-only. Strip it from public responses so it
    // does not leak through the raw API to a prospect inspecting the network
    // tab, matching the UI's showInternal gate.
    const responseIssues = isOperator
      ? issues
      : issues.map(({ internalNote, prospectingAngle, ...rest }) => rest);

    const result: SeoCheckResult = {
      domain,
      scanMode,
      pagesScanned: pages.length,
      pages,
      categories: aggregatedCategories,
      overallScore,
      grade,
      aiSearchScore,
      aiSearchGrade: computeGrade(aiSearchScore),
      aiPolicyScore,
      aiPolicyGrade: computeGrade(aiPolicyScore),
      aiBots,
      ...(intentAlignment ? { intentAlignment } : {}),
      ...(renderingSummary ? { renderingSummary } : {}),
      topFixes,
      issues: responseIssues,
      ...(isOperator ? { internalSummary } : {}),
      severityBreakdown: breakdown,
      partial,
      discoveryConfidence,
      buildSha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      checkedAt: new Date().toISOString(),
    };

    // Auto-save every operator scan, so it is recoverable without the
    // operator remembering to click "Save this scan" on the report. See
    // save-run.ts for why the manual button still exists alongside this.
    if (isOperator) {
      await saveSeoCheckRunBestEffort(result as unknown as Record<string, unknown>, operatorSession?.lawyer_id || null);
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
