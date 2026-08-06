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

  function sampleText(el) {
    var cs = getComputedStyle(el);
    var rect = el.getBoundingClientRect();
    var text = (el.innerText || '').trim().slice(0, 200);
    var fontSizePx = parseFloat(cs.fontSize) || 0;
    return {
      tag: el.tagName.toLowerCase(),
      text: text,
      fontSizePx: fontSizePx,
      fontWeight: cs.fontWeight,
      fontFamily: cs.fontFamily,
      lineHeightPx: parseFloat(cs.lineHeight) || 0,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
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
  var spacingValuesPx = [];
  var layoutEls = Array.from(document.querySelectorAll('section,header,footer,nav,article,main,div')).slice(0, 150);
  layoutEls.forEach(function (el) {
    var cs = getComputedStyle(el);
    ['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].forEach(function (prop) {
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
  var firmVoicedParts = [];
  Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button')).slice(0, 400).forEach(function (el) {
    var t = (el.innerText || '').trim();
    if (t.length > 0) firmVoicedParts.push(t);
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

    const [screenshotPng, html, domSnapshot, webVitals] = await Promise.all([
      page.screenshot({ fullPage: true, type: "png" }),
      page.content(),
      page.evaluate(DOM_SNAPSHOT_SCRIPT) as Promise<DomSnapshot>,
      page.evaluate("window.__designCheckVitals") as Promise<WebVitalsSample>,
    ]);

    return {
      viewport,
      finalUrl: response?.url() ?? url,
      screenshotPng: screenshotPng as Buffer,
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
