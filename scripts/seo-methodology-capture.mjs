/**
 * Fixed-domain, read-only capture for the SEO methodology benchmark.
 *
 * This is not the production API and never saves a scan result. It captures
 * only the five domains pinned by docs/seo-methodology/BASELINE-v3.json.
 * Run with Node 24+: node --experimental-strip-types
 * scripts/seo-methodology-capture.mjs [--out <directory>]
 */
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { registerHooks } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import https from "node:https";
import http from "node:http";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = join(ROOT, "docs", "seo-methodology", "corpus", "capture-2026-10-28-run2");
const args = process.argv.slice(2);
const smokeOnly = args.includes("--smoke");
const outArg = args.indexOf("--out");
const OUT = resolve(outArg >= 0 ? args[outArg + 1] : DEFAULT_OUT);
const CORPUS_ROOT = resolve(ROOT, "docs", "seo-methodology", "corpus");
const outRelative = relative(CORPUS_ROOT, OUT);
if (outRelative === "" || outRelative === "." || outRelative.startsWith(`..${sep}`) || outRelative === ".." || isAbsolute(outRelative)) {
  throw new Error(`--out must be a new subdirectory of ${CORPUS_ROOT}`);
}
if (!smokeOnly && existsSync(OUT)) throw new Error(`Refusing to overwrite existing capture output: ${OUT}`);
const PAGE_LIMIT = 50;
const WALL_BUDGET_MS = 230_000;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_RESOURCE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const FRONTIER_CAP = 600;
const SITEMAP_URL_BUDGET = 10_000;
const SITEMAP_CHILD_LIMIT = 50;
const SCANNER_UA = "Mozilla/5.0 (compatible; CaseLoadSelect-SEOCheck/1.0; +https://caseloadselect.ca)";
const CAPTURED_AT = new Date().toISOString();

// Resolve the same pure, tested robots/URL/SSRF helpers used by the app.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const target = pathToFileURL(join(ROOT, "src", `${specifier.slice(2)}.ts`)).href;
      return nextResolve(target, context);
    }
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  SCANNER_TOKEN,
  checkBotBlockedParsed,
  crawlUrlKey,
  isSameOrigin,
  isSsrfBlocked,
  normalizeDomain,
  normalizePageUrl,
  parseRobotsTxt,
  scoreUrlPriority,
  shouldSkipUrl,
} = await import(pathToFileURL(join(ROOT, "src/app/api/tools/seo-check/engine-core.ts")));
if (smokeOnly) {
  try {
    await requestOnce("https://example.invalid/", 1000, MAX_HTML_BYTES, "sonilaw.ca", Date.now() + 1000);
    throw new Error("Out-of-scope host preflight unexpectedly resolved");
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "host_or_protocol_out_of_scope") throw error;
  }
  console.log("SEO capture runtime imports passed; no network requests were made.");
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(join(ROOT, "docs/seo-methodology/BASELINE-v3.json"), "utf8"));
const manifest = baseline.targetManifest;
const sites = [
  { key: "Soni", slug: "soni", fixture: null },
  { key: "SakuraBala", slug: "sakura-bala", fixture: "sakurabalaw.json" },
  { key: "Gosai", slug: "gosai", fixture: "gosailaw.json" },
  { key: "DRG", slug: "drg", fixture: "drglaw.json" },
  { key: "Marathon", slug: "marathon", fixture: "marathonlaw.json" },
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const safeName = (value) => value.replace(/[^a-z0-9.-]+/gi, "_").slice(0, 150);

function entryUrlFor(site) {
  const item = manifest[site.key];
  const domain = item.domain;
  if (site.fixture) {
    const fixture = JSON.parse(readFileSync(join(ROOT, "src/app/api/tools/seo-check/__tests__/__fixtures__", site.fixture), "utf8"));
    const first = fixture.pages?.[0]?.url;
    if (!first || normalizeDomain(new URL(first).hostname) !== domain) throw new Error(`Fixture root does not match approved domain for ${site.key}`);
    return first;
  }
  if (site.key === "Soni" && item.domainSource === "approved execution plan") return `https://${domain}/`;
  throw new Error(`No approved entry URL for ${site.key}`);
}

function entryUrlSourceFor(site) {
  return site.fixture
    ? `first page URL in tracked fixture ${site.fixture}`
    : "approved execution plan domain; HTTPS root probe sequence follows current route";
}

const COVERAGE_DEFINITIONS = {
  attemptedPages: "Unique page candidates attempted: one root page candidate plus each unique discovered child candidate dequeued for a page scan, regardless of whether an eligible HTML response is obtained. Alternative root-host probes and redirect hops are logged request attempts, not additional page candidates.",
  failedPages: "Attempted page candidates that did not produce an eligible HTML result. Root counts as one failure only if every root-host probe fails; each failed child candidate is listed once in failedPages.",
  requestCount: "Logged GET request attempts/probe operations, including attempts that fail during DNS, connect, or preflight; every redirect hop; robots/llms/sitemap resources; and homepage timing samples. It equals requestLog.length.",
};

const CAPTURE_BUDGETS = {
  pageLimit: PAGE_LIMIT,
  wallClockMs: WALL_BUDGET_MS,
  htmlBytesDecoded: MAX_HTML_BYTES,
  resourceBytesDecoded: MAX_RESOURCE_BYTES,
  maxRedirects: MAX_REDIRECTS,
  dnsTimeoutMs: 8000,
  connectTimeoutMs: 8000,
  headersAndBodyTimeoutMs: 15000,
  safeFetchTimeoutMs: [5000, 6000, 12000, 15000],
  frontierCap: FRONTIER_CAP,
  sitemapUrlBudget: SITEMAP_URL_BUDGET,
  sitemapChildLimit: SITEMAP_CHILD_LIMIT,
  depth: 4,
};

function commonCaptureFields(site, domain, entryUrl) {
  return {
    schemaVersion: 1,
    firm: site.key,
    domain,
    entryUrl,
    entryUrlSource: entryUrlSourceFor(site),
    sourceFixture: site.fixture ? `src/app/api/tools/seo-check/__tests__/__fixtures__/${site.fixture}` : null,
    capturedAt: CAPTURED_AT,
    methodologyVersion: "4.0-candidate",
    sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    captureMode: "read-only-fixed-host-allowlist",
    persistence: "disabled; no application API or database used",
    budgets: CAPTURE_BUDGETS,
    coverageDefinitions: COVERAGE_DEFINITIONS,
  };
}

function hostAllowed(hostname, domain) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === domain || host === `www.${domain}`;
}

