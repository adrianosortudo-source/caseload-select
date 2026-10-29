/**
 * Per-page SEO/AEO/AI-visibility analysis for /api/tools/seo-check.
 *
 * HTML extraction, structured-data parsing, the individual category checks,
 * buildPageResult (assembles one page's full result), and the backward-
 * compatible aggregateCategories rollup. Split out of route.ts because
 * Next.js route files may only export HTTP handlers and a small fixed set
 * of route config values; any other named export fails typed-route
 * validation during `next build`.
 *
 * Network fetching, SSRF protection, sitemap/crawl traversal, and the
 * route handler itself stay in route.ts.
 */

import {
  type CheckItem,
  type CategoryResult,
  type ParsedRobots,
  SCANNER_TOKEN,
  checkBotBlockedParsed,
  GENERIC_ANCHORS,
  isSameOrigin,
  isWpDefaultContent,
  crawlUrlKey,
  classifyPageType,
  decodeHtmlEntities,
  computeGrade,
  computeWeightedScore,
  scoreItems,
  applyPageTypeApplicability,
} from "./engine-core";
import {
  summarizeImageAlt,
  hasGoogleBusinessProfileLink,
  hasTestimonialStructure,
  likelyServiceAreaBusiness,
  classifyCsp,
  classifyTtfb,
  type TtfbMeasurement,
} from "./content-signals";
import {
  type PageResult,
  type Indexability,
  type SchemaSummary,
  type LawFirmSignals,
  type TopFix,
} from "./analysis";
import {
  type NormalizedIntent,
  analyzePageIntent,
  buildIntentCategory,
  buildPageAuditSnapshot,
} from "./intent-analysis";
import {
  analyzeRenderingSnapshot,
  buildRenderingCategory,
} from "./rendering-analysis";
import { attachMethodologyEvidence } from "./methodology-sources";
import { parseIndexDirectives } from "./index-directives";

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

