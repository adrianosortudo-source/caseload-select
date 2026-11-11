import { describe, expect, it } from "vitest";
import { answerDemoState, startDemoState } from "../screen-demo";
import { mergeLlmResults } from "../screen-engine/llm/extractor";
import { isUserAnswered, selectNextSlot } from "../screen-engine/selector";
import { confirmDemoFacts, demoReviewFacts } from "../screen-demo-confirmation";

const description = "Fictional demonstration. A business client owes us $18,450 for completed work. I am the owner and can approve hiring a lawyer. We have the invoice. I want advice about a demand letter.";
const extracted = { amount_at_stake: "$5,000–$25,000", dispute_reason: "No clear reason" };
describe("demo fact readback", () => {
  it("keeps AI proposals unconfirmed until readback and then avoids repeating them", () => {
    const state = mergeLlmResults(startDemoState(description), extracted);
    expect(isUserAnswered(state, "amount_at_stake")).toBe(false);
    expect(demoReviewFacts(state).map((fact) => fact.id)).toEqual(expect.arrayContaining(["amount_at_stake", "decision_authority", "desired_outcome_unpaid_invoice"]));
    const confirmed = confirmDemoFacts(state);
    expect(isUserAnswered(confirmed, "amount_at_stake")).toBe(true);
    expect(isUserAnswered(confirmed, "decision_authority")).toBe(true);
    expect(selectNextSlot(confirmed)?.id).not.toBe("amount_at_stake");
    expect(isUserAnswered(confirmed, "desired_outcome_unpaid_invoice")).toBe(true);
    expect(confirmed.questionHistory).toEqual(state.questionHistory);
    expect(state.slot_meta.amount_at_stake.source).toBe("llm_inferred");
  });
  it("does not infer hiring authority merely from business ownership or accept invented options", () => {
    const state = mergeLlmResults(startDemoState("I own a business and a client has not paid an invoice."), { amount_at_stake: "a million dollars", client_email: "fake@example.test", made_up: "Yes" });
    expect(demoReviewFacts(state)).toEqual([]);
    expect(isUserAnswered(confirmDemoFacts(state), "decision_authority")).toBe(false);
  });
});


it("accepts only canonical corrections without consuming the question budget", () => {
  const state = mergeLlmResults(startDemoState(description), extracted);
  const fact = demoReviewFacts(state).find((fact) => fact.id === "amount_at_stake")!;
  const replacement = fact.options.find((option) => option.value !== fact.value)!.value;
  const corrected = confirmDemoFacts(state, { amount_at_stake: replacement, made_up: "Yes" });
  expect(corrected.slots.amount_at_stake).toBe(replacement);
  expect(corrected.slot_meta.amount_at_stake.evidence).toMatch(/corrected/);
  expect(corrected.questionHistory).toEqual(state.questionHistory);
  expect(corrected.slots.made_up).toBeUndefined();
  expect(state.slots.amount_at_stake).toBe(extracted.amount_at_stake);
  expect(confirmDemoFacts(state, { amount_at_stake: "invented value" }).slot_meta.amount_at_stake.source).toBe("llm_inferred");
});

it("can leave an incorrect AI proposal unanswered so discovery can ask for it", () => {
  const state = mergeLlmResults(startDemoState(description), extracted);
  const confirmed = confirmDemoFacts(state, { amount_at_stake: "" });
  expect(confirmed.slots.amount_at_stake).toBeNull();
  expect(isUserAnswered(confirmed, "amount_at_stake")).toBe(false);
  expect(selectNextSlot(confirmed)?.id).toBe("amount_at_stake");
});

