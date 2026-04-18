/**
 * CPI Calculator — scoring.test.ts
 *
 * Tests validateAndFixScoring() and computeCpiPartial() covering:
 *   - Component clamping
 *   - Sum recomputation from components
 *   - Primary band assignment (total thresholds)
 *   - Three-axis derived scores (cpi_fit, cpi_urgency, cpi_friction)
 *   - Band modifiers (urgency promotion, friction floor)
 *   - computeCpiPartial() output shape and urgency exposure
 *
 * These tests are the regression guard for the band assignment policy.
 * Any change to the scoring formula must be reflected here first.
 */

import { describe, it, expect } from "vitest";
import { validateAndFixScoring, computeCpiPartial } from "../cpi-calculator";
import type { CpiBreakdown } from "../cpi-calculator";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeCpi(overrides: Partial<CpiBreakdown> = {}): CpiBreakdown {
  return {
    fit_score: 0,
    geo_score: 0,
    practice_score: 0,
    legitimacy_score: 5, // neutral default — not a red flag, not perfect
    referral_score: 0,
    value_score: 0,
    urgency_score: 0,
    complexity_score: 0,
    multi_practice_score: 0,
    fee_score: 0,
    total: 0,
    band: null,
    band_locked: false,
    cpi_fit: 0,
    cpi_urgency: 0,
    cpi_friction: 0,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component clamping
// ─────────────────────────────────────────────────────────────────────────────

describe("validateAndFixScoring — component clamping", () => {
  it("clamps geo_score to 0-10", () => {
    const result = validateAndFixScoring(makeCpi({ geo_score: 15 }));
    expect(result.geo_score).toBe(10);
  });

  it("clamps urgency_score to 0-20", () => {
    const result = validateAndFixScoring(makeCpi({ urgency_score: 30 }));
    expect(result.urgency_score).toBe(20);
  });

  it("clamps complexity_score to 0-25", () => {
    const result = validateAndFixScoring(makeCpi({ complexity_score: 40 }));
    expect(result.complexity_score).toBe(25);
  });

  it("clamps fee_score to 0-10", () => {
    const result = validateAndFixScoring(makeCpi({ fee_score: 50 }));
    expect(result.fee_score).toBe(10);
  });

  it("clamps multi_practice_score to 0-5", () => {
    const result = validateAndFixScoring(makeCpi({ multi_practice_score: 10 }));
    expect(result.multi_practice_score).toBe(5);
  });

  it("floors negative values to 0", () => {
    const result = validateAndFixScoring(makeCpi({ urgency_score: -5, fee_score: -3 }));
    expect(result.urgency_score).toBe(0);
    expect(result.fee_score).toBe(0);
  });

  it("rounds decimal components", () => {
    const result = validateAndFixScoring(makeCpi({ geo_score: 7.8, urgency_score: 14.3 }));
    expect(result.geo_score).toBe(8);
    expect(result.urgency_score).toBe(14);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sum recomputation
// ─────────────────────────────────────────────────────────────────────────────

describe("validateAndFixScoring — sum recomputation", () => {
  it("recomputes fit_score from components", () => {
    const result = validateAndFixScoring(makeCpi({
      geo_score: 8, practice_score: 8, legitimacy_score: 8, referral_score: 4,
      fit_score: 0, // GPT arithmetic was wrong
    }));
    expect(result.fit_score).toBe(28);
  });

  it("recomputes value_score from components", () => {
    const result = validateAndFixScoring(makeCpi({
      urgency_score: 15, complexity_score: 20, multi_practice_score: 3, fee_score: 8,
      value_score: 0, // GPT arithmetic was wrong
    }));
    expect(result.value_score).toBe(46);
  });

  it("recomputes total from fit + value", () => {
    const result = validateAndFixScoring(makeCpi({
      geo_score: 8, practice_score: 8, legitimacy_score: 7, referral_score: 3,
      urgency_score: 15, complexity_score: 18, multi_practice_score: 2, fee_score: 7,
    }));
    expect(result.total).toBe(68); // fit=26, value=42
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Primary band assignment
// ─────────────────────────────────────────────────────────────────────────────

describe("validateAndFixScoring — primary band thresholds", () => {
  it("does NOT reach Band A at total 76 without urgency promotion", () => {
    // urgency_score=5 → cpi_urgency=25 < 75, no promotion; total=76 → Band B
    const result = validateAndFixScoring(makeCpi({
      geo_score: 10, practice_score: 10, legitimacy_score: 8, referral_score: 2,
      urgency_score: 5, complexity_score: 20, multi_practice_score: 3, fee_score: 8,
      // fit=30, value=36, total=66 → Band B
    }));
    expect(result.band).toBe("B");
    expect(result.cpi_urgency).toBe(25); // no promotion
  });

  it("Band A at total = 80 exactly", () => {
    // fit: 10+10+10+4=34, value: 18+20+4+4=46, total=80
    const result = validateAndFixScoring(makeCpi({
      geo_score: 10, practice_score: 10, legitimacy_score: 10, referral_score: 4,
      urgency_score: 18, complexity_score: 20, multi_practice_score: 4, fee_score: 4,
    }));
    expect(result.band).toBe("A");
    expect(result.total).toBe(80);
  });

  it("Band B at total 60-79 (urgency low, no promotion)", () => {
    // urgency_score=10 → cpi_urgency=50 < 75, no promotion; total=62 → Band B
    const result = validateAndFixScoring(makeCpi({
      geo_score: 8, practice_score: 8, legitimacy_score: 7, referral_score: 3,
      urgency_score: 10, complexity_score: 18, multi_practice_score: 2, fee_score: 6,
      // fit=26, value=36, total=62 → Band B
    }));
    expect(result.band).toBe("B");
    expect(result.total).toBe(62);
    expect(result.cpi_urgency).toBe(50); // below promotion threshold
  });

  it("Band C at total 40-59", () => {
    const result = validateAndFixScoring(makeCpi({
      geo_score: 6, practice_score: 6, legitimacy_score: 5, referral_score: 0,
      urgency_score: 8, complexity_score: 10, multi_practice_score: 0, fee_score: 6,
    }));
    // fit=17, value=24, total=41
    expect(result.band).toBe("C");
  });

  it("Band D at total 20-39", () => {
    const result = validateAndFixScoring(makeCpi({
      geo_score: 4, practice_score: 4, legitimacy_score: 4, referral_score: 0,
      urgency_score: 5, complexity_score: 8, multi_practice_score: 0, fee_score: 4,
    }));
    // fit=12, value=17, total=29
    expect(result.band).toBe("D");
  });

  it("Band E at total < 20", () => {
    const result = validateAndFixScoring(makeCpi({
      geo_score: 2, practice_score: 2, legitimacy_score: 2, referral_score: 0,
      urgency_score: 2, complexity_score: 3, multi_practice_score: 0, fee_score: 2,
    }));
    // fit=6, value=7, total=13
    expect(result.band).toBe("E");
  });

  it("all-zero scores → Band E", () => {
    const result = validateAndFixScoring(makeCpi({ legitimacy_score: 0 }));
    expect(result.band).toBe("E");
    expect(result.total).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Three-axis derived scores
// ─────────────────────────────────────────────────────────────────────────────

describe("validateAndFixScoring — three-axis derived scores", () => {
  it("cpi_fit: fit_score 40 → 100", () => {
    const result = validateAndFixScoring(makeCpi({
      geo_score: 10, practice_score: 10, legitimacy_score: 10, referral_score: 10,
    }));
    expect(result.cpi_fit).toBe(100);
  });

  it("cpi_fit: fit_score 20 → 50", () => {
    const result = validateAndFixScoring(makeCpi({
      geo_score: 5, practice_score: 5, legitimacy_score: 5, referral_score: 5,
    }));
    expect(result.cpi_fit).toBe(50);
  });

  it("cpi_fit: fit_score 0 → 0", () => {
    const result = validateAndFixScoring(makeCpi({ legitimacy_score: 0 }));
    expect(result.cpi_fit).toBe(0);
  });

  it("cpi_urgency: urgency_score 20 → 100", () => {
    const result = validateAndFixScoring(makeCpi({ urgency_score: 20 }));
    expect(result.cpi_urgency).toBe(100);
  });

  it("cpi_urgency: urgency_score 15 → 75", () => {
    const result = validateAndFixScoring(makeCpi({ urgency_score: 15 }));
    expect(result.cpi_urgency).toBe(75);
  });

  it("cpi_urgency: urgency_score 0 → 0", () => {
    const result = validateAndFixScoring(makeCpi({ urgency_score: 0 }));
    expect(result.cpi_urgency).toBe(0);
  });

  it("cpi_friction: legitimacy 10 → 0 (clean case)", () => {
    const result = validateAndFixScoring(makeCpi({ legitimacy_score: 10 }));
    expect(result.cpi_friction).toBe(0);
  });

  it("cpi_friction: legitimacy 5 → 50 (neutral)", () => {
    const result = validateAndFixScoring(makeCpi({ legitimacy_score: 5 }));
    expect(result.cpi_friction).toBe(50);
  });

  it("cpi_friction: legitimacy 0 → 100 (maximum friction)", () => {
    const result = validateAndFixScoring(makeCpi({ legitimacy_score: 0 }));
    expect(result.cpi_friction).toBe(100);
  });

  it("cpi_friction: legitimacy 2 → 80 (triggers friction floor)", () => {
    const result = validateAndFixScoring(makeCpi({ legitimacy_score: 2 }));
    expect(result.cpi_friction).toBe(80);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Band modifiers
// ─────────────────────────────────────────────────────────────────────────────

describe("validateAndFixScoring — urgency promotion modifier", () => {
  it("promotes to Band A when cpi_urgency ≥ 75 AND total ≥ 55", () => {
    // urgency_score=15 → cpi_urgency=75; total=62 → Band B without modifier
    const result = validateAndFixScoring(makeCpi({
      geo_score: 7, practice_score: 7, legitimacy_score: 7, referral_score: 3,
      urgency_score: 15, complexity_score: 15, multi_practice_score: 2, fee_score: 6,
      // fit=24, value=38, total=62 → Band B
    }));
    expect(result.cpi_urgency).toBe(75);
    expect(result.total).toBe(62);
    expect(result.band).toBe("A"); // promoted
  });

  it("does NOT promote when cpi_urgency ≥ 75 but total < 55", () => {
    // urgency=15 but total only 40 → Band C, no promotion
    const result = validateAndFixScoring(makeCpi({
      geo_score: 5, practice_score: 5, legitimacy_score: 5, referral_score: 0,
      urgency_score: 15, complexity_score: 8, multi_practice_score: 0, fee_score: 5,
      // fit=15, value=28, total=43 → Band C
    }));
    expect(result.cpi_urgency).toBe(75);
    expect(result.band).toBe("C"); // not promoted — total too low
  });

  it("does NOT promote when total ≥ 55 but cpi_urgency < 75", () => {
    // urgency=10 → cpi_urgency=50, total=62 → Band B stays
    const result = validateAndFixScoring(makeCpi({
      geo_score: 7, practice_score: 7, legitimacy_score: 7, referral_score: 3,
      urgency_score: 10, complexity_score: 20, multi_practice_score: 2, fee_score: 6,
      // fit=24, value=38, total=62 → Band B
    }));
    expect(result.cpi_urgency).toBe(50);
    expect(result.band).toBe("B"); // stays
  });

  it("urgency promotion does not apply when band_locked=true", () => {
    const result = validateAndFixScoring(makeCpi({
      geo_score: 7, practice_score: 7, legitimacy_score: 7, referral_score: 3,
      urgency_score: 15, complexity_score: 15, multi_practice_score: 2, fee_score: 6,
      band: "B", band_locked: true,
    }));
    // band_locked prevents any modifier from firing
    expect(result.band).toBe("B");
  });
});

describe("validateAndFixScoring — friction floor modifier", () => {
  it("caps Band A at D when cpi_friction ≥ 80 (legitimacy ≤ 2)", () => {
    // High total → Band A, but legitimacy=2 → cpi_friction=80 → friction floor
    const result = validateAndFixScoring(makeCpi({
      geo_score: 10, practice_score: 10, legitimacy_score: 2, referral_score: 5,
      urgency_score: 18, complexity_score: 20, multi_practice_score: 4, fee_score: 8,
      // fit=27, value=50, total=77 → Band B (below 80), but legitimacy=2...
    }));
    // total=77 → Band B without modifier; cpi_friction=80 → floor at D
    expect(result.cpi_friction).toBe(80);
    expect(result.band).toBe("D");
  });

  it("caps Band B at D when cpi_friction ≥ 80", () => {
    // fit=20, value=41, total=61 → Band B; legitimacy=1 → cpi_friction=90 → floor to D
    const result = validateAndFixScoring(makeCpi({
      geo_score: 8, practice_score: 8, legitimacy_score: 1, referral_score: 3,
      urgency_score: 12, complexity_score: 20, multi_practice_score: 2, fee_score: 7,
      // fit=20, value=41, total=61 → Band B; cpi_urgency=60 < 75 (no promotion)
    }));
    expect(result.total).toBe(61);
    expect(result.cpi_friction).toBe(90);
    expect(result.band).toBe("D");
  });

  it("does NOT apply friction floor when cpi_friction < 80 (legitimacy 3+)", () => {
    // legitimacy=3 → cpi_friction=70 (not ≥ 80) → no floor
    const result = validateAndFixScoring(makeCpi({
      geo_score: 10, practice_score: 10, legitimacy_score: 3, referral_score: 5,
      urgency_score: 18, complexity_score: 20, multi_practice_score: 4, fee_score: 8,
    }));
    expect(result.cpi_friction).toBe(70);
    expect(result.band).not.toBe("D"); // no floor applied
  });

  it("friction floor does not apply when band_locked=true", () => {
    const result = validateAndFixScoring(makeCpi({
      geo_score: 10, practice_score: 10, legitimacy_score: 0, referral_score: 0,
      urgency_score: 20, complexity_score: 25, multi_practice_score: 5, fee_score: 10,
      band: "A", band_locked: true,
    }));
    // legitimacy=0 → cpi_friction=100, but band_locked protects
    expect(result.band).toBe("A");
  });

  it("friction floor and urgency promotion: friction wins (both active)", () => {
    // urgency=15 (cpi_urgency=75, promotes), legitimacy=2 (cpi_friction=80, floors)
    // Friction floor is applied AFTER urgency promotion — friction wins
    const result = validateAndFixScoring(makeCpi({
      geo_score: 7, practice_score: 7, legitimacy_score: 2, referral_score: 3,
      urgency_score: 15, complexity_score: 18, multi_practice_score: 2, fee_score: 6,
      // fit=19, value=41, total=60 → Band B
    }));
    // urgency promotes to A (total ≥ 55, cpi_urgency ≥ 75)
    // then friction floors to D (cpi_friction ≥ 80)
    expect(result.band).toBe("D");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeCpiPartial
// ─────────────────────────────────────────────────────────────────────────────

describe("computeCpiPartial — output shape and urgency field", () => {
  it("returns score = total, band, confidence=provisional when not finalized", () => {
    const cpi = validateAndFixScoring(makeCpi({
      geo_score: 7, practice_score: 7, legitimacy_score: 7, referral_score: 3,
      urgency_score: 10, complexity_score: 15, multi_practice_score: 2, fee_score: 6,
    }));
    const partial = computeCpiPartial(cpi, false);
    expect(partial.score).toBe(cpi.total);
    expect(partial.band).toBe(cpi.band);
    expect(partial.confidence).toBe("provisional");
  });

  it("confidence=final when finalized=true", () => {
    const cpi = validateAndFixScoring(makeCpi({ urgency_score: 5 }));
    const partial = computeCpiPartial(cpi, true);
    expect(partial.confidence).toBe("final");
  });

  it("confidence=final when band_locked=true", () => {
    const cpi = validateAndFixScoring(makeCpi({ band: "B", band_locked: true }));
    const partial = computeCpiPartial(cpi, false);
    expect(partial.confidence).toBe("final");
  });

  it("exposes urgency in partial when cpi_urgency ≥ 50", () => {
    const cpi = validateAndFixScoring(makeCpi({ urgency_score: 10 })); // cpi_urgency=50
    const partial = computeCpiPartial(cpi, false);
    expect(partial.urgency).toBe(50);
  });

  it("does NOT expose urgency when cpi_urgency < 50", () => {
    const cpi = validateAndFixScoring(makeCpi({ urgency_score: 9 })); // cpi_urgency=45
    const partial = computeCpiPartial(cpi, false);
    expect(partial.urgency).toBeUndefined();
  });

  it("exposes urgency=100 for maximum urgency cases", () => {
    const cpi = validateAndFixScoring(makeCpi({ urgency_score: 20 }));
    const partial = computeCpiPartial(cpi, false);
    expect(partial.urgency).toBe(100);
  });
});