function extractInitialAddressText(html: string): string {
  return html
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<([a-z][\w:-]*)\b(?=[^>]*(?:\shidden(?:\s|=|\/?>)|\saria-hidden\s*=\s*["']true["']|\sstyle\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)))[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
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

/**
 * Collect every URL in any sameAs array anywhere in the parsed JSON-LD, at any
 * nesting depth, deduplicated. sameAs is where directory and profile URLs
 * reach the entity graph, and per the Directory Submission playbook a captured
 * listing URL that never lands here is half-finished work.
 */
function collectSameAsUrls(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const n of node) collectSameAsUrls(n, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key.toLowerCase() === "sameas") {
      const vals = Array.isArray(value) ? value : [value];
      for (const v of vals) {
        if (typeof v === "string" && /^https?:\/\//i.test(v.trim())) out.add(v.trim());
      }
    }
    collectSameAsUrls(value, out);
  }
}

export function extractSchemaSummary(html: string): SchemaSummary {
  const scriptTags = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const types = new Set<string>();
  let invalidBlocks = 0;
  const parsed: unknown[] = [];
  // Track how many SEPARATE blocks declare a business entity, and whether any
  // block uses @graph. Organization + LocalBusiness + LegalService inside one
  // block (or one @graph) is the recommended law-firm pattern, not a conflict.
  const BUSINESS_TYPES = ["organization", "localbusiness", "legalservice"];
  let businessTypeBlockCount = 0;
  let hasGraph = false;
  for (const tag of scriptTags) {
    const jsonStr = tag.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "").trim();
    try {
      const obj = JSON.parse(jsonStr);
      parsed.push(obj);
      const blockTypes = new Set<string>();
      collectTypes(obj, blockTypes);
      for (const bt of blockTypes) types.add(bt);
      if (hasKeyDeep(obj, ["@graph"])) hasGraph = true;
      if (BUSINESS_TYPES.some((b) => blockTypes.has(b))) businessTypeBlockCount++;
    } catch { invalidBlocks++; }
  }
  const t = (name: string) => types.has(name);
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
    // A genuine conflict is two or more SEPARATE, unlinked business-entity
    // blocks (two disconnected business cards). Multiple entity types inside
    // one block, or linked through @graph, is correct rich schema, so it never
    // fires. Field case: preszlerlaw.com declares Organization + LegalService +
    // 22 LocalBusiness locations in one @graph, which is best practice.
    conflictingEntity: businessTypeBlockCount >= 2 && !hasGraph,
    sameAsUrls: (() => { const s = new Set<string>(); collectSameAsUrls(parsed, s); return [...s]; })(),
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

  const addressTextPresent = ADDRESS_RE.test(extractInitialAddressText(html));
  // Structured address markup is useful evidence that an address is declared,
  // but neither source establishes what a browser displays to a visitor.
  const hasAddressSignal = addressTextPresent || schema.fields.address;

  return {
    phoneVisible: PHONE_RE.test(bodyText),
    contactFormPresent: hasForm,
    addressTextPresent,
    consultationCta,
    policyPagePresent: /href=["'][^"']*(privacy|terms|disclaimer)/i.test(html),
    practiceAreaIntent: /\b(lawyer|attorney|law firm|legal|solicitor|barrister|counsel|litigation|real estate|immigration|criminal|family law|corporate|employment|estate|wills|probate|personal injury)\b/i.test(bodyText),
    serviceAreaLikely: likelyServiceAreaBusiness(bodyText, schema.fields.areaServed, hasAddressSignal),
    trust: {
      // Trust signals must be VISIBLE to a person, so they scan the extracted
      // body text, not the raw HTML. Field bug (marathonlaw.ca): scanning the
      // full HTML matched "rating" inside Squarespace's script-config JSON and
      // credited reviews the page does not show. Word-bounded "ratings?" also
      // stops crediting unrelated words that merely contain the substring.
      // testimonials also checks for structural quote+attribution markup
      // (hasTestimonialStructure), since real client quotes rarely use the
      // literal word "testimonial" (field case drglaw.ca: three attributed
      // client quotes, zero occurrences of "testimonial").
      testimonials: /(testimonial|what our clients say|client stories|in their words)/i.test(bodyLower) || hasTestimonialStructure(html),
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

/**
 * hreflang annotations.
 *
 * Only multi-language sites need them, so absence is unscored rather than a
 * defect: a single-language firm site is not missing anything. When
 * annotations do exist they are validated, because a malformed or
 * one-directional cluster silently suppresses the alternate-language tree
 * without any other symptom. Field gap: drglaw.ca publishes en-CA, pt-BR and
 * x-default and this audit was blind to all three.
 */
export function checkHreflang(html: string, pageUrl: string): CheckItem {
  const tags = html.match(/<link\b[^>]*\bhreflang\s*=\s*["'][^"']*["'][^>]*>/gi) || [];
  if (tags.length === 0) {
    return {
      label: "Hreflang annotations",
      status: "pass",
      scored: false,
      detail: "No hreflang annotations found. Only multi-language sites need them, so this is shown for completeness and not scored.",
    };
  }

  const entries = tags.map((t) => ({
    lang: (t.match(/\bhreflang\s*=\s*["']([^"']*)["']/i)?.[1] || "").trim(),
    href: (t.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1] || "").trim(),
  }));

  const LANG_RE = /^([a-z]{2,3}(-[a-z]{2,4})?|x-default)$/i;
  const badLang = entries.filter((e) => !LANG_RE.test(e.lang)).map((e) => e.lang || "(empty)");
  const missingHref = entries.filter((e) => !e.href).length;
  const relative = entries.filter((e) => e.href && !/^https?:\/\//i.test(e.href)).length;

  let selfReferenced = false;
  try {
    const self = new URL(pageUrl);
    selfReferenced = entries.some((e) => {
      if (!e.href) return false;
      try {
        const u = new URL(e.href, pageUrl);
        return u.hostname.replace(/^www\./, "") === self.hostname.replace(/^www\./, "")
          && (u.pathname.replace(/\/$/, "") || "/") === (self.pathname.replace(/\/$/, "") || "/");
      } catch { return false; }
    });
  } catch { selfReferenced = false; }

  const hasXDefault = entries.some((e) => e.lang.toLowerCase() === "x-default");
  const count = entries.length;

  if (badLang.length > 0 || missingHref > 0) {
    const problems: string[] = [];
    if (badLang.length > 0) problems.push(`invalid language code${badLang.length > 1 ? "s" : ""}: ${[...new Set(badLang)].join(", ")}`);
    if (missingHref > 0) problems.push(`${missingHref} annotation${missingHref > 1 ? "s" : ""} with no href`);
    return {
      label: "Hreflang annotations",
      status: "fail",
      detail: `${count} hreflang annotation${count > 1 ? "s" : ""} found, but ${problems.join(" and ")}. Search engines discard a cluster they cannot parse.`,
      fix: "Use valid ISO codes (for example en-CA, pt-BR) or x-default, and give every annotation an href.",
    };
  }

  if (!selfReferenced || relative > 0) {
    const problems: string[] = [];
    if (!selfReferenced) problems.push("no self-referencing annotation");
    if (relative > 0) problems.push(`${relative} relative URL${relative > 1 ? "s" : ""}`);
    return {
      label: "Hreflang annotations",
      status: "warn",
      detail: `${count} hreflang annotation${count > 1 ? "s" : ""} found, but ${problems.join(" and ")}. Google requires each page in a cluster to point at itself using absolute URLs.`,
      fix: "Add a self-referencing hreflang for this page and make every href an absolute https URL.",
    };
  }

  const xDefaultNote = hasXDefault ? " x-default is set." : " No x-default is set, which is optional but recommended for a language selector fallback.";
  return {
    label: "Hreflang annotations",
    status: "pass",
    detail: `${count} valid hreflang annotations with a self-reference.${xDefaultNote}`,
  };
}

/* 1. On-Page SEO */
function checkOnPageSeo(html: string, pageUrl: string): CategoryResult {
  const items: CheckItem[] = [];

  const rawTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const title = rawTitle ? decodeHtmlEntities(rawTitle) : rawTitle;
  if (!title) {
    items.push({ label: "Page title", status: "fail", detail: "No non-empty <title> text was found in the inspected HTML.", fix: "Add an accurate page title in the document head." });
    items.push({ label: "Page title length", status: "pass", scored: false, detail: "No title text was available for a length observation." });
  } else {
    items.push({ label: "Page title", status: "pass", detail: "A non-empty <title> was found in the inspected HTML." });
    items.push({ label: "Page title length", status: "pass", scored: false, detail: `The title contains ${title.length} characters. Length is recorded but not scored.` });
  }

  const desc = extractMetaContent(html, "description");
  if (!desc) {
    items.push({ label: "Meta description", status: "fail", detail: "No meta description was found in the inspected HTML. Search engines may generate a snippet from page content instead.", fix: "Consider adding an accurate summary of this page in the document head." });
  } else {
    items.push({ label: "Meta description", status: "pass", scored: false, detail: `Description present (${desc.length} characters). Length is recorded but not scored.` });
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

  // Missing alt attribute, empty alt="" on a decorative image, and empty
  // alt="" on an icon-only link/button are three different findings with
  // three different fixes; collapsing them into one "missing alt text" count
  // flags a correctly-decorative image as an accessibility failure (field
  // case drglaw.ca: alt="" on a full-bleed background image). See
  // content-signals.ts for the classification rules.
  const altSummary = summarizeImageAlt(html);
  if (altSummary.total === 0) {
    items.push({ label: "Image alt text", status: "pass", detail: "No images found to check." });
  } else if (altSummary.missing === 0 && altSummary.suspiciousEmpty === 0) {
    const decorativeNote = altSummary.decorative > 0 ? ` (${altSummary.decorative} correctly decorative with alt="")` : "";
    items.push({ label: "Image alt text", status: "pass", detail: `All ${altSummary.total} images have alt text or a valid empty alt${decorativeNote}.` });
  } else if (altSummary.missing > 0) {
    const pct = Math.round((altSummary.missing / altSummary.total) * 100);
    items.push({ label: "Image alt text", status: pct > 50 ? "fail" : "warn", detail: `${altSummary.missing} of ${altSummary.total} images (${pct}%) have no alt attribute at all. This is an accessibility failure: screen readers fall back to announcing the file name.`, fix: "Add a descriptive alt attribute to every <img> tag that lacks one. Purely decorative images should get alt=\"\", not a missing attribute." });
  } else {
    items.push({ label: "Image alt text", status: "warn", detail: `${altSummary.suspiciousEmpty} image${altSummary.suspiciousEmpty > 1 ? "s" : ""} with alt="" ${altSummary.suspiciousEmpty > 1 ? "are" : "is"} the only content of a link or button with no other accessible label. This needs a human look: confirm the image is decorative, or give the control real alt text or an aria-label.`, fix: "For each flagged control, add descriptive alt text (or an aria-label on the link/button) if the image conveys meaning; leave alt=\"\" only if the control has another visible label." });
  }

  const langAttr = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  if (langAttr) {
    items.push({ label: "HTML lang attribute", status: "pass", detail: `Set to "${langAttr[1]}". Helps search engines serve the right audience.` });
  } else {
    items.push({ label: "HTML lang attribute", status: "warn", detail: "Missing. Tells browsers and search engines the page's primary language.", fix: "Add lang=\"en\" (or your language code) to the <html> tag." });
  }

  items.push(checkHreflang(html, pageUrl));

  const { score, maxScore } = scoreItems(items);
  return { name: "On-Page SEO", score, maxScore, items };
}

/* 2. Indexability */
function checkIndexability(idx: Indexability, robotsAllowed: { google: boolean | null }): CategoryResult {
  const items: CheckItem[] = [];

  const successfulResponse = idx.httpStatus >= 200 && idx.httpStatus < 300;
  items.push({ label: "HTTP status", status: successfulResponse ? "pass" : "fail", detail: `Returned HTTP ${idx.httpStatus}${successfulResponse ? "." : "; a 2xx response was not observed."}` });

  items.push({
    label: "Redirect chain",
    status: idx.redirectHops > 0 ? "warn" : "pass",
    scored: false,
    detail: idx.redirectHops > 0
      ? `${idx.redirectHops} redirect hop${idx.redirectHops > 1 ? "s" : ""} were observed before this page. Redirects are normal URL behavior; this count alone does not establish a search defect.`
      : "No redirect hop was observed before this page.",
  });

  const googleNoindex = idx.googleDirectives?.noindex ?? (idx.metaNoindex || idx.headerNoindex ? "observed" : "not-observed");
  if (googleNoindex === "observed") {
    items.push({ label: "Indexable", status: "fail", detail: "The inspected HTML or response headers contain a noindex instruction addressed to Google. Google can act on it only if it retrieves this response; this does not confirm current indexing status.", fix: "Confirm whether this page should appear in search before changing its noindex setting." });
  } else if (googleNoindex === "unknown") {
    items.push({ label: "Indexable", status: "warn", scored: false, applicability: "unknown", detail: "Google applicability of a page-level robots directive could not be determined from the inspected HTML or response headers. Noindex status is unknown; no fix is recommended from this observation." });
  } else {
    items.push({ label: "Indexable", status: "pass", detail: "No generic or Googlebot-specific noindex instruction was observed in the inspected HTML or response headers. This does not confirm the page is indexed." });
  }

  const googleNofollow = idx.googleDirectives?.nofollow;
  items.push({
    label: "Followable links",
    status: googleNofollow === "unknown" ? "warn" : idx.metaNofollow || idx.headerNofollow ? "warn" : "pass",
    ...(googleNofollow === "unknown" ? { scored: false, applicability: "unknown" as const } : {}),
    scored: false,
    detail: idx.metaNofollow || idx.headerNofollow
      ? `A page-level nofollow directive was observed${idx.metaNofollow ? " in meta robots" : " in X-Robots-Tag"}. This records policy only; it does not establish how every link will be treated.`
      : googleNofollow === "unknown"
        ? "Google scope for a page-level nofollow directive could not be determined from the inspected response and HTML."
        : "No page-level nofollow directive was observed in the inspected response and HTML.",
  });

  items.push({
    label: "Canonical tag",
    status: !idx.canonical || idx.canonicalSelf === false || idx.canonicalSameOrigin === false ? "warn" : "pass",
    scored: false,
    detail: !idx.canonical
      ? "No canonical annotation was observed. Canonicals are optional signals; their absence alone does not establish a search defect."
      : `Canonical annotation observed: ${idx.canonical}. Google may select a different canonical; this scan does not verify that selection.`,
  });

  items.push({
    label: "Mixed indexability signals",
    status: idx.mixedSignals == null ? "warn" : idx.mixedSignals ? "warn" : "pass",
    ...(idx.mixedSignals == null ? { applicability: "unknown" as const } : {}),
    scored: false,
    detail: idx.mixedSignals == null
      ? "Google applicability of the noindex instruction could not be determined, so the mixed-signal combination was not assessed."
      : idx.mixedSignals
      ? "A noindex instruction and a different same-origin canonical annotation were observed. This records configuration only; the intended URL and actual indexing outcome were not assessed."
      : "No noindex and different-canonical combination was observed in the inspected signals. This does not confirm indexing status.",
  });

  if (robotsAllowed.google === false) {
    items.push({ label: "robots.txt crawl access", status: "fail", detail: "A matching robots.txt rule restricts Googlebot on this page path. This records crawl policy only; it does not establish whether the URL is indexed.", fix: "Confirm whether this Googlebot restriction is intentional before changing it." });
  } else if (robotsAllowed.google === null) {
    items.push({ label: "robots.txt crawl access", status: "warn", scored: false, applicability: "unknown", detail: "Could not assess Googlebot access for this page because no accessible robots.txt was observed." });
  } else {
    items.push({ label: "robots.txt crawl access", status: "pass", detail: "No matching robots.txt rule for Googlebot was observed on this page path. This does not establish whether the URL is indexed." });
  }

  if (idx.inSitemap === null && !idx.sitemapComplete) {
    items.push({ label: "Sitemap membership", status: "warn", scored: false, applicability: "unknown", detail: "Could not verify whether this page was listed in the sitemap locations inspected. A bounded check does not establish a site-wide sitemap inventory." });
  } else if (idx.inSitemap === null) {
    items.push({ label: "Sitemap membership", status: "warn", scored: false, detail: "No sitemap was observed at the checked locations. Some sites do not need a sitemap; search engines may discover pages through links." });
  } else if (idx.inSitemap) {
    items.push({ label: "Sitemap membership", status: "pass", scored: false, detail: "This page URL was observed in the sitemap data inspected. Sitemap membership is an optional discovery signal." });
  } else {
    items.push({ label: "Sitemap membership", status: "warn", scored: false, detail: "This page URL was not found in the sitemap data inspected. Sitemap membership is optional for some sites; this observation alone is not a search defect." });
  }

  const { score, maxScore } = scoreItems(items);
  return { name: "Indexability", score, maxScore, items };
}

/* 3. Schema & Structured Data */

/**
 * Known entity surfaces, keyed by a hostname fragment. Wave 1-R and Wave 1-P
 * from PB_Capture_DirectorySubmission_v5.html, plus the social profiles firms
 * commonly publish. Social profiles count as sameAs hygiene but NOT as
 * directory coverage: they are not citation surfaces.
 */
const ENTITY_SURFACES: Array<{ match: RegExp; name: string; directory: boolean }> = [
  { match: /(^|\.)google\.[a-z.]+\/maps|maps\.google\.|(^|\.)g\.page/i, name: "Google Business Profile", directory: true },
  { match: /(^|\.)bing\.com\/(maps|forbusiness)|bingplaces\.com/i, name: "Bing Places", directory: true },
  { match: /maps\.apple\.com/i, name: "Apple Business Connect", directory: true },
  { match: /lso\.ca/i, name: "Law Society of Ontario", directory: true },
  { match: /yellowpages\.ca|(^|\.)yp\.ca/i, name: "Yellow Pages Canada", directory: true },
  { match: /canada411\.ca/i, name: "Canada411", directory: true },
  { match: /canadianlawlist\.com/i, name: "Canadian Law List", directory: true },
  { match: /bbb\.org/i, name: "Better Business Bureau", directory: true },
  { match: /linkedin\.com/i, name: "LinkedIn", directory: false },
  { match: /instagram\.com/i, name: "Instagram", directory: false },
  { match: /facebook\.com/i, name: "Facebook", directory: false },
  { match: /(^|\.)x\.com|twitter\.com/i, name: "X", directory: false },
  { match: /youtube\.com/i, name: "YouTube", directory: false },
];

/**
 * Entity sameAs coverage.
 *
 * This check reports only the sameAs URLs observed in the inspected structured
 * data. It cannot establish which profiles or listings the firm maintains or
 * intends to associate, or how any search or AI service interprets them.
 *
 * Deliberately NOT checked: whether the values match what those surfaces
 * publish. The playbook's purpose-class rule says an approved difference is not
 * a defect, and this engine cannot see the client's exception register, so a
 * cross-surface consistency finding would be a coin flip presented as fact.
 */
export function checkEntitySameAs(schema: SchemaSummary, hasBusiness: boolean): CheckItem {
  if (!hasBusiness) {
    return {
      label: "Entity sameAs coverage",
      status: "pass",
      scored: false,
      applicability: "not-applicable",
      detail: "Not applicable: no business entity in the structured data to attach profile or listing URLs to.",
    };
  }

  const urls = schema.sameAsUrls;
  if (urls.length === 0) {
    return {
      label: "Entity sameAs coverage",
      status: "pass",
      scored: false,
      detail: "No sameAs URLs were observed in the business entity's structured data. This scan cannot establish which profiles or listings the firm maintains or intends to associate.",
    };
  }

  const matched = ENTITY_SURFACES.filter((s) => urls.some((u) => s.match.test(u)));
  const directories = matched.filter((s) => s.directory).map((s) => s.name);
  const socials = matched.filter((s) => !s.directory).map((s) => s.name);
  const unrecognised = urls.length - matched.length;

  const found = [
    directories.length > 0 ? `directories: ${directories.join(", ")}` : null,
    socials.length > 0 ? `profiles: ${socials.join(", ")}` : null,
    unrecognised > 0 ? `${unrecognised} other URL${unrecognised > 1 ? "s" : ""}` : null,
  ].filter(Boolean).join("; ");

  if (directories.length >= 3) {
    return {
      label: "Entity sameAs coverage",
      status: "pass",
      scored: false,
      detail: `${urls.length} sameAs URLs covering ${directories.length} directory surfaces (${found}).`,
    };
  }

  if (directories.length === 0) {
    return {
      label: "Entity sameAs coverage",
      status: "pass",
      scored: false,
      detail: `${urls.length} sameAs URLs were observed, but none matched a directory or map surface recognized by this check (${found}). This does not establish the firm's local entity status.`,
    };
  }

  return {
    label: "Entity sameAs coverage",
    status: "pass",
    scored: false,
      detail: `${urls.length} sameAs URLs were observed, including ${directories.length} directory surface${directories.length > 1 ? "s" : ""} recognized by this check (${found}). This scan cannot determine whether other claimed listings exist or should be associated.`,
      fix: "Confirm which official profile and directory URLs should be associated with the business entity.",
  };
}

// serviceAreaLikely defaults to false so the direct-call tests (e.g.
// acceptance-trust-pass.test.ts, schema-recs.test.ts) that predate the
// service-area detection keep working without threading it through.
export function checkSchemaMarkup(schema: SchemaSummary): CategoryResult {
  const items: CheckItem[] = [];

  if (schema.blocks === 0) {
    items.push({ label: "JSON-LD structured data", status: "pass", scored: false, detail: "No JSON-LD block was observed in the inspected HTML. Other structured-data formats and rendered markup were not assessed." });
  } else {
    items.push({ label: "JSON-LD structured data", status: "pass", detail: `${schema.blocks} JSON-LD block${schema.blocks > 1 ? "s" : ""} found.` });
  }

  if (schema.blocks === 0) {
    items.push({ label: "JSON-LD validity", status: "pass", scored: false, detail: "No JSON-LD blocks were observed to validate." });
  } else if (schema.invalidBlocks > 0) {
    items.push({ label: "JSON-LD validity", status: "pass", scored: false, detail: `${schema.invalidBlocks} of ${schema.blocks} inspected blocks could not be parsed as JSON. Rich-result eligibility and effects were not assessed.` });
  } else {
    items.push({ label: "JSON-LD validity", status: "pass", scored: false, detail: `${schema.blocks} inspected JSON-LD block${schema.blocks > 1 ? "s" : ""} parsed as JSON. This does not establish eligibility or search display.` });
  }

  const hasBusiness = schema.hasLocalBusiness || schema.hasLegalService || schema.hasAttorney || schema.hasOrganization;
  if (hasBusiness) {
    items.push({ label: "Business / LegalService schema", status: "pass", scored: false, detail: "A business-related JSON-LD type was observed. Presence alone does not establish eligibility, accuracy, or rich-result display." });
  } else {
    items.push({ label: "Business / LegalService schema", status: "pass", scored: false, detail: "No Organization, LocalBusiness, LegalService, or Attorney JSON-LD type was observed. Other structured-data formats and rendered markup were not assessed." });
  }

  if (hasBusiness) {
    const observed = Object.entries(schema.fields).filter(([, present]) => present).map(([name]) => name);
    items.push({ label: "Business schema fields", status: "pass", scored: false, detail: observed.length
      ? `Observed fields: ${observed.join(", ")}. Field presence is recorded; this check does not assess completeness or requirements.`
      : "No listed business fields were observed in the inspected JSON-LD. Completeness and requirements were not assessed." });
  } else {
    items.push({ label: "Business schema fields", status: "pass", scored: false, detail: "No business-related JSON-LD entity was observed for field review." });
  }

  // FAQPage is an optional markup observation. Google retired FAQ rich
  // results and removed the corresponding Search documentation in 2026.
  if (schema.hasFaq) {
    items.push({ label: "FAQPage schema", status: "pass", scored: false, detail: "FAQPage markup was observed. Its presence is optional and does not establish search display." });
  } else {
    items.push({ label: "FAQPage schema", status: "pass", scored: false, detail: "No FAQPage markup was observed. Its absence is not scored; visible question-and-answer content is a separate observation." });
  }

  // Presence/absence is an observation only. This scan does not establish
  // review accuracy, eligibility, or how search systems display it.
  if (schema.hasReview) {
    items.push({ label: "Review / Rating schema", status: "pass", scored: false, detail: "Review or rating markup was observed. Accuracy, eligibility, and search display were not assessed." });
  } else {
    items.push({ label: "Review / Rating schema", status: "pass", scored: false, detail: "No review or rating markup was observed. Its absence is not scored." });
  }

  if (schema.hasBreadcrumb) {
    items.push({ label: "Breadcrumb schema", status: "pass", scored: false, detail: "Breadcrumb markup was observed. This scan does not assess eligibility or search display." });
  } else {
    items.push({ label: "Breadcrumb schema", status: "pass", scored: false, detail: "No breadcrumb markup was observed. Its absence is not scored." });
  }

  if (schema.conflictingEntity) {
    items.push({ label: "Schema conflicts", status: "warn", detail: "Business entity types are declared in separate, unlinked blocks, which can read as competing entities.", fix: "Connect them in one @graph, or link them with @id references, so parsers read a single business entity." });
  } else if (schema.blocks === 0) {
    // Vacuous pass: a site with no JSON-LD has no declarations that could
    // conflict. Crediting it for the absence of a defect inside a feature it
    // does not have is how a site with zero structured data used to score 34%
    // in this category. Shown for completeness, scored zero either way.
    items.push({ label: "Schema conflicts", status: "pass", scored: false, detail: "Not applicable: no structured data blocks on the page, so there is nothing that could conflict." });
  } else {
    items.push({ label: "Schema conflicts", status: "pass", detail: "No conflicting business entity declarations." });
  }

  items.push(checkEntitySameAs(schema, hasBusiness));

  const { score, maxScore } = scoreItems(items);
  return { name: "Schema & Structured Data", score, maxScore, items };
}

/* 4. AI Visibility */
export function checkAiVisibility(html: string, _parsedRobots: ParsedRobots | null, llmsTxt: string | null, schema: SchemaSummary): CategoryResult {
  const items: CheckItem[] = [];
  const bodyText = extractBodyText(html);

  items.push({
    label: "AI search bot access", status: "pass", scored: false,
    detail: "Provider-specific robots.txt policy observations are listed separately. This check does not establish crawler access, search visibility, or citations.",
  });
  items.push({
    label: "AI training bot control", status: "pass", scored: false,
    detail: "Provider crawler purposes differ and may include search, grounding, training, product indexing, or dataset collection. A robots.txt rule records policy only; actual fetching and downstream use were not verified.",
  });

  const orgDesc = extractMetaContent(html, "description");
  if ((schema.hasOrganization || schema.hasLocalBusiness || schema.hasLegalService) && schema.fields.name) {
    items.push({ label: "Entity description", status: "pass", detail: "A named business entity was observed in structured data." });
  } else {
    items.push({ label: "Entity description", status: "pass", detail: orgDesc
      ? "A meta description was observed; no named entity was found in the inspected JSON-LD. Other formats and rendered markup were not assessed."
      : "No named entity was found in the inspected JSON-LD. Other formats and rendered markup were not assessed." });
  }

  if (schema.hasAttorney || schema.hasPerson) {
    items.push({ label: "Attorney / person schema", status: "pass", detail: "Attorney or Person schema was observed in the inspected HTML." });
  } else {
    items.push({ label: "Attorney / person schema", status: "pass", detail: "No Attorney or Person JSON-LD type was observed. Its absence is optional and does not establish whether lawyer details appear elsewhere." });
  }

  const h2s = extractAllTags(html, "h2");
  const h3s = extractAllTags(html, "h3");
  const questionHeadings = [...h2s, ...h3s].filter(
    (h) => h.endsWith("?") || /^(what|how|when|where|why|who|can|do|does|is|are|should|will)\b/i.test(h)
  );
  items.push({ label: "Question-format headings", status: "pass", scored: false, detail: `${questionHeadings.length} headings matched this question-format pattern in initial HTML. This is a formatting observation; no question format is required by this check.` });

  // Boundary note: this is a coarse, general-purpose structural heuristic for
  // ANY external site scanned by this public/operator tool, with no access to
  // authored editorial metadata. It is a separate, disconnected system from
  // Content Studio's own direct-answer / quotable-definition doctrine
  // (docs/CONTENT_STUDIO_SEO_AEO_SPEC.md Section 4A, enforced by
  // validateDirectAnswerDefinition in src/lib/content-validators.ts), which
  // is the authoritative check for CaseLoad-authored long-form content: it
  // reads the operator's actual applicability/classification/source decision
  // rather than guessing from sentence shape. Do not treat this check's
  // pass/fail as a proxy for that doctrine's compliance.
  const sentences = bodyText.split(/[.!?]+/).filter((s) => s.trim().length > 20);
  const directAnswers = sentences.filter((s) => /\b(is|are|means|refers to|defined as|consists of|requires|involves)\b/i.test(s));
  items.push({ label: "Direct-answer sentences", status: "pass", scored: false, detail: `${directAnswers.length} sentences matched a broad wording pattern in initial HTML. This is not an assessment of answer quality or AI visibility.` });

  const anchorTags = html.match(/<a[^>]+href=["']https?:\/\/([^"']+)["']/gi) || [];
  const authoritative = anchorTags.filter((a) => /\.(gov|edu)|canlii|justice|courts?|lawsociety|cba\.org|ontario\.ca|canada\.ca/i.test(a));
  items.push({ label: "Authoritative citations", status: "pass", scored: false, detail: `${authoritative.length} external links matched this check's list of government, court, or legal organization domains. This list does not assess source quality or completeness.` });

  const hasAuthorMeta = extractMetaContent(html, "author") !== null;
  items.push({ label: "Author / reviewer signals", status: "pass", scored: false, detail: hasAuthorMeta || schema.hasPerson || schema.hasAttorney
    ? "An author meta tag or Person/Attorney JSON-LD was observed. Identity, qualifications, and other page content were not assessed."
    : "No author meta tag or Person/Attorney JSON-LD was observed. Other formats and content were not assessed." });

  if (llmsTxt && llmsTxt.length > 50) {
    items.push({ label: "llms.txt file", status: "pass", scored: false, detail: "An llms.txt file was fetched. Its content and effects were not assessed; this file is optional and is not required by this check." });
  } else {
    items.push({ label: "llms.txt file", status: "pass", scored: false, detail: "No llms.txt file was observed. It is optional and its absence is not scored." });
  }

  const semanticTags = ["<header", "<nav", "<main", "<article", "<section", "<footer"];
  const foundSemantic = semanticTags.filter((tag) => html.toLowerCase().includes(tag));
  items.push({ label: "Semantic HTML structure", status: "pass", scored: false, detail: `${foundSemantic.length} of this check's listed semantic element types were observed in initial HTML. This structural observation is not a measure of AI visibility.` });

  const unscoredItems = items.map((item) => ({ ...item, scored: false }));
  const { score, maxScore } = scoreItems(unscoredItems);
  return { name: "AI Visibility", score, maxScore, items: unscoredItems };
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

  items.push({
    label: "Address / NAP",
    status: "pass",
    scored: false,
    detail: signals.addressTextPresent
      ? "A street-address pattern was found in initial HTML text outside explicit hidden/template markup. This does not confirm what a browser displays."
      : "No street-address pattern was found in initial HTML text. This does not assess rendered visibility or whether the firm needs a published office address.",
  });

  const trust = signals.trust;
  const hasTrustCues = [trust.testimonials, trust.reviews, trust.caseResults, trust.awards, trust.credentials].some(Boolean);
  items.push({
    label: "Trust signals",
    status: "pass",
    scored: false,
    detail: hasTrustCues
      ? "Some review, experience, award, or credential references were detected in the initial page text. Their accuracy and quality were not assessed."
      : "No review, experience, award, or credential references were detected in the initial page text. This observation does not assess credibility or professional status.",
  });

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
function checkLocalSeo(html: string, schema: SchemaSummary, serviceAreaLikely: boolean): CategoryResult {
  const items: CheckItem[] = [];
  const bodyText = html.replace(/<[^>]+>/g, " ");

  items.push(PHONE_RE.test(bodyText)
    ? { label: "Phone number (NAP)", status: "pass", detail: "Phone number found on page." }
    : { label: "Phone number (NAP)", status: "fail", detail: "No phone number found. Local SEO depends on visible NAP.", fix: "Add the firm's phone number to the header or footer." });

  items.push({
    label: "Street address (NAP)",
    status: "pass",
    scored: false,
    detail: serviceAreaLikely
      ? "No address text was found in the initial HTML; separate area-served and remote-practice signals were detected. Neither establishes what a browser displays or whether an office address is required."
      : "Address text in initial HTML is recorded in Address / NAP above. This check does not assess rendered visibility or whether the firm needs a published office address.",
  });

  items.push(/google\.com\/maps|maps\.googleapis\.com|gmp-map/i.test(html)
    ? { label: "Google Maps embed", status: "pass", detail: "Maps integration found." }
    : { label: "Google Maps embed", status: "warn", detail: "No Google Maps embed. A map reinforces location authority.", fix: "Embed a Google Map showing the office location." });

  items.push((schema.fields.telephone || schema.fields.address)
    ? { label: "NAP in structured data", status: "pass", detail: "Contact info found in JSON-LD." }
    : { label: "NAP in structured data", status: "fail", detail: "No NAP in structured data.", fix: "Add telephone, address, and name to a LocalBusiness or LegalService schema block." });

  // maps/dir directions links embed the firm's Google place ID, and a
  // maps?cid= link is the permalink format Google issues from a verified
  // Business Profile, so both tie the site to its GBP entity just like a
  // maps/place link does. Field cases: marathonlaw.ca (two /maps/dir/ office
  // links) and drglaw.ca (a maps?cid= link under "Public client reviews from
  // Google") both read as no GBP link at all under the narrower regex.
  items.push(hasGoogleBusinessProfileLink(html)
    ? { label: "Google Business Profile link", status: "pass", detail: "GBP link found. Cross-linking strengthens local authority." }
    : { label: "Google Business Profile link", status: "warn", detail: "No link to Google Business Profile.", fix: "Link to the firm's Google Business Profile in the footer or contact section." });

  const { score, maxScore } = scoreItems(items);
  return { name: "Local SEO", score, maxScore, items };
}

// Mixed content is a genuinely LOADED http:// sub-resource on an https page.
// The old detector matched any src=/href="http://, which fired on <a href>
// navigations and, worse, on <link rel="profile" href="http://gmpg.org/xfn/11">
// (a WordPress XFN declaration the browser never fetches) that ships on every
// WordPress install: a false positive a prospect can rebut live. This counts
// only fetched sub-resources: src / srcset / poster / lazy-load data-src,
// <object data>, CSS url()/@import, and <link> whose rel actually loads a
// resource. <a href>, form-field values, data-* config, and declaration rels
// (profile / canonical / dns-prefetch / pingback / alternate) are excluded.
// rel tokens that actually fetch a resource. Matched as EXACT tokens, not
// substrings: rel="dns-prefetch" must not match "prefetch", and rel="profile"
// (the WordPress XFN declaration) must not match anything.
const RESOURCE_LINK_RELS = new Set([
  "stylesheet", "preload", "prefetch", "modulepreload", "icon", "shortcut", "apple-touch-icon", "manifest",
]);
export function countMixedContentResources(html: string): number {
  let count = 0;
  count += (html.match(/\b(?:src|data-src|data-lazy-src|srcset|poster)=["']http:\/\//gi) || []).length;
  count += (html.match(/<object\b[^>]*\bdata=["']http:\/\//gi) || []).length;
  count += (html.match(/(?:url\(|@import\s+(?:url\()?)\s*["']?http:\/\//gi) || []).length;
  // <link> only when it loads a resource. rel can carry multiple tokens and
  // sit before or after href, so tokenise rel rather than assume order.
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (!/\bhref=["']http:\/\//i.test(tag)) continue;
    const rel = (tag.match(/\brel=["']([^"']*)["']/i)?.[1] || "").toLowerCase();
    if (rel.split(/\s+/).some((t) => RESOURCE_LINK_RELS.has(t))) count++;
  }
  return count;
}

/* 7. Technical & Security */
export function checkTechnicalSecurity(html: string, url: string, headers: Headers): CategoryResult {
  const items: CheckItem[] = [];

  items.push(url.startsWith("https://")
    ? { label: "HTTPS", status: "pass", detail: "The inspected page response used HTTPS." }
    : { label: "HTTPS", status: "fail", detail: "The inspected page response used HTTP, so transport was not encrypted.", fix: "Ask your provider to enable HTTPS for this page and verify the final URL." });

  const mixedCount = countMixedContentResources(html);
  items.push(mixedCount === 0
    ? { label: "Mixed content", status: "pass", detail: "No insecure HTTP resources detected." }
    : { label: "Mixed content", status: "warn", detail: `${mixedCount} HTTP resource${mixedCount > 1 ? "s" : ""} on an HTTPS page.`, fix: "Change all http:// resource URLs to https:// or use protocol-relative URLs." });

  // Trust-fix pass WI-5: CSP, HSTS, and X-Content-Type-Options are security
  // hygiene, not search-visibility signals. They stay visible (and their
  // issues-list findings keep firing at their calibrated severities) but are
  // excluded from the score, so a site cannot grade higher merely for having
  // them, and a placeholder site with none is not marked down for it either.
  // HTTPS and Mixed content above remain scored: they directly affect
  // accessibility and search eligibility.
  const hsts = headers.get("strict-transport-security");
  if (hsts) {
    const maxAge = parseInt(hsts.match(/max-age=(\d+)/)?.[1] || "0");
    items.push(maxAge >= 31536000
      ? { label: "HSTS header", status: "pass", scored: false, detail: "Present with max-age of at least one year. Security hygiene; shown for completeness and excluded from the SEO score." }
      : { label: "HSTS header", status: "warn", scored: false, detail: `Present but max-age is low (${maxAge}s). Recommended: at least 31536000. Security hygiene; shown for completeness and excluded from the SEO score.`, fix: "Set Strict-Transport-Security: max-age=31536000; includeSubDomains." });
  } else {
    items.push({ label: "HSTS header", status: "warn", scored: false, detail: "Missing. HSTS tells browsers to always use HTTPS. Security hygiene; shown for completeness and excluded from the SEO score.", fix: "Add Strict-Transport-Security: max-age=31536000; includeSubDomains to response headers." });
  }

  const xcto = headers.get("x-content-type-options");
  items.push(xcto?.toLowerCase() === "nosniff"
    ? { label: "X-Content-Type-Options", status: "pass", scored: false, detail: "Set to nosniff. Security hygiene; shown for completeness and excluded from the SEO score." }
    : { label: "X-Content-Type-Options", status: "warn", scored: false, detail: "Missing or incorrect. Prevents MIME-type sniffing. Security hygiene; shown for completeness and excluded from the SEO score.", fix: "Add X-Content-Type-Options: nosniff to response headers." });

  // See classifyCsp for why report-only is credited as progress in flight,
  // not scored the same as a missing policy; the matching exception in
  // analysis.ts's severity coverage bump keeps a sitewide rollout in
  // progress from being inflated back up to a "genuinely missing" severity.
  // Security hygiene (WI-5): CSP, like HSTS and X-Content-Type-Options above,
  // is excluded from the SEO score so its presence or absence never moves the
  // grade. classifyCsp additionally recognizes report-only mode (the trust
  // pass predates that distinction and read report-only as flatly "Missing"),
  // so a rollout in progress is neither scored nor described as an absent
  // control. See classifyCsp's own docblock for why the detail leads with
  // "Monitoring enabled ... enforcement still pending."
  const csp = headers.get("content-security-policy");
  const cspReportOnly = headers.get("content-security-policy-report-only");
  items.push({ label: "Content-Security-Policy", scored: false, ...classifyCsp(csp, cspReportOnly) });

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
// One HTTP round trip is not a performance measurement, it is a sample; see
// classifyTtfb in content-signals.ts for why single- and multi-sample
// readings are scored differently.
function checkPerformance(html: string, ttfb: TtfbMeasurement, pageHostname: string): CategoryResult {
  const items: CheckItem[] = [];
  items.push({ label: "Time to first byte", ...classifyTtfb(ttfb) });

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

  items.push({ label: "Word count", status: "pass", scored: false, detail: `${words.toLocaleString()} words in the extracted initial HTML text. Quantity is recorded but not scored.` });

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

  items.push({ label: "Internal links", status: "pass", scored: false, detail: `${internalCount} internal links found in the initial HTML. Link count is recorded but not scored.` });

  const ratio = html.length > 0 ? Math.round((bodyText.length / html.length) * 100) : 0;
  items.push({ label: "Content-to-HTML ratio", status: "pass", scored: false, detail: `${ratio}% extracted text relative to the initial HTML size. This rough ratio is recorded but not scored.` });

  if (genericAnchors.length === 0) items.push({ label: "Anchor text quality", status: "pass", detail: "Links use descriptive text." });
  else if (genericAnchors.length <= 2) items.push({ label: "Anchor text quality", status: "warn", detail: `${genericAnchors.length} link${genericAnchors.length > 1 ? "s" : ""} with generic text.`, fix: "Replace \"click here\" and \"learn more\" with descriptive text." });
  else items.push({ label: "Anchor text quality", status: "fail", detail: `${genericAnchors.length} links with generic text.`, fix: "Replace generic links with descriptive anchor text." });

  items.push({ label: "External links", status: "pass", scored: false, detail: `${externalCount} external links found in the initial HTML. Link count is recorded but not scored.` });

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
  sitemapSet: Set<string> | null,
  sitemapComplete = true
): Indexability {
  const googleDirectives = parseIndexDirectives(html, headers.get("x-robots-tag") ? [headers.get("x-robots-tag")!] : []);
  const metaNoindex = googleDirectives.observations.some((o) => o.source === "meta" && o.googleApplicability === "applicable" && o.effectiveDirectives.some((d) => d === "noindex" || d === "none"));
  const metaNofollow = googleDirectives.observations.some((o) => o.source === "meta" && o.googleApplicability === "applicable" && o.effectiveDirectives.some((d) => d === "nofollow" || d === "none"));
  const headerNoindex = googleDirectives.observations.some((o) => o.source === "x-robots-tag" && o.googleApplicability === "applicable" && o.effectiveDirectives.some((d) => d === "noindex" || d === "none"));
  const headerNofollow = googleDirectives.observations.some((o) => o.source === "x-robots-tag" && o.googleApplicability === "applicable" && o.effectiveDirectives.some((d) => d === "nofollow" || d === "none"));

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

  const noindex = googleDirectives.noindex === "observed";
  const mixedSignals = googleDirectives.noindex === "unknown" ? null : noindex && canonicalSelf === false && canonicalSameOrigin !== false;

  let inSitemap: boolean | null = null;
  if (sitemapSet && sitemapSet.size > 0) {
    // sitemapSet is keyed with the same canonical crawl key used for dedupe.
    inSitemap = sitemapSet.has(crawlUrlKey(finalUrl));
    // Homepage discovery does not depend on sitemap membership, but membership
    // is still reported only when the URL itself was observed.
    // If the sitemap was too large or incomplete to read fully, a missing URL
    // stays unknown rather than being reported as absent.
    if (!inSitemap && !sitemapComplete) inSitemap = null;
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
    indexable: googleDirectives.noindex === "unknown" ? null : !noindex,
    googleDirectives,
    inSitemap,
    sitemapComplete,
    mixedSignals,
  };
}

function robotsAllowedFor(parsedRobots: ParsedRobots | null, path: string): { scanner: boolean | null; google: boolean | null; bing: boolean | null } {
  if (!parsedRobots) return { scanner: null, google: null, bing: null };
  return {
    scanner: !checkBotBlockedParsed(parsedRobots, SCANNER_TOKEN, path),
    google: !checkBotBlockedParsed(parsedRobots, "Googlebot", path),
    bing: !checkBotBlockedParsed(parsedRobots, "Bingbot", path),
  };
}

export function buildPageResult(
  html: string,
  finalUrl: string,
  requestedUrl: string,
  headers: Headers,
  ttfb: TtfbMeasurement,
  redirectHops: number,
  domain: string,
  parsedRobots: ParsedRobots | null,
  llmsTxt: string | null,
  sitemapSet: Set<string> | null,
  intent: NormalizedIntent | null,
  sitemapComplete = true
): PageResult {
  const pageHostname = new URL(finalUrl).hostname.replace(/^www\./, "");
  const rawPageTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;
  const title = rawPageTitle ? decodeHtmlEntities(rawPageTitle) : null;
  const pageType = classifyPageType(finalUrl);

  const schema = extractSchemaSummary(html);
  const lawFirm = extractLawFirmSignals(html, schema);
  const idx = buildIndexability(html, headers, finalUrl, requestedUrl, redirectHops, domain, sitemapSet, sitemapComplete);
  const bodyText = extractBodyText(html);
  const wordCount = countWords(bodyText);
  const rendering = analyzeRenderingSnapshot(html, wordCount);
  const pageAudit = buildPageAuditSnapshot(html);
  const intentAlignment = intent
    ? analyzePageIntent({ html, url: finalUrl, title, wordCount, schemaTypes: schema.types, intent })
    : undefined;
  const path = (() => { try { return new URL(finalUrl).pathname || "/"; } catch { return "/"; } })();
  const robotsAllowed = robotsAllowedFor(parsedRobots, path);

  const rawCategories: CategoryResult[] = [
    checkOnPageSeo(html, finalUrl),
    checkIndexability(idx, robotsAllowed),
    checkSchemaMarkup(schema),
    checkAiVisibility(html, parsedRobots, llmsTxt, schema),
    checkLegalMarketing(lawFirm),
    checkLocalSeo(html, schema, lawFirm.serviceAreaLikely),
    checkTechnicalSecurity(html, finalUrl, headers),
    buildRenderingCategory(rendering),
    checkPerformance(html, ttfb, pageHostname),
    checkLinksContent(html, pageHostname),
  ];
  const intentCategory = buildIntentCategory(intentAlignment ?? null);
  if (intentCategory) rawCategories.push(intentCategory);

  // Downgrade checks that do not apply to this page's type (AEO/content
  // depth checks off practice/faq/blog pages, breadcrumb schema on the
  // homepage/language root) BEFORE scoring, page-level aggregation, and
  // issue-building all run off this same categories array. See
  // engine-core.ts's applyPageTypeApplicability.
  const applicableCategories = applyPageTypeApplicability(rawCategories, pageType, finalUrl);
  const categories = attachMethodologyEvidence(applicableCategories, finalUrl).map((category) => {
    const { score, maxScore } = scoreItems(category.items);
    return { ...category, score, maxScore };
  });
  const pageAssessed = categories.some((category) => category.maxScore > 0);
  const pageScore = pageAssessed ? computeWeightedScore(categories) : null;
  const pageGrade = pageScore === null ? "Not assessed" : computeGrade(pageScore);

  const aiCat = categories.find((c) => c.name === "AI Visibility");
  const aiVisibilityScore = aiCat && aiCat.maxScore > 0 ? Math.round((aiCat.score / aiCat.maxScore) * 100) : null;

  const allItems = categories.flatMap((c) => c.items);
  const applicableItems = allItems.filter((i) => i.scored !== false && i.applicability !== "not-applicable" && i.applicability !== "unknown");
  const failCount = applicableItems.filter((i) => i.status === "fail").length;
  const warnCount = applicableItems.filter((i) => i.status === "warn").length;
  const keyWarnings = applicableItems.filter((i) => i.status === "fail").slice(0, 3).map((i) => i.label);

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
    robotsAccess: robotsAllowed,
    schema,
    lawFirm,
    wordCount,
    rendering,
    pageAudit,
    intentAlignment,
    keyWarnings,
    wpDefault: isWpDefaultContent(finalUrl, html),
  };
}

/* ────────────────────────────────────────────────────────
   Site aggregation (backward-compatible categories + AI scores)
   ──────────────────────────────────────────────────────── */

export function computeTopFixes(pages: PageResult[], limit: number): TopFix[] {
  const fixMap = new Map<string, { status: "warn" | "fail"; category: string; fix?: string; pagesAffected: Set<string> }>();
  for (const page of pages) {
    for (const cat of page.categories) {
      for (const item of cat.items) {
        if (item.status === "pass" || item.scored === false || item.applicability === "not-applicable" || item.applicability === "unknown" || cat.name === "AI Visibility") continue;
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

export function aggregateCategories(pages: PageResult[]): CategoryResult[] {
  if (pages.length === 0) return [];
  const catNames = [...new Set(pages.flatMap((p) => p.categories.map((c) => c.name)))];
  return catNames.map((name) => {
    const pageCats = pages.map((p) => p.categories.find((c) => c.name === name)).filter((c): c is CategoryResult => !!c);
    const applicablePageCats = pageCats.filter((c) => c.maxScore > 0);
    const avgPct = applicablePageCats.length > 0
      ? applicablePageCats.reduce((sum, c) => sum + c.score / c.maxScore, 0) / applicablePageCats.length
      : 0;
    const allLabels = [...new Set(pageCats.flatMap((c) => c.items.map((i) => i.label)))];
    const items: CheckItem[] = allLabels.map((label) => {
      const instances = pageCats.flatMap((c) => c.items.filter((i) => i.label === label));
      const applicable = instances.filter((i) => i.applicability !== "not-applicable" && i.applicability !== "unknown");
      const failCount = applicable.filter((i) => i.status === "fail").length;
      const warnCount = applicable.filter((i) => i.status === "warn").length;
      const statusInstances = applicable.length > 0 ? applicable : instances;
      const status: "pass" | "warn" | "fail" = statusInstances.some((i) => i.status === "fail")
        ? "fail"
        : statusInstances.some((i) => i.status === "warn") ? "warn" : "pass";
      const representative = statusInstances.find((i) => i.status === "fail") ?? statusInstances.find((i) => i.status === "warn") ?? statusInstances[0];
      if (!representative) return { label, status: "pass", detail: "Not assessed.", scored: false, applicability: "unknown" };
      let detail = representative.detail;
      if (applicable.length > 1) {
        const affected = failCount + warnCount;
        if (affected > 0) detail += ` (${failCount} fail, ${warnCount} warn across ${applicable.length} applicable page checks)`;
      }
      // An item is unscored only when it is unscored on every applicable page.
      const unscored = applicable.length === 0 || applicable.every((i) => i.scored === false);
      const allNotApplicable = instances.every((i) => i.applicability === "not-applicable");
      const hasUnknown = instances.some((i) => i.applicability === "unknown");
      const applicability = applicable.length > 0 ? "applicable" as const : allNotApplicable ? "not-applicable" as const : hasUnknown ? "unknown" as const : undefined;
      const applicableScored = applicable.filter((i) => i.scored !== false);
      return {
        label, status, detail, fix: representative.fix,
        ...(representative.checkId ? { checkId: representative.checkId } : {}),
        ...(representative.sourceIds ? { sourceIds: representative.sourceIds } : {}),
        ...(representative.disposition ? { disposition: representative.disposition } : {}),
        ...(representative.basis ? { basis: representative.basis } : {}),
        ...(representative.predicate ? { predicate: representative.predicate } : {}),
        ...(representative.scoringRationale ? { scoringRationale: representative.scoringRationale } : {}),
        ...(representative.evidence ? { evidence: representative.evidence } : {}),
        ...(unscored ? { scored: false } : {}),
        ...(applicability ? { applicability } : {}),
        failCount,
        warnCount,
        applicableCount: applicableScored.length,
        notAssessedCount: instances.filter((i) => i.applicability === "unknown" || (i.scored === false && i.applicability !== "not-applicable")).length,
        notApplicableCount: instances.filter((i) => i.applicability === "not-applicable").length,
      };
    });
    // maxScore comes from scoreItems so unscored items stay out of the
    // denominator, and an all-unscored category reports 0/0 rather than 0/N
    // (which would defeat computeWeightedScore's `maxScore <= 0` skip and get
    // counted as 0% at full weight plus the low-pct penalty). The score itself
    // stays the per-page average ratio rather than scoreItems' own tally, so
    // multi-page grading is unchanged: a label failing on 1 of 10 pages still
    // costs a tenth of the category rather than the whole item.
    const { maxScore } = scoreItems(items);
    const score = avgPct * maxScore;
    const allPageItems = pageCats.flatMap((c) => c.items);
    const assessedItems = allPageItems.filter((i) => i.scored !== false && i.applicability !== "not-applicable" && i.applicability !== "unknown");
    const counts = {
      fail: assessedItems.filter((i) => i.status === "fail").length,
      warn: assessedItems.filter((i) => i.status === "warn").length,
      applicable: assessedItems.length,
      notAssessed: allPageItems.filter((i) => i.applicability === "unknown" || (i.scored === false && i.applicability !== "not-applicable")).length,
      notApplicable: allPageItems.filter((i) => i.applicability === "not-applicable").length,
    };
    return { name, score, maxScore, items, counts };
  });
}
