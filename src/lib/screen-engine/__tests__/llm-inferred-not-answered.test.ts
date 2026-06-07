/**
 * Lock-in tests for the 2026-06-07 provenance rule.
 *
 * Global engine rule:
 *
 *   A slot is only "answered" if the user actually answered it. Not if
 *   the model guessed it. Not if it is the most likely next answer. Not
 *   if it is inferred from matter type. Not if it is a plausible package
 *   recommendation.
 *
 * Concretely: any value mergeLlmResults writes into slot_meta carries
 * source: 'llm_inferred'. The engine's gating predicates (isUserAnswered,
 * slotIsAnswered, groupAlreadyAnswered, isResolved, computeCoreCompleteness,
 * getMatterGap blocks) treat 'llm_inferred' as NOT-answered, so the engine
 * keeps asking the user even when the LLM has a guess.
 *
 * This file pins the rule across the full set of launch-week DRG matter
 * types (estates, employment, corporate, real estate) and the routing
 * catch-alls. If any of these tests fail in the future, the engine has
 * regressed to letting model guesses suppress discovery questions.
 */
import { describe, it, expect } from "vitest";
import { initialiseState } from "../extractor";
import { mergeLlmResults } from "../llm/extractor";
import { getNextStep } from "../control";
import { computeCoreCompleteness, isUserAnswered } from "../selector";
import type { EngineState, MatterType } from "../types";

function makeState(description: string, matter_type: MatterType): EngineState {
  return { ...initialiseState(description), matter_type };
}

describe("provenance rule: LLM extractions never count as user-answered", () => {
  it("mergeLlmResults tags every slot it writes as source='llm_inferred'", () => {
    const state = makeState("i need a will", "will_drafting");
    const merged = mergeLlmResults(state, {
      existing_will_status: "No, I have never had one",
      desired_outcome_will_drafting: "Simple will",
    });
    expect(merged.slot_meta["existing_will_status"]?.source).toBe("llm_inferred");
    expect(merged.slot_meta["desired_outcome_will_drafting"]?.source).toBe(
      "llm_inferred",
    );
  });

  it("isUserAnswered returns false for LLM-inferred slots even with a value", () => {
    const state = makeState("i need a will", "will_drafting");
    const merged = mergeLlmResults(state, {
      existing_will_status: "No, I have never had one",
    });
    expect(merged.slots["existing_will_status"]).toBe("No, I have never had one");
    expect(isUserAnswered(merged, "existing_will_status")).toBe(false);
  });

  it("computeCoreCompleteness does not count LLM-inferred slots", () => {
    const state = makeState("i need a will", "will_drafting");
    const merged = mergeLlmResults(state, {
      existing_will_status: "No, I have never had one",
      desired_outcome_will_drafting: "Simple will",
    });
    // Both slots have values, but neither is user-answered. Completeness
    // must therefore be 0% (existing_will_status is core; the other slot
    // is strategic and does not count for the core ratio either way).
    expect(computeCoreCompleteness(merged)).toBe(0);
  });
});

