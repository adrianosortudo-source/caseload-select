/**
 * Regression tests for content-signals.ts, written directly against the
 * drglaw.ca dogfood audit (2026-07-16) that exposed each of these gaps. See
 * content-signals.ts docblocks for the field-case detail behind each fix.
 */

import { describe, it, expect } from "vitest";
import {
  classifyImageAlt,
  summarizeImageAlt,
  hasGoogleBusinessProfileLink,
  hasTestimonialStructure,
  likelyServiceAreaBusiness,
  classifyCsp,
  classifyTtfb,
  classifyWordCount,
  classifyContentRatio,
} from "../content-signals";

describe("classifyImageAlt / summarizeImageAlt", () => {
  it("classifies a missing alt attribute as missing (real accessibility failure)", () => {
    expect(classifyImageAlt(`<img src="/photo.png">`)).toBe("missing");
  });

  it("classifies alt=\"\" on a plain decorative image as decorative, not missing", () => {
    // Field case: drglaw.ca's full-bleed walnut-desk background band.
    const tag = `<img alt="" loading="lazy" data-nimg="fill" class="v3-final-bg" src="/images/brand/walnut-band.jpg"/>`;
    expect(classifyImageAlt(tag)).toBe("decorative");
  });

  it("classifies non-empty alt as present", () => {
    expect(classifyImageAlt(`<img alt="Damaris Regina Guimaraes, founder of DRG Law" src="/x.png">`)).toBe("present");
  });

  it("classifies alt=\"\" as suspicious when the image is the only content of a link with no other label", () => {
    const control = `<img alt="" src="/icon.svg">`;
    expect(classifyImageAlt(`<img alt="" src="/icon.svg">`, control)).toBe("suspicious-empty");
  });

  it("does not flag alt=\"\" as suspicious when the control has other visible text", () => {
    const control = `<img alt="" src="/icon.svg"> Contact us`;
    expect(classifyImageAlt(`<img alt="" src="/icon.svg">`, control)).toBe("decorative");
  });

  it("does not flag alt=\"\" as suspicious when the control has an aria-label", () => {
    const control = `<img alt="" src="/icon.svg">`;
    // aria-label lives on the <a>/<button> itself in real markup; simulate by
    // including it in the control's innerHTML scan window.
    expect(classifyImageAlt(`<img alt="" src="/icon.svg">`, `${control} aria-label="Call us"`)).toBe("decorative");
  });

  it("summarizeImageAlt buckets a mixed page correctly", () => {
    const html = `
      <a href="/contact"><img alt="" src="/icon.svg"></a>
      <img alt="" class="hero-bg" src="/bg.jpg">
      <img src="/no-alt.jpg">
      <img alt="Team photo" src="/team.jpg">
    `;
    const summary = summarizeImageAlt(html);
    expect(summary.total).toBe(4);
    expect(summary.missing).toBe(1);
    expect(summary.decorative).toBe(1);
    expect(summary.suspiciousEmpty).toBe(1);
  });

  it("reproduces the drglaw.ca homepage: real alt text, one valid decorative image, zero missing", () => {
    const html = `
      <img alt="A lawyer's desk with legal papers and warm material details" src="/hero.png">
      <img alt="Damaris Regina Guimaraes, founder of DRG Law" src="/founder.png">
      <img alt="" class="v3-final-bg" src="/walnut-band.jpg">
    `;
    const summary = summarizeImageAlt(html);
    expect(summary.missing).toBe(0);
    expect(summary.suspiciousEmpty).toBe(0);
    expect(summary.decorative).toBe(1);
  });
});

describe("hasGoogleBusinessProfileLink", () => {
  it("recognizes the maps?cid= permalink format (field case drglaw.ca)", () => {
    const html = `<a href="https://www.google.com/maps?cid=563987161242451811" target="_blank">Read more</a>`;
    expect(hasGoogleBusinessProfileLink(html)).toBe(true);
  });

  it("still recognizes maps/place and maps/dir links", () => {
    expect(hasGoogleBusinessProfileLink(`<a href="https://google.com/maps/place/Firm+Name">Map</a>`)).toBe(true);
    expect(hasGoogleBusinessProfileLink(`<a href="https://google.com/maps/dir/?api=1">Directions</a>`)).toBe(true);
  });

  it("still recognizes g.page and maps.app.goo.gl short links", () => {
    expect(hasGoogleBusinessProfileLink(`<a href="https://g.page/some-firm">Reviews</a>`)).toBe(true);
    expect(hasGoogleBusinessProfileLink(`<a href="https://maps.app.goo.gl/abc123">Visit</a>`)).toBe(true);
  });

  it("returns false when no GBP link is present", () => {
    expect(hasGoogleBusinessProfileLink(`<a href="/contact">Contact</a>`)).toBe(false);
  });
});

