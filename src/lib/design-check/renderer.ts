import type { Browser, Page, Route } from "playwright-core";
import { checkOutboundRequest } from "./ssrf-guard";

/**
 * Phase 0 rendering layer for the website design grading tool. Loads a URL
 * in a real headless browser (not a fetch+regex crawl like seo-check) so
 * downstream dimensions can score computed styles, layout, and a real
 * performance trace, and so the vision-model judgment pass has an actual
 * screenshot to look at.
 *
 * Dual Chromium strategy: `playwright-core` + `@sparticuz/chromium` in
 * production (the standard Vercel/Lambda-compatible Linux binary; both are
 * production dependencies), full `playwright` with its own bundled,
 * Windows-compatible browser download in local dev (a devDependency only,
 * never bundled to prod). See BUILD_PLAN_website_design_grading_v1.md §4.
 */

export const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

export interface BlockedRequestLog {
  url: string;
  reason: string;
}

export interface RenderCapture {
  viewport: ViewportName;
  finalUrl: string;
  screenshotPng: Buffer;
  /** The page's real full height when the capture had to be clipped to
   * stay under the vision API's pixel ceiling, else null. Non-null means
   * the judgment pass saw the top of the page, not all of it, and the
   * report must say so rather than implying whole-page coverage. */
  screenshotClippedFromPx: number | null;
  html: string;
  domSnapshot: DomSnapshot;
  webVitals: WebVitalsSample;
  blockedRequests: BlockedRequestLog[];
  renderMs: number;
}

export interface FormFieldSample {
  tag: string;
  type: string | null;
  hasLabel: boolean;
  isPlaceholderOnly: boolean;
  isRequired: boolean;
}

export interface FormSample {
  fieldCount: number;
  fields: FormFieldSample[];
  formTextMentionsRequired: boolean;
}

export interface TapTargetSample {
  tag: string;
  text: string;
  widthPx: number;
  heightPx: number;
}

export interface HamburgerMenuInfo {
  found: boolean;
  hasAccessibleLabel: boolean;
}

export interface ImageSample {
  src: string;
  format: string;
  isLikelyLogo: boolean;
}

export interface LinkSample {
  text: string;
  href: string;
}

export interface BylineSample {
  text: string;
  hasProfileLink: boolean;
}

export interface TestimonialSample {
  text: string;
  hasAttribution: boolean;
}

/** Authority and Positioning module inputs (Phase 3), all extractable from
 * this single rendered page. Cross-page checks the module specifies
 * (message consistency across home/about/service, site-wide NAP
 * consistency) are out of scope per the operator's 2026-07-16 v1
 * single-URL decision; they are not approximated here. */
export interface AuthoritySnapshot {
  /** Best-effort JSON.parse of every <script type="application/ld+json">
   * block. Parse failures are skipped, not thrown. */
  jsonLd: unknown[];
  metaTitle: string | null;
  metaDescription: string | null;
  /** Concatenated heading + paragraph + CTA text, capped, for the
   * self-designation lexicon scan. This is "firm-voiced copy" per the
   * module, not the visitor-facing rendered layout sample above. */
  firmVoicedText: string;
  navLinks: LinkSample[];
  footerLinks: LinkSample[];
  authorBylines: BylineSample[];
  testimonials: TestimonialSample[];
  /** Heuristic list of distinct practice-area/service labels found at
   * equal visual weight (a nav list or card grid), for the
   * generic-full-service signal. */
  practiceAreaLabels: string[];
  /** Text matching a legal-information disclaimer pattern found in the
   * first ~2000 characters of body text. */
  disclaimerPresent: boolean;
}

export interface PreCheckedConsentSample {
  labelText: string;
}

/** Master framework's dark-pattern red-flag inputs (Phase 4). Detection
 * confidence is disclosed per signal, not uniformly claimed: some are
 * fully deterministic from the DOM, others are best-effort text/class/
 * script-signature heuristics because proving them for real needs
 * interaction simulation this v1 static render pass does not do (see
 * dimensions/red-flags.ts for which is which). Never silently reported as
 * "clear" when a signal was not actually checkable. */
export interface DarkPatternSnapshot {
  preCheckedConsentBoxes: PreCheckedConsentSample[];
  /** Text or class/id matches suggesting a countdown timer or scarcity
   * messaging. Best-effort: a real countdown's actual behavior (does it
   * reset on reload, is the scarcity real) needs interaction/reload
   * simulation not run here. */
  urgencyOrCountdownSignals: string[];
  /** Script src or inline-script substrings matching known exit-intent
   * pop-up library signatures. Best-effort only: cannot simulate the
   * mouse-leave trigger itself in a static render. */
  exitIntentScriptSignals: string[];
  /** Raw-number claims ("10,000+ clients", "join 50,000 others") found in
   * firm-voiced text with no adjacent citation. Reuses the Authority
   * module's proof-window logic. */
  bandwagonClaimsWithoutProof: string[];
}

