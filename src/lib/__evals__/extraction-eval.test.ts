/**
 * Extraction Eval  -  Track 1 (Deterministic)
 *
 * Asserts that extractEvents() detects the expected event types from each
 * fixture in the screening corpus. Pure function, no LLM, runs in vitest.
 *
 * Pass threshold: 90% of fixtures must meet their extraction assertion.
 * Below threshold = build gate failure.
 *
 * Fixture contract:
 *   expected_events: []              → extractEvents() must return []
 *   expected_events: ["slip_fall"]   → "slip_fall" must appear in detected types
 *   expected_events: ["t","t"]       → type "t" must appear at least twice
 */

import { describe, it, expect } from "vitest";
import { extractEvents } from "../event-extractor";
import corpus from "./fixtures/screening-corpus.json";

type Fixture = (typeof corpus.fixtures)[number];

function countTypes(types: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of types) counts[t] = (counts[t] ?? 0) + 1;
  return counts;
}

describe("extraction eval  -  screening corpus", () => {
  const results: Array<{ id: string; passed: boolean; detail: string }> = [];

  for (const fixture of corpus.fixtures) {
    it(fixture.id, () => {
      const events = extractEvents(fixture.message);
      const detectedTypes = events.map(e => e.type);

      if (fixture.expected_events.length === 0) {
        // Expect clean extraction: no events detected
        const passed = detectedTypes.length === 0;
        results.push({
          id: fixture.id,
          passed,
          detail: passed
            ? "ok  -  no events detected"
            : `unexpected events: ${detectedTypes.join(", ")}`,
        });
        expect(detectedTypes).toHaveLength(0);
        return;
      }

      // Count-based subset check
      const expectedCounts = countTypes(fixture.expected_events);
      const detectedCounts = countTypes(detectedTypes);
      const failures: string[] = [];

      for (const [type, count] of Object.entries(expectedCounts)) {
        const found = detectedCounts[type] ?? 0;
        if (found < count) {
          failures.push(`expected ${count}x ${type}, found ${found}`);
        }
      }

      const passed = failures.length === 0;
      results.push({
        id: fixture.id,
        passed,
        detail: passed ? "ok" : failures.join("; "),
      });

      for (const [type, count] of Object.entries(expectedCounts)) {
        const found = detectedCounts[type] ?? 0;
        expect(found, `${fixture.id}: expected at least ${count}x ${type}`).toBeGreaterThanOrEqual(count);
      }
    });
  }

  it("pass rate >= 90%  (gate)", () => {
    const total = results.length;
    if (total === 0) return; // no fixtures loaded yet

    const passed = results.filter(r => r.passed).length;
    const rate = passed / total;

    const failures = results.filter(r => !r.passed);
    if (failures.length > 0) {
      console.error("\nExtraction failures:");
      for (const f of failures) console.error(`  ${f.id}: ${f.detail}`);
    }

    console.info(`\nExtraction rate: ${passed}/${total} (${(rate * 100).toFixed(1)}%)`);
    expect(rate, `extraction pass rate ${(rate * 100).toFixed(1)}% is below 90% gate`).toBeGreaterThanOrEqual(0.9);
  });
});
