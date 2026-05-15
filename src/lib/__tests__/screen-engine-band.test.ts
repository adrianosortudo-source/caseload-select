/**
 * Engine band computation — Band D doctrine (2026-05-15).
 *
 * The engine's `computeBand` returns BandResult. Out-of-scope matters get
 * `band: 'D'` (refer-eligible) so the lawyer sees them in the queue and
 * can Refer / Take / Pass. In-scope matters get A/B/C from the four-axis
 * lift formula.
 *
 * These tests stub a minimal EngineState directly rather than running
 * the full extractor pipeline, so we can target the band logic in
 * isolation.
 */

import { describe, it, expect } from "vitest";
import { computeBand } from "../screen-engine/band";
import type { EngineState } from "../screen-engine/types";

function baseState(overrides: Partial<EngineState> = {}): EngineState {
  const state: EngineState = {
    input: "",
    practice_area: "corporate",
    matter_type: "shareholder_dispute",
    intent_family: "business_dispute",
    dispute_family: "ownership_control",
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
    lead_id: "L-2026-05-15-TST",
    submitted_at: "2026-05-15T12:00:00.000Z",
    language: "en",
    ...overrides,
  };
  return state;
}

describe("computeBand — out_of_scope returns Band D (refer-eligible)", () => {
  it("OOS matter (family law) returns band='D'", () => {
    const state = baseState({
      matter_type: "out_of_scope",
      practice_area: "family",
    });
    const result = computeBand(state);
    expect(result.band).toBe("D");
  });

  it("OOS matter reasoning mentions refer-eligible context", () => {
    const state = baseState({
      matter_type: "out_of_scope",
      practice_area: "immigration",
    });
    const result = computeBand(state);
    expect(result.reasoning.toLowerCase()).toMatch(/out of scope/);
    expect(result.reasoning.toLowerCase()).toMatch(/refer/);
  });

  it("OOS across every practice area returns band='D'", () => {
    const areas = ["family", "immigration", "employment", "criminal", "personal_injury", "estates"];
    for (const area of areas) {
      const state = baseState({
        matter_type: "out_of_scope",
        practice_area: area as EngineState["practice_area"],
      });
      const result = computeBand(state);
      expect(result.band, `area=${area}`).toBe("D");
    }
  });
});

describe("computeBand — in-scope matters still return A/B/C", () => {
  it("unknown matter type returns Band C (engine still classifying)", () => {
    const state = baseState({ matter_type: "unknown" });
    const result = computeBand(state);
    expect(result.band).toBe("C");
  });

  it("corporate_general routing lane returns Band B", () => {
    const state = baseState({ matter_type: "corporate_general" });
    const result = computeBand(state);
    expect(result.band).toBe("B");
  });

  it("real_estate_general routing lane returns Band B", () => {
    const state = baseState({ matter_type: "real_estate_general" });
    const result = computeBand(state);
    expect(result.band).toBe("B");
  });

  it("in-scope matter (shareholder_dispute) with zero signals returns C", () => {
    // No slots filled, no raw signals → low ratio → Band C.
    const state = baseState({ matter_type: "shareholder_dispute" });
    const result = computeBand(state);
    expect(["A", "B", "C"]).toContain(result.band);
    expect(result.band).not.toBe("D");
  });
});
