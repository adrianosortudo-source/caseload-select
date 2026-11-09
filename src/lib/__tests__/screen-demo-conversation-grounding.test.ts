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
