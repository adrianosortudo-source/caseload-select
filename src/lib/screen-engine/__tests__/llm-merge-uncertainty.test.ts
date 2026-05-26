import { describe, it, expect } from "vitest";
import { mergeLlmResults, leadExpressedUncertainty } from "../llm/extractor";
import { initialiseState } from "../extractor";

/**
 * Task #96 regression: Phase C discovery asks slots already inferred from
 * turn 1.
 *
 * Root cause: when the lead explicitly says "I'm not sure how much money
 * is at stake," the LLM correctly extracts amount_at_stake="Not sure".
 * The merge layer's NON_ANSWER_LITERALS filter then drops that value as
 * Gemini hedging, leaving the slot empty. The discovery loop re-asks
 * the same question — from the lead's side, they answered it once and
 * the bot is asking again.
 *
 * Fix: detect uncertainty markers in the lead's text. When present, the
 * LLM's "Not sure" extraction is preserved as a legitimate answer.
 */

describe("leadExpressedUncertainty", () => {
  it("returns false for empty / null input", () => {
    expect(leadExpressedUncertainty(null)).toBe(false);
    expect(leadExpressedUncertainty("")).toBe(false);
    expect(leadExpressedUncertainty(undefined)).toBe(false);
  });

  it("returns false for confident lead text", () => {
    expect(leadExpressedUncertainty("My business partner owes me $50,000.")).toBe(false);
    expect(leadExpressedUncertainty("I want to file for divorce next week.")).toBe(false);
  });

  it("detects 'not sure'", () => {
    expect(leadExpressedUncertainty("I'm not sure how much they owe")).toBe(true);
    expect(leadExpressedUncertainty("Not sure on the amount yet")).toBe(true);
  });

  it("detects 'don't know' (with and without apostrophe)", () => {
    expect(leadExpressedUncertainty("I don't know what the contract said")).toBe(true);
    expect(leadExpressedUncertainty("dont know if we have a written agreement")).toBe(true);
  });

  it("detects 'no idea'", () => {
    expect(leadExpressedUncertainty("Honestly no idea about the dollar amount.")).toBe(true);
  });

  it("detects 'haven't decided' variations", () => {
    expect(leadExpressedUncertainty("We haven't decided yet on a budget")).toBe(true);
    expect(leadExpressedUncertainty("havent decided what to do")).toBe(true);
  });

  it("detects 'still figuring out'", () => {
    expect(leadExpressedUncertainty("still figuring out the structure")).toBe(true);
  });

  it("detects 'unclear' and 'unsure'", () => {
    expect(leadExpressedUncertainty("It's unclear what the next step is")).toBe(true);
    expect(leadExpressedUncertainty("unsure on the timeline")).toBe(true);
  });

  it("detects TBD shorthand", () => {
    expect(leadExpressedUncertainty("The deadline is tbd")).toBe(true);
    expect(leadExpressedUncertainty("Amount: to be determined")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(leadExpressedUncertainty("NOT SURE about anything")).toBe(true);
    expect(leadExpressedUncertainty("DON'T KNOW")).toBe(true);
  });
});

describe("mergeLlmResults — Not-sure preservation when lead expressed uncertainty", () => {
  // Real slot ids that have "Not sure" listed as an explicit option in the
  // registry. These are the only candidates the slot-aware gate (Codex
  // pushback) will preserve a non-answer for.
  //   amount_at_stake             — Corporate, options include "Not sure"
  //   hiring_timeline             — universal, options include "Not sure"
  //   other_counsel               — universal, options include "Not sure"

  function makeState(input: string) {
    return initialiseState(input);
  }

  it("drops 'Not sure' when the lead's text is confident", () => {
    // Historical behaviour preserved: when the lead didn't express
    // uncertainty, "Not sure" from the LLM is treated as Gemini hedging.
    const state = makeState(
      "My business partner Ben owes me $50,000 from a contract dispute. The agreement was in writing.",
    );
    const merged = mergeLlmResults(state, {
      amount_at_stake: "Not sure",
      hiring_timeline: "Within the next 30 days",
    });
    // "Not sure" was dropped; the slot stays empty.
    expect(merged.slots["amount_at_stake"]).toBeUndefined();
    // The legitimate value was merged.
    expect(merged.slots["hiring_timeline"]).toBe("Within the next 30 days");
  });

  it("preserves 'Not sure' when the lead explicitly said 'not sure'", () => {
    const state = makeState(
      "I have a contract dispute with my business partner. Not sure on the dollar amount yet.",
    );
    const merged = mergeLlmResults(state, {
      amount_at_stake: "Not sure",
    });
    expect(merged.slots["amount_at_stake"]).toBe("Not sure");
    const meta = merged.slot_meta["amount_at_stake"];
    expect(meta?.source).toBe("inferred");
    expect(meta?.evidence).toMatch(/uncertainty/i);
  });

  it("preserves 'Not sure' when the lead said \"don't know\"", () => {
    const state = makeState(
      "Honestly I don't know how much money is involved, just got the letter today.",
    );
    const merged = mergeLlmResults(state, {
      amount_at_stake: "Not sure",
    });
    expect(merged.slots["amount_at_stake"]).toBe("Not sure");
  });

  it("preserves 'Not sure' across multiple slots whose option sets include it", () => {
    const state = makeState(
      "Got a notice of breach of contract. Not sure on the amount, the timeline to hire, or whether I want to talk to other lawyers.",
    );
    const merged = mergeLlmResults(state, {
      amount_at_stake: "Not sure",
      hiring_timeline: "Not sure",
      other_counsel: "Not sure",
    });
    expect(merged.slots["amount_at_stake"]).toBe("Not sure");
    expect(merged.slots["hiring_timeline"]).toBe("Not sure");
    expect(merged.slots["other_counsel"]).toBe("Not sure");
  });

  // Codex pushback 2026-05-26: even when the lead expressed uncertainty,
  // "Not sure" should NOT be preserved on a slot whose option set does
  // not legitimise that value. Previously, the merge was too permissive:
  // "I'm not sure about the amount" would preserve "Not sure" for
  // *every* slot the LLM hedged on, including ones where the canonical
  // answer is e.g. "Business partner" / "Yes" / "No".
  it("DROPS 'Not sure' when the slot's option set does not include 'Not sure'", () => {
    const state = makeState(
      "I have a contract dispute. Not sure on the dollar amount.",
    );
    // `corporate_problem_type` is a routing classifier with concrete
    // option phrases — its options do NOT include "Not sure". The
    // LLM's "Not sure" hedge for this slot must still be dropped,
    // regardless of the uncertainty marker about a different slot.
    const merged = mergeLlmResults(state, {
      amount_at_stake: "Not sure",         // preserve (option set includes it)
      corporate_problem_type: "Not sure",  // drop (option set does not)
    });
    expect(merged.slots["amount_at_stake"]).toBe("Not sure");
    expect(merged.slots["corporate_problem_type"]).toBeUndefined();
  });

  it("drops 'Not sure' on unknown slot ids even with uncertainty marker", () => {
    // Defensive: if the LLM returns a slotId that isn't in the registry,
    // the slot-options gate fails closed (no slot → no options to
    // legitimise the value).
    const state = makeState("Not sure about a lot of things.");
    const merged = mergeLlmResults(state, {
      this_slot_does_not_exist: "Not sure",
    });
    expect(merged.slots["this_slot_does_not_exist"]).toBeUndefined();
  });

  it("still drops empty / null / undefined regardless of uncertainty marker", () => {
    const state = makeState("Not sure about anything here.");
    const merged = mergeLlmResults(state, {
      amount_at_stake: null,
      hiring_timeline: "",
    });
    expect(merged.slots["amount_at_stake"]).toBeUndefined();
    expect(merged.slots["hiring_timeline"]).toBeUndefined();
  });

  it("does not overwrite regex-found values even when uncertainty marker is present", () => {
    // Setup: regex pre-fills amount_at_stake with an explicit dollar.
    const state = makeState("Not sure about most things, but $50k is involved.");
    const seeded = {
      ...state,
      slots: { ...state.slots, amount_at_stake: "$25,000–$100,000" },
      slot_meta: {
        ...state.slot_meta,
        amount_at_stake: {
          source: "explicit" as const,
          evidence: "regex: dollar amount",
          confidence: 0.95,
        },
      },
    };
    const merged = mergeLlmResults(seeded, {
      amount_at_stake: "Not sure",
    });
    // Regex value preserved.
    expect(merged.slots["amount_at_stake"]).toBe("$25,000–$100,000");
    expect(merged.slot_meta["amount_at_stake"]?.source).toBe("explicit");
  });
});
