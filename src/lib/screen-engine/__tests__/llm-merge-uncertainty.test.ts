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
  function makeState(input: string) {
    const base = initialiseState(input);
    return base;
  }

  it("drops 'Not sure' when the lead's text is confident", () => {
    // Historical behaviour preserved: when the lead didn't express
    // uncertainty, "Not sure" from the LLM is treated as Gemini hedging.
    const state = makeState(
      "My business partner Ben owes me $50,000 from a contract dispute. The agreement was in writing.",
    );
    const merged = mergeLlmResults(state, {
      amount_at_stake: "Not sure",
      relationship_to_other_party: "Business partner",
    });
    // "Not sure" was dropped; the slot stays empty.
    expect(merged.slots["amount_at_stake"]).toBeUndefined();
    // The other value (legitimate) was merged.
    expect(merged.slots["relationship_to_other_party"]).toBe("Business partner");
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

  it("preserves 'Not sure' across multiple slots when uncertainty marker is present", () => {
    const state = makeState(
      "Got a notice of breach of contract. Not sure on the amount, the relationship, or what they want from me.",
    );
    const merged = mergeLlmResults(state, {
      amount_at_stake: "Not sure",
      relationship_to_other_party: "Not sure",
      desired_outcome: "Not sure",
    });
    expect(merged.slots["amount_at_stake"]).toBe("Not sure");
    expect(merged.slots["relationship_to_other_party"]).toBe("Not sure");
    expect(merged.slots["desired_outcome"]).toBe("Not sure");
  });

  it("still drops empty / null / undefined regardless of uncertainty marker", () => {
    const state = makeState("Not sure about anything here.");
    const merged = mergeLlmResults(state, {
      amount_at_stake: null,
      relationship_to_other_party: "",
    });
    expect(merged.slots["amount_at_stake"]).toBeUndefined();
    expect(merged.slots["relationship_to_other_party"]).toBeUndefined();
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