async function pinnedLookup(hostname, deadlineAt, timeoutMs) {
  const remaining = Math.min(timeoutMs, deadlineAt - Date.now());
  if (remaining <= 0) throw new Error("230s-wall-clock-budget");
  const addresses = await withTimeout(lookup(hostname, { all: true, verbatim: true }), remaining, "230s-wall-clock-budget");
  if (!addresses.length || addresses.some((address) => isSsrfBlocked(address.address))) throw new Error("ssrf_blocked_or_unresolved_address");
  return addresses;
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

async function requestOnce(url, timeoutMs, byteCap, domain, deadlineAt, bodyMode = "read") {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password || !hostAllowed(parsed.hostname, domain)) {
      throw new Error("host_or_protocol_out_of_scope");
    }
    let addresses;
    addresses = await pinnedLookup(parsed.hostname, deadlineAt, 8000);
    const remaining = Math.min(timeoutMs, deadlineAt - Date.now());
    if (remaining <= 0) throw new Error("230s-wall-clock-budget");
    const requestStartedAt = Date.now();
    let bytes = 0;
    let wireBytes = 0;
    const chunks = [];
    let settled = false;
    return await new Promise((resolvePromise, rejectPromise) => {
    const finish = (fn, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(result);
    };
    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.request(parsed, {
      method: "GET",
      headers: { "User-Agent": SCANNER_UA, Accept: "text/html,application/xhtml+xml,text/plain,*/*", "Accept-Encoding": "gzip, deflate, br" },
      lookup: (_hostname, options, callback) => {
        if (options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
    }, (res) => {
      const status = res.statusCode ?? 0;
      const headersReceivedAtMs = Date.now();
      const headersReceivedAt = new Date(headersReceivedAtMs).toISOString();
      const headers = Object.fromEntries(Object.entries(res.headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(", ") : value ?? ""]));
      if (status >= 300 && status < 400) {
        res.resume();
        finish(resolvePromise, { status, headers, body: Buffer.alloc(0), decodedBytes: 0, wireBytes: 0, headersReceivedAt, headersReceivedAtMs, headerWaitMs: headersReceivedAtMs - requestStartedAt, bodyReadMs: 0, totalElapsedMs: Date.now() - requestStartedAt });
        return;
      }
      if (bodyMode === "cancel") {
        res.on("error", () => {});
        res.destroy();
        finish(resolvePromise, { status, headers, body: Buffer.alloc(0), decodedBytes: 0, wireBytes: 0, headersReceivedAt, headersReceivedAtMs, headerWaitMs: headersReceivedAtMs - requestStartedAt, bodyReadMs: 0, totalElapsedMs: Date.now() - requestStartedAt });
        return;
      }
      const encoding = String(headers["content-encoding"] ?? "identity").toLowerCase().trim();
      const decoders = {
        identity: null,
        gzip: createGunzip,
        "x-gzip": createGunzip,
        deflate: createInflate,
        br: createBrotliDecompress,
      };
      const makeDecoder = decoders[encoding];
      if (makeDecoder === undefined) {
        res.destroy();
        finish(rejectPromise, new Error(`unsupported_content_encoding:${encoding}`));
        return;
      }
      res.on("data", (chunk) => { wireBytes += chunk.length; });
      const bodyStream = makeDecoder ? res.pipe(makeDecoder()) : res;
      bodyStream.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > byteCap) {
          res.destroy();
          bodyStream.destroy();
          finish(rejectPromise, new Error("resource_byte_cap_exceeded"));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      bodyStream.on("end", () => {
        const endedAt = Date.now();
        finish(resolvePromise, { status, headers, body: Buffer.concat(chunks), decodedBytes: bytes, wireBytes, headersReceivedAt, headersReceivedAtMs, headerWaitMs: headersReceivedAtMs - requestStartedAt, bodyReadMs: endedAt - headersReceivedAtMs, totalElapsedMs: endedAt - requestStartedAt });
      });
      bodyStream.on("error", (error) => finish(rejectPromise, error));
      res.on("error", (error) => finish(rejectPromise, error));
    });
    const timer = setTimeout(() => req.destroy(new Error(Date.now() >= deadlineAt ? "230s-wall-clock-budget" : "request_timeout")), remaining);
    req.setTimeout(remaining, () => req.destroy(new Error(Date.now() >= deadlineAt ? "230s-wall-clock-budget" : "request_timeout")));
    req.on("socket", (socket) => {
      if (!socket.connecting) return;
      const connectTimer = setTimeout(() => req.destroy(new Error("connect_timeout")), Math.min(8000, deadlineAt - Date.now()));
      const connected = () => clearTimeout(connectTimer);
      socket.once(parsed.protocol === "https:" ? "secureConnect" : "connect", connected);
      req.once("close", connected);
    });
    req.on("error", (error) => finish(rejectPromise, error));
    req.end();
    });
}

async function safeGet(startUrl, timeoutMs, cap, domain, deadlineAt, requestLog, bodyMode = "read") {
  const fetchStartedAt = Date.now();
  const fetchDeadlineAt = Math.min(deadlineAt, fetchStartedAt + timeoutMs);
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (Date.now() >= deadlineAt) throw new Error("230s-wall-clock-budget");
    if (Date.now() >= fetchDeadlineAt) throw new Error("request_timeout");
    const entry = { requestedUrl: current, startedAt: new Date().toISOString(), method: "GET", redirectHop: hop };
    let logged = false;
    try {
      const response = await requestOnce(current, timeoutMs, cap, domain, fetchDeadlineAt, bodyMode);
      Object.assign(entry, {
        status: response.status,
        headers: response.headers,
        decodedBytes: response.decodedBytes,
        wireBytes: response.wireBytes,
        headersReceivedAt: response.headersReceivedAt,
        headerWaitMs: response.headersReceivedAtMs - Date.parse(entry.startedAt),
        bodyReadMs: response.bodyReadMs,
        totalElapsedMs: Date.now() - Date.parse(entry.startedAt),
      });
      requestLog.push(entry);
      logged = true;
      if (response.status >= 300 && response.status < 400) {
        if (hop === MAX_REDIRECTS) throw new Error("too_many_redirects");
        const location = response.headers.location;
        if (!location) throw new Error("redirect_without_location");
        const next = new URL(location, current).href;
        const parsedNext = new URL(next);
        if (!["https:", "http:"].includes(parsedNext.protocol) || !hostAllowed(parsedNext.hostname, domain)) throw new Error("redirect_host_out_of_scope");
        current = next;
        continue;
      }
      return { ...response, finalUrl: current, requestedUrl: startUrl, redirectHops: hop, ttfbMs: response.headersReceivedAtMs - fetchStartedAt, elapsedMs: Date.now() - fetchStartedAt };
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      entry.totalElapsedMs ??= Date.now() - Date.parse(entry.startedAt);
      if (!logged) requestLog.push(entry);
      throw error;
    }
  }
  throw new Error("too_many_redirects");
}

