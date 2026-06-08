/**
 * Engine band computation — Phase B sub-types scoring (2026-06-01).
 *
 * Regression coverage for the field-detected scoring gap surfaced by
 * Adriano's PSTN test of the voice intake on 2026-06-01:
 *
 *   1. will_drafting with full slots used to return value=0, urgency=3,
 *      readiness=0, complexity=0 because band.ts had no will_drafting
 *      branch in any of the four scoring functions. Lead landed Band C
 *      regardless of actual signal. After the fix, the same input yields
 *      non-zero scores on value / readiness / complexity and lands at
 *      least Band B.
 *
 *   2. Other Phase B sub-types (probate, wrongful_dismissal, etc.) used
 *      to fall through to the four-axis scorer and collapse to all-zero
 *      Band C. After the fix, they route through bandRoutingLane and
 *      hold a Band B baseline until per-sub-type scoring lands.
 *
 *   3. The classification gates (out_of_scope, unknown) still fire above
 *      the Phase B fallback. The fallback never bypasses a disqualifier.
 *
 * Mirrors the test shape of screen-engine-band.test.ts. Stubs a minimal
 * EngineState rather than running the full extractor pipeline.
 */

import { describe, it, expect } from "vitest";
import { computeBand, scoreFourAxes } from "../screen-engine/band";
import type { EngineState, MatterType } from "../screen-engine/types";

function baseState(overrides: Partial<EngineState> = {}): EngineState {
  const state: EngineState = {
    input: "",
    practice_area: "estates",
    matter_type: "will_drafting",
    intent_family: "estates",
    dispute_family: "general_estates",
    advisory_subtrack: "unknown",
    slots: {},
    slot_meta: {},
    slot_evidence: {},
    raw: {
      mentions_urgency: false,
      mentions_money: false,
      mentions_access: false,
      mentions_ownership: false,
      mentions_documents: false,
      mentions_payment: false,
      mentions_agreement: false,
      mentions_vendor: false,
      mentions_fraud: false,
      mentions_property: false,
      mentions_closing: false,
      mentions_lease: false,
      mentions_construction: false,
      mentions_mortgage: false,
      mentions_preconstruction: false,
      input_length: 0,
    },
    confidence: 0,
    coreCompleteness: 0,
    answeredQuestionGroups: [],
    questionHistory: [],
    insightShown: false,
    contactCaptureStarted: false,
    lead_id: "L-2026-06-01-TST",
    submitted_at: "2026-06-01T19:56:59.000Z",
    language: "en",
    ...overrides,
  };
  return state;
}

describe("Phase B fix — will_drafting four-axis scoring", () => {
  // Reproduces the exact slot shape from Adriano's PSTN test on
  // 2026-06-01 (screened_leads row 7ceb37d9-..., later deleted).
  // Before the fix this returned {value:0, urgency:3, readiness:0,
  // complexity:0}. After the fix none of the will_drafting axes
  // should be zero.
  it("will_drafting with realistic slots no longer returns all-zero axes", () => {
    const state = baseState({
      matter_type: "will_drafting" as MatterType,
      slots: {
        client_name: "Adriano Domingues",
        client_phone: "+16475492106",
        client_postal_code: "M5T 1B3",
        estates_problem_type: "I need a will drafted or updated",
        existing_will_status: "No, I have never had one",
        children_count: "Two or three",
        estate_complexity: "Simple, one residence and savings",
      },
      slot_meta: {
        existing_will_status: { source: "answered" },
      } as EngineState["slot_meta"],
    });

    const scores = scoreFourAxes(state);

    expect(scores.value).toBeGreaterThan(0);
    expect(scores.readiness).toBeGreaterThan(0);
    expect(scores.complexity).toBeGreaterThan(0);

    // existing_will_status === "No, I have never had one" is a strong
    // readiness signal: +4 on top of the universal base.
    expect(scores.readiness).toBeGreaterThanOrEqual(4);

    // Simple estate + two children: baseline 1 + 1 children lift = 2.
    expect(scores.complexity).toBe(2);

    // Baseline 4, no Full-estate-plan upgrade, simple assets: 4.
    expect(scores.value).toBe(4);

    // readinessAnswered should fire on the will_drafting-specific signal
    // even when the universal triple (hiring_timeline / other_counsel /
    // decision_authority) is absent.
    expect(scores.readinessAnswered).toBe(true);
  });

  it("will_drafting with Full estate plan + Business assets scores higher value", () => {
    const state = baseState({
      matter_type: "will_drafting" as MatterType,
      slots: {
        desired_outcome_will_drafting: "Full estate plan (will, POAs, trusts)",
        estate_complexity: "Business or company ownership",
        existing_will_status: "Yes, but it is outdated",
        children_count: "Four or more",
      },
      slot_meta: {
        existing_will_status: { source: "answered" },
      } as EngineState["slot_meta"],
    });

    const scores = scoreFourAxes(state);

    // Base 4 + Full estate plan 4 + Business 3 = 10 (clamped)
    expect(scores.value).toBe(10);
    // Base 1 + Business complexity 6 + Four-or-more children 2 = 9
    expect(scores.complexity).toBe(9);
    // Base ~0 + outdated will 3 = 3
    expect(scores.readiness).toBeGreaterThanOrEqual(3);
  });

  it("will_drafting with realistic slots lands at least Band B (not collapsed to C)", () => {
    const state = baseState({
      matter_type: "will_drafting" as MatterType,
      slots: {
        client_name: "Adriano Domingues",
        client_phone: "+16475492106",
        existing_will_status: "No, I have never had one",
        children_count: "Two or three",
        estate_complexity: "Simple, one residence and savings",
      },
      slot_meta: {
        existing_will_status: { source: "answered" },
      } as EngineState["slot_meta"],
    });

    const result = computeBand(state);
    // Should be B or A; specifically must NOT be C (the broken default).
    expect(result.band).not.toBe("C");
    expect(["A", "B"]).toContain(result.band);
  });
});

