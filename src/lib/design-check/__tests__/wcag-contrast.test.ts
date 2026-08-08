import { describe, it, expect } from "vitest";
import { parseCssColor, relativeLuminance, contrastRatio, checkTextContrast } from "../wcag-contrast";

/**
 * Contrast is the one finding in this tool that is a hard accessibility
 * standard rather than a judgment call, and Phase 4 promotes a failure
 * into a grade-capping red flag. That makes the math load-bearing: a
 * wrong ratio caps a firm's grade on a page that was actually compliant,
 * or clears one that was not. These pin it against the published WCAG
 * reference values.
 */

describe("parseCssColor", () => {
  it("parses the rgb() form getComputedStyle returns", () => {
    expect(parseCssColor("rgb(30, 47, 88)")).toEqual({ r: 30, g: 47, b: 88, a: 1 });
  });

  it("parses rgba() and keeps the alpha channel", () => {
    expect(parseCssColor("rgba(0, 0, 0, 0)")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("tolerates the whitespace and decimal variations real browsers emit", () => {
    expect(parseCssColor("rgba(255,255,255,0.5)")).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
  });

  it("returns null rather than guessing on a format it cannot read", () => {
    expect(parseCssColor("#1E2F58")).toBeNull();
    expect(parseCssColor("navy")).toBeNull();
    expect(parseCssColor("")).toBeNull();
  });
});

describe("relativeLuminance", () => {
  it("puts pure black at 0 and pure white at 1", () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0, a: 1 })).toBeCloseTo(0, 5);
    expect(relativeLuminance({ r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1, 5);
  });

  it("weights green most heavily, per the WCAG coefficients", () => {
    const green = relativeLuminance({ r: 0, g: 255, b: 0, a: 1 });
    const red = relativeLuminance({ r: 255, g: 0, b: 0, a: 1 });
    const blue = relativeLuminance({ r: 0, g: 0, b: 255, a: 1 });
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
    expect(green).toBeCloseTo(0.7152, 4);
  });
});

describe("contrastRatio", () => {
  const black = { r: 0, g: 0, b: 0, a: 1 };
  const white = { r: 255, g: 255, b: 255, a: 1 };

  it("returns the maximum 21:1 for black on white", () => {
    expect(contrastRatio(black, white)).toBeCloseTo(21, 2);
  });

  it("returns 1:1 for a colour against itself", () => {
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
  });

  it("is symmetric, so argument order cannot change a pass into a fail", () => {
    const navy = { r: 30, g: 47, b: 88, a: 1 };
    expect(contrastRatio(navy, white)).toBeCloseTo(contrastRatio(white, navy), 10);
  });

  it("matches the published reference value for mid grey on white", () => {
    // #767676 on white is the canonical example of a colour that just
    // clears the 4.5:1 body-text minimum.
    const grey = { r: 118, g: 118, b: 118, a: 1 };
    const ratio = contrastRatio(grey, white);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeCloseTo(4.54, 1);
  });

  it("puts a known-failing light grey below the AA body minimum", () => {
    const lightGrey = { r: 200, g: 200, b: 200, a: 1 };
    expect(contrastRatio(lightGrey, white)).toBeLessThan(4.5);
  });
});

describe("checkTextContrast", () => {
  it("computes a ratio when both colours are real", () => {
    const result = checkTextContrast("rgb(0, 0, 0)", "rgb(255, 255, 255)");
    expect(result.checkable).toBe(true);
    if (result.checkable) expect(result.ratio).toBeCloseTo(21, 2);
  });

  it("reports a fully transparent background as not checkable rather than assuming white", () => {
    // Assuming a background would fabricate a pass or fail that was never
    // measured. The tool reports what it could not check instead.
    const result = checkTextContrast("rgb(255, 255, 255)", "rgba(0, 0, 0, 0)");
    expect(result.checkable).toBe(false);
    if (!result.checkable) expect(result.reason).toBe("transparent_background");
  });

  it("reports an unparseable colour as not checkable", () => {
    const result = checkTextContrast("rgb(0,0,0)", "transparent");
    expect(result.checkable).toBe(false);
    if (!result.checkable) expect(result.reason).toBe("unparseable_color");
  });

  it("still checks a partially transparent background, which does paint something", () => {
    const result = checkTextContrast("rgb(0, 0, 0)", "rgba(255, 255, 255, 0.5)");
    expect(result.checkable).toBe(true);
  });
});
