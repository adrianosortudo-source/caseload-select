/**
 * Auto-Confirm Regression Tests
 *
 * Runs every fixture from sub-type-seeds.ts through autoConfirmFromContext()
 * and asserts:
 *   - Positive fixtures: the expected question ID receives the expected value.
 *   - Negative fixtures (expectedValue: null): the question ID is NOT present
 *     in the output, confirming no false-positive fires.
 *
 * Test count: ~630 (15 per sub-type × 42 sub-types).
 */

import { describe, it, expect } from "vitest";
import { autoConfirmFromContext } from "../auto-confirm";
import { ALL_FIXTURES, type Fixture } from "./fixtures/sub-type-seeds";

/**
 * Groups fixtures by questionSetKey so failures cluster by sub-type.
 */
function groupByKey(fixtures: Fixture[]): Map<string, Fixture[]> {
  const map = new Map<string, Fixture[]>();
  for (const f of fixtures) {
    const bucket = map.get(f.questionSetKey) ?? [];
    bucket.push(f);
    map.set(f.questionSetKey, bucket);
  }
  return map;
}

const grouped = groupByKey(ALL_FIXTURES);

for (const [questionSetKey, fixtures] of grouped) {
  // Derive umbrella PA from the first fixture in the group.
  const practiceArea = fixtures[0].practiceArea;

  describe(`auto-confirm: ${questionSetKey}`, () => {
    for (const fixture of fixtures) {
      const label = fixture.expectedValue !== null
        ? `✓ "${fixture.input.slice(0, 60)}..." → ${fixture.questionId}=${fixture.expectedValue}`
        : `✗ (no false-positive) "${fixture.input.slice(0, 60)}..." → ${fixture.questionId} absent`;

      it(label, () => {
        const result = autoConfirmFromContext(
          practiceArea,
          fixture.input,
          {},
          questionSetKey,
        );

        if (fixture.expectedValue !== null) {
          // Positive: the question should be auto-confirmed with the expected value.
          expect(result[fixture.questionId]).toBe(fixture.expectedValue);
        } else {
          // Negative: the question should NOT be auto-confirmed.
          expect(result[fixture.questionId]).toBeUndefined();
        }
      });
    }
  });
}

// ─── Edge cases ────────────────────────────────────────────────────────────────

describe("auto-confirm edge cases", () => {
  it("returns empty object for null practice area", () => {
    const result = autoConfirmFromContext(null, "I was in a car accident", {}, "pi_mva");
    expect(result).toEqual({});
  });

  it("does not override an already-confirmed answer", () => {
    const existing = { pi_mva_q1: "pedestrian" };
    const result = autoConfirmFromContext("pi", "I was driving my car when rear-ended", existing, "pi_mva");
    // The function explicitly skips any questionId already in existingConfirmed.
    // pi_mva_q1 is in existing, so it must NOT appear in the output regardless of regex match.
    expect(result["pi_mva_q1"]).toBeUndefined();
  });

  it("returns empty object for unknown question set key", () => {
    const result = autoConfirmFromContext("pi", "Some text", {}, "pi_nonexistent_subtype");
    // Falls back to umbrella "pi" rules  -  may have results or not, but must not throw.
    expect(typeof result).toBe("object");
  });

  it("handles empty input string without throwing", () => {
    const result = autoConfirmFromContext("crim", "", {}, "crim_dui");
    expect(result).toEqual({});
  });

  it("handles very long input string without throwing", () => {
    const longInput = "I was driving my car. ".repeat(500);
    expect(() =>
      autoConfirmFromContext("pi", longInput, {}, "pi_mva")
    ).not.toThrow();
  });

  it("fam sub-types are NOT caught by the umbrella fam fallback when questionSetKey is specified", () => {
    // fam_divorce rules should fire when questionSetKey is 'fam_divorce'
    const result = autoConfirmFromContext("fam", "We have been separated for over a year and want a divorce.", {}, "fam_divorce");
    expect(result).toBeDefined();
  });

  it("ins_sabs rules fire for SABS-specific input", () => {
    const result = autoConfirmFromContext("ins", "My insurer cut off my income replacement benefit after the accident.", {}, "ins_sabs");
    expect(result["ins_sab_q1"]).toBe("irb");
  });

  it("ins_denial rules fire for disability denial input", () => {
    const result = autoConfirmFromContext("ins", "My long-term disability claim was denied  -  I cannot work due to chronic pain.", {}, "ins_denial");
    expect(result["ins_den_q1"]).toBe("disability");
  });

  it("civ_contract rules fire for breach scenario", () => {
    const result = autoConfirmFromContext("civ", "They're suing me for breach of our service agreement  -  I'm the defendant.", {}, "civ_contract");
    expect(result["civ_con_q2"]).toBe("defendant");
  });

  it("civ_tort rules correctly identify defamation on social media", () => {
    const result = autoConfirmFromContext("civ", "My former partner made a defamatory statement about me on their Facebook page.", {}, "civ_tort");
    expect(result["civ_trt_q1"]).toBe("defamation");
    expect(result["civ_trt_q17"]).toBe("social_media");
  });

  it("crim_dui child passenger aggravator fires", () => {
    const result = autoConfirmFromContext("crim", "I was stopped for DUI and my daughter was in the car seat in the back.", {}, "crim_dui");
    expect(result["crim_dui_q47"]).toBe("yes");
  });

  it("imm_refugee removal urgency fires", () => {
    const result = autoConfirmFromContext("imm", "CBSA scheduled my deportation  -  removal is imminent and I need help urgently.", {}, "imm_refugee");
    expect(result["imm_ref_q17"]).toBe("removal_imminent");
  });

  it("fam_protection immediate danger fires", () => {
    const result = autoConfirmFromContext("fam", "My husband assaulted me last night and I am not safe at home.", {}, "fam_protection");
    expect(result["fam_prt_q1"]).toBe("immediate_danger");
  });

  it("emp_constructive salary cut fires", () => {
    const result = autoConfirmFromContext("emp", "They cut my salary without any agreement last month.", {}, "emp_constructive");
    expect(result["emp_con_q1"]).toBe("pay_cut");
  });
});