describe("hasTestimonialStructure", () => {
  it("detects attributed client quotes with no literal 'testimonial' word (field case drglaw.ca)", () => {
    const html = `<ul aria-label="Client excerpts"><li><p>“Hiring her to review my contract was one of the best decisions I've made.”</p><cite>Alessandra Souza · Toronto</cite></li></ul>`;
    expect(hasTestimonialStructure(html)).toBe(true);
    expect(/testimonial/i.test(html)).toBe(false);
  });

  it("detects an explicit aria-label naming client quotes", () => {
    expect(hasTestimonialStructure(`<div aria-label="What our clients say">...</div>`)).toBe(true);
  });

  it("does not fire on an unrelated <cite> with no nearby quote", () => {
    expect(hasTestimonialStructure(`<p>See the style guide.</p><cite>MLA format</cite>`)).toBe(false);
  });

  it("returns false on plain content with no quote structure at all", () => {
    expect(hasTestimonialStructure(`<p>We handle real estate and corporate law.</p>`)).toBe(false);
  });

  // A <cite> is the correct tag to attribute a quotation from case law, a
  // statute, or a style guide — none of which are client trust signals, even
  // though the markup shape (quote + cite) is identical to a testimonial.
  it("does not credit a quoted case-law excerpt as a testimonial", () => {
    const html = `<blockquote>"The court held that the defendant's conduct fell below the standard of care."</blockquote><cite>Smith v. Jones, 2020 ONCA 123</cite>`;
    expect(hasTestimonialStructure(html)).toBe(false);
  });

  it("does not credit a quoted statute excerpt as a testimonial", () => {
    const html = `<p>"Every person has a right to file a complaint."</p><cite>Employment Standards Act, R.S.O. 1990</cite>`;
    expect(hasTestimonialStructure(html)).toBe(false);
  });

  it("does not credit a quote and an unrelated citation that merely co-occur on the page (not adjacent)", () => {
    // Field concern: the original heuristic checked "a <cite> exists AND a
    // quote exists anywhere on the page," which would misfire on a law-firm
    // blog post that quotes case law elsewhere on a page that also happens
    // to carry an unrelated decorative pull-quote.
    const html = `
      <blockquote class="pull-quote">"Access to justice matters."</blockquote>
      <p>Reference: <cite>Ontario Legal Aid</cite> annual report.</p>
    `;
    expect(hasTestimonialStructure(html)).toBe(false);
  });

  it("credits a <blockquote> immediately followed by a <cite> naming a person (no literal quote marks required in the blockquote)", () => {
    expect(hasTestimonialStructure(`<blockquote>Great firm, highly recommend.</blockquote><cite>J. Doe</cite>`)).toBe(true);
  });
});

describe("likelyServiceAreaBusiness / hasServiceAreaLanguage", () => {
  it("recognizes a remote/service-area practice (field case drglaw.ca: areaServed + 'by video')", () => {
    const body = "DRG Law closes residential and commercial purchases across Ontario by video and other remote methods.";
    expect(likelyServiceAreaBusiness(body, true, false)).toBe(true);
  });

  it("does not fire when an address IS visible, regardless of language", () => {
    const body = "Visit our office. We also close deals remotely by video when needed.";
    expect(likelyServiceAreaBusiness(body, true, true)).toBe(false);
  });

  it("does not fire on areaServed schema alone without remote/service-area language", () => {
    const body = "We are Ontario's trusted law firm for over 20 years.";
    expect(likelyServiceAreaBusiness(body, true, false)).toBe(false);
  });

  it("does not fire on service-area language alone without areaServed schema", () => {
    const body = "We offer virtual consultations for your convenience.";
    expect(likelyServiceAreaBusiness(body, false, false)).toBe(false);
  });
});