it.each([
  "I own a business and cannot approve hiring a lawyer. A client owes an invoice.",
  "I can approve hiring a lawyer but my partner must agree. A client owes an invoice.",
  "I do not want a demand letter. A client owes an invoice.",
  "I may decide to hire a lawyer if my partner agrees. A client owes an invoice.",
  "I am the owner and cannot decide to hire a lawyer. A client owes an invoice.",
  "I do not think I am the owner and can decide to hire a lawyer. A client owes an invoice.",
])("does not overstate negated or joint readiness: %s", (input) => {
  const state = startDemoState(input);
  expect(demoReviewFacts(state).some((fact) => fact.id === "decision_authority" || fact.id === "desired_outcome_unpaid_invoice")).toBe(false);
});


describe("delivery documentation in demo readback", () => {
  const input = "I run a small design studio in Ontario. We completed and delivered a website project. The client has not paid our $18,450 invoice, overdue by 60 days. The signed contract, invoice and emails confirming delivery are ready. I am the owner and can decide to hire a lawyer. I want a demand letter.";
  it("proposes explicit available evidence for confirmation without repeating it", () => {
    const state = mergeLlmResults(startDemoState(input), extracted);
    const fact = demoReviewFacts(state).find((item) => item.id === "proof_of_performance");
    expect(fact).toMatchObject({ label: "Proof of delivery", value: "Yes", source: "inferred" });
    expect(demoReviewFacts(state).find((item) => item.id === "decision_authority")).toMatchObject({ value: "Just me", source: "inferred" });
    expect(isUserAnswered(state, "proof_of_performance")).toBe(false);
    const confirmed = confirmDemoFacts(state);
    expect(isUserAnswered(confirmed, "proof_of_performance")).toBe(true);
    expect(selectNextSlot(confirmed)?.id).not.toBe("proof_of_performance");
    expect(confirmed.questionHistory).toEqual(state.questionHistory);
    expect(selectNextSlot(confirmed)?.id).toBe("hiring_timeline");
    const afterTiming = answerDemoState(confirmed, "hiring_timeline", "Now (this week)");
    expect(selectNextSlot(afterTiming)?.id).toBe("other_counsel");
    const afterCounsel = answerDemoState(afterTiming, "other_counsel", "No, you are the first");
    expect(selectNextSlot(afterCounsel)?.id).not.toBe("decision_authority");
    expect(afterCounsel.questionHistory.length).toBeLessThanOrEqual(8);
  });
  it.each([
    "A client has not paid an invoice. We delivered the project.",
    "A client has not paid an invoice. I do not have emails confirming delivery.",
    "A client has not paid an invoice. I might have emails confirming delivery.",
    "A client has not paid an invoice. The customer has emails confirming delivery.",
    "A client has not paid an invoice. I do not think emails confirming delivery are ready.",
    "A client has not paid an invoice. I have emails confirming delivery but they are unavailable.",
  ])("does not propose absent, negative, uncertain or third-party evidence: %s", (input) => {
    expect(demoReviewFacts(startDemoState(input)).some((item) => item.id === "proof_of_performance")).toBe(false);
  });
  it("preserves a correction or a choice to leave evidence unanswered", () => {
    const state = mergeLlmResults(startDemoState(input), extracted);
    const corrected = confirmDemoFacts(state, { proof_of_performance: "No" });
    expect(corrected.slots.proof_of_performance).toBe("No");
    expect(demoReviewFacts(corrected).some((item) => item.id === "proof_of_performance")).toBe(false);
    const blank = confirmDemoFacts(state, { proof_of_performance: "" });
    expect(blank.slots.proof_of_performance).toBeNull();
    expect(demoReviewFacts(blank).some((item) => item.id === "proof_of_performance")).toBe(false);
    expect(blank.questionHistory).toEqual(state.questionHistory);
  });
});


it("keeps the existing explicit sole-decision phrasing with unrelated nonpayment", () => {
  const state = startDemoState("A client has not paid an invoice. I alone decide whether to hire a lawyer.");
  expect(demoReviewFacts(state).find((item) => item.id === "decision_authority")).toMatchObject({ value: "Just me", source: "inferred" });
});
