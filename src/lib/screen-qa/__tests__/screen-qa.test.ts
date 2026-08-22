import { describe, expect, it } from "vitest";
import {
  getScreenQaFixture,
  SCREEN_QA_FIXTURES,
} from "../scenarios";
import {
  isRoutingSlot,
  reportText,
  runScreenQaFixture,
} from "../runner";

describe("deterministic Screen QA matrix", () => {
  it("contains the complete, versioned twelve-scenario pack", () => {
    expect(SCREEN_QA_FIXTURES).toHaveLength(12);
    expect(SCREEN_QA_FIXTURES.map((fixture) => fixture.id)).toEqual([
      "QA-01",
      "QA-02",
      "QA-03",
      "QA-04",
      "QA-05",
      "QA-06",
      "QA-07",
      "QA-08",
      "QA-09",
      "QA-10",
      "QA-11",
      "QA-12",
    ]);
    expect(SCREEN_QA_FIXTURES.every((fixture) =>
      fixture.id === "QA-01" ||
      fixture.opening.startsWith("Fictional") ||
      fixture.locale === "pt",
    )).toBe(true);
  });

  it("keeps representative web journeys in the 5–7 question target", () => {
    const representativeIds = ["QA-01", "QA-02", "QA-03", "QA-04", "QA-05", "QA-07", "QA-08", "QA-10"];
    for (const id of representativeIds) {
      const result = runScreenQaFixture(getScreenQaFixture(id));
      expect(result.questionCount, id).toBeGreaterThanOrEqual(5);
      expect(result.questionCount, id).toBeLessThanOrEqual(7);
      expect(result.maxObservedQuestionCount, id).toBeLessThanOrEqual(8);
    }
  });

  it("never exceeds the hard cap and keeps progressive routing bounded", () => {
    for (const fixture of SCREEN_QA_FIXTURES) {
      const result = runScreenQaFixture(fixture);
      expect(result.maxObservedQuestionCount, fixture.id).toBeLessThanOrEqual(8);
      expect(result.progressiveRoutingSlots.filter(isRoutingSlot).length, fixture.id)
        .toBeLessThanOrEqual(fixture.expected.maxProgressiveRoutingSteps ?? 3);
      expect(result.progressiveRoutingSlots.length, fixture.id).toBeLessThanOrEqual(3);
      if (fixture.expected.route) {
        expect(result.state.matter_type, fixture.id).toBe(fixture.expected.route);
      }
      for (const slotId of fixture.expected.expectedAsked ?? []) {
        expect(result.askedSlots, `${fixture.id} expected ${slotId}`).toContain(slotId);
      }
      for (const slotId of fixture.expected.forbiddenAsked ?? []) {
        expect(result.askedSlots, `${fixture.id} forbidden ${slotId}`).not.toContain(slotId);
      }
    }
  });

  it("keeps routing scaffolding out of deterministic lawyer reports", () => {
    for (const id of ["QA-02", "QA-08", "QA-12"]) {
      const fixture = getScreenQaFixture(id);
      const result = runScreenQaFixture(fixture);
      const text = reportText(result.report);
      expect(result.report, id).not.toBeNull();
      for (const token of fixture.expected.reportMustContain ?? []) {
        expect(text, `${id} report missing ${token}`).toContain(token);
      }
      for (const token of fixture.expected.reportMustNotContain ?? []) {
        expect(text, `${id} report leaked ${token}`).not.toContain(token);
      }
    }
  });

  it("preserves navigation semantics for Back, skip, restart, and report open", () => {
    const result = runScreenQaFixture(getScreenQaFixture("QA-11"));
    expect(result.report).not.toBeNull();
    expect(result.state.matter_type).toBe("business_setup_advisory");
    expect(result.questionCount).toBeLessThanOrEqual(1);
    expect(result.state.questionHistory).toEqual(["advisory_path"]);
  });
});
