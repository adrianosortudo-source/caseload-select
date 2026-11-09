import { describe, expect, it } from "vitest";
import { initialiseState } from "../screen-engine/extractor";
import { mergeLlmResults } from "../screen-engine/llm/extractor";
import { prepareFamilyDemoState } from "../screen-demo-family";
import { groundDemoConversationFacts } from "../screen-demo-conversation-grounding";

describe("literal demo conversation grounding", () => {
  it("grounds only the user's explicit child and parenting facts, without marking AI guesses answered", () => {
    const text = "I am having a difficult divorce as my wife will not allow me see my son";
    const initial = prepareFamilyDemoState(initialiseState(text), ["family"]);
    const inferred = mergeLlmResults(initial, { family_children: "Yes", family_help_sought: "Parenting or decision-making", family_jurisdiction: "Ontario" });
    const grounded = groundDemoConversationFacts(inferred, text);
    expect(grounded.slot_meta.family_children).toMatchObject({ source: "explicit", evidence: text });
    expect(grounded.slot_meta.family_help_sought).toMatchObject({ source: "explicit", evidence: text });
    expect(grounded.slot_meta.family_jurisdiction.source).toBe("llm_inferred");
    expect(grounded.slots.family_existing_order).toBeFalsy();
    expect(grounded.questionHistory).toEqual(initial.questionHistory);
  });
  it("does not treat a bare family issue or a partial order denial as both negatives", () => {
    const text = "I need a family lawyer and have no court order.";
    const state = prepareFamilyDemoState(initialiseState(text), ["family"]);
    const result = groundDemoConversationFacts(state, text);
    expect(result.slots.family_existing_order).toBeFalsy();
    expect(result.slots.family_children).toBeFalsy();
  });
  it("grounds a stated age-qualified son but not a negated child claim", () => {
    const text = "My former spouse and I have a nine-year-old son. I need help enforcing our parenting time.";
    const initial = prepareFamilyDemoState(initialiseState(text), ["family"]);
    const inferred = mergeLlmResults(initial, { family_children: "Yes", family_help_sought: "Parenting or decision-making" });
    const result = groundDemoConversationFacts(inferred, text);
    expect(result.slot_meta.family_children).toMatchObject({ source: "explicit", evidence: text });
    expect(result.slot_meta.family_help_sought.source).toBe("explicit");
    const negative = "I need a family lawyer. We do not have a nine-year-old son.";
    const other = prepareFamilyDemoState(initialiseState(negative), ["family"]);
    const guessed = mergeLlmResults(other, { family_children: "Yes" });
    expect(groundDemoConversationFacts(guessed, negative).slot_meta.family_children.source).toBe("llm_inferred");
  });
  it("does not turn a stated lack of parenting need into a parenting request", () => {
    const text = "I need a family lawyer. This is not about parenting or custody.";
    const state = prepareFamilyDemoState(initialiseState(text), ["family"]);
    const inferred = mergeLlmResults(state, { family_help_sought: "Parenting or decision-making" });
    expect(groundDemoConversationFacts(inferred, text).slot_meta.family_help_sought.source).toBe("llm_inferred");
  });
  it("retains the person's literal no-date statement, without trusting a paraphrase", () => {
    const text = "I have a family court order. No court date is scheduled.";
    const state = prepareFamilyDemoState(initialiseState(text), ["family"]);
    const inferred = mergeLlmResults(state, { family_timing: "No known date" });
    const result = groundDemoConversationFacts(inferred, text);
    expect(result.slots.family_timing).toBe("No court date is scheduled");
    expect(result.slot_meta.family_timing).toMatchObject({ source: "explicit", evidence: text });
  });
  it("does not override a different AI help request when parenting is only background", () => {
    const text = "I have a parenting order, but I need a family lawyer to discuss property after separation.";
    const state = prepareFamilyDemoState(initialiseState(text), ["family"]);
    const inferred = mergeLlmResults(state, { family_help_sought: "Separation or divorce" });
    const result = groundDemoConversationFacts(inferred, text);
    expect(result.slots.family_help_sought).toBe("Separation or divorce");
    expect(result.slot_meta.family_help_sought.source).toBe("llm_inferred");
  });
  it("grounds only a single unambiguous literal amount matching the model's existing range", () => {
    function amount(text: string, value: string) {
      const state = initialiseState(text);
      return groundDemoConversationFacts(mergeLlmResults(state, { amount_at_stake: value }), text);
    }
    const valid = amount("A business client owes $18,450 on an unpaid invoice.", "$5,000–$25,000");
    expect(valid.slot_meta.amount_at_stake).toMatchObject({ source: "explicit", evidence: "A business client owes $18,450 on an unpaid invoice." });
    for (const text of ["A client owes $5,000 on an unpaid invoice.", "A client owes $25,000 on an unpaid invoice.", "A client owes $100,000 on an unpaid invoice.", "A client owes $18,450 or $22,000 on an unpaid invoice.", "A client owes between $18,450 and 22,000 on an unpaid invoice.", "A client owes about $18,450 on an unpaid invoice."]) {
      expect(amount(text, "$5,000–$25,000").slot_meta.amount_at_stake?.source).not.toBe("explicit");
    }
    expect(amount("A client owes $18,450 on an unpaid invoice.", "$25,000–$100,000").slot_meta.amount_at_stake.source).toBe("llm_inferred");
  });
  it("grounds the specific scheduled conference, not the order or incident date", () => {
    const text = "My former spouse and I have a nine-year-old son. I need help enforcing our parenting time. A court order was made March 15, 2025. An incident happened October 30, 2026. A case conference is scheduled for December 12, 2026.";
    const state = prepareFamilyDemoState(initialiseState(text), ["family"]);
    const inferred = mergeLlmResults(state, { family_children: "Yes", family_help_sought: "Parenting or decision-making", family_timing: "A case conference is scheduled for December 12, 2026." });
    const result = groundDemoConversationFacts(inferred, text);
    expect(result.slots.family_timing).toBe("A case conference is scheduled for December 12, 2026");
    expect(result.slot_meta.family_timing.source).toBe("explicit");
    expect(result.questionHistory).toEqual(state.questionHistory);
  });
  it("does not turn alternative conference dates into a confirmed date", () => {
    const text = "I need a family lawyer. The court hearing may be December 12, 2026 or January 5, 2027.";
    const state = prepareFamilyDemoState(initialiseState(text), ["family"]);
    const inferred = mergeLlmResults(state, { family_timing: "December 12, 2026" });
    expect(groundDemoConversationFacts(inferred, text).slot_meta.family_timing.source).toBe("llm_inferred");
  });
  it("grounds Toronto, Ontario without inventing an order the person wants to obtain", () => {
    const text = "I live in Toronto, Ontario. I need a family lawyer to help get a court order.";
    const state = prepareFamilyDemoState(initialiseState(text), ["family"]);
    const inferred = mergeLlmResults(state, { family_jurisdiction: "Ontario", family_existing_order: "Court order" });
    const result = groundDemoConversationFacts(inferred, text);
    expect(result.slot_meta.family_jurisdiction.source).toBe("explicit");
    expect(result.slot_meta.family_existing_order.source).toBe("llm_inferred");
  });
  it("keeps unrelated nonpayment negation from blocking explicit authority and delivery evidence", () => {
    const text = "My client has not paid the invoice for delivered work. I own a small business and can decide whether to hire a lawyer. We have emails confirming delivery.";
    const state = initialiseState(text);
    expect(state.matter_type).toBe("unpaid_invoice");
    const result = groundDemoConversationFacts(state, text);
    expect(result.slots.decision_authority).toBe("Just me");
    expect(result.slot_meta.decision_authority.source).toBe("explicit");
    expect(result.slots.proof_of_performance).toBe("Yes");
    expect(result.slot_meta.proof_of_performance.source).toBe("explicit");
  });
  it("grounds an explicit family date, location, and both absent documents", () => {
    const text = "We live in Ontario. There is no court order or written parenting agreement. Our family court date is December 12, 2026.";
    const initial = prepareFamilyDemoState(initialiseState(text), ["family"]);
    const inferred = mergeLlmResults(initial, { family_existing_order: "Neither", family_timing: "December 12, 2026", family_jurisdiction: "Ontario" });
    const result = groundDemoConversationFacts(inferred, text);
    expect(result.slot_meta.family_existing_order.source).toBe("explicit");
    expect(result.slot_meta.family_timing.source).toBe("explicit");
    expect(result.slot_meta.family_jurisdiction.source).toBe("explicit");
  });
});
