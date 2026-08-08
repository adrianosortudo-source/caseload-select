/**
 * /api/tools/seo-check
 *
 * Bounded professional SEO + AI visibility diagnostic. Crawls a law-firm site
 * (scan modes: quick 10 / standard 25 / deep 50, hard cap 75), runs per-page
 * analyzers across nine categories, and returns a backward-compatible report
 * plus a professional issue model and an internal prospecting summary.
 *
 * Network + SSRF live here; the pure logic (SSRF ranges, robots, URL/page-type
 * helpers, scoring) lives in engine-core.ts, the per-page checks + aggregation
 * live in page-checks.ts, and the issue / prospecting model lives in
 * analysis.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { lookup as dnsLookup } from "node:dns";
import { Agent } from "undici";

import {
  type AiBotStatus,
  type ParsedRobots,
  type EligibilityCapApplied,
  type PageType,
  AI_SEARCH_BOTS,
  AI_TRAINING_BOTS,
  SCANNER_TOKEN,
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
  resolveScan,
  computeGrade,
  computeWeightedScore,
  aiScoresFromItems,
  CATEGORY_WEIGHTS,
  applyEligibilityCaps,
  deriveEligibilityGates,
  describeEligibilityCaps,
  SCAN_MODE_DEFAULTS,
} from "./engine-core";
import { type TtfbMeasurement } from "./content-signals";
import { buildPageResult, aggregateCategories, computeTopFixes } from "./page-checks";
import {
  type PageResult,
  type SeoCheckResult,
  type Issue,
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
  normalizeIntentInput,
} from "./intent-analysis";
import { aggregateRenderingSummary } from "./rendering-analysis";
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

// Sitemap traversal budgets. A large multi-location firm (field case:
// preszlerlaw.com) publishes a sitemap index with a dozen child sitemaps and
// well over a thousand URLs; the practice-area sitemap that lists every
// location page sits 12th of 13. The old 5-child / 500-URL caps stopped short
// of it, so every location page read as "not in the sitemap" when it was there.
// These budgets cover any realistic firm site many times over; SITEMAP_TRUNCATED
// records when we still could not read the whole thing.
const SITEMAP_URL_BUDGET = 10000;
const SITEMAP_CHILD_LIMIT = 50;

async function fetchSitemapUrls(sitemapUrl: string, domain: string, depth = 0): Promise<{ urls: string[]; truncated: boolean }> {
  try {
    const parsed = new URL(sitemapUrl);
    if (isSsrfBlocked(parsed.hostname)) return { urls: [], truncated: false };
    const raw = await safeResource(sitemapUrl, 6000);
    if (!raw) return { urls: [], truncated: false };
    const urls: string[] = [];
    const childSitemaps: string[] = [];
    let truncated = false;
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
      if (urls.length >= SITEMAP_URL_BUDGET) { truncated = true; break; }
    }
    if (depth === 0) {
      const reachable = childSitemaps.slice(0, SITEMAP_CHILD_LIMIT);
      if (childSitemaps.length > reachable.length) truncated = true;
      for (const child of reachable) {
        if (urls.length >= SITEMAP_URL_BUDGET) { truncated = true; break; }
        const childResult = await fetchSitemapUrls(child, domain, 1);
        for (const u of childResult.urls) urls.push(u);
        if (childResult.truncated) truncated = true;
      }
    }
    return { urls, truncated };
  } catch { return { urls: [], truncated: false }; }
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

async function scanPage(
  url: string,
  domain: string,
  parsedRobots: ParsedRobots | null,
  llmsTxt: string | null,
  sitemapSet: Set<string> | null,
  intent: NormalizedIntent | null,
  sitemapComplete = true
): Promise<{ page: PageResult; html: string } | null> {
  let handle: SafeFetchResult | null = null;
  try {
    const t0 = Date.now();
    handle = await safeFetch(url, 12000);
    const ttfb: TtfbMeasurement = { ms: Date.now() - t0, sampleCount: 1 };
    const { res, finalUrl, redirectHops } = handle;
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html") && !ct.includes("xhtml")) return null;
    const read = await readCappedText(res, MAX_HTML_BYTES);
    if (!read.ok) return null;
    const page = buildPageResult(read.text, finalUrl, url, res.headers, ttfb, redirectHops, domain, parsedRobots, llmsTxt, sitemapSet, intent, sitemapComplete);
    return { page, html: read.text };
  } catch { return null; }
  finally { handle?.cleanup(); }
}

// Take a small number of EXTRA lightweight timing samples against a URL
// (headers only; the body is cancelled immediately) and combine them with an
// already-measured first sample to produce a median + range. Reserved for the
// homepage: it is the one page whose performance finding is used as a
// standalone, single-page headline claim ("Time to first byte: 1 page"), so
// it is the one page worth the extra round trips. Failed samples are simply
// dropped; the first (already-measured) sample always counts even if every
// extra sample fails.
async function sampleAdditionalTtfb(url: string, firstSampleMs: number, extraSamples: number, timeoutMs = 6000): Promise<TtfbMeasurement> {
  const samples = [firstSampleMs];
  for (let i = 0; i < extraSamples; i++) {
    let handle: SafeFetchResult | null = null;
    try {
      const t0 = Date.now();
      handle = await safeFetch(url, timeoutMs);
      samples.push(Date.now() - t0);
      handle.res.body?.cancel().catch(() => {});
    } catch {
      // Skip a failed extra sample; the first sample still counts.
    } finally {
      handle?.cleanup();
    }
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return { ms: median, sampleCount: sorted.length, min: sorted[0], max: sorted[sorted.length - 1] };
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
/**
 * Turn an applied eligibility cap into a top-priority finding, so the reason a
 * headline score is capped appears in the same issues list as everything else
 * rather than only in a response field the report does not render.
 */
