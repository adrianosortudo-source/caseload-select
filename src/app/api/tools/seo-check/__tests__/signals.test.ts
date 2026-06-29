/**
 * Tests for the HTML-signal detection patterns used by extractLawFirmSignals
 * in route.ts. The function is private to the route, so we test the patterns
 * directly to pin the logic without restructuring the module.
 */

import { describe, it, expect } from "vitest";

// ---- replicated patterns from extractLawFirmSignals ----

const INTAKE_ANCHOR_RE = /#(matter-review|intake|contact|book|schedule|consultation|get-started|form)/;
const INTAKE_PATH_RE = /\/(book|contact|schedule|consultation)/;

function hasIntakeAnchor(html: string): boolean {
  const hrefs = [...html.matchAll(/\bhref=["']([^"']+)["']/gi)].map((m) => m[1].toLowerCase());
  return hrefs.some((h) => INTAKE_ANCHOR_RE.test(h) || INTAKE_PATH_RE.test(h));
}

const INTAKE_IFRAME_RE = /(widget-public|widget\/|intake|calendly\.com|typeform\.com|jotform\.com|cognitoforms|formstack)/;

function hasIntakeIframe(html: string): boolean {
  const srcs = [...html.matchAll(/<iframe[^>]*src=["']([^"']+)["']/gi)].map((m) => m[1].toLowerCase());
  return srcs.some((s) => INTAKE_IFRAME_RE.test(s));
}

// ---- intake anchor detection ----

describe("hasIntakeAnchor", () => {
  it("detects #matter-review (CaseLoad Screen intake CTA pattern)", () => {
    const html = `<a href="#matter-review" class="btn">Book a call with the firm</a>`;
    expect(hasIntakeAnchor(html)).toBe(true);
  });

  it("detects /contact path in href", () => {
    const html = `<a href="/contact">Get in touch</a>`;
    expect(hasIntakeAnchor(html)).toBe(true);
  });

  it("detects /book path in href", () => {
    const html = `<a href="/book-consultation">Schedule now</a>`;
    expect(hasIntakeAnchor(html)).toBe(true);
  });

  it("detects #intake fragment anchor", () => {
    const html = `<a href="#intake">Start here</a>`;
    expect(hasIntakeAnchor(html)).toBe(true);
  });

  it("detects #consultation fragment anchor", () => {
    const html = `<a href="#consultation">Free consultation</a>`;
    expect(hasIntakeAnchor(html)).toBe(true);
  });

  it("does not fire on unrelated anchors", () => {
    const html = `<a href="/about">About us</a> <a href="#team">Meet the team</a>`;
    expect(hasIntakeAnchor(html)).toBe(false);
  });

  it("does not fire on empty page", () => {
    expect(hasIntakeAnchor("<p>No links here</p>")).toBe(false);
  });

  it("matches multiple anchors on a page like drglaw.ca (4x #matter-review)", () => {
    const html = [
      `<a href="#matter-review" class="hero-cta">...</a>`,
      `<a href="#matter-review" class="nav-cta">...</a>`,
      `<a href="/contact">Contact</a>`,
      `<a href="/#matter-review">...</a>`,
    ].join("\n");
    expect(hasIntakeAnchor(html)).toBe(true);
  });
});

// ---- intake iframe detection ----

describe("hasIntakeIframe", () => {
  it("detects CaseLoad Screen widget-public iframe", () => {
    const html = `<iframe src="https://app.caseloadselect.ca/widget-public/eec1d25e-a047-4827-8e4a-6eb96becca2b" loading="lazy"></iframe>`;
    expect(hasIntakeIframe(html)).toBe(true);
  });

  it("detects Calendly embed", () => {
    const html = `<iframe src="https://calendly.com/myfirm/consult" width="100%"></iframe>`;
    expect(hasIntakeIframe(html)).toBe(true);
  });

  it("detects Typeform embed", () => {
    const html = `<iframe src="https://myfirm.typeform.com/to/abc123"></iframe>`;
    expect(hasIntakeIframe(html)).toBe(true);
  });

  it("detects JotForm embed", () => {
    const html = `<iframe id="JotFormIFrame-123" src="https://form.jotform.com/myfirm/contact"></iframe>`;
    expect(hasIntakeIframe(html)).toBe(true);
  });

  it("does not fire on YouTube or Google Maps iframes", () => {
    const html = [
      `<iframe src="https://www.youtube.com/embed/xyz"></iframe>`,
      `<iframe src="https://www.google.com/maps/embed?pb=..."></iframe>`,
    ].join("\n");
    expect(hasIntakeIframe(html)).toBe(false);
  });

  it("does not fire when no iframe present", () => {
    expect(hasIntakeIframe("<p>Contact us at 416-555-1234</p>")).toBe(false);
  });
});

// ---- GBP link detection (replicated from checkLocalSeo) ----

function hasGbpLink(html: string): boolean {
  return (
    /google\.com\/(maps\/place|search\?.*business|business)/i.test(html) ||
    /g\.page\//i.test(html) ||
    /maps\.app\.goo\.gl|goo\.gl\/maps/i.test(html)
  );
}

describe("hasGbpLink", () => {
  it("detects google.com/maps/place link", () => {
    expect(hasGbpLink(`<a href="https://www.google.com/maps/place/myfirm">Google</a>`)).toBe(true);
  });

  it("detects maps.app.goo.gl short URL (common Share button output)", () => {
    expect(hasGbpLink(`<a href="https://maps.app.goo.gl/YwmKbP64L9w8DyEc6">Find us on Google</a>`)).toBe(true);
  });

  it("detects goo.gl/maps short URL (legacy format)", () => {
    expect(hasGbpLink(`<a href="https://goo.gl/maps/abc123">Directions</a>`)).toBe(true);
  });

  it("detects g.page short URL", () => {
    expect(hasGbpLink(`<a href="https://g.page/myfirm">GBP</a>`)).toBe(true);
  });

  it("does not fire on unrelated google links", () => {
    expect(hasGbpLink(`<a href="https://www.google.com/search?q=lawyers">Search</a>`)).toBe(false);
  });

  it("does not fire when no Google link present", () => {
    expect(hasGbpLink("<p>Contact us by phone.</p>")).toBe(false);
  });
});
