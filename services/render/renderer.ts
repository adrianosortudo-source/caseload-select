import type { Browser, BrowserContext, Route } from "playwright-core";
import { ssrfSafeFetchOneHop } from "./ssrf-fetch";
import type {
  BlockedRequestLog,
  DomSnapshot,
  RenderCapture,
  RenderRunResult,
  ViewportName,
  WebVitalsSample,
} from "./render-types";

/**
 * The render service's browser-launching layer. Loads a URL in a real
 * headless browser (not a fetch+regex crawl like seo-check) so the main
 * app's dimension scorers can score computed styles, layout, and a real
 * performance trace, and so the vision-model judgment pass has an actual
 * screenshot to look at.
 *
 * Moved here from src/lib/design-check/renderer.ts as part of the
 * render-isolation work (docs/BUILD_PLAN_render_isolation_v1.md): this
 * code executes attacker-chosen content, so it now runs in its own
 * Vercel project with zero application secrets rather than inside the
 * runtime holding the main app's 63 env vars. Every other consumer in
 * the main app (aggregate.ts, all seven dimensions/*.ts files) only ever
 * needed the TYPES this module produces, never the browser itself --
 * that's what made the move a call-site swap rather than a rewrite. The
 * wire shape those consumers depend on now lives in ./render-types,
 * mirrored byte-for-byte into the main app's own copy (parity enforced
 * by scripts/check-render-service-parity.mjs).
 *
 * Single Chromium strategy (unlike the pre-isolation dual-strategy
 * version): @sparticuz/chromium + playwright-core in production, full
 * `playwright` with its own bundled, Windows-compatible browser download
 * for local dev (a devDependency only, never bundled to the deployed
 * function).
 */

export const VIEWPORTS: Record<ViewportName, { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
};

const NAV_TIMEOUT_MS = 20_000;
const RENDER_SETTLE_MS = 1_500; // let web-vitals observers + fonts settle
// Caps the redirect chain guardContextRoutes will walk for a single
// intercepted request before refusing it outright. Bounds both a
// pathological/hostile infinite-redirect loop and how long one request can
// spend re-checking hops.
const MAX_REDIRECT_HOPS = 10;

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
    // @sparticuz/chromium ships `"type": "module"` (ESM-only, verified via
    // its own package.json); this import must reach the runtime as a real
    // dynamic import(), never a require(). Two things had to both be true
    // to get there, discovered the hard way against real production
    // renders on 2026-08-07:
    //
    // 1. tsconfig.json's module target must not downlevel import() to
    //    require(). It was "commonjs" originally, which does exactly that
    //    -- a longstanding, documented TypeScript behavior
    //    (microsoft/TypeScript#43329) -- and the first real render failed
    //    in 23ms with "require() of ES Module ... not supported" once
    //    server-side logging (handle-render-request.ts) made the error
    //    visible at all. Switched to "NodeNext", which preserves a
    //    literal import() call as real ESM-loader syntax even from this
    //    CommonJS-typed package (no "type": "module" of our own), while
    //    leaving every other static `import {...} from "..."` in this
    //    codebase compiling to require() exactly as before.
    // 2. The import specifier must stay a literal string Vercel's own
    //    build-time dependency tracer can see. A `new Function(...)`
    //    string-construction trick was tried first specifically to defeat
    //    TypeScript's static analysis and stop the require() downlevel --
    //    it worked for that, but it also hid the specifier from Vercel's
    //    tracer, so @sparticuz/chromium never got included in the
    //    deployed function bundle at all: the very next real render
    //    failed instantly with "Cannot find package '@sparticuz/chromium'"
    //    (ERR_MODULE_NOT_FOUND). Fixing the compiler setting instead of
    //    hiding the import from it is what satisfies both constraints at
    //    once: a real import() AND a specifier every tool can still see.
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

/**
 * Fetches exactly one hop of a redirect chain through the pinned-DNS
 * transport, converting the outcome into the shape guardContextRoutes'
 * loop needs: either a response object (redirect or final, the caller
 * decides which) or a thrown Error whose message becomes the blocked
 * reason. This is the seam guard-context-routes tests mock -- injecting
 * a fake here proves the loop's own control flow (does it re-check the
 * next hop before fetching it? does it abort without fulfilling when a
 * hop is refused?) without needing a real network or a real blocked
 * address to resolve against. The exported default wires the real
 * pinned-DNS-safe fetch.
 */