function eligibilityIssues(
  capsApplied: EligibilityCapApplied[],
  uncapped: number,
  homeUrl: string,
  totalPages: number
): Issue[] {
  return capsApplied.map((c) => ({
    id: `eligibility-${c.gate}`,
    category: "Indexability",
    severity: "critical" as const,
    status: "fail" as const,
    title: `Score capped at ${c.cap}: ${c.headline}`,
    detail: `${c.reason} The rest of the audit scored ${uncapped}, but that is not reachable while this holds, so the headline score is capped at ${c.cap}.`,
    fix: c.fix,
    affectedUrls: [homeUrl],
    affectedCount: 1,
    totalPages,
    pageTypeImpact: ["homepage" as PageType],
    confidence: "high" as const,
    effort: "medium" as const,
    priority: 100,
  }));
}

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

    // Resolve the serving host and fetch the homepage before anything else.
    // Sites commonly serve on only one of apex or www; normalizeDomain strips
    // www for same-origin keying, so the apex we build by default can be dead
    // even when the site is live (field case jsmlaw.ca: the apex TLS handshake
    // fails, only www.jsmlaw.ca answers). Probe both forms, keep the first that
    // returns a usable HTML page, and build every downstream fetch URL from it.
    // isSameOrigin treats apex and www as equal, so the crawl is unaffected by
    // which host served.
    let originHost = domain;
    let homeHtml = "";
    let homeHeaders: Headers = new Headers();
    let homeFinalUrl = "";
    let homeRedirectHops = 0;
    let homeTtfbMs = 0;
    let resolved = false;
    let homeErrorResponse: NextResponse | null = null;
    // Remember the last HTTP status a host actually returned, so a live-but-
    // access-restricted site (field case ganganilaw.com: Squarespace serves a
    // 401 site-wide password page on both apex and www) is reported honestly
    // instead of as a dead domain.
    let lastHttpStatus = 0;
    // https first for both hosts, then http. A site that answers on https is
    // never downgraded: the http entries are only reached when both https
    // attempts fail. Field case: sanjlaw.ca and thecastlelawyers.com are live
    // Ontario firm sites whose TLS handshake fails, and which this scanner
    // used to report as "could not connect" rather than as sites with no SSL.
    // Reaching them over http also makes the notHttps eligibility cap
    // reachable, which it never was while every fetch was https.
    for (const candidate of [
      `https://${domain}`,
      `https://www.${domain}`,
      `http://${domain}`,
      `http://www.${domain}`,
    ]) {
      const h = candidate.replace(/^https?:\/\//, "");
      let handle: SafeFetchResult | null = null;
      try {
        const t0 = Date.now();
        handle = await safeFetch(candidate, 15000);
        const { res, finalUrl, redirectHops } = handle;
        if (!res.ok) { lastHttpStatus = res.status; continue; }
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("html") && !ct.includes("xhtml")) {
          homeErrorResponse = NextResponse.json({ error: `${domain} returned a non-HTML response. Only websites can be checked.` }, { status: 422 });
          continue;
        }
        const read = await readCappedText(res, MAX_HTML_BYTES);
        if (!read.ok) {
          homeErrorResponse = NextResponse.json({ error: read.reason === "too_large"
            ? `${domain} returned a page that is too large to scan.`
            : `${domain} took too long to respond or closed the connection. Try again in a moment.` }, { status: 422 });
          continue;
        }
        originHost = h;
        homeHeaders = res.headers;
        homeHtml = read.text;
        homeFinalUrl = finalUrl;
        homeRedirectHops = redirectHops;
        homeTtfbMs = Date.now() - t0;
        resolved = true;
        break;
      } catch (fetchErr: unknown) {
        const msg = fetchErr instanceof Error ? fetchErr.message : "unknown";
        if (msg === "ssrf_blocked") homeErrorResponse = NextResponse.json({ error: "That domain cannot be checked." }, { status: 400 });
        // Any other failure (TLS, DNS, timeout) just moves on to the next host.
      } finally {
        handle?.cleanup();
      }
    }
    if (!resolved) {
      if (homeErrorResponse) return homeErrorResponse;
      if (lastHttpStatus === 401) {
        return NextResponse.json({ error: `${domain} is live but access-restricted (HTTP 401), usually a site-wide password on an unpublished or trial site. Remove the site lock, then re-run the check.` }, { status: 422 });
      }
      if (lastHttpStatus === 403) {
        return NextResponse.json({ error: `${domain} is live but blocked the scanner (HTTP 403), usually a firewall or bot protection. Confirm the site loads for you; it may need the scanner allow-listed.` }, { status: 422 });
      }
      if (lastHttpStatus === 451) {
        return NextResponse.json({ error: `${domain} returned HTTP 451 (unavailable for legal reasons) and cannot be scanned.` }, { status: 422 });
      }
      if (lastHttpStatus >= 500) {
        return NextResponse.json({ error: `${domain} is up but returned HTTP ${lastHttpStatus} to the scanner. The host may be temporarily unavailable or blocking automated access (common on Squarespace, Wix, and Cloudflare). Confirm the site loads for you, then try again later.` }, { status: 422 });
      }
      if (lastHttpStatus > 0) {
        return NextResponse.json({ error: `${domain} responded with HTTP ${lastHttpStatus}, so no page could be scanned.` }, { status: 422 });
      }
      return NextResponse.json({ error: `Could not connect to ${domain}. Verify the domain is correct and the site is live.` }, { status: 422 });
    }
    const homeUrl = `https://${originHost}`;

    const [robotsRaw, llmsTxt] = await Promise.all([
      safeResource(`https://${originHost}/robots.txt`, 5000),
      safeResource(`https://${originHost}/llms.txt`, 5000),
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
    let sitemapTruncated = false;
    const rootSm = await fetchSitemapUrls(`https://${originHost}/sitemap.xml`, domain);
    for (const u of rootSm.urls) collectSitemapUrl(u);
    if (rootSm.truncated) sitemapTruncated = true;
    if (parsedRobots) {
      const sameOriginSitemaps = parsedRobots.sitemaps.filter((s) => isSameOrigin(s, domain));
      if (sameOriginSitemaps.length > 5) sitemapTruncated = true;
      for (const sm of sameOriginSitemaps.slice(0, 5)) {
        const smResult = await fetchSitemapUrls(sm, domain);
        for (const u of smResult.urls) collectSitemapUrl(u);
        if (smResult.truncated) sitemapTruncated = true;
      }
    }
    const sitemapSet = sitemapUrls.size > 0 ? sitemapUrls : null;
    // When the sitemap was too large to read in full, a page missing from the
    // partial set is unproven, so we must not assert "not listed" (see the
    // budget note on fetchSitemapUrls).
    const sitemapComplete = !sitemapTruncated;

    // The homepage's performance finding is reported as a standalone,
    // single-page claim, so it is the one page worth two extra round trips
    // to turn a single noisy sample into a median + range (see
    // sampleAdditionalTtfb and the dogfood note on TtfbMeasurement).
    const homeTtfb = await sampleAdditionalTtfb(homeUrl, homeTtfbMs, 2);

    // The homepage HTML + headers were already captured during host resolution
    // above; build its result now that robots + sitemap are available.
    const homePage: PageResult = buildPageResult(
      homeHtml, homeFinalUrl, homeUrl, homeHeaders, homeTtfb, homeRedirectHops,
      domain, parsedRobots, llmsTxt, sitemapSet, intent, sitemapComplete
    );

    const pages: PageResult[] = [homePage];
    let partial = false;

    // Count of same-origin links the homepage's OWN server HTML links to.
    // Feeds discoveryConfidence: a site with near-zero on-page links and no
    // sitemap safety net cannot be reliably crawled, so absence findings
    // ("no practice pages", "no team page") get downgraded rather than
    // reported at full confidence.
    let homeInternalLinkCount = 0;

    // URLs discovered (homepage nav, sitemap, crawled pages) but left unscanned
    // when the page budget ran out. Absence claims ("no team page") consult
    // this: a page sitting unscanned in the frontier is not absent.
    let uncrawledUrls: string[] = [];

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

        const scanned = await scanPage(next.url, domain, parsedRobots, llmsTxt, sitemapSet, intent, sitemapComplete);
        if (!scanned) continue;
        visited.add(crawlUrlKey(scanned.page.url));
        pages.push(scanned.page);

        // Expand discovery from this page if depth allows.
        if (next.depth < maxDepth) {
          for (const u of extractInternalLinks(scanned.html, scanned.page.url, domain)) enqueue(u, next.depth + 1);
        }
      }
      uncrawledUrls = frontier.map((f) => f.url);
    }

    // Untouched WordPress starter pages (Hello world! / Sample Page) are not the
    // firm's content: excluded from quality scores + findings so their thin
    // boilerplate does not mis-measure the site (field case chaabanelaw.com,
    // where /sample-page/ dragged word-count, thin-content, and meta-description
    // findings onto the firm). They stay in `pages` for pagesScanned, maturity,
    // and discovery confidence, and their presence is surfaced as one finding.
    const wpStarterUrls = pages.filter((p) => p.wpDefault).map((p) => p.url);
    const scored = pages.some((p) => p.wpDefault) ? pages.filter((p) => !p.wpDefault) : pages;
    const forFindings = scored.length > 0 ? scored : pages;

    // Trust-fix pass WI-7: placeholder-class signal (bare WordPress install,
    // single-page firm site). Pages with no real content cannot carry
    // answer-engine content signals (question headings, citations,
    // authorship), so buildIssues collapses those four findings into one
    // honest "publish content first" finding on this class of site.
    const effectiveContentPages = pages.filter((p) => !p.wpDefault && p.wordCount >= 150).length;

    // Backward-compatible aggregation.
    const aggregatedCategories = aggregateCategories(forFindings);
    // Declared here rather than further down because the eligibility gates
    // below need the rendering risk before the headline score is settled.
    const renderingSummary = aggregateRenderingSummary(forFindings);
    const eligibilityGates = deriveEligibilityGates(aggregatedCategories, renderingSummary?.risk);
    const uncappedScore = computeWeightedScore(aggregatedCategories);
    const overallScore = applyEligibilityCaps(uncappedScore, eligibilityGates);
    const capsApplied = describeEligibilityCaps(eligibilityGates);
    const grade = computeGrade(overallScore);

    const perPageAi = forFindings.map((p) => {
      const ai = p.categories.find((c) => c.name === "AI Visibility");
      return aiScoresFromItems(ai ? ai.items : []);
    });
    const aiSearchScore = perPageAi.length > 0 ? Math.round(perPageAi.reduce((s, a) => s + a.search, 0) / perPageAi.length) : 0;
    const aiPolicyScore = perPageAi.length > 0 ? Math.round(perPageAi.reduce((s, a) => s + a.policy, 0) / perPageAi.length) : 50;

    const aiBots: AiBotStatus[] = [
      ...AI_SEARCH_BOTS.map((b) => ({ name: b.label, blocked: parsedRobots ? checkBotBlockedParsed(parsedRobots, b.token) : false, category: "search" as const })),
      ...AI_TRAINING_BOTS.map((b) => ({ name: b.label, blocked: parsedRobots ? checkBotBlockedParsed(parsedRobots, b.token) : false, category: "training" as const })),
    ];
    const intentAlignment = aggregateIntentAlignment(forFindings);

    const topFixes = computeTopFixes(forFindings, 5);

    // Professional layer.
    const discoveryConfidence = computeDiscoveryConfidence(pages.length, sitemapSet?.size ?? 0, homeInternalLinkCount, maxPages);
    const pageIssues = buildIssues(forFindings, effectiveContentPages);
    const structureIssues = buildSiteStructureIssues(pages, !!sitemapSet, parsedRobots, discoveryConfidence, uncrawledUrls, wpStarterUrls);
    const capIssues = eligibilityIssues(
      capsApplied,
      uncappedScore,
      pages[0]?.url ?? `https://${domain}`,
      pages.length
    );
    const issues = [...pageIssues, ...structureIssues, ...capIssues].sort(compareIssuesByPriority);
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
      ...(capsApplied.length > 0 ? { eligibility: { uncappedScore, capsApplied } } : {}),
      buildSha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      checkedAt: new Date().toISOString(),
      // Trust-fix pass WI-8 (acceptance criterion): expose exactly which
      // checks contribute to no grade, built from the actual scored:false
      // flags set this scan (not a hand-maintained list that can drift).
      scoring: {
        categoryWeights: CATEGORY_WEIGHTS,
        unscoredLabels: [...new Set(
          pages.flatMap((p) => p.categories.flatMap((c) => c.items))
            .filter((i) => i.scored === false)
            .map((i) => i.label)
        )].sort(),
        note: "Unscored checks are shown for completeness and excluded from every grade.",
      },
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
