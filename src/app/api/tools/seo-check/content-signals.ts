/**
 * content-signals.ts
 *
 * Pure, network-free detectors that need to be more careful than a single
 * keyword regex: image alt-text classification, Google Business Profile link
 * recognition, testimonial/review structure detection, and service-area
 * business detection. Split out of route.ts so each detector is directly
 * unit-testable (route.ts route handlers can only export HTTP method
 * handlers plus a small allow-list of config values, so pure logic used by
 * the route lives beside it in an importable module instead).
 *
 * Field case: drglaw.ca (2026-07-16 dogfood audit). See individual detector
 * docblocks for the specific false positive each one fixes.
 */

export type ImgAltVerdict = "missing" | "decorative" | "suspicious-empty" | "present";

/**
 * Classify one <img ...> tag's alt attribute. The three cases the plain
 * "has a non-empty alt" check collapsed into one "missing" bucket:
 *
 *  - No alt attribute at all: a real accessibility failure. Screen readers
 *    fall back to announcing the file name or "image".
 *  - alt="" on a decorative image: valid per WCAG/HTML spec, tells assistive
 *    tech to skip the image. NOT a defect (field case drglaw.ca: a full-bleed
 *    walnut-desk background band, alt="", correctly decorative).
 *  - alt="" where the image is the ONLY accessible content of a link or
 *    button (no other text in the control): suspicious. An icon-only link
 *    with no label has nothing for a screen reader to announce, so an empty
 *    alt here is more likely a mistake than a deliberate decorative choice.
 *    Flagged as a warning that needs a human look, not asserted as a fact.
 *  - alt="non-empty text": present, no finding.
 */