export type FetchHop = (url: string, timeoutMs: number) => Promise<Response>;

async function defaultFetchHop(url: string, timeoutMs: number): Promise<Response> {
  return ssrfSafeFetchOneHop(url, { timeoutMs, allowedSchemes: ["http:", "https:"] });
}

/**
 * SSRF-guards every request the browser context issues: subresources,
 * popups, and -- the part that matters here -- every hop of a redirect.
 *
 * Registered on the BROWSER CONTEXT (context.route), not the page
 * (page.route). page.route only covers the top-level page object it was
 * attached to: a page opened by the rendered site itself (window.open, a
 * target="_blank" click simulated by the site's own script) gets its own
 * Page instance with NO route handler at all, so none of its requests are
 * ever checked. context.route applies to every page the context creates,
 * present and future, closing that gap.
 *
 * Redirects are walked manually rather than trusting Playwright to re-fire
 * this handler on each hop, because it does not: page.route's own request
 * interception is only invoked once per *user-initiated* request. When
 * that request's response is a same-navigation HTTP redirect, Chromium
 * follows the Location header internally and Playwright surfaces the final
 * destination without ever calling the route handler again for it. A route
 * handler that only inspected route.request().url() saw the original URL,
 * never the redirect target, and a page that 302'd to a loopback address
 * rendered its content through to the report with zero indication the
 * guard had been bypassed (the original finding this mechanism exists to
 * close).
 *
 * The transport that fetches each hop is what changed in the
 * render-isolation work (docs/BUILD_PLAN_render_isolation_v1.md §3.4).
 * The original fix (commit 7f1739d3 on the pre-isolation branch) drove
 * the hop chain via Playwright's own route.fetch({maxRedirects: 0}),
 * which uses Playwright's network stack and its own DNS resolution --
 * separate from whatever resolution a standalone SSRF check might have
 * used to decide "is this hop allowed," which is exactly the shape of a
 * DNS-rebinding TOCTOU (the check and the connect can each resolve a
 * hostname to a different address). fetchHop now drives every hop
 * through ssrfSafeFetchOneHop, the same pinned-DNS undici transport
 * ssrf-fetch.ts already uses for the main app's own redirect-following
 * (publication-receipt verification): validateOutboundUrl runs first
 * (catches literal blocked IPs and blocklisted hostnames with no network
 * I/O at all), then the fetch itself resolves DNS through an agent whose
 * connect.lookup hook refuses to connect at all if any resolved address
 * is in a blocked range -- the SAME resolution used for the real
 * connection, not a separate pre-check that could disagree with it. A
 * blocked hop now surfaces as a thrown Error (caught below and logged
 * with its message as the reason) rather than a typed
 * {blocked, reason} result, because the check and the fetch are now one
 * atomic operation instead of two.
 *
 * Once a non-redirect response is reached (or the chain is exhausted / a
 * hop is blocked), the original route is resolved exactly once via
 * route.fulfill() or route.abort() -- Chromium never performs its own
 * follow-the-redirect network call for this request at all, and never
 * resolves DNS for it either: Node does, through the pinned agent.
 *
 * fetchHop defaults to the real pinned-DNS transport and is only ever
 * overridden in tests, to drive the same real interception mechanism
 * against a scripted response sequence without depending on live
 * DNS/network access.
 */
