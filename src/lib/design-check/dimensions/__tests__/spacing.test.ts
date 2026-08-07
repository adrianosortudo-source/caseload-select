import { describe, it, expect } from "vitest";
import { scoreSpacing } from "../spacing";
import type { DomSnapshot } from "../../renderer";

/**
 * Phase 1 investigation (2026-08-06,
 * docs/CALIBRATION_PROPOSAL_website_design_grading_v1.md) found the
 * anchor site, drglaw.ca, scoring 0 here despite being built to a
 * deliberate token scale. Root cause was two-fold: auto-centering
 * margins polluting the sample (fixed in renderer.ts, not directly
 * unit-testable since it runs in-page), and a real 8-point grid the
 * named SCALE_STEPS list did not enumerate (fixed here). The two
 * fixtures below are the exact, real, unmodified value lists captured
 * live from drglaw.ca and marathonlaw.ca (post centering-margin
 * exclusion), verified against the fixed logic before being pinned
 * here, so the boundaries are pinned against real sites rather than
 * invented numbers.
 */

function snapshot(spacingValuesPx: number[]): DomSnapshot {
  return { spacingValuesPx } as DomSnapshot;
}

describe("scoreSpacing", () => {
  it("passes too small a sample as unscored rather than judging a pattern from noise", () => {
    const result = scoreSpacing(snapshot([8, 16, 24]));
    expect(result.items[0].scored).toBe(false);
    expect(result.items[0].status).toBe("pass");
    expect(result.maxScore).toBe(0);
  });

  it("passes drglaw.ca's real distribution once the 8pt grid is credited (93%), which the named steps alone (52%) would have left at warn", () => {
    // Captured live 2026-08-06, post the renderer's centering-margin
    // exclusion (150 values). Named-scale-only lands at 52% (warn);
    // this fixture proves the 8pt-grid credit correctly recognizes the
    // real, coherent grid in the remainder (56/88/80/112/40/72/200 are
    // all exact multiples of 8) and reaches pass.
    // prettier-ignore
    const drglawReal = [64,64,56,56,32,22,28,26,28,96,96,56,56,18,18,18,18,48,48,48,48,86,56,56,56,22,22,22,80,80,56,56,16,9,20,12,11,11,1,11,11,1,11,11,1,11,11,1,11,11,1,11,11,1,11,11,1,11,11,1,11,11,1,11,11,1,11,11,1,11,11,1,11,11,1,20,112,112,56,56,70,101,80,80,56,56,80,80,56,56,36,40,40,48,32,32,32,32,32,28,112,112,56,56,112,112,56,56,72,24,24,24,88,24,24,88,24,24,88,24,24,88,24,24,88,24,24,88,24,24,88,24,24,88,24,24,88,200,56,200,56,32,64,64,56,56,28,64,64,14];

    const result = scoreSpacing(snapshot(drglawReal));
    expect(result.items[0].status).toBe("pass");
    expect(result.items[0].detail).toContain("93%");
  });

  it("still fails marathonlaw.ca's real distribution (42%), proving the 8pt-grid credit does not paper over genuine ad-hoc spacing", () => {
    // Captured live 2026-08-06 (73 values). marathonlaw.ca has no
    // auto-centered max-width containers, so this raw list is
    // unaffected by the renderer fix; the 8pt-grid credit alone barely
    // moves it (36% named-only to 42% combined) because most of its
    // off-scale values (17, 13, 5, 85, 15, 69, 95, 115, 103, 130) are
    // not multiples of 8 either. This is the case the fix must not
    // launder: real ad-hoc spacing must stay flagged.
    // prettier-ignore
    const marathonlawReal = [17,17,13,13,5,5,5,5,22,58,22,58,36,20,20,20,36,36,20,20,20,36,206,58,58,58,58,58,58,58,58,20,86,20,15,8,15,8,15,8,15,8,206,69,69,20,115,48,48,95,95,58,70,58,128,20,85,10,128,20,85,10,128,20,85,10,128,20,85,10,128,20,85];

    const result = scoreSpacing(snapshot(marathonlawReal));
    expect(result.items[0].status).toBe("fail");
    expect(result.items[0].detail).toContain("42%");
  });

  it("treats an exact multiple of 8 as on-scale even far outside the named-step list", () => {
    const values = [56, 56, 56, 56, 56, 56, 56, 56, 56, 56]; // 10 identical, exact 8pt-grid, not in SCALE_STEPS
    const result = scoreSpacing(snapshot(values));
    expect(result.items[0].status).toBe("pass");
    expect(result.items[0].detail).toContain("100%");
  });

  it("does not treat a near-miss of 8 (off by more than the tight grid tolerance) as on-scale", () => {
    // 58 is 2px off the nearest multiple of 8 (56 or 64), outside the
    // ±1px grid tolerance, and also outside ±2px of every SCALE_STEPS
    // entry (nearest is 64, distance 6). Must read as off-scale.
    const onScale = Array(2).fill(0).flatMap(() => [8, 16, 24, 32]); // 8 clearly on-scale values
    const offScale = Array(3).fill(0).flatMap(() => [58, 58]); // 6 values, deliberately just outside both tolerances
    const values = [...onScale, ...offScale];
    const result = scoreSpacing(snapshot(values));
    // 8/14 = 57%, warn band (45-70), not pass: proves 58 was NOT credited.
    expect(result.items[0].status).toBe("warn");
  });
});