describe("Phase B fix — non-will sub-types use slotRegistry-driven baseline scoring", () => {
  it("probate with estate value answered gets baseline value and complexity lift", () => {
    const state = baseState({
      matter_type: "probate" as MatterType,
      practice_area: "estates",
      slots: {
        estate_value_band: "$500,000 to $2 million",
        relationship_to_deceased: "Spouse or partner",
      },
    });
    const scores = scoreFourAxes(state);
    const result = computeBand(state);

    expect(scores.value).toBeGreaterThan(0);
    expect(scores.complexity).toBeGreaterThan(0);
    expect(result.reasoning).not.toMatch(/Weighted 0\.0.*Weak signal/i);
  });

  it("wrongful_dismissal with salary and tenure answered gets baseline lift", () => {
    const state = baseState({
      matter_type: "wrongful_dismissal" as MatterType,
      practice_area: "employment",
      intent_family: "employment",
      slots: {
        salary_band: "$100,000 to $200,000",
        tenure_band: "4 to 7 years",
      },
    });
    const scores = scoreFourAxes(state);
    const result = computeBand(state);

    expect(scores.value).toBeGreaterThan(0);
    expect(scores.complexity).toBeGreaterThan(0);
    expect(result.reasoning).not.toMatch(/Weighted 0\.0.*Weak signal/i);
  });

  it("employment and estates sub-types no longer need practice-area routing fallback", () => {
    const fixtures: Array<{ matter_type: MatterType; slots: Record<string, string> }> = [
      { matter_type: "severance_review", slots: { severance_offer_amount: "3 to 6 months of pay" } },
      { matter_type: "harassment_complaint", slots: { harassment_type: "Discrimination" } },
      { matter_type: "wage_recovery", slots: { wages_owed_band: "$10,000 to $50,000" } },
      { matter_type: "employment_contract_review", slots: { contract_review_type: "A new job offer" } },
      { matter_type: "power_of_attorney", slots: { poa_type: "Both" } },
      { matter_type: "estate_dispute", slots: { estate_dispute_type: "The executor is not acting properly" } },
    ];

    for (const fixture of fixtures) {
      const isEmployment = fixture.matter_type.includes("severance") ||
        fixture.matter_type.includes("harassment") ||
        fixture.matter_type.includes("wage") ||
        fixture.matter_type.includes("employment");
      const state = baseState({
        matter_type: fixture.matter_type,
        practice_area: isEmployment ? "employment" : "estates",
        intent_family: isEmployment ? "employment" : "estates",
        slots: fixture.slots,
      });
      const scores = scoreFourAxes(state);
      const result = computeBand(state);
      expect(scores.value + scores.complexity).toBeGreaterThan(0);
      expect(result.reasoning).not.toMatch(/Weighted 0\.0.*Weak signal/i);
    }
  });
});

describe("Phase B fix — disqualifier gates fire above baseline scoring", () => {
  // The operator's guardrail: baseline scoring only runs AFTER
  // classification has already cleared OOS / unknown gates.
  // These tests prove disqualifiers still take precedence.

  it("out_of_scope still returns Band D, not a baseline-scored in-scope band", () => {
    const state = baseState({
      matter_type: "out_of_scope",
      practice_area: "family",
    });
    const result = computeBand(state);
    expect(result.band).toBe("D");
  });

  it("unknown matter type still returns Band C with confidence 0", () => {
    const state = baseState({
      matter_type: "unknown",
    });
    const result = computeBand(state);
    expect(result.band).toBe("C");
    expect(result.confidence).toBe(0);
  });
});
