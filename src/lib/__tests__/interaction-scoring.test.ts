/**
 * Interaction Scoring  -  interaction-scoring.test.ts
 *
 * Tests for computeSabsUrgency() and computeDismissalBardal().
 *
 * Coverage:
 *   computeSabsUrgency
 *     - No deadlines missed → low urgency
 *     - Insurer not notified, recent accident → moderate/high
 *     - Insurer not notified, overdue → critical, overdue flag
 *     - OCF-1 not filed, overdue → high score
 *     - MIG designation → adds to score and flags
 *     - Municipal notice overdue (slip/fall) → critical
 *     - Catastrophic impairment → adds deadline entry
 *     - All slots present and compliant → low score
 *
 *   computeDismissalBardal
 *     - Junior employee, short tenure → low notice range
 *     - Senior executive, long tenure → high notice range
 *     - Inducement → bonus months + flag
 *     - Protected ground → flag, no months
 *     - Signed full release → Band E override, flag
 *     - Unsigned package, 7-day deadline → critical flag
 *     - bardalScore maps correctly to 0–100
 *
 *   estimateCaseValue (from case-value.ts)
 *     - PI Band A → $250K+ bucket
 *     - emp signed release → forces Band E
 *     - fam Band B → $150K-$500K
 *     - unknown PA → default table
 */

import { describe, it, expect } from "vitest";
import { computeSabsUrgency, computeDismissalBardal } from "../interaction-scoring";
import { estimateCaseValue } from "../case-value";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns an ISO date string N days before today. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// computeSabsUrgency
// ─────────────────────────────────────────────────────────────────────────────