describe("classifyCsp", () => {
  it("credits an enforced header as pass", () => {
    const r = classifyCsp("default-src 'self'", null);
    expect(r.status).toBe("pass");
    expect(r.detail).toMatch(/enforced/i);
  });

  it("credits report-only as implementation in progress, not a missing control (field case drglaw.ca)", () => {
    const r = classifyCsp(null, "default-src 'self'; script-src 'self'");
    expect(r.status).toBe("warn");
    expect(r.detail).toMatch(/report-only/i);
    expect(r.detail).toMatch(/implementation in progress/i);
    // May legitimately say "not an enforced security control" (a negative
    // clarification); must never claim positive enforcement.
    expect(r.detail.toLowerCase()).not.toContain("present and enforced");
    expect(r.detail.toLowerCase()).not.toMatch(/\bis enforced\b/);
  });

  it("leads with 'monitoring enabled ... enforcement still pending' so a skimming reader can't mistake report-only for a working CSP", () => {
    const r = classifyCsp(null, "default-src 'self'");
    expect(r.detail).toMatch(/monitoring enabled/i);
    expect(r.detail).toMatch(/enforcement still pending/i);
    expect(r.detail).toMatch(/not.*(an )?enforced security control|nothing is blocked/i);
  });

  it("does not claim full enforcement when only report-only is present", () => {
    const r = classifyCsp(null, "default-src 'self'");
    expect(r.detail.toLowerCase()).not.toContain("present and enforced");
  });

  it("treats a genuinely missing header as before", () => {
    const r = classifyCsp(null, null);
    expect(r.status).toBe("warn");
    expect(r.detail).toMatch(/missing/i);
  });

  it("prefers the enforced header when both are somehow present", () => {
    const r = classifyCsp("default-src 'self'", "default-src 'none'");
    expect(r.status).toBe("pass");
  });
});

describe("classifyTtfb", () => {
  it("does not fail a single noisy sample the way it would a corroborated one (field case drglaw.ca: 1176ms single sample vs ~150-180ms true)", () => {
    const r = classifyTtfb({ ms: 1176, sampleCount: 1 });
    expect(r.status).not.toBe("fail");
    expect(r.status).toBe("warn");
    expect(r.detail).toMatch(/single-sample/i);
  });

  it("passes a fast single sample", () => {
    expect(classifyTtfb({ ms: 180, sampleCount: 1 }).status).toBe("pass");
  });

  it("still fails a single sample far outside plausible noise", () => {
    expect(classifyTtfb({ ms: 4000, sampleCount: 1 }).status).toBe("fail");
  });

  it("uses tighter thresholds and reports median + range for multi-sample readings", () => {
    const r = classifyTtfb({ ms: 180, sampleCount: 3, min: 150, max: 210 });
    expect(r.status).toBe("pass");
    expect(r.detail).toMatch(/median/i);
    expect(r.detail).toMatch(/range 150-210ms/i);
  });

  it("fails a multi-sample median above 900ms even though that would only warn on a single sample", () => {
    const r = classifyTtfb({ ms: 950, sampleCount: 3, min: 900, max: 1000 });
    expect(r.status).toBe("fail");
  });

  it("warns when the measurement could not be taken at all", () => {
    expect(classifyTtfb({ ms: 0, sampleCount: 0 }).status).toBe("warn");
  });
});

describe("classifyWordCount", () => {
  it("passes 300+ words without asserting a hard minimum exists", () => {
    const r = classifyWordCount(450);
    expect(r.status).toBe("pass");
  });

  it("warns thin content with guideline language, not a hard rule", () => {
    const r = classifyWordCount(220);
    expect(r.status).toBe("warn");
    expect(r.detail).toMatch(/no fixed minimum/i);
  });

  it("fails very thin content but still avoids claiming a universal minimum", () => {
    const r = classifyWordCount(50);
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/no fixed word-count rule/i);
  });
});

describe("classifyContentRatio", () => {
  it("passes a low ratio when the page already has substantive word count (framework markup weight, not thin content)", () => {
    const r = classifyContentRatio(4, 900);
    expect(r.status).toBe("pass");
    expect(r.detail).toMatch(/markup weight, not thin content/i);
  });

  it("still passes a healthy ratio regardless of word count", () => {
    expect(classifyContentRatio(20, 50).status).toBe("pass");
  });

  it("warns a low ratio with moderate word count as a weak signal, not a standalone problem", () => {
    const r = classifyContentRatio(6, 180);
    expect(r.status).toBe("warn");
    expect(r.detail).toMatch(/weak signal/i);
  });

  it("fails only when ratio AND word count are both genuinely thin", () => {
    const r = classifyContentRatio(3, 40);
    expect(r.status).toBe("fail");
  });
});