export async function guardContextRoutes(
  context: BrowserContext,
  blocked: BlockedRequestLog[],
  fetchHop: FetchHop = defaultFetchHop
): Promise<void> {
  let intercepted = 0;
  await context.route("**/*", async (route: Route) => {
    intercepted++;
    if (intercepted > MAX_INTERCEPTED_REQUESTS) {
      blocked.push({ url: route.request().url(), reason: "request_budget_exceeded" });
      await route.abort();
      return;
    }

    const originalUrl = route.request().url();
    let protocol: string;
    try {
      protocol = new URL(originalUrl).protocol;
    } catch {
      blocked.push({ url: originalUrl, reason: "unsupported_protocol" });
      await route.abort();
      return;
    }
    if (protocol !== "http:" && protocol !== "https:") {
      // data:/blob:/about: and similar are same-document, no network
      // request for the SSRF transport to evaluate; nothing to guard.
      await route.continue();
      return;
    }

    let currentUrl = originalUrl;
    let finalResponse: Response | null = null;

    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      let hopResponse: Response;
      try {
        hopResponse = await fetchHop(currentUrl, NAV_TIMEOUT_MS);
      } catch (err) {
        blocked.push({
          url: currentUrl,
          reason: err instanceof Error ? err.message : String(err),
        });
        await route.abort();
        return;
      }

      if (hopResponse.status >= 300 && hopResponse.status < 400) {
        const location = hopResponse.headers.get("location");
        if (!location) {
          blocked.push({ url: currentUrl, reason: "redirect_missing_location" });
          await route.abort();
          return;
        }
        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          blocked.push({ url: currentUrl, reason: "redirect_invalid_location" });
          await route.abort();
          return;
        }
        currentUrl = nextUrl;
        continue; // next hop is re-validated by fetchHop at the top of the loop before being fetched
      }

      finalResponse = hopResponse;
      break;
    }

    if (!finalResponse) {
      blocked.push({ url: currentUrl, reason: "too_many_redirects" });
      await route.abort();
      return;
    }

    // finalResponse.arrayBuffer() is the DECODED body: undici/fetch
    // transparently decompresses gzip/br/deflate before handing it back.
    // So the body passed to route.fulfill() is already plain bytes -- but
    // the response headers still describe the ON-THE-WIRE encoding that no
    // longer applies. Copying content-encoding / content-length /
    // transfer-encoding verbatim tells Chromium "these bytes are
    // gzip-compressed and N bytes long" about a body that is neither, so
    // Chromium either fails to decode or waits for compressed data that
    // never arrives -- which is exactly how a render of even a trivial
    // page (example.com) hung to the 280s timeout on 2026-08-07 once the
    // earlier crash-before-navigation bugs (#136/#137 module loading,
    // #138 concurrent single-process contexts) were cleared and execution
    // finally reached this fulfill path. These three headers must be
    // dropped whenever the body is handed over decoded; Chromium
    // recomputes the correct length itself.
    const bodyBuffer = Buffer.from(await finalResponse.arrayBuffer());
    const STRIP_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding"]);
    const headers: Record<string, string> = {};
    finalResponse.headers.forEach((value, key) => {
      if (!STRIP_HEADERS.has(key.toLowerCase())) headers[key] = value;
    });
    await route.fulfill({ status: finalResponse.status, headers, body: bodyBuffer });
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
  //
  // Tested against the FULL body text, not a truncated slice: a fixed
  // character cap here was tried first and found live (2026-08-06) to
  // produce a false negative on drglaw.ca. That site's real, doctrine-
  // locked disclaimer ("Legal information, not legal advice.") sits at
  // character 6064 of its homepage, past a 3000-character cutoff the
  // check previously used, because the hero and services content ahead
  // of the disclaimer's placement near the intake widget is substantial.
  // A plain regex .test() against a full page's innerText is cheap
  // (microseconds even on a long page), so there was no real performance
  // reason for the cap in the first place.
  var disclaimerPresent = /legal information[,]? not legal advice|does not constitute legal advice|for informational purposes only|no attorney-client relationship|apenas informativo|n[aã]o constitui aconselhamento|(a|à) titre informatif|ne constitue pas un avis juridique/i.test(
    document.body.innerText || ''
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
  // Registered on the context, before any page exists, so the very first
  // navigation request is guarded and so is any page the rendered site
  // opens on its own (see guardContextRoutes' docstring for why
  // page-level routing does not cover that case).
  await guardContextRoutes(context, blocked);
  const page = await context.newPage();
  // This tool only ever needs the single page it navigated itself: no
  // dimension or vision check reads anything from a popup, and scoring a
  // marketing page's design/accessibility/copy never requires following a
  // target="_blank" link or a window.open() call. Registered only after
  // the main page above is created, so this only ever sees genuine
  // popups, never fights with the main page's own creation. Rather than
  // rely solely on request interception (already in place via
  // guardContextRoutes) to make an unwanted popup inert, close any
  // further page the context spawns the moment it appears, before it gets
  // a chance to run more script or navigate again.
  context.on("page", (popup) => {
    blocked.push({ url: popup.url(), reason: "popup_closed" });
    popup.close().catch(() => undefined);
  });
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

    const [screenshotBuffer, domSnapshot, webVitals] = await Promise.all([
      needsClip
        ? page.screenshot({
            type: "png",
            clip: { x: 0, y: 0, width: VIEWPORTS[viewport].width, height: MAX_SCREENSHOT_HEIGHT_PX },
          })
        : page.screenshot({ fullPage: true, type: "png" }),
      page.evaluate(DOM_SNAPSHOT_SCRIPT) as Promise<DomSnapshot>,
      page.evaluate("window.__designCheckVitals") as Promise<WebVitalsSample>,
    ]);

    return {
      viewport,
      finalUrl: response?.url() ?? url,
      // Encoded to base64 here, at the point of capture, so this
      // function's return type is already the wire shape
      // (RenderCapture.screenshotPng: string) -- the HTTP handler in
      // api/render.ts does not need its own Buffer-to-base64 conversion
      // step. `page.content()` (the HTML capture the pre-isolation
      // renderer also produced) is deliberately not called: it was
      // verified consumed nowhere downstream, and dropping it removes an
      // unbounded, attacker-influenced field from both the capture and
      // the wire response.
      screenshotPng: (screenshotBuffer as Buffer).toString("base64"),
      screenshotClippedFromPx: needsClip ? fullPageHeightPx : null,
      domSnapshot,
      webVitals,
      blockedRequests: blocked,
      renderMs: Date.now() - start,
    };
  } finally {
    // Never let cleanup mask the real failure. When the browser has
    // already died, context.close() throws "Target page, context or
    // browser has been closed" -- and because that throw happens in a
    // finally block, it REPLACES whatever error actually caused the
    // failure, which is the error worth seeing. That is exactly what
    // happened on the 2026-08-07 production renders: every real cause
    // was invisible behind a close() error, and the logs showed only the
    // symptom. Swallowing it here is safe: a context on a browser that
    // is about to be closed (see renderUrl's finally) needs no explicit
    // cleanup to avoid a leak.
    await context.close().catch(() => undefined);
  }
}

