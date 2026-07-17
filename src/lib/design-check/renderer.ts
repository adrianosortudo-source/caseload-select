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
