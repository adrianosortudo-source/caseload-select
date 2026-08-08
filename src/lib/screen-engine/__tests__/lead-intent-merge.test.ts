import { describe, it, expect } from "vitest";
import { mergeLlmResults } from "../llm/extractor";
import { LEAD_INTENT_FIELD } from "../llm/schema";
import { initialiseState } from "../extractor";
import { computeBand } from "../band";
import { computeCoreCompleteness, getDecisionGap } from "../selector";

/**
 * DR-112. mergeLlmResults writes the LLM's __lead_intent classification
 * into state.lead_intent, following the exact pattern already proven for
 * __detected_language (DR-039): always-injected synthetic field, special-
 * cased before the slot loop, never written to state.slots.
 */
describe("mergeLlmResults: __lead_intent (DR-112)", () => {
  it("writes lead_intent='contact_request' from the LLM field", () => {
    const before = initialiseState("i want to speak to a lawyer");
    const after = mergeLlmResults(before, { [LEAD_INTENT_FIELD]: "contact_request" });
    expect(after.lead_intent).toBe("contact_request");
  });

  it("writes lead_intent='case_description' from the LLM field", () => {
    const before = initialiseState("something happened and I need help");
    const after = mergeLlmResults(before, { [LEAD_INTENT_FIELD]: "case_description" });
    expect(after.lead_intent).toBe("case_description");
  });

  it("leaves state.lead_intent unchanged on null (keeps the heuristic default)", () => {
    const before = initialiseState("i want to speak to a lawyer");
    expect(before.lead_intent).toBe("contact_request");
    const after = mergeLlmResults(before, { [LEAD_INTENT_FIELD]: null });
    expect(after.lead_intent).toBe("contact_request");
  });

  it("leaves state.lead_intent unchanged on an invalid/unrecognised value", () => {
    const before = initialiseState("I got fired last week");
    expect(before.lead_intent).toBe("unknown");
    const after = mergeLlmResults(before, { [LEAD_INTENT_FIELD]: "maybe" });
    expect(after.lead_intent).toBe("unknown");
  });

  it("never writes the synthetic field into state.slots or state.slot_meta", () => {
    const before = initialiseState("i want to speak to a lawyer");
    const after = mergeLlmResults(before, {
      [LEAD_INTENT_FIELD]: "contact_request",
      client_name: "Jordan Lee",
    });
    expect(after.slots[LEAD_INTENT_FIELD]).toBeUndefined();
    expect(after.slot_meta[LEAD_INTENT_FIELD]).toBeUndefined();
    // Sanity: a real slot in the same call still merges normally.
    expect(after.slots.client_name).toBe("Jordan Lee");
  });

  it("promotes matter_type from __matter_type in the SAME merge call that sets lead_intent (touched=0 guard)", () => {
    // Regression guard for the "touched === 0 still returns post-
    // classification state" early-return in mergeLlmResults: a call that
    // only carries the two synthetic fields (no real slot fills) must
    // still persist both the language/matter-type promotion AND
    // lead_intent, not just whichever was set first.
    const before = initialiseState("I would like to learn more about how you can help me");
    expect(before.matter_type).toBe("unknown");
    const after = mergeLlmResults(before, {
      [LEAD_INTENT_FIELD]: "case_description",
      __matter_type: "corporate_general",
    });
    expect(after.lead_intent).toBe("case_description");
    expect(after.matter_type).toBe("corporate_general");
  });
});

/**
 * lead_intent is routing/presentation metadata ONLY. It must never change
 * band, confidence, completeness, or the decision gap. Proven by
 * constructing two otherwise-identical states that differ only in
 * lead_intent and asserting every scoring output is byte-identical.
 */
describe("lead_intent does not affect scoring (DR-112 band regression)", () => {
  const SAMPLE_INPUTS = [
    "i want to speak to a lawyer",
    "My business partner owes me $50,000 and has stopped answering my calls.",
    "I got fired last week and have no severance offer",
    "I would like to learn more about how you can help me",
  ];

  for (const input of SAMPLE_INPUTS) {
    it(`band/completeness/gap identical regardless of lead_intent — "${input.slice(0, 40)}..."`, () => {
      const base = initialiseState(input);
      const asCaseDescription = { ...base, lead_intent: "case_description" as const };
      const asContactRequest = { ...base, lead_intent: "contact_request" as const };
      const asUnknown = { ...base, lead_intent: "unknown" as const };

      const bandA = computeBand(asCaseDescription);
      const bandB = computeBand(asContactRequest);
      const bandC = computeBand(asUnknown);
      expect(bandA).toEqual(bandB);
      expect(bandA).toEqual(bandC);

      expect(computeCoreCompleteness(asCaseDescription)).toBe(computeCoreCompleteness(asContactRequest));
      expect(computeCoreCompleteness(asCaseDescription)).toBe(computeCoreCompleteness(asUnknown));

      expect(getDecisionGap(asCaseDescription)).toBe(getDecisionGap(asContactRequest));
      expect(getDecisionGap(asCaseDescription)).toBe(getDecisionGap(asUnknown));
    });
  }
});

describe("legacy state without lead_intent (DR-112)", () => {
  it("a serialized state missing lead_intent is treated as absent, not a crash", () => {
    const state = initialiseState("I got fired last week");
    const { lead_intent: _drop, ...legacy } = state;
    void _drop;
    // Scoring functions must not throw on a state predating this field.
    expect(() => computeBand(legacy as typeof state)).not.toThrow();
  });
});