async function fetchResource(url, timeoutMs, domain, deadlineAt, requestLog, filesDir, kind) {
  try {
    const response = await safeGet(url, timeoutMs, MAX_RESOURCE_BYTES, domain, deadlineAt, requestLog);
    if (response.status < 200 || response.status >= 300) return { url, finalUrl: response.finalUrl, status: response.status, available: false, reason: `http-${response.status}` };
    const file = `${kind}-${sha256(response.finalUrl).slice(0, 12)}.txt`;
    writeFileSync(join(filesDir, file), response.body);
    return { url, finalUrl: response.finalUrl, status: response.status, available: true, decodedBytes: response.decodedBytes, wireBytes: response.wireBytes, headersReceivedAt: response.headersReceivedAt, ttfbMs: response.ttfbMs, bodyReadMs: response.bodyReadMs, elapsedMs: response.elapsedMs, sha256: sha256(response.body), file, text: response.body.toString("utf8") };
  } catch (error) {
    return { url, available: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function extractInternalLinks(html, baseUrl, domain) {
  const seen = new Set();
  for (const [, href] of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
    const normalized = normalizePageUrl(href, baseUrl);
    if (normalized && isSameOrigin(normalized, domain) && !shouldSkipUrl(normalized)) seen.add(normalized);
  }
  return [...seen];
}

async function fetchSitemap(url, domain, deadlineAt, requestLog, resourceDir, depth = 0, state = { urls: [], resources: [], truncated: false, children: 0 }) {
  if (state.urls.length >= SITEMAP_URL_BUDGET) { state.truncated = true; return state; }
  const resource = await fetchResource(url, 6000, domain, deadlineAt, requestLog, resourceDir, "sitemap");
  const { text } = resource;
  state.resources.push({ ...resource, text: undefined });
  if (!text) return state;
  const children = [];
  for (const [, raw] of text.matchAll(/<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi)) {
    const candidate = raw.trim();
    if (/\.(xml|gz)(\?.*)?$/i.test(candidate)) {
      if (depth === 0 && isSameOrigin(candidate, domain)) children.push(candidate);
      continue;
    }
    if (isSameOrigin(candidate, domain)) {
      try { const parsed = new URL(candidate); parsed.hash = ""; state.urls.push(parsed.href); } catch { /* Ignore invalid sitemap entries. */ }
    }
    if (state.urls.length >= SITEMAP_URL_BUDGET) { state.truncated = true; break; }
  }
  if (depth === 0) {
    const remaining = Math.min(SITEMAP_CHILD_LIMIT, children.length);
    if (children.length > remaining) state.truncated = true;
    for (const child of children.slice(0, remaining)) {
      if (state.urls.length >= SITEMAP_URL_BUDGET) { state.truncated = true; break; }
      state.children++;
      await fetchSitemap(child, domain, deadlineAt, requestLog, resourceDir, 1, state);
    }
  }
  return state;
}

function writeJson(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }

async function captureSite(site) {
  const domain = manifest[site.key].domain;
  const entryUrl = entryUrlFor(site);
  const siteDir = join(OUT, site.slug);
  const pagesDir = join(siteDir, "pages");
  const resourcesDir = join(siteDir, "resources");
  mkdirSync(pagesDir, { recursive: true });
  mkdirSync(resourcesDir, { recursive: true });
  const startedAt = Date.now();
  const requestLog = [];
  const skippedReasons = {};
  const countSkipped = (reason, count = 1) => { skippedReasons[reason] = (skippedReasons[reason] ?? 0) + count; };
  const pages = [];
  const failedPages = [];
  let attemptedChildPages = 0;
  let stopReason = "discovery-exhausted";
  const elapsed = () => Date.now() - startedAt;
  const remainingMs = () => WALL_BUDGET_MS - elapsed();
  const deadlineAt = startedAt + WALL_BUDGET_MS;
  const rootProbeUrls = [`https://${domain}`, `https://www.${domain}`, `http://${domain}`, `http://www.${domain}`];
  const rootProbeAttempts = [];
  let rootResponse = null;
  let rootProbeUrl = null;
  let rootCt = "";
  for (const candidate of rootProbeUrls) {
    if (remainingMs() <= 0) { stopReason = "230s-wall-clock-budget"; break; }
    try {
      const response = await safeGet(candidate, Math.min(15000, remainingMs()), MAX_HTML_BYTES, domain, deadlineAt, requestLog);
      const contentType = String(response.headers["content-type"] ?? "");
      rootProbeAttempts.push({ url: candidate, status: response.status, contentType, headersReceivedAt: response.headersReceivedAt, ttfbMs: response.ttfbMs, bodyReadMs: response.bodyReadMs, elapsedMs: response.elapsedMs });
      if (response.status >= 200 && response.status < 300 && /html|xhtml/i.test(contentType)) {
        rootResponse = response;
        rootProbeUrl = candidate;
        rootCt = contentType;
        break;
      }
    } catch (error) {
      rootProbeAttempts.push({ url: candidate, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!rootResponse || !rootProbeUrl) {
    const reason = stopReason === "230s-wall-clock-budget" ? stopReason : "root-not-eligible";
    writeJson(join(siteDir, "capture.json"), { ...commonCaptureFields(site, domain, entryUrl), rootProbeUrls, rootProbeAttempts, stopReason: reason, rootContentType: rootCt, pages: [], requestLog, skippedReasons: { ...skippedReasons, "root-not-eligible": 1 }, coverage: { attemptedPages: 1, successfulPages: 0, failedPages: 1, elapsedMs: elapsed(), requestCount: requestLog.length, decodedResponseBytes: requestLog.reduce((sum, entry) => sum + (entry.decodedBytes ?? 0), 0), wireResponseBytes: requestLog.reduce((sum, entry) => sum + (entry.wireBytes ?? 0), 0) } });
    return;
  }

  const originHost = new URL(rootProbeUrl).hostname;
  // The route builds its later URL from the selected host while preserving
  // its https-prefixed home URL convention, including an http-only fallback.
  const homeUrl = `https://${originHost}`;
  const pageFile = (index, url) => `${String(index).padStart(3, "0")}-${safeName(new URL(url).pathname || "home")}-${sha256(url).slice(0, 10)}.html`;
  const pageSha = sha256(rootResponse.body);
  const rootFile = pageFile(1, rootResponse.finalUrl);
  writeFileSync(join(pagesDir, rootFile), rootResponse.body);
  pages.push({ order: 1, requestedUrl: homeUrl, entryProbeUrl: rootProbeUrl, finalUrl: rootResponse.finalUrl, status: rootResponse.status, headers: rootResponse.headers, redirectHops: rootResponse.redirectHops, headersReceivedAt: rootResponse.headersReceivedAt, ttfbMs: rootResponse.ttfbMs, bodyReadMs: rootResponse.bodyReadMs, elapsedMs: rootResponse.elapsedMs, decodedBytes: rootResponse.decodedBytes, wireBytes: rootResponse.wireBytes, sha256: pageSha, file: `pages/${rootFile}`, discoveredBy: "approved-entry-url", capturedAt: new Date().toISOString() });

  const [robots, llms] = await Promise.all([
    fetchResource(`https://${originHost}/robots.txt`, Math.min(5000, remainingMs()), domain, deadlineAt, requestLog, resourcesDir, "robots"),
    fetchResource(`https://${originHost}/llms.txt`, Math.min(5000, remainingMs()), domain, deadlineAt, requestLog, resourcesDir, "llms"),
  ]);
  const parsedRobots = robots.text ? parseRobotsTxt(robots.text) : null;
  const sitemap = await fetchSitemap(`https://${originHost}/sitemap.xml`, domain, deadlineAt, requestLog, resourcesDir);
  if (parsedRobots) {
    const declared = parsedRobots.sitemaps.filter((url) => isSameOrigin(url, domain));
    if (declared.length > 5) sitemap.truncated = true;
    for (const url of declared.slice(0, 5)) {
      const declaredSitemap = await fetchSitemap(url, domain, deadlineAt, requestLog, resourcesDir);
      sitemap.urls.push(...declaredSitemap.urls);
      sitemap.resources.push(...declaredSitemap.resources);
      sitemap.truncated ||= declaredSitemap.truncated;
    }
  }
  const sitemapUrls = [...new Map(sitemap.urls.map((url) => [crawlUrlKey(url), url])).values()];

  // Match the route's two additional homepage timing requests. Bodies are
  // cancelled immediately and their status/time are still in requestLog.
  for (let i = 0; i < 2 && remainingMs() > 0; i++) {
    try { await safeGet(homeUrl, Math.min(6000, remainingMs()), MAX_HTML_BYTES, domain, deadlineAt, requestLog, "cancel"); }
    catch { /* Timing sample failures are observations; the captured page remains valid. */ }
  }

  const frontier = [];
  const discovered = new Set();
  const visited = new Set([crawlUrlKey(rootResponse.finalUrl), crawlUrlKey(homeUrl)]);
  const maxDepth = 4;
  const enqueue = (url, depth, source) => {
    const key = crawlUrlKey(url);
    if (discovered.has(key)) return;
    discovered.add(key);
    if (frontier.length >= FRONTIER_CAP) { countSkipped("frontier-cap"); return; }
    if (visited.has(key)) return;
    if (!isSameOrigin(url, domain) || shouldSkipUrl(url)) { countSkipped("out-of-scope-or-unsupported-url"); return; }
    if (parsedRobots) {
      try { if (checkBotBlockedParsed(parsedRobots, SCANNER_TOKEN, new URL(url).pathname)) { countSkipped("robots-disallowed"); return; } }
      catch { countSkipped("invalid-url"); return; }
    }
    if (frontier.some((entry) => crawlUrlKey(entry.url) === key)) return;
    frontier.push({ url, depth, source, score: scoreUrlPriority(url) });
  };
  for (const url of extractInternalLinks(rootResponse.body.toString("utf8"), rootResponse.finalUrl, domain)) enqueue(url, 1, "homepage-link");
  for (const url of sitemapUrls) enqueue(url, 1, "sitemap");

  while (pages.length < PAGE_LIMIT && frontier.length) {
    if (remainingMs() <= 0) { stopReason = "230s-wall-clock-budget"; break; }
    let best = 0;
    for (let i = 1; i < frontier.length; i++) if (frontier[i].score > frontier[best].score) best = i;
    const next = frontier.splice(best, 1)[0];
    const key = crawlUrlKey(next.url);
    if (visited.has(key)) continue;
    visited.add(key);
    attemptedChildPages++;
    let response;
    try { response = await safeGet(next.url, Math.min(12000, remainingMs()), MAX_HTML_BYTES, domain, deadlineAt, requestLog); }
    catch (error) {
      failedPages.push({ requestedUrl: next.url, error: error instanceof Error ? error.message : String(error), discoveredBy: next.source });
      continue;
    }
    const contentType = String(response.headers["content-type"] ?? "");
    if (response.status < 200 || response.status >= 300 || !/html|xhtml/i.test(contentType)) {
      failedPages.push({ requestedUrl: next.url, finalUrl: response.finalUrl, status: response.status, contentType, discoveredBy: next.source });
      continue;
    }
    const filename = pageFile(pages.length + 1, response.finalUrl);
    const digest = sha256(response.body);
    writeFileSync(join(pagesDir, filename), response.body);
    pages.push({ order: pages.length + 1, requestedUrl: next.url, finalUrl: response.finalUrl, status: response.status, headers: response.headers, redirectHops: response.redirectHops, headersReceivedAt: response.headersReceivedAt, ttfbMs: response.ttfbMs, bodyReadMs: response.bodyReadMs, elapsedMs: response.elapsedMs, decodedBytes: response.decodedBytes, wireBytes: response.wireBytes, sha256: digest, file: `pages/${filename}`, discoveredBy: next.source, depth: next.depth, capturedAt: new Date().toISOString() });
    visited.add(crawlUrlKey(response.finalUrl));
    if (next.depth < maxDepth) {
      for (const url of extractInternalLinks(response.body.toString("utf8"), response.finalUrl, domain)) enqueue(url, next.depth + 1, "page-link");
    }
  }
  if (pages.length >= PAGE_LIMIT && frontier.length) { stopReason = "50-page-limit"; countSkipped("page-limit", frontier.length); }
  if (remainingMs() <= 0 && stopReason === "discovery-exhausted") stopReason = "230s-wall-clock-budget";
  if (sitemap.truncated) countSkipped("sitemap-truncated-event");
  const normalizedIdentities = pages.map((page) => crawlUrlKey(page.finalUrl));
  const pageSetHash = sha256(normalizedIdentities.join("\n"));
  const record = {
    ...commonCaptureFields(site, domain, entryUrl),
    rootProbeUrls,
    rootProbeAttempts,
    selectedOriginHost: originHost,
    coverage: { requestedPages: PAGE_LIMIT, attemptedPages: 1 + attemptedChildPages, successfulPages: pages.length, failedPages: failedPages.length, skippedPages: Object.entries(skippedReasons).filter(([key]) => key !== "sitemap-truncated-event").reduce((sum, [, value]) => sum + value, 0), skippedReasons, discoveredCandidates: discovered.size, remainingFrontier: frontier.length, sitemapTruncated: sitemap.truncated, stopReason, elapsedMs: elapsed(), requestCount: requestLog.length, decodedResponseBytes: requestLog.reduce((sum, entry) => sum + (entry.decodedBytes ?? 0), 0), wireResponseBytes: requestLog.reduce((sum, entry) => sum + (entry.wireBytes ?? 0), 0) },
    pageSetHashBasis: "normalized-url-identities",
    pageSetHash,
    corpusHash: sha256(JSON.stringify({
      pages: pages.map(({ order, requestedUrl, finalUrl, status, headers, redirectHops, headersReceivedAt, ttfbMs, bodyReadMs, elapsedMs, decodedBytes, wireBytes, sha256: pageHash }) => ({ order, requestedUrl, finalUrl, status, headers, redirectHops, headersReceivedAt, ttfbMs, bodyReadMs, elapsedMs, decodedBytes, wireBytes, sha256: pageHash })),
      robots: { url: robots.url, finalUrl: robots.finalUrl, status: robots.status, sha256: robots.sha256 },
      llms: { url: llms.url, finalUrl: llms.finalUrl, status: llms.status, sha256: llms.sha256 },
      sitemapUrls,
      sitemapResources: sitemap.resources.map(({ url, finalUrl, status, sha256: resourceHash }) => ({ url, finalUrl, status, sha256: resourceHash })),
    })),
    captureHarnessSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    robots: { ...robots, text: undefined },
    llms: { ...llms, text: undefined },
    sitemapResources: sitemap.resources,
    sitemapUrls,
    sitemapComplete: !sitemap.truncated,
    pages,
    failedPages,
    requestLog,
  };
  writeJson(join(siteDir, "capture.json"), record);
}

mkdirSync(OUT, { recursive: true });
for (const site of sites) {
  console.log(`Capturing ${manifest[site.key].domain} (read-only, max ${PAGE_LIMIT} pages, ${WALL_BUDGET_MS}ms)`);
  try { await captureSite(site); }
  catch (error) {
    const siteDir = join(OUT, site.slug);
    mkdirSync(siteDir, { recursive: true });
    writeJson(join(siteDir, "capture.json"), { firm: site.key, domain: manifest[site.key].domain, entryUrl: entryUrlFor(site), capturedAt: CAPTURED_AT, persistence: "disabled", pages: [], stopReason: "capture-error", error: error instanceof Error ? error.message : String(error) });
    console.error(`${manifest[site.key].domain}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const summaries = sites.map((site) => {
  const path = join(OUT, site.slug, "capture.json");
  try {
    const result = JSON.parse(readFileSync(path, "utf8"));
    return { firm: result.firm, domain: result.domain, entryUrl: result.entryUrl, pages: result.coverage?.successfulPages ?? 0, stopReason: result.coverage?.stopReason ?? result.stopReason, elapsedMs: result.coverage?.elapsedMs ?? null, corpusFile: path };
  } catch { return { firm: site.key, domain: manifest[site.key].domain, state: "capture-manifest-missing" }; }
});
writeJson(join(OUT, "summary.json"), { capturedAt: CAPTURED_AT, sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(), methodVersion: "4.0-candidate", savingDisabled: true, sites: summaries });
console.log(JSON.stringify(summaries, null, 2));