describe("computeSabsUrgency", () => {
  it("returns low urgency when all deadlines are met", () => {
    const result = computeSabsUrgency({
      "pi_mva__accident_date":       daysAgo(5),
      "pi_mva__reported_to_insurer": "yes",
      "pi_mva__ocf1_filed":          "yes",
      "pi_mva__irb_applied":         "yes",
      "pi_mva__catastrophic":        "no",
    });
    expect(result.urgencyScore).toBeLessThan(20);
    expect(result.urgencyTier).toBe("low");
  });

  it("urgencyScore > 0 when insurer not notified and accident is recent", () => {
    const result = computeSabsUrgency({
      "pi_mva__accident_date":       daysAgo(3),
      "pi_mva__reported_to_insurer": "no",
      "pi_mva__ocf1_filed":          "yes",
    });
    expect(result.urgencyScore).toBeGreaterThan(0);
    expect(result.deadlines.length).toBeGreaterThan(0);
  });

  it("marks insurer notification as overdue after 7 days", () => {
    const result = computeSabsUrgency({
      "pi_mva__accident_date":       daysAgo(10),
      "pi_mva__reported_to_insurer": "no",
      "pi_mva__ocf1_filed":          "yes",
    });
    const insurerDeadline = result.deadlines.find(d => d.windowDays === 7);
    expect(insurerDeadline).toBeDefined();
    expect(insurerDeadline!.overdue).toBe(true);
    expect(result.flags.some(f => f.includes("7 days"))).toBe(true);
  });

  it("marks OCF-1 as overdue after 30 days", () => {
    const result = computeSabsUrgency({
      "pi_mva__accident_date":       daysAgo(35),
      "pi_mva__reported_to_insurer": "yes",
      "pi_mva__ocf1_filed":          "no",
    });
    const ocfDeadline = result.deadlines.find(d => d.windowDays === 30);
    expect(ocfDeadline).toBeDefined();
    expect(ocfDeadline!.overdue).toBe(true);
    expect(result.urgencyScore).toBeGreaterThanOrEqual(25);
  });

  it("adds MIG flag and score when designation is at issue", () => {
    const result = computeSabsUrgency({
      "pi_mva__reported_to_insurer": "yes",
      "pi_mva__ocf1_filed":          "yes",
      "pi_mig_designation":          "yes",
    });
    expect(result.flags.some(f => f.includes("MIG"))).toBe(true);
    expect(result.urgencyScore).toBeGreaterThanOrEqual(15);
  });

  it("treats 'unsure' insurer notification as unresolved", () => {
    const result = computeSabsUrgency({
      "pi_mva__accident_date":       daysAgo(4),
      "pi_mva__reported_to_insurer": "unsure",
      "pi_mva__ocf1_filed":          "yes",
    });
    expect(result.urgencyScore).toBeGreaterThan(0);
    expect(result.deadlines.some(d => d.windowDays === 7)).toBe(true);
  });

  it("adds municipal notice deadline for slip/fall when not notified", () => {
    const result = computeSabsUrgency({
      "pi_slip_fall__accident_date":          daysAgo(2),
      "pi_mva__reported_to_insurer":          "yes",
      "pi_mva__ocf1_filed":                   "yes",
      "pi_slip_fall__municipality_notified":  "no",
    });
    const munDeadline = result.deadlines.find(d => d.windowDays === 10);
    expect(munDeadline).toBeDefined();
    expect(munDeadline!.overdue).toBe(false);
  });

  it("flags municipal notice as overdue after 10 days (slip/fall)", () => {
    const result = computeSabsUrgency({
      "pi_slip_fall__accident_date":          daysAgo(14),
      "pi_mva__reported_to_insurer":          "yes",
      "pi_mva__ocf1_filed":                   "yes",
      "pi_slip_fall__municipality_notified":  "no",
    });
    const munDeadline = result.deadlines.find(d => d.windowDays === 10);
    expect(munDeadline!.overdue).toBe(true);
    expect(result.urgencyScore).toBeGreaterThanOrEqual(30);
  });

  it("adds catastrophic determination entry to deadlines", () => {
    const result = computeSabsUrgency({
      "pi_mva__reported_to_insurer": "yes",
      "pi_mva__ocf1_filed":          "yes",
      "pi_mva__catastrophic":        "yes",
    });
    const catDeadline = result.deadlines.find(d => d.windowDays === 365);
    expect(catDeadline).toBeDefined();
    expect(result.flags.some(f => f.includes("Catastrophic"))).toBe(true);
  });

  it("urgencyScore is capped at 100", () => {
    const result = computeSabsUrgency({
      "pi_mva__accident_date":                daysAgo(15),
      "pi_mva__reported_to_insurer":          "no",
      "pi_mva__ocf1_filed":                   "no",
      "pi_mig_designation":                   "yes",
      "pi_mva__catastrophic":                 "yes",
      "pi_slip_fall__municipality_notified":  "no",
    });
    expect(result.urgencyScore).toBeLessThanOrEqual(100);
  });

  it("works with no answers (graceful degradation)", () => {
    const result = computeSabsUrgency({});
    expect(result.urgencyScore).toBeGreaterThanOrEqual(0);
    expect(result.urgencyScore).toBeLessThanOrEqual(100);
    expect(Array.isArray(result.deadlines)).toBe(true);
    expect(Array.isArray(result.flags)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeDismissalBardal
// ─────────────────────────────────────────────────────────────────────────────

describe("computeDismissalBardal", () => {
  it("returns a low notice range for a junior entry-level employee", () => {
    const result = computeDismissalBardal({
      "emp_dismissal__tenure_years":    "under_1",
      "emp_dismissal__position_level":  "entry_level",
      "emp_dismissal__age_bracket":     "under_30",
    });
    expect(result.estimatedNoticeMonths.high).toBeLessThanOrEqual(5);
    expect(result.bardalScore).toBeLessThan(30);
  });

  it("returns a high notice range for a long-tenured executive", () => {
    const result = computeDismissalBardal({
      "emp_dismissal__tenure_years":    "over_15",
      "emp_dismissal__position_level":  "executive_c_suite",
      "emp_dismissal__age_bracket":     "over_60",
    });
    expect(result.estimatedNoticeMonths.high).toBeGreaterThanOrEqual(18);
    expect(result.bardalScore).toBeGreaterThan(70);
  });

  it("adds months and flag for inducement", () => {
    const base = computeDismissalBardal({
      "emp_dismissal__tenure_years":   "5_10",
      "emp_dismissal__position_level": "manager_director",
      "emp_dismissal__age_bracket":    "40_50",
    });
    const induced = computeDismissalBardal({
      "emp_dismissal__tenure_years":    "5_10",
      "emp_dismissal__position_level":  "manager_director",
      "emp_dismissal__age_bracket":     "40_50",
      "emp_dismissal__induced_to_leave": "yes",
    });
    expect(induced.estimatedNoticeMonths.high).toBeGreaterThan(base.estimatedNoticeMonths.high);
    expect(induced.flags.some(f => f.toLowerCase().includes("inducement"))).toBe(true);
  });

  it("adds human rights flag for protected ground, no extra months", () => {
    const base = computeDismissalBardal({
      "emp_dismissal__tenure_years":   "3_5",
      "emp_dismissal__position_level": "clerical_administrative",
    });
    const withGround = computeDismissalBardal({
      "emp_dismissal__tenure_years":     "3_5",
      "emp_dismissal__position_level":   "clerical_administrative",
      "emp_dismissal__protected_ground": "yes",
    });
    // Notice range should be the same  -  protected ground is a flag, not a Bardal month adder
    expect(withGround.estimatedNoticeMonths.low).toBe(base.estimatedNoticeMonths.low);
    expect(withGround.flags.some(f => f.includes("Human Rights"))).toBe(true);
  });

  it("flags signed full release with warning", () => {
    const result = computeDismissalBardal({
      "emp_dismissal__tenure_years":       "10_15",
      "emp_dismissal__position_level":     "manager_director",
      "emp_dismissal__severance_offered":  "signed_full_release",
    });
    expect(result.flags.some(f => f.toLowerCase().includes("release"))).toBe(true);
    const releaseFactor = result.factors.find(f => f.factor.toLowerCase().includes("release"));
    expect(releaseFactor?.impact).toBe("negative");
  });

  it("flags urgent signing deadline for unsigned package", () => {
    const result = computeDismissalBardal({
      "emp_dismissal__severance_offered": "package_unsigned",
      "emp_dismissal__signing_deadline":  "deadline_7d",
    });
    expect(result.flags.some(f => f.includes("7 days"))).toBe(true);
  });

  it("bardalScore is between 0 and 100 in all cases", () => {
    const cases: Record<string, string>[] = [
      {},
      { "emp_dismissal__tenure_years": "over_15", "emp_dismissal__position_level": "executive_c_suite", "emp_dismissal__age_bracket": "over_60", "emp_dismissal__induced_to_leave": "yes" },
      { "emp_dismissal__tenure_years": "under_1", "emp_dismissal__position_level": "entry_level" },
    ];
    cases.forEach(answers => {
      const result = computeDismissalBardal(answers);
      expect(result.bardalScore).toBeGreaterThanOrEqual(0);
      expect(result.bardalScore).toBeLessThanOrEqual(100);
    });
  });

  it("works with no answers (graceful degradation)", () => {
    const result = computeDismissalBardal({});
    expect(typeof result.bardalScore).toBe("number");
    expect(Array.isArray(result.factors)).toBe(true);
    expect(Array.isArray(result.flags)).toBe(true);
  });

  it("notice range low <= high in all cases", () => {
    const result = computeDismissalBardal({
      "emp_dismissal__tenure_years":   "3_5",
      "emp_dismissal__position_level": "professional_specialist",
      "emp_dismissal__age_bracket":    "50_60",
    });
    expect(result.estimatedNoticeMonths.low).toBeLessThanOrEqual(result.estimatedNoticeMonths.high);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// estimateCaseValue
// ─────────────────────────────────────────────────────────────────────────────

describe("estimateCaseValue", () => {
  it("returns exceptional tier for PI Band A (CPI ≥ 80)", () => {
    const result = estimateCaseValue("pi_mva", 85, {});
    expect(result.tier).toBe("exceptional");
    expect(result.low).toBeGreaterThanOrEqual(250_000);
  });

  it("returns low tier for PI Band E (CPI < 20)", () => {
    const result = estimateCaseValue("pi_slip_fall", 10, {});
    expect(result.tier).toBe("low");
    expect(result.high).toBeLessThanOrEqual(5_000);
  });

  it("forces Band E for emp with signed full release", () => {
    const result = estimateCaseValue("emp_dismissal", 90, {
      "emp_dismissal__severance_offered": "signed_full_release",
    });
    expect(result.tier).toBe("low");
  });

  it("returns high tier for emp Band B (CPI 60–79)", () => {
    const result = estimateCaseValue("emp", 70, {});
    expect(result.tier).toBe("high");
    expect(result.low).toBeGreaterThanOrEqual(50_000);
  });

  it("returns significant tier for fam Band C (CPI 40–59)", () => {
    const result = estimateCaseValue("fam_separation", 50, {});
    expect(result.tier).toBe("significant");
  });

  it("returns exceptional for crim Band A", () => {
    const result = estimateCaseValue("crim_indictable_sc", 82, {});
    expect(result.tier).toBe("exceptional");
  });

  it("uses default table for unknown practice areas", () => {
    const result = estimateCaseValue("imm_refugee", 75, {});
    expect(result).toHaveProperty("label");
    expect(result).toHaveProperty("tier");
    expect(result.tier).toBe("high");
  });

  it("label is always a non-empty string", () => {
    ["pi_mva", "emp_dismissal", "fam_separation", "crim_indictable_sc", "wills"].forEach(pa => {
      [5, 30, 55, 70, 90].forEach(cpi => {
        const result = estimateCaseValue(pa, cpi, {});
        expect(typeof result.label).toBe("string");
        expect(result.label.length).toBeGreaterThan(0);
      });
    });
  });
});
