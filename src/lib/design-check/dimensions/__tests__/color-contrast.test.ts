import { describe, it, expect } from "vitest";
import { scoreColorContrast } from "../color-contrast";
import type { DomSnapshot, TextBlockSample } from "../../renderer";

/**
 * Phase 2 investigation (2026-08-06,
 * docs/CALIBRATION_PROPOSAL_website_design_grading_v1.md) found drglaw.ca
 * and gosailaw.com with every sampled text element reporting a
 * transparent own background-color, so this dimension silently covered
 * nothing on either site. The fix lives entirely in-page (renderer.ts's
 * resolveEffectiveBackgroundColor, which walks document.elementsFromPoint
 * to find what is actually painted behind the text) and cannot be unit
 * tested outside a real browser; it was verified live instead, in both
 * directions, against drglaw.ca, gosailaw.com, and themblawfirm.ca (see
 * the investigation note). What IS unit-testable, and had zero coverage
 * before this dimension became load-bearing on real sites, is how
 * scoreColorContrast itself combines resolved and still-unresolved
 * samples: these fixtures simulate exactly what the renderer now hands
 * it in each of the three real outcomes the live check produced.
 */

function sample(overrides: Partial<TextBlockSample>): TextBlockSample {
  return {
    tag: "p",
    text: "Sample text",
    fontSizePx: 16,
    fontWeight: "400",
    fontFamily: "sans-serif",
    lineHeightPx: 24,
    color: "rgb(0, 0, 0)",
    backgroundColor: "rgba(0, 0, 0, 0)",
    textTransform: "none",
    textAlign: "left",
    widthPx: 400,
    avgCharWidthPx: 8,
    ...overrides,
  };
}

function snapshot(headingSamples: TextBlockSample[], bodyTextSample: TextBlockSample[] = []): DomSnapshot {
  return { headingSamples, bodyTextSample } as DomSnapshot;
}

describe("scoreColorContrast", () => {
  it("scores every sample clean when the renderer resolved a genuinely passing background (drglaw.ca's real outcome)", () => {
    const result = scoreColorContrast(
      snapshot([sample({ tag: "h1", color: "rgb(255, 252, 246)", backgroundColor: "rgb(26, 20, 16)" })])
    );
    expect(result.items.every((i) => i.status !== "fail")).toBe(true);
    expect(result.score).toBe(result.maxScore);
  });

  it("still fails a resolved sample below the WCAG threshold, so the fix does not launder a real failure (themblawfirm.ca's real outcome)", () => {
    const result = scoreColorContrast(
      snapshot([], [sample({ tag: "a", text: "Book an appointment", color: "rgb(0, 0, 238)", backgroundColor: "rgb(0, 122, 94)" })])
    );
    const failing = result.items.find((i) => i.status === "fail");
    expect(failing).toBeDefined();
    expect(failing!.detail).toContain("below the WCAG AA minimum");
  });

  it("reports genuinely unresolvable samples as not checkable, never as a pass or fail it did not earn (gosailaw.com's real outcome)", () => {
    // Represents the resolver correctly refusing to trust a sample: an
    // image sat between the text and any opaque colour, so the
    // background stayed transparent, same as before this fix for the
    // cases it genuinely cannot see through.
    const result = scoreColorContrast(snapshot([sample({ tag: "h1", backgroundColor: "rgba(0, 0, 0, 0)" })]));
    expect(result.items[0].scored).toBe(false);
    expect(result.items[0].detail).toContain("could not be checked");
  });

  it("surfaces a coverage note, distinct from the checked findings, when some samples resolved and others did not", () => {
    const result = scoreColorContrast(
      snapshot(
        [sample({ tag: "h1", color: "rgb(255, 255, 255)", backgroundColor: "rgb(0, 0, 0)" })],
        [sample({ tag: "p", backgroundColor: "rgba(0, 0, 0, 0)" })]
      )
    );
    const coverageNote = result.items.find((i) => i.label === "Contrast coverage note");
    expect(coverageNote).toBeDefined();
    expect(coverageNote!.scored).toBe(false);
    expect(coverageNote!.detail).toContain("1 of 2");
  });
});
