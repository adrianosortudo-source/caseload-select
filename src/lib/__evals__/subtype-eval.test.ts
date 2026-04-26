/**
 * Sub-Type Routing Eval  -  Track 1 (Deterministic)
 *
 * Asserts that mapEventToSubType() maps the selected event type to the
 * correct sub-type bank key for each fixture where a sub-type is expected.
 *
 * Fixtures where expected_sub_type is null are gap-flagged (no bank exists
 * yet) and are excluded from the pass-rate calculation  -  they appear in
 * output as known gaps, not failures.
 *
 * Pass threshold: 95% of non-gap fixtures must map correctly.
 * Below threshold = build gate failure.
 */

import { describe, it, expect } from "vitest";
import { mapEventToSubType } from "../event-subtype-map";
import corpus from "./fixtures/screening-corpus.json";

describe("sub-type routing eval  -  screening corpus", () => {
  const results: Array<{ id: string; passed: boolean; detail: string }> = [];
  const gaps: Array<{ id: string; eventType: string }> = [];

  for (const fixture of corpus.fixtures) {
    // Only test fixtures where a selected event is expected
    if (fixture.expected_selected === null) continue;

    it(fixture.id, () => {
      const eventType = fixture.expected_selected as string;
      const mapped = mapEventToSubType(eventType);

      if (fixture.expected_sub_type === null) {
        // Known gap: no bank exists. Confirm mapEventToSubType returns null too.
        gaps.push({ id: fixture.id, eventType });
        expect(mapped, `${fixture.id}: expected null mapping for ${eventType} (known gap)`).toBeNull();
        return;
      }

      const passed = mapped === fixture.expected_sub_type;
      results.push({
        id: fixture.id,
        passed,
        detail: passed
          ? `ok  -  ${eventType} → ${mapped}`
          : `expected ${fixture.expected_sub_type}, got ${mapped ?? "null"}`,
      });

      expect(
        mapped,
        `${fixture.id}: ${eventType} mapped to ${mapped ?? "null"}, expected ${fixture.expected_sub_type}`,
      ).toBe(fixture.expected_sub_type);
    });
  }

  it("pass rate >= 95%  (gate)", () => {
    const total = results.length;

    if (gaps.length > 0) {
      console.warn("\nKnown sub-type gaps (no bank  -  excluded from rate):");
      for (const g of gaps) console.warn(`  ${g.id}: ${g.eventType} → null`);
    }

    if (total === 0) {
      console.info("No non-gap fixtures to evaluate.");
      return;
    }

    const passed = results.filter(r => r.passed).length;
    const rate = passed / total;

    const failures = results.filter(r => !r.passed);
    if (failures.length > 0) {
      console.error("\nSub-type routing failures:");
      for (const f of failures) console.error(`  ${f.id}: ${f.detail}`);
    }

    console.info(`\nSub-type routing rate: ${passed}/${total} (${(rate * 100).toFixed(1)}%)`);
    expect(rate, `sub-type pass rate ${(rate * 100).toFixed(1)}% is below 95% gate`).toBeGreaterThanOrEqual(0.95);
  });
});