export interface DomSnapshot {
  /** Non-zero margin/padding values (px, one entry per side per element)
   * sampled from layout containers, for the spacing-scale-adherence check. */
  spacingValuesPx: number[];
  h1Count: number;
  h1Text: string | null;
  headingOrder: string[]; // e.g. ["h1","h2","h2","h3"] in DOM order
  headingSamples: TextBlockSample[]; // first element per heading level present (h1..h6)
  bodyTextSample: TextBlockSample[];
  hasHorizontalOverflow: boolean;
  viewportMetaContent: string | null;
  forms: FormSample[];
  tapTargets: TapTargetSample[];
  hamburgerMenu: HamburgerMenuInfo;
  images: ImageSample[];
  authority: AuthoritySnapshot;
  darkPatterns: DarkPatternSnapshot;
}

export interface TextBlockSample {
  tag: string;
  text: string;
  fontSizePx: number;
  fontWeight: string;
  fontFamily: string;
  lineHeightPx: number;
  color: string;
  backgroundColor: string;
  textTransform: string;
  textAlign: string;
  widthPx: number;
  /** Real canvas-measured average glyph width in px for this exact text at
   * this exact font, not a fontSize-based approximation. Used to derive
   * characters-per-line honestly. Null if canvas measurement failed. */
  avgCharWidthPx: number | null;
}

export interface WebVitalsSample {
  lcpMs: number | null;
  cls: number | null;
  ttfbMs: number | null;
  // INP requires real user interaction and cannot be measured in a scripted
  // load; TBT (total blocking time) is the lab-measurable responsiveness
  // proxy. Never present this as INP. See build plan §5 Phase 1 note.
  tbtMs: number | null;
}

const NAV_TIMEOUT_MS = 20_000;
const RENDER_SETTLE_MS = 1_500; // let web-vitals observers + fonts settle

/**
 * The Anthropic Messages API rejects any image whose longest edge exceeds
 * 8000 pixels ("At least one of the image dimensions exceed max allowed
 * size: 8000 pixels", HTTP 400). A full-page screenshot of a long
 * marketing page passes that easily: drglaw.ca hit it and lost BOTH
 * vision passes silently, which is how this was found. Capped just under
 * the limit so the judgment runs at all; when a page is taller, the
 * capture is clipped from the top and `screenshotClippedFromPx` records
 * the real full height so the report can disclose that the judgment saw
 * the top of the page rather than all of it.
 */
const MAX_SCREENSHOT_HEIGHT_PX = 7_800;
const MAX_INTERCEPTED_REQUESTS = 300; // guard against a runaway page