/** Renders one URL at both viewports, sequentially. One browser instance
 * shared across both. */
export async function renderUrl(url: string): Promise<RenderRunResult> {
  const start = Date.now();
  const browser = await launchBrowser();
  try {
    // Sequential, NOT Promise.all. @sparticuz/chromium's own argument set
    // forces --single-process (plus --no-zygote and the site-isolation
    // disables) because Lambda-class serverless environments cannot give
    // Chromium the process/namespace primitives it normally relies on --
    // see README.md for the full flag rationale. Under --single-process
    // the browser, every renderer, and the GPU process all share one OS
    // process, and driving two BrowserContexts concurrently through it is
    // unstable: the 2026-08-07 production renders died mid-capture with
    // the browser process gone, for both a heavy real site (drglaw.ca)
    // and a trivial one (example.com), which rules out page weight as the
    // cause. Running the viewports one after the other also halves peak
    // memory, which matters on a 2GB-capped Hobby-tier function.
    //
    // The cost is wall-clock: two sequential ~5-10s captures instead of
    // two overlapping ones. That is well within this service's 300s
    // budget and not worth trading for a browser that falls over.
    const captures: RenderCapture[] = [];
    for (const viewport of ["mobile", "desktop"] as const) {
      captures.push(await captureViewport(browser, url, viewport));
    }
    return { captures, totalMs: Date.now() - start };
  } finally {
    // Same masking rationale as captureViewport's own cleanup above: if
    // the browser is already gone, close() throws and would replace the
    // real error on the way out.
    await browser.close().catch(() => undefined);
  }
}