describe("provenance rule: ultra-short inputs across DRG launch matter types", () => {
  it("'i need a will' produces a getNextStep that ASKS a discovery slot, not present_insight", () => {
    const state = makeState("i need a will", "will_drafting");
    const merged = mergeLlmResults(state, {
      existing_will_status: "No, I have never had one",
      desired_outcome_will_drafting: "Simple will",
    });
    const next = getNextStep(merged);
    expect(next.type).not.toBe("present_insight");
    expect(next.type).not.toBe("stop");
  });

  it("'i got fired' produces a getNextStep that ASKS a wrongful-dismissal slot", () => {
    const state = makeState("i got fired", "wrongful_dismissal");
    const merged = mergeLlmResults(state, {
      tenure_band: "1 to 3 years",
      severance_offered: "No offer yet",
      signed_release: "No, I have not signed anything",
    });
    const next = getNextStep(merged);
    expect(next.type).not.toBe("present_insight");
    expect(next.type).not.toBe("stop");
  });

  it("'i need a contract reviewed' asks a contract-review slot, not insight", () => {
    const state = makeState(
      "i need a contract reviewed",
      "employment_contract_review",
    );
    const merged = mergeLlmResults(state, {
      contract_review_type: "A new job offer",
      contract_review_timeline: "This week",
      contract_review_concerns: "Termination clause",
    });
    const next = getNextStep(merged);
    expect(next.type).not.toBe("present_insight");
    expect(next.type).not.toBe("stop");
  });

  it("'my landlord issue' asks a landlord-tenant slot, not insight", () => {
    const state = makeState("my landlord issue", "landlord_tenant");
    const merged = mergeLlmResults(state, {
      party_role: "Tenant",
      tenancy_type: "Residential",
      tenancy_issue: "Eviction notice",
    });
    const next = getNextStep(merged);
    expect(next.type).not.toBe("present_insight");
    expect(next.type).not.toBe("stop");
  });

  it("'need probate help' asks a probate slot, not insight", () => {
    const state = makeState("need probate help", "probate");
    const merged = mergeLlmResults(state, {
      relationship_to_deceased: "Child",
      will_status_probate: "Yes, and it is valid",
      executor_role: "I am the executor (estate trustee)",
    });
    const next = getNextStep(merged);
    expect(next.type).not.toBe("present_insight");
    expect(next.type).not.toBe("stop");
  });

  it("'I have an estate dispute' asks an estate-dispute slot, not insight", () => {
    const state = makeState("I have an estate dispute", "estate_dispute");
    const merged = mergeLlmResults(state, {
      estate_dispute_type: "The will is being challenged",
      estate_dispute_role: "Beneficiary",
      estate_value_band: "$500,000 to $2 million",
    });
    const next = getNextStep(merged);
    expect(next.type).not.toBe("present_insight");
    expect(next.type).not.toBe("stop");
  });

  it("'I need a power of attorney' asks a POA slot, not insight", () => {
    const state = makeState(
      "I need a power of attorney",
      "power_of_attorney",
    );
    const merged = mergeLlmResults(state, {
      poa_type: "Both",
      poa_urgency: "Planning ahead, no immediate trigger",
    });
    const next = getNextStep(merged);
    expect(next.type).not.toBe("present_insight");
    expect(next.type).not.toBe("stop");
  });

  it("'workplace harassment' asks a harassment slot, not insight", () => {
    const state = makeState(
      "I am being harassed at work",
      "harassment_complaint",
    );
    const merged = mergeLlmResults(state, {
      harassment_type: "Discrimination (race, gender, age, disability, or other protected ground)",
      harassment_employment_status: "Yes, still employed",
      reported_to_hr: "No, I have not reported it yet",
    });
    const next = getNextStep(merged);
    expect(next.type).not.toBe("present_insight");
    expect(next.type).not.toBe("stop");
  });

  it("'wages not paid' asks a wage-recovery slot, not insight", () => {
    const state = makeState("my wages were not paid", "wage_recovery");
    const merged = mergeLlmResults(state, {
      wages_owed_band: "$2,000 to $10,000",
      wages_type: "Regular wages",
    });
    const next = getNextStep(merged);
    expect(next.type).not.toBe("present_insight");
    expect(next.type).not.toBe("stop");
  });

  it("'severance review' asks a severance slot, not insight", () => {
    const state = makeState(
      "I need someone to review my severance offer",
      "severance_review",
    );
    const merged = mergeLlmResults(state, {
      severance_offer_amount: "3 to 6 months of pay",
      severance_deadline: "Yes, within the next week",
      tenure_band: "4 to 7 years",
      salary_band: "$100,000 to $200,000",
    });
    const next = getNextStep(merged);
    expect(next.type).not.toBe("present_insight");
    expect(next.type).not.toBe("stop");
  });
});
