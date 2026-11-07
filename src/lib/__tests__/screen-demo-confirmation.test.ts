import { describe, expect, it } from "vitest";
import { startDemoState } from "../screen-demo";
import { mergeLlmResults } from "../screen-engine/llm/extractor";
import { isUserAnswered, selectNextSlot } from "../screen-engine/selector";
import { confirmDemoFacts, demoReviewFacts } from "../screen-demo-confirmation";

const description = "Fictional demonstration. A business client owes us $18,450 for completed work. I am the owner and can approve hiring a lawyer. We have the invoice.";
const extracted = { amount_at_stake: "$5,000–$25,000", dispute_reason: "No clear reason" };
describe("demo fact readback", () => {
  it("keeps AI proposals unconfirmed until readback and then avoids repeating them", () => {
    const state = mergeLlmResults(startDemoState(description), extracted);
    expect(isUserAnswered(state, "amount_at_stake")).toBe(false);
    expect(demoReviewFacts(state).map((fact) => fact.id)).toEqual(expect.arrayContaining(["amount_at_stake", "decision_authority"]));
    const confirmed = confirmDemoFacts(state);
    expect(isUserAnswered(confirmed, "amount_at_stake")).toBe(true);
    expect(isUserAnswered(confirmed, "decision_authority")).toBe(true);
    expect(selectNextSlot(confirmed)?.id).not.toBe("amount_at_stake");
    expect(confirmed.questionHistory).toEqual(state.questionHistory);
    expect(state.slot_meta.amount_at_stake.source).toBe("llm_inferred");
  });
  it("does not infer hiring authority merely from business ownership or accept invented options", () => {
    const state = mergeLlmResults(startDemoState("I own a business and a client has not paid an invoice."), { amount_at_stake: "a million dollars", client_email: "fake@example.test", made_up: "Yes" });
    expect(demoReviewFacts(state)).toEqual([]);
    expect(isUserAnswered(confirmDemoFacts(state), "decision_authority")).toBe(false);
  });
});
