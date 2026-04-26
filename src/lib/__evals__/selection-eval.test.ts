/**
 * Selection Eval  -  Track 1 (Deterministic)
 *
 * Asserts that selectEvent() picks the expected event from each fixture.
 * Feeds extractEvents() output directly into selectEvent() — no mocking.
 * Pure functions, no LLM, runs in vitest.
 *
 * Pass threshold: 85% of fixtures must meet their selection assertion.
 * Below threshold = build gate failure.
 *
 * Fixture contract:
 *   expected_selected: null        → selectEvent() must return null
 *   expected_selected: "slip_fall" → selectEvent() must return an event with type "slip_fall"
 */

import { describe, it, expect } from "vitest";
import { extractEvents } from "../event-extractor";
import { selectEvent } from "../event-selector";
import corpus from "./fixtures/screening-corpus.json";

describe("selection eval  -  screening corpus", () => {
  const results: Array<{ id: string; passed: boolean; detail: string }> = [];

  for (const fixture of corpus.fixtures) {
    it(fixture.id, () => {
      const events = extractEvents(fixture.message);
      const selected = selectEvent(events);

      const expectedType = fixture.expected_selected;

      if (expectedType === null) {
        const passed = selected === null;
        results.push({
          id: fixture.id,
          passed,
          detail: passed ? "ok  -  null as expected" : `unexpected selection: ${selected?.type}`,
        });
        expect(selected, `${fixture.id}: expected null selection`).toBeNull();
        return;
      }

      const passed = selected?.type === expectedType;
      results.push({
        id: fixture.id,
        passed,
        detail: passed
          ? `ok  -  ${selected!.type}`
          : `expected ${expectedType}, got ${selected?.type ?? "null"}`,
      });
      expect(selected, `${fixture.id}: selectEvent returned null, expected ${expectedType}`).not.toBeNull();
      expect(selected!.type, `${fixture.id}: wrong event type selected`).toBe(expectedType);
    });
  }

  it("pass rate >= 85%  (gate)", () => {
    const total = results.length;
    if (total === 0) return;

    const passed = results.filter(r => r.passed).length;
    const rate = passed / total;

    const failures = results.filter(r => !r.passed);
    if (failures.length > 0) {
      console.error("\nSelection failures:");
      for (const f of failures) console.error(`  ${f.id}: ${f.detail}`);
    }

    console.info(`\nSelection rate: ${passed}/${total} (${(rate * 100).toFixed(1)}%)`);
    expect(rate, `selection pass rate ${(rate * 100).toFixed(1)}% is below 85% gate`).toBeGreaterThanOrEqual(0.85);
  });
});