export function classifyImageAlt(imgTag: string, controlInnerHtml?: string): ImgAltVerdict {
  const altMatch = imgTag.match(/\salt=(["'])([\s\S]*?)\1/i);
  if (!altMatch) return "missing";
  const altValue = altMatch[2].trim();
  if (altValue !== "") return "present";

  if (controlInnerHtml !== undefined) {
    const otherText = controlInnerHtml.replace(/<img\b[^>]*>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const hasAriaLabel = /\saria-label=["'][^"']+["']/i.test(controlInnerHtml) || /\saria-labelledby=["'][^"']+["']/i.test(controlInnerHtml);
    if (!otherText && !hasAriaLabel) return "suspicious-empty";
  }
  return "decorative";
}

export interface ImageAltSummary {
  total: number;
  missing: number;
  decorative: number;
  suspiciousEmpty: number;
}

// Interactive controls (links, buttons) whose accessible name can come
// entirely from an image inside them. Matched non-greedily and capped so a
// pathological page cannot blow up the regex engine.
const CONTROL_RE = /<(a|button)\b[^>]*>([\s\S]{0,600}?)<\/\1>/gi;

export function summarizeImageAlt(html: string): ImageAltSummary {
  const imgTags = html.match(/<img\b[^>]*>/gi) || [];
  // Map each <img> tag to the innerHTML of its enclosing <a>/<button>, if any,
  // so classifyImageAlt can tell an icon-only control from a decorative image
  // sitting in plain body content.
  const controls = [...html.matchAll(CONTROL_RE)].map((m) => m[2]);
  const summary: ImageAltSummary = { total: imgTags.length, missing: 0, decorative: 0, suspiciousEmpty: 0 };
  for (const tag of imgTags) {
    const owningControl = controls.find((c) => c.includes(tag));
    const verdict = classifyImageAlt(tag, owningControl);
    if (verdict === "missing") summary.missing++;
    else if (verdict === "decorative") summary.decorative++;
    else if (verdict === "suspicious-empty") summary.suspiciousEmpty++;
  }
  return summary;
}

/**
 * Google Business Profile link recognition. GBP shares content through
 * several distinct URL shapes; the original detector only recognised
 * maps/place, maps/dir, and a bare "business" path segment. It missed the
 * "cid=" permalink format Google issues from a verified Business Profile
 * (field case drglaw.ca: https://www.google.com/maps?cid=563987161242451811,
 * linked from a "Public client reviews from Google" section, read as no GBP
 * link at all).
 */
export const GBP_LINK_RE =
  /google\.com\/(maps\/(place|dir)\/|maps\?[^"'\s]*\bcid=|search\?[^"'\s]*\bbusiness|business\/)|g\.page\/|maps\.app\.goo\.gl\/|goo\.gl\/maps\//i;

export function hasGoogleBusinessProfileLink(html: string): boolean {
  return GBP_LINK_RE.test(html);
}

/**
 * Structural testimonial/client-quote detection. The keyword-only check
 * (literal words like "testimonial", "what our clients say") misses a page
 * that simply prints quoted client excerpts with attribution, which is the
 * more common real-world pattern: a <cite> naming the client next to a
 * quoted <p>, or a list explicitly labelled as client quotes via aria-label.
 * Field case drglaw.ca: three attributed client quotes
 * (`<li><p>"..."</p><cite>Name · City</cite></li>`, wrapped in
 * `<ul aria-label="Client excerpts">`) with zero occurrences of the word
 * "testimonial" anywhere on the page.
 *
 * A <cite> element is not automatically a testimonial: it is the correct
 * HTML tag to attribute a quotation from a statute, a court decision, a
 * news article, or a style guide, none of which are client trust signals.
 * Two independent guards keep the structural fallback from over-firing on
 * those: (1) ADJACENCY — the quote and its <cite> must sit immediately next
 * to each other (not just co-occur anywhere on the page, which is what the
 * original heuristic checked and is exactly the false-positive risk a firm's
 * blog post quoting case law would trip); (2) a legal/editorial-citation
 * exclusion — a <cite> whose text reads like a case citation, a statute
 * reference, a court name, or a style-guide name is excluded even when
 * adjacent to a quote. This does not fully solve the general case (a
 * genuinely non-legal third-party quote used as page decoration, e.g. a
 * motivational quote from a public figure, still looks structurally
 * identical to a client testimonial), so the explicit aria-label path above
 * remains the higher-confidence signal; the structural fallback is
 * deliberately conservative rather than exhaustive.
 */
const QUOTE_ARIA_LABEL_RE = /aria-label=["'][^"']*(testimonial|client (quote|excerpt|stor)|what (our )?clients? say)[^"']*["']/i;

const QUOTE_CHARS = `[“"][^<>]{15,400}[”"]`;

// <blockquote> is itself the HTML quotation signal (no literal quote marks
// required in its text); paired with an adjacent <cite> it is a strong
// structural "quote + source" pattern.
const BLOCKQUOTE_THEN_CITE_RE = /<blockquote\b[^>]*>[\s\S]{10,600}?<\/blockquote>\s*<cite\b[^>]*>([\s\S]{2,200}?)<\/cite>/i;
const CITE_THEN_BLOCKQUOTE_RE = /<cite\b[^>]*>([\s\S]{2,200}?)<\/cite>\s*<blockquote\b[^>]*>[\s\S]{10,600}?<\/blockquote>/i;
// A <p> carries no inherent quotation semantics, so it must actually contain
// quote-marked text (not just any adjacent paragraph) to count.
const QUOTE_PARA_THEN_CITE_RE = new RegExp(`<p\\b[^>]*>\\s*${QUOTE_CHARS}\\s*</p>\\s*<cite\\b[^>]*>([\\s\\S]{2,200}?)</cite>`, "i");
const CITE_THEN_QUOTE_PARA_RE = new RegExp(`<cite\\b[^>]*>([\\s\\S]{2,200}?)</cite>\\s*<p\\b[^>]*>\\s*${QUOTE_CHARS}`, "i");

// Case citations (Smith v. Jones, 2020 ONCA 123), statute references
// (R.S.O. 1990), and court/style-guide names. A <cite> matching this next to
// a quote is a legal or editorial citation, not a client testimonial.
// No trailing \b: several alternatives end in a literal period (R.S.O.,
// O.R., S.C.R.), and \b cannot match between two non-word characters (a
// period followed by a space), so a trailing boundary would silently fail
// to match exactly the citation-style abbreviations this exists to catch.
const LEGAL_OR_EDITORIAL_CITATION_RE =
  /\bv\.\s|\b(court of appeal|supreme court|superior court|divisional court|ONCA|ONSC|ONCJ|SCC|O\.?J\.?\s|O\.R\.|S\.C\.R\.|F\.3d|R\.S\.O\.|R\.S\.C\.|MLA|APA|Chicago Manual|style guide)/i;

export function hasTestimonialStructure(html: string): boolean {
  if (QUOTE_ARIA_LABEL_RE.test(html)) return true;
  const match =
    BLOCKQUOTE_THEN_CITE_RE.exec(html) ||
    CITE_THEN_BLOCKQUOTE_RE.exec(html) ||
    QUOTE_PARA_THEN_CITE_RE.exec(html) ||
    CITE_THEN_QUOTE_PARA_RE.exec(html);
  if (!match) return false;
  const citeText = (match[1] || "").replace(/<[^>]+>/g, " ");
  return !LEGAL_OR_EDITORIAL_CITATION_RE.test(citeText);
}

/**
 * Service-area / remote-practice detection. A firm that legitimately serves
 * clients without a walk-in office (video closings, virtual consultations,
 * a defined service area with no storefront) should not be scored down for
 * omitting a street address, and should not be told to publish one: doing so
 * either invents an address or pressures the firm into exposing a private
 * home/mailing address. Detected from two independent signals so neither a
 * schema quirk nor a stray phrase alone triggers it.
 */
const SERVICE_AREA_PHRASE_RE =
  /\b(serving clients (across|throughout|in)|remote (consultations?|closings?|practice)|by video|virtual (consultations?|law firm|closings?)|work(s)? (remotely|virtually)|no in-person (office|visits?)|closes? .{0,40} by video)\b/i;

export function hasServiceAreaLanguage(bodyText: string): boolean {
  return SERVICE_AREA_PHRASE_RE.test(bodyText);
}

export function likelyServiceAreaBusiness(bodyText: string, hasAreaServedSchema: boolean, hasAddress: boolean): boolean {
  if (hasAddress) return false;
  return hasAreaServedSchema && hasServiceAreaLanguage(bodyText);
}

export interface FindingResult {
  status: "pass" | "warn" | "fail";
  detail: string;
  fix?: string;
}

/**
 * Content-Security-Policy classification. Content-Security-Policy-Report-Only
 * is the audit's own recommended first rollout step, so a site running it is
 * mid-implementation, not lacking a policy. Credited as progress: still a
 * warn (it enforces nothing yet), never claimed as full enforcement. Field
 * case drglaw.ca: report-only was live sitewide and the finding read "High /
 * Missing" as if no CSP work existed at all.
 *
 * The detail text leads with "Monitoring enabled; enforcement still pending"
 * on purpose: a security-review reader skimming for status must not come
 * away thinking the site has a working CSP. Report-only logs violations to
 * the browser console/a report endpoint; it blocks nothing. See
 * analysis.ts's severityFor for why this finding is pinned to "low" (never
 * dropped further to "info") — there is a concrete next action (promote to
 * enforced), so it belongs in the report's "optimization opportunity" tier,
 * not "informational," which would read as "no action needed."
 */
export function classifyCsp(enforcedHeader: string | null, reportOnlyHeader: string | null): FindingResult {
  if (enforcedHeader) {
    return { status: "pass", detail: "Present and enforced. Reduces the risk of injection attacks." };
  }
  if (reportOnlyHeader) {
    return {
      status: "warn",
      detail: "Monitoring enabled (Content-Security-Policy-Report-Only); enforcement still pending. Violations are logged but nothing is blocked yet, so this is not an enforced security control. Treat as implementation in progress, not full protection.",
      fix: "Review the report-only violation reports, then promote the policy to an enforced Content-Security-Policy header once it is clean.",
    };
  }
  return {
    status: "warn",
    detail: "Missing. CSP helps prevent cross-site scripting.",
    fix: "Configure a Content-Security-Policy header, starting in report-only mode.",
  };
}

export interface TtfbMeasurement {
  ms: number;
  sampleCount: number;
  min?: number;
  max?: number;
}

/**
 * Time-to-first-byte classification. One HTTP round trip is a SAMPLE, not a
 * measurement: a single reading can land several times above a site's true
 * TTFB from ambient network jitter alone (field case drglaw.ca, 2026-07-16:
 * one audit sample read 1176ms while five back-to-back live samples averaged
 * 150-180ms). Multi-sample readings (sampleCount >= 2) report a median and
 * range using the original, tighter thresholds. Single-sample readings say so
 * explicitly and use a much wider "fail" bar so noise alone cannot
 * manufacture a performance defect; only a reading far outside plausible
 * noise fails outright on one sample.
 */
export function classifyTtfb(ttfb: TtfbMeasurement): FindingResult {
  if (ttfb.ms === 0 || ttfb.sampleCount === 0) {
    return { status: "warn", detail: "Could not measure response time for this page.", fix: "Improve TTFB with caching, a CDN, or faster hosting." };
  }
  if (ttfb.sampleCount >= 2 && typeof ttfb.min === "number" && typeof ttfb.max === "number") {
    const median = Math.round(ttfb.ms);
    const range = `range ${Math.round(ttfb.min)}-${Math.round(ttfb.max)}ms, ${ttfb.sampleCount} samples`;
    if (ttfb.ms < 400) return { status: "pass", detail: `Fast (median ${median}ms; ${range}).` };
    if (ttfb.ms < 900) return { status: "warn", detail: `Moderate (median ${median}ms; ${range}).`, fix: "Improve TTFB with caching, a CDN, or faster hosting." };
    return { status: "fail", detail: `Slow (median ${median}ms; ${range}).`, fix: "Investigate server response time: caching, CDN, hosting upgrade." };
  }
  // "single-sample" stays hyphenated in all three branches below (not just
  // this one): the reporting layer (audit-notes.ts's classifyActionTier)
  // pattern-matches on that exact phrase to route any single-sample TTFB
  // reading to the "needs verification" bucket regardless of severity.
  const ms = Math.round(ttfb.ms);
  if (ttfb.ms < 400) return { status: "pass", detail: `Fast (${ms}ms, single-sample measurement).` };
  if (ttfb.ms < 2500) {
    return {
      status: "warn",
      detail: `${ms}ms on a single-sample measurement. A single reading can be skewed by network noise; treat as indicative and re-check with multiple samples before citing it as a defect.`,
      fix: "Re-measure with multiple samples before flagging as slow. If consistently high, investigate caching, a CDN, or hosting.",
    };
  }
  return { status: "fail", detail: `Very slow (${ms}ms), well outside what measurement noise alone would explain even on a single-sample reading.`, fix: "Investigate server response time: caching, CDN, hosting upgrade." };
}

/**
 * Word-count classification. There is no universal word-count minimum Google
 * enforces; 300 words is a rule-of-thumb depth signal for an informational
 * page trying to rank on a topic, not a pass/fail line, so the wording stays
 * a guideline. This only runs as a scored requirement on content pages in the
 * first place (see engine-core.ts's applyPageTypeApplicability).
 */
export function classifyWordCount(words: number): FindingResult {
  if (words >= 300) return { status: "pass", detail: `${words.toLocaleString()} words.` };
  if (words >= 200) {
    return {
      status: "warn",
      detail: `${words} words. As a rule of thumb, informational pages with more depth tend to rank better, though there is no fixed minimum.`,
      fix: "Consider expanding with substantive content if this page is meant to rank on its own.",
    };
  }
  return {
    status: "fail",
    detail: `${words} words. Thin for a page meant to stand on its own topically, though there is no fixed word-count rule.`,
    fix: "Add substantive content: services, common questions, process.",
  };
}

/**
 * Content-to-HTML ratio classification. A weak diagnostic on its own: a
 * modern framework (React/Next.js) ships large script/style payloads on
 * every page regardless of how much real content the page has, so a low
 * ratio just as often means "the framework is verbose" as "the page is
 * thin." Only fires "add substantive text" when the page ALSO has thin
 * content by word count; a page with 300+ words of real copy is not missing
 * text just because the markup around it is heavy.
 */
export function classifyContentRatio(ratio: number, words: number): FindingResult {
  if (ratio >= 15 || words >= 300) {
    if (words >= 300 && ratio < 15) {
      return { status: "pass", detail: `${ratio}% text content, but the page already has ${words.toLocaleString()} words of substantive copy; a low ratio here reflects markup weight, not thin content.` };
    }
    return { status: "pass", detail: `${ratio}% text content.` };
  }
  if (ratio >= 8 || words >= 150) {
    return {
      status: "warn",
      detail: `${ratio}% text content. Weak signal on its own: worth a look alongside actual word count, not a standalone problem.`,
      fix: "If the page's copy also reads thin, add substantive text; otherwise no action needed.",
    };
  }
  return { status: "fail", detail: `${ratio}% text content and ${words} words. Low ratio together with genuinely thin copy.`, fix: "Add substantive text content." };
}
