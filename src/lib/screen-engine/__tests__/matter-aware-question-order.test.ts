/**
 * Lock-in tests for the matter-aware question order (2026-06-07).
 *
 * The default scoreSlot ranks slots by decision_value, tier, and priority,
 * which optimises for the scoring model rather than the lead's experience.
 * MATTER_SPECIFIC_SLOT_ORDER in selector.ts overrides the scorer for the
 * 9 DRG launch matter types so the question sequence matches how a good
 * intake coordinator would ask, not how the scoring model's variables
 * happen to rank.
 *
 * Each test walks the engine state forward by user-answering one slot at
 * a time and asserts the next slot the engine picks. The order encoded
 * here IS the contract; if anyone in future tries to ride the scorer's
 * default ranking for these matter types, these tests fail loud.
 */
import { describe, it, expect } from "vitest";
import { initialiseState } from "../extractor";
import { selectNextSlot } from "../selector";
import type { EngineState, MatterType } from "../types";

function answer(state: EngineState, slotId: string, value: string): EngineState {
  return {
    ...state,
    slots: { ...state.slots, [slotId]: value },
    slot_meta: {
      ...state.slot_meta,
      [slotId]: { source: "answered", confidence: 1.0 },
    },
  };
}

function buildState(description: string, matter_type: MatterType): EngineState {
  return { ...initialiseState(description), matter_type };
}

function walkAndAssertOrder(
  description: string,
  matter_type: MatterType,
  expected: readonly string[],
) {
  let state = buildState(description, matter_type);
  for (const expectedSlotId of expected) {
    const next = selectNextSlot(state);
    expect(next?.id).toBe(expectedSlotId);
    if (!next) return;
    state = answer(state, next.id, "Answered (test stub)");
  }
}

describe("matter-aware question order (DRG launch matter types)", () => {
  it("will_drafting walks the coordinator-style order", () => {
    walkAndAssertOrder("i need a will", "will_drafting", [
      "existing_will_status",
      "marital_status",
      "children_count",
      "estate_complexity",
      "desired_outcome_will_drafting",
    ]);
  });

  it("power_of_attorney walks its order", () => {
    walkAndAssertOrder("i need a power of attorney", "power_of_attorney", [
      "poa_type",
      "poa_existing_documents",
      "poa_urgency",
      "marital_status",
    ]);
  });

  it("probate walks its order", () => {
    walkAndAssertOrder("need probate help", "probate", [
      "will_status_probate",
      "relationship_to_deceased",
      "executor_role",
      "estate_value_band",
    ]);
  });

  it("estate_dispute walks its order", () => {
    walkAndAssertOrder("i have an estate dispute", "estate_dispute", [
      "estate_dispute_role",
      "estate_dispute_type",
      "estate_court_status",
      "estate_value_band",
      "desired_outcome_estate_dispute",
    ]);
  });

  it("wrongful_dismissal asks signed_release first (urgency), then tenure", () => {
    walkAndAssertOrder("i got fired", "wrongful_dismissal", [
      "signed_release",
      "tenure_band",
      "dismissal_reason_given",
      "severance_offered",
      "salary_band",
      "desired_outcome_wrongful_dismissal",
    ]);
  });

  it("severance_review asks signed_release first, then deadline, then offer", () => {
    walkAndAssertOrder(
      "i need someone to review my severance offer",
      "severance_review",
      [
        "signed_release",
        "severance_deadline",
        "severance_offer_amount",
        "tenure_band",
        "salary_band",
        "desired_outcome_severance_review",
      ],
    );
  });

  it("harassment_complaint asks current employment status first", () => {
    walkAndAssertOrder("i am being harassed at work", "harassment_complaint", [
      "harassment_employment_status",
      "harassment_type",
      "reported_to_hr",
      "desired_outcome_harassment",
    ]);
  });

  it("wage_recovery asks what kind of pay before how much", () => {
    walkAndAssertOrder("my wages were not paid", "wage_recovery", [
      "wages_type",
      "wages_owed_band",
      "desired_outcome_wage_recovery",
    ]);
  });

  it("employment_contract_review asks contract type then timeline then concerns", () => {
    walkAndAssertOrder(
      "i need a contract reviewed",
      "employment_contract_review",
      [
        "contract_review_type",
        "contract_review_timeline",
        "contract_review_concerns",
        "desired_outcome_contract_review",
      ],
    );
  });
});

describe("matter-aware order falls through to default scorer when exhausted", () => {
  it("after all matter-specific slots answered, the universal slots fire (will_drafting)", () => {
    let state = buildState("i need a will", "will_drafting");
    const matterOrder = [
      "existing_will_status",
      "marital_status",
      "children_count",
      "estate_complexity",
      "desired_outcome_will_drafting",
    ];
    for (const slotId of matterOrder) {
      state = answer(state, slotId, "Answered (test stub)");
    }
    // Now the matter-specific list is exhausted. The next pick should be a
    // universal readiness slot (hiring_timeline / other_counsel /
    // decision_authority) via the default scoring path.
    const next = selectNextSlot(state);
    expect(next).not.toBeNull();
    expect(
      ["hiring_timeline", "other_counsel", "decision_authority"].includes(
        next?.id ?? "",
      ),
    ).toBe(true);
  });
});

describe("matter types without an explicit order keep the default scorer", () => {
  it("commercial_real_estate has no explicit order; default scorer picks", () => {
    const state = buildState(
      "i am buying a commercial property",
      "commercial_real_estate",
    );
    const next = selectNextSlot(state);
    expect(next).not.toBeNull();
    // We don't pin a specific slot here because the default scorer is the
    // expected behaviour. The test just guarantees selectNextSlot still
    // returns something (no infinite null) when no explicit order exists.
  });
});