async function launchBrowser(): Promise<Browser> {
  const isServerless = !!process.env.VERCEL || process.env.NODE_ENV === "production";
  if (isServerless) {
    const chromium = (await import("@sparticuz/chromium")).default;
    const { chromium: launcher } = await import("playwright-core");
    return launcher.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- devDependency-only, dynamic to keep it out of the prod bundle graph
  const playwright = await import("playwright");
  return playwright.chromium.launch({ headless: true }) as unknown as Browser;
}

/** SSRF-guards every request the page issues: subresources, redirects, everything. */
async function guardRoutes(page: Page, blocked: BlockedRequestLog[]): Promise<void> {
  let intercepted = 0;
  await page.route("**/*", async (route: Route) => {
    intercepted++;
    if (intercepted > MAX_INTERCEPTED_REQUESTS) {
      blocked.push({ url: route.request().url(), reason: "request_budget_exceeded" });
      await route.abort();
      return;
    }
    const url = route.request().url();
    const check = await checkOutboundRequest(url);
    if (check.blocked) {
      blocked.push({ url, reason: check.reason ?? "blocked" });
      await route.abort();
      return;
    }
    await route.continue();
  });
}

const WEB_VITALS_COLLECTOR = /* js */ `
window.__designCheckVitals = { lcpMs: null, cls: null, ttfbMs: null, tbtMs: null };
(function () {
  try {
    var nav = performance.getEntriesByType('navigation')[0];
    if (nav) window.__designCheckVitals.ttfbMs = nav.responseStart;
  } catch (e) {}

  try {
    var po = new PerformanceObserver(function (list) {
      var entries = list.getEntries();
      var last = entries[entries.length - 1];
      if (last) window.__designCheckVitals.lcpMs = last.renderTime || last.loadTime || null;
    });
    po.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {}

  try {
    var clsValue = 0;
    var clsObserver = new PerformanceObserver(function (list) {
      for (var entry of list.getEntries()) {
        if (!entry.hadRecentInput) clsValue += entry.value;
      }
      window.__designCheckVitals.cls = clsValue;
    });
    clsObserver.observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}

  try {
    var tbt = 0;
    var longTaskObserver = new PerformanceObserver(function (list) {
      for (var entry of list.getEntries()) {
        var blocking = entry.duration - 50;
        if (blocking > 0) tbt += blocking;
      }
      window.__designCheckVitals.tbtMs = tbt;
    });
    longTaskObserver.observe({ type: 'longtask', buffered: true });
  } catch (e) {}
})();
`;

const DOM_SNAPSHOT_SCRIPT = /* js */ `
(function () {
  var headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  var h1s = document.querySelectorAll('h1');
  var viewportMeta = document.querySelector('meta[name="viewport"]');

  // Shared canvas for real font-metrics measurement. Real, not a
  // fontSize-based approximation: measures this exact text at this exact
  // computed font, so characters-per-line is an honest measurement.
  var measureCanvas = document.createElement('canvas');
  var measureCtx = measureCanvas.getContext('2d');

  function measureAvgCharWidth(text, fontWeight, fontSizePx, fontFamily) {
    if (!measureCtx || !text) return null;
    try {
      measureCtx.font = fontWeight + ' ' + fontSizePx + 'px ' + fontFamily;
      var width = measureCtx.measureText(text).width;
      return text.length > 0 ? width / text.length : null;
    } catch (e) { return null; }
  }

  // A transparent own background-color means this element paints nothing;
  // the effective background is whatever is actually painted behind it.
  // Uses document.elementsFromPoint at the element's own on-screen
  // centre to read the real browser paint order, rather than walking the
  // DOM ancestor tree: an ancestor-only walk cannot see a hero photo
  // implemented as an absolutely-positioned sibling image plus a
  // gradient-scrim sibling div (the standard technique for a
  // photo-with-darkening-overlay hero, and the technique drglaw.ca's own
  // hero uses), because neither the image nor the scrim is a CSS
  // ancestor of the text. An ancestor-only version of this fix was tried
  // first and rejected: it resolved past the hero entirely to the plain
  // page background four sections down, producing a false 1:1 "contrast
  // failure" on legible white-on-dark hero text, a materially worse
  // defect than the "not checkable" it replaced (a confident wrong
  // accusation instead of a disclosed unknown, on the exact kind of
  // finding this tool's own copy calls "an accessibility floor, not a
  // stylistic preference"). elementsFromPoint returns every element
  // stacked at that pixel in real front-to-back paint order, so an
  // absolutely-positioned sibling image or scrim is seen exactly where
  // it visually sits, the same way gosailaw.com's ancestor-owned hero
  // photo is: if an image-painting element (an <img>/<video>/<canvas>/
  // <svg>, or anything with a background-image) is encountered before an
  // opaque background-color, the result is left unresolved rather than
  // trusted, so wcag-contrast.ts's existing checkTextContrast (which
  // already treats any alpha>0 colour as checkable) can grade the
  // remaining, genuinely resolvable, extremely common case of a text
  // element with no background of its own sitting over a plain-coloured
  // section, without guessing at the cases it cannot see through.
  function colorAlpha(rgbaString) {
    var m = rgbaString.match(/rgba?\\(\\s*[\\d.]+\\s*,\\s*[\\d.]+\\s*,\\s*[\\d.]+\\s*(?:,\\s*([\\d.]+)\\s*)?\\)/);
    if (!m) return 0;
    return m[1] !== undefined ? parseFloat(m[1]) : 1;
  }

  function resolveEffectiveBackgroundColor(el) {
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    var x = rect.left + rect.width / 2;
    var y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return null; // off-screen at capture time; elementsFromPoint is unreliable outside the viewport
    var stack;
    try { stack = document.elementsFromPoint(x, y); } catch (e) { return null; }
    if (!stack) return null;
    for (var i = 0; i < stack.length; i++) {
      var node = stack[i];
      if (node === el || el.contains(node)) continue; // the text element and its own inline markup, not a background
      var cs = getComputedStyle(node);
      var isImagePaintingNode = ['IMG', 'VIDEO', 'CANVAS', 'SVG', 'PICTURE'].indexOf(node.tagName) !== -1;
      if (isImagePaintingNode || (cs.backgroundImage && cs.backgroundImage !== 'none')) return null;
      if (colorAlpha(cs.backgroundColor) > 0) return cs.backgroundColor; // first opaque colour actually painted behind the text, nothing image-like was in front of it
    }
    return null;
  }

  function sampleText(el) {
    var cs = getComputedStyle(el);
    var rect = el.getBoundingClientRect();
    var text = (el.innerText || '').trim().slice(0, 200);
    var fontSizePx = parseFloat(cs.fontSize) || 0;
    // Only resolve through the paint stack when the element has no
    // background of its own; an element that already declares a real
    // opaque background (e.g. a filled button) must use that colour
    // directly, never whatever happens to sit behind it once the
    // element itself is excluded from the stack walk.
    var ownBackgroundIsTransparent = colorAlpha(cs.backgroundColor) === 0;
    var effectiveBackground = ownBackgroundIsTransparent ? resolveEffectiveBackgroundColor(el) : null;
    return {
      tag: el.tagName.toLowerCase(),
      text: text,
      fontSizePx: fontSizePx,
      fontWeight: cs.fontWeight,
      fontFamily: cs.fontFamily,
      lineHeightPx: parseFloat(cs.lineHeight) || 0,
      color: cs.color,
      backgroundColor: effectiveBackground || cs.backgroundColor,
      textTransform: cs.textTransform,
      textAlign: cs.textAlign,
      widthPx: rect.width,
      avgCharWidthPx: measureAvgCharWidth(text, cs.fontWeight, fontSizePx, cs.fontFamily),
    };
  }

  // Representative sample: the h1, the first two body paragraphs of
  // meaningful length, and up to three link/button elements that look
  // like primary calls to action.
  var samples = [];
  if (h1s[0]) samples.push(sampleText(h1s[0]));
  var paragraphs = Array.from(document.querySelectorAll('p'))
    .filter(function (p) { return (p.innerText || '').trim().length > 40; })
    .slice(0, 2);
  paragraphs.forEach(function (p) { samples.push(sampleText(p)); });
  var ctas = Array.from(document.querySelectorAll('a,button')).slice(0, 20)
    .filter(function (el) {
      var t = (el.innerText || '').toLowerCase();
      return /contact|consult|call|book|schedule|get started|submit|learn more/.test(t);
    })
    .slice(0, 3);
  ctas.forEach(function (el) { samples.push(sampleText(el)); });

  // One sample per heading LEVEL present (first occurrence of h1, first of
  // h2, etc.), for the headline-to-subline contrast check. Distinct from
  // headingOrder above, which records every heading's tag in DOM sequence
  // for the skipped-level check.
  var headingSamples = [];
  ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach(function (tag) {
    var el = document.querySelector(tag);
    if (el && (el.innerText || '').trim().length > 0) headingSamples.push(sampleText(el));
  });

  // Forms: real <label> vs placeholder-only, required markers, field count.
  var forms = Array.from(document.querySelectorAll('form')).map(function (form) {
    var fields = Array.from(form.querySelectorAll('input,textarea,select')).filter(function (el) {
      var t = (el.getAttribute('type') || '').toLowerCase();
      return t !== 'hidden' && t !== 'submit' && t !== 'button' && t !== 'image';
    });
    var fieldSamples = fields.map(function (el) {
      var id = el.getAttribute('id');
      var hasLabel = !!(id && document.querySelector('label[for="' + id + '"]')) || !!el.closest('label');
      var hasPlaceholder = !!el.getAttribute('placeholder');
      return {
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type'),
        hasLabel: hasLabel,
        isPlaceholderOnly: hasPlaceholder && !hasLabel,
        isRequired: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
      };
    });
    return {
      fieldCount: fieldSamples.length,
      fields: fieldSamples,
      formTextMentionsRequired: /required/i.test(form.innerText || ''),
    };
  });

  // Tap targets: CTA-like anchors/buttons, for mobile tap-size checks.
  var tapTargets = Array.from(document.querySelectorAll('a,button')).slice(0, 40)
    .filter(function (el) { return (el.innerText || '').trim().length > 0; })
    .map(function (el) {
      var rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || '').trim().slice(0, 60),
        widthPx: rect.width,
        heightPx: rect.height,
      };
    });

  // Hamburger menu: a small icon-only control commonly used to reveal
  // mobile navigation. Heuristic match on common naming, then check for
  // an accessible name (visible text, aria-label, or aria-labelledby).
  var hamburgerCandidates = Array.from(document.querySelectorAll('button,[role="button"],a')).filter(function (el) {
    var cls = (el.className && el.className.toString) ? el.className.toString().toLowerCase() : '';
    var aria = (el.getAttribute('aria-label') || '').toLowerCase();
    var text = (el.innerText || '').trim();
    var looksLikeIconOnly = text.length === 0 && el.querySelector('svg,img');
    return (looksLikeIconOnly) && (/menu|hamburger|nav-?toggle|burger/.test(cls) || /menu/.test(aria));
  });
  var hamburgerMenu = { found: hamburgerCandidates.length > 0, hasAccessibleLabel: false };
  if (hamburgerCandidates[0]) {
    var hEl = hamburgerCandidates[0];
    var hasAria = !!(hEl.getAttribute('aria-label') && /menu/i.test(hEl.getAttribute('aria-label')));
    var hasLabelledby = !!(hEl.getAttribute('aria-labelledby'));
    var hasVisibleText = /menu/i.test((hEl.innerText || '').trim());
    hamburgerMenu.hasAccessibleLabel = hasAria || hasLabelledby || hasVisibleText;
  }

  // Spacing: non-zero margin/padding values from layout containers, for
  // the scale-adherence histogram check. Capped sample; zero values are
  // excluded since they carry no scale-decision information.
  //
  // marginLeft/marginRight are also excluded on a centered max-width
  // container (the extremely common .container max-width plus margin:
  // 0 auto pattern). Confirmed live (2026-08-06) on drglaw.ca: a
  // max-width 1240px container computes marginLeft = marginRight =
  // 100px at a 1440px viewport, and that 100 dominated the sample (26
  // of 178 raw values) despite having nothing to do with the site's
  // spacing tokens: it is the output of (viewport width - max-width) /
  // 2, arithmetic that changes with viewport, not a value anyone chose
  // from a scale. Only the two horizontal margins on a genuinely
  // centered box are dropped; vertical margins and all padding on the
  // same element, plus every margin on non-centered elements, are
  // unaffected.
  var spacingValuesPx = [];
  var layoutEls = Array.from(document.querySelectorAll('section,header,footer,nav,article,main,div')).slice(0, 150);
  layoutEls.forEach(function (el) {
    var cs = getComputedStyle(el);
    var marginLeftPx = parseFloat(cs.marginLeft) || 0;
    var marginRightPx = parseFloat(cs.marginRight) || 0;
    var isAutoCenteredContainer = cs.maxWidth !== 'none' && marginLeftPx > 0 && Math.abs(marginLeftPx - marginRightPx) < 0.5;
    ['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].forEach(function (prop) {
      if (isAutoCenteredContainer && (prop === 'marginLeft' || prop === 'marginRight')) return;
      var v = parseFloat(cs[prop]);
      if (v && v > 0) spacingValuesPx.push(Math.round(v));
    });
  });

  // Images: format inventory. Logos guessed by alt/src/class containing
  // "logo" or sitting inside <header>.
  var images = Array.from(document.querySelectorAll('img')).slice(0, 60).map(function (img) {
    var src = img.currentSrc || img.src || '';
    var extMatch = src.match(/\\.([a-z0-9]+)(?:\\?|#|$)/i);
    var format = extMatch ? extMatch[1].toLowerCase() : 'unknown';
    var alt = (img.getAttribute('alt') || '').toLowerCase();
    var cls = (img.className && img.className.toString) ? img.className.toString().toLowerCase() : '';
    var isLikelyLogo = /logo/.test(alt) || /logo/.test(cls) || !!img.closest('header');
    return { src: src, format: format, isLikelyLogo: isLikelyLogo };
  });

  // Authority module (Phase 3) inputs. All on-site, single-page only.
  var jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    .map(function (s) { try { return JSON.parse(s.textContent || ''); } catch (e) { return null; } })
    .filter(function (v) { return v !== null; });

  var metaTitleEl = document.querySelector('title');
  var metaDescEl = document.querySelector('meta[name="description"]');

  // Firm-voiced text: headings + paragraphs + CTA text, capped, for the
  // self-designation lexicon scan.
  //
  // Quoted client speech is deliberately EXCLUDED. The module scans
  // "firm-voiced body copy", and a testimonial is the client's voice, not
  // the firm's: a client writing "one of the best decisions I've made" is
  // not the firm claiming to be the best. Including testimonials
  // false-flagged a real, compliant client site (drglaw.ca) for an LSO
  // Rule 4.2-1 prohibited word and capped its grade, which is exactly the
  // kind of accusation this tool must never make on evidence it has
  // misattributed. Testimonials are still captured separately, and still
  // scored, by the attribution check.
  // Detection is primarily TEXTUAL, not structural. Class-name matching
  // was tried first and is not reliable: drglaw.ca renders testimonials
  // as plain <p> inside <ul class="v3-short-proof-fragments">, with no
  // blockquote and no testimonial/review class anywhere in the ancestry.
  // What quoted speech does carry, independent of any site's markup, is
  // an opening quotation mark. The structural selector is kept as a
  // secondary signal for sites that do mark quotes up semantically.
  var QUOTED_SPEECH_SELECTOR = 'blockquote,cite,figcaption,[class*="testimonial"],[class*="review"],[class*="quote"],[class*="proof"]';
  var OPENING_QUOTES = [
    String.fromCharCode(0x22),   // "
    String.fromCharCode(0x201C), // left double quotation mark
    String.fromCharCode(0x201D), // right double quotation mark (sites misuse it as an opener)
    String.fromCharCode(0xAB),   // guillemet
  ];
  function isQuotedSpeech(el, text) {
    if (el.closest(QUOTED_SPEECH_SELECTOR)) return true;
    return OPENING_QUOTES.indexOf(text.charAt(0)) !== -1;
  }

  var firmVoicedParts = [];
  Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button')).slice(0, 400).forEach(function (el) {
    var t = (el.innerText || '').trim();
    if (t.length === 0) return;
    if (isQuotedSpeech(el, t)) return;
    firmVoicedParts.push(t);
  });
  var firmVoicedText = firmVoicedParts.join(' \\n ').slice(0, 20000);

  function extractLinks(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll('a[href]')).slice(0, 40).map(function (a) {
      return { text: (a.innerText || '').trim().slice(0, 80), href: a.getAttribute('href') || '' };
    });
  }
  var navLinks = extractLinks(document.querySelector('nav') || document.querySelector('header'));
  var footerLinks = extractLinks(document.querySelector('footer'));

  // Author bylines: elements naming an author via rel/class/itemprop, or a
  // "By <Name>" text pattern. hasProfileLink checks for an adjacent anchor.
  var bylineEls = Array.from(document.querySelectorAll('[rel="author"],[itemprop="author"],.author,.byline,[class*="author"],[class*="byline"]')).slice(0, 20);
  var bylineTextMatches = [];
  Array.from(document.querySelectorAll('p,span,div')).slice(0, 300).forEach(function (el) {
    var t = (el.innerText || '').trim();
    if (/^by\\s+[A-Z][a-z]+\\s+[A-Z][a-z]+/.test(t) && t.length < 80) bylineTextMatches.push(el);
  });
  var bylineCandidates = bylineEls.concat(bylineTextMatches).slice(0, 20);
  var authorBylines = bylineCandidates.map(function (el) {
    var text = (el.innerText || '').trim().slice(0, 120);
    var hasProfileLink = !!el.querySelector('a[href]') || (el.tagName === 'A' && el.hasAttribute('href'));
    return { text: text, hasProfileLink: hasProfileLink };
  });

  // Testimonials: quote-like blocks or elements classed as testimonial/
  // review, checked for a nearby name (heuristic: a short line following
  // the quote, capitalized, under 40 chars, not itself a sentence).
  var testimonialEls = Array.from(document.querySelectorAll('blockquote,[class*="testimonial"],[class*="review-"],.review')).slice(0, 20);
  var testimonials = testimonialEls.map(function (el) {
    var text = (el.innerText || '').trim().slice(0, 300);
    var cite = el.querySelector('cite,footer,[class*="attribution"],[class*="author"],[class*="name"]');
    var citeText = cite ? (cite.innerText || '').trim() : '';
    var hasAttribution = citeText.length > 0 && citeText.length < 60;
    return { text: text, hasAttribution: hasAttribution };
  });

  // Practice-area labels: items in a list/grid under a heading mentioning
  // "practice area" or "services", read as equal-weight labels.
  var practiceAreaLabels = [];
  // English-primary with Portuguese/French terms added, same rationale as
  // the disclaimer pattern above. Confirmed live: without it, this exact
  // heading pattern (9 practice areas at equal weight, the generic
  // full-service signal the module names) went undetected on the
  // Portuguese-language "Conheca Nossos Servicos" / "Como Podemos Ajudar
  // Voce?" headings on the sakurabalaw.ca fixture.
  // Heading tags include h5/h6 (a smaller eyebrow-style section heading is
  // common). The card grid itself is found by structure, not by climbing
  // a fixed number of ancestor levels: page-builder markup (Elementor,
  // Divi, and similar, common on small-firm sites) nests a heading and
  // its associated grid many wrapper-divs apart, so a fixed-depth climb
  // either misses the grid or, climbed far enough, sweeps in unrelated
  // repeated groups elsewhere on the page (team member cards, blog post
  // cards). Confirmed live on the sakurabalaw.ca fixture: the real
  // 9-practice-area grid sits 5 wrapper divs above its own heading.
  // Instead, within a generously bounded ancestor scope, look for a group
  // of 5+ elements that share one direct parent and each carry short
  // label-like text: that sibling-repetition signature is what "items
  // presented at equal visual weight" structurally means, independent of
  // nesting depth, and naturally separates one grid from another sharing
  // a distant common ancestor.
  function findRepeatedLabelGroup(root) {
    var byParent = [];
    var parents = Array.from(root.querySelectorAll('*')).map(function (el) { return el.parentElement; }).filter(Boolean);
    var seenParents = [];
    parents.forEach(function (p) {
      if (seenParents.indexOf(p) !== -1) return;
      seenParents.push(p);
    });
    for (var pi = 0; pi < seenParents.length; pi++) {
      var parent = seenParents[pi];
      var children = Array.from(parent.children);
      if (children.length < 5) continue;
      var labels = [];
      children.forEach(function (child) {
        var text = (child.innerText || '').trim();
        var firstLine = text.split('\\n')[0].trim();
        if (firstLine.length > 0 && firstLine.length < 60) labels.push(firstLine);
      });
      // Majority, not unanimous: real card grids often mix in a decorative
      // or non-text sibling (a divider, a trailing "view all" link).
      if (labels.length >= 5 && labels.length >= Math.ceil(children.length * 0.7)) {
        byParent.push(labels);
      }
    }
    if (byParent.length === 0) return [];
    // Prefer the largest qualifying group as the primary grid.
    byParent.sort(function (a, b) { return b.length - a.length; });
    return byParent[0];
  }

  Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).forEach(function (h) {
    if (practiceAreaLabels.length > 0) return; // first qualifying heading wins
    var t = (h.innerText || '').toLowerCase();
    if (!/practice area|our services|areas of (law|practice)|what we do|nossos servi[cç]os|como podemos ajudar|[aá]reas de atua[cç][aã]o|nos services|domaines de pratique/.test(t)) return;
    var scope = h.parentElement;
    for (var depth = 0; depth < 6 && scope; depth++) scope = scope.parentElement || scope;
    if (!scope) return;
    var found = findRepeatedLabelGroup(scope);
    found.slice(0, 30).forEach(function (label) { practiceAreaLabels.push(label); });
  });

  // English-primary with Portuguese/French terms added, same rationale as
  // the About/team-link patterns in dimensions/authority.ts: not
  // exhaustive multilingual coverage, but confirmed live that without it,
  // a real disclaimer on the Portuguese sakurabalaw.ca fixture ("Este
  // site e apenas informativo e nao constitui aconselhamento juridico")
  // went undetected.
  var disclaimerPresent = /legal information[,]? not legal advice|does not constitute legal advice|for informational purposes only|no attorney-client relationship|apenas informativo|n[aã]o constitui aconselhamento|(a|à) titre informatif|ne constitue pas un avis juridique/i.test(
    (document.body.innerText || '').slice(0, 3000)
  );

  var authority = {
    jsonLd: jsonLd,
    metaTitle: metaTitleEl ? metaTitleEl.textContent : null,
    metaDescription: metaDescEl ? metaDescEl.getAttribute('content') : null,
    firmVoicedText: firmVoicedText,
    navLinks: navLinks,
    footerLinks: footerLinks,
    authorBylines: authorBylines,
    testimonials: testimonials,
    practiceAreaLabels: practiceAreaLabels,
    disclaimerPresent: disclaimerPresent,
  };

  // Dark-pattern signals (master framework's red-flag list, Phase 4).
  var preCheckedConsentBoxes = [];
  Array.from(document.querySelectorAll('input[type="checkbox"]:checked')).slice(0, 20).forEach(function (box) {
    var id = box.getAttribute('id');
    var label = id ? document.querySelector('label[for="' + id + '"]') : box.closest('label');
    var labelText = label ? (label.innerText || '').trim() : '';
    if (/subscribe|newsletter|marketing|updates|consent|agree|offers|promotions/i.test(labelText)) {
      preCheckedConsentBoxes.push({ labelText: labelText.slice(0, 120) });
    }
  });

  var urgencyOrCountdownSignals = [];
  Array.from(document.querySelectorAll('[class*="countdown"],[class*="timer"],[class*="urgency"],[id*="countdown"],[id*="timer"]')).slice(0, 10).forEach(function (el) {
    urgencyOrCountdownSignals.push('element: ' + el.tagName.toLowerCase() + '.' + (el.className || '').toString().slice(0, 60));
  });
  var urgencyTextMatch = (document.body.innerText || '').match(/only \\d+ (left|remaining|spots?)|offer ends (today|soon|in)|hurry,?\\s|limited time only|\\d+ people (viewing|looking)/i);
  if (urgencyTextMatch) urgencyOrCountdownSignals.push('text: "' + urgencyTextMatch[0] + '"');

  var exitIntentScriptSignals = [];
  var EXIT_INTENT_SIGNATURES = ['exit-intent', 'exitintent', 'optinmonster', 'sumo.com', 'privy.com', 'exitpopup'];
  Array.from(document.querySelectorAll('script[src]')).forEach(function (s) {
    var src = (s.getAttribute('src') || '').toLowerCase();
    EXIT_INTENT_SIGNATURES.forEach(function (sig) {
      if (src.indexOf(sig) !== -1) exitIntentScriptSignals.push('script src matches "' + sig + '"');
    });
  });

  var bandwagonClaimsWithoutProof = [];
  var bandwagonPattern = /\\b(\\d{2,3}[,.]?\\d{3}\\+?|thousands|hundreds)\\s+(of\\s+)?(clients|customers|people|users|firms|families)\\b/gi;
  var bandwagonMatch;
  while ((bandwagonMatch = bandwagonPattern.exec(firmVoicedText)) !== null) {
    var bwStart = Math.max(0, bandwagonMatch.index - 150);
    var bwEnd = Math.min(firmVoicedText.length, bandwagonMatch.index + bandwagonMatch[0].length + 150);
    var bwWindow = firmVoicedText.slice(bwStart, bwEnd);
    var hasProof = /\\b\\d{4}\\b|survey|study|source:|according to/i.test(bwWindow);
    if (!hasProof) bandwagonClaimsWithoutProof.push(bandwagonMatch[0]);
  }

  var darkPatterns = {
    preCheckedConsentBoxes: preCheckedConsentBoxes,
    urgencyOrCountdownSignals: urgencyOrCountdownSignals,
    exitIntentScriptSignals: exitIntentScriptSignals,
    bandwagonClaimsWithoutProof: bandwagonClaimsWithoutProof,
  };

  return {
    h1Count: h1s.length,
    h1Text: h1s[0] ? (h1s[0].innerText || '').trim().slice(0, 200) : null,
    headingOrder: headings.map(function (h) { return h.tagName.toLowerCase(); }),
    headingSamples: headingSamples,
    bodyTextSample: samples,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    viewportMetaContent: viewportMeta ? viewportMeta.getAttribute('content') : null,
    forms: forms,
    tapTargets: tapTargets,
    hamburgerMenu: hamburgerMenu,
    images: images,
    spacingValuesPx: spacingValuesPx,
    authority: authority,
    darkPatterns: darkPatterns,
  };
})();
`;

async function captureViewport(
  browser: Browser,
  url: string,
  viewport: ViewportName
): Promise<RenderCapture> {
  const start = Date.now();
  const context = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    userAgent:
      "Mozilla/5.0 (compatible; CaseLoadSelect-DesignCheck/1.0; +https://caseloadselect.ca)",
  });
  const blocked: BlockedRequestLog[] = [];
  const page = await context.newPage();
  await guardRoutes(page, blocked);
  await page.addInitScript(WEB_VITALS_COLLECTOR);

  try {
    // "networkidle" is discouraged by Playwright's own docs: a real-world
    // site with persistent analytics/tracking chatter (beacons, polling)
    // may never go fully quiet, so it reliably times out on exactly the
    // sites this tool needs to grade. "load" plus the settle delay below
    // is the standard robust pattern.
    const response = await page.goto(url, {
      waitUntil: "load",
      timeout: NAV_TIMEOUT_MS,
    });
    // Let fonts finish swapping and the observers above finish collecting
    // before reading anything: LCP/CLS finalize on a delay, not at load.
    await page.waitForTimeout(RENDER_SETTLE_MS);
    await page.evaluate(() => document.fonts.ready).catch(() => undefined);

    // Measure the real page height first: a full-page capture taller than
    // the vision API's hard pixel ceiling is rejected outright, so the
    // capture is clipped rather than allowed to fail (see
    // MAX_SCREENSHOT_HEIGHT_PX).
    const fullPageHeightPx = (await page
      .evaluate(() => document.documentElement.scrollHeight)
      .catch(() => 0)) as number;
    const needsClip = fullPageHeightPx > MAX_SCREENSHOT_HEIGHT_PX;

    const [screenshotPng, html, domSnapshot, webVitals] = await Promise.all([
      needsClip
        ? page.screenshot({
            type: "png",
            clip: { x: 0, y: 0, width: VIEWPORTS[viewport].width, height: MAX_SCREENSHOT_HEIGHT_PX },
          })
        : page.screenshot({ fullPage: true, type: "png" }),
      page.content(),
      page.evaluate(DOM_SNAPSHOT_SCRIPT) as Promise<DomSnapshot>,
      page.evaluate("window.__designCheckVitals") as Promise<WebVitalsSample>,
    ]);

    return {
      viewport,
      finalUrl: response?.url() ?? url,
      screenshotPng: screenshotPng as Buffer,
      screenshotClippedFromPx: needsClip ? fullPageHeightPx : null,
      html,
      domSnapshot,
      webVitals,
      blockedRequests: blocked,
      renderMs: Date.now() - start,
    };
  } finally {
    await context.close();
  }
}

export interface RenderRunResult {
  captures: RenderCapture[];
  totalMs: number;
}

/** Renders one URL at both viewports. One browser instance shared across both. */
export async function renderUrl(url: string): Promise<RenderRunResult> {
  const start = Date.now();
  const browser = await launchBrowser();
  try {
    const captures = await Promise.all([
      captureViewport(browser, url, "mobile"),
      captureViewport(browser, url, "desktop"),
    ]);
    return { captures, totalMs: Date.now() - start };
  } finally {
    await browser.close();
  }
}
