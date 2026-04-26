/**
 * slot-selector.test.ts
 *
 * Coverage:
 *   getSlotById                   -  registry lookup (2 tests)
 *   selectSlots                   -  round limits, dependency, ordering, exclusion (23 tests)
 *   selectSlots                   -  universal slot behaviour (9 tests)
 *   selectSlots / scoring         -  crim_indictable_sc bank (23 tests)
 *   selectSlots / scoring         -  civ_contract_dispute bank (19 tests)
 *   selectSlots / scoring         -  fam_separation bank (24 tests)
 *   selectSlots / scoring         -  div_tribunal_review bank (21 tests)
 *   selectSlots / scoring         -  pi_mva bank (20 tests)
 *   selectSlots / scoring         -  emp_dismissal bank (20 tests)
 *   scoreFromSlotAnswers          -  delta accumulation, multi-select, edge cases (11 tests)
 *   scoreFromSlotAnswers          -  universal slot scoring (2 tests)
 *   shouldTriggerRound3           -  trigger detection (7 tests)
 *   computeJordanUrgency          -  Jordan s.11(b) delay clock (15 tests)
 *
 * Total: 196 tests
 */

import { describe, it, expect } from "vitest";
import {
  getSlotById,
  selectSlots,
  scoreFromSlotAnswers,
  shouldTriggerRound3,
  computeJordanUrgency,
} from "../slot-selector";

// ─────────────────────────────────────────────────────────────────────────────
// getSlotById
// ─────────────────────────────────────────────────────────────────────────────

describe("getSlotById", () => {
  it("returns the slot for a known ID", () => {
    const slot = getSlotById("pi_slip_fall__location_type");
    expect(slot).toBeDefined();
    expect(slot!.id).toBe("pi_slip_fall__location_type");
    expect(slot!.subType).toBe("pi_slip_fall");
    expect(slot!.round).toBe(1);
  });

  it("returns undefined for an unknown ID", () => {
    expect(getSlotById("does_not_exist__xyz")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// selectSlots  -  round filtering
// ─────────────────────────────────────────────────────────────────────────────

describe("selectSlots  -  round filtering", () => {
  const noAnswers: Record<string, string> = {};

  it("returns only round 1 slots when round=1", () => {
    const slots = selectSlots("pi_slip_fall", noAnswers, 1);
    expect(slots.every(s => s.round === 1)).toBe(true);
  });

  it("returns only round 2 slots when round=2", () => {
    const slots = selectSlots("pi_slip_fall", noAnswers, 2);
    expect(slots.every(s => s.round === 2)).toBe(true);
  });

  it("returns only round 3 slots when round=3", () => {
    const slots = selectSlots("pi_slip_fall", noAnswers, 3);
    expect(slots.every(s => s.round === 3)).toBe(true);
  });

  it("caps round 1 at 6 slots", () => {
    const slots = selectSlots("pi_slip_fall", noAnswers, 1);
    expect(slots.length).toBeLessThanOrEqual(6);
  });

  it("round 1 returns exactly 6 slots when bank has ≥6 round-1 slots", () => {
    // pi_slip_fall has exactly 6 round-1 slots
    const slots = selectSlots("pi_slip_fall", noAnswers, 1);
    expect(slots.length).toBe(6);
  });

  it("caps round 2 at 5 slots (unconditional candidates)", () => {
    // When no round-2 deps have been satisfied, unconditional round-2 slots cap at 5.
    // pi_slip_fall has 9 round-2 slots; the conditional one (warning_sign) is excluded
    // because hazard_type has not been answered yet, leaving 8 candidates → top 5.
    const slots = selectSlots("pi_slip_fall", noAnswers, 2);
    expect(slots.length).toBeLessThanOrEqual(5);
    expect(slots.length).toBe(5);
  });

  it("returns all round 3 slots without a cap", () => {
    // pi_slip_fall has 5 round-3 slots; 2 are conditional (lost_income_amount depends
    // on lost_income=yes). With noAnswers, lost_income_amount is excluded → 4 returned.
    const slots = selectSlots("pi_slip_fall", noAnswers, 3);
    // Should return all unconditional round-3 slots (no arbitrary cap)
    expect(slots.length).toBe(4);
  });

  it("returns only universal slots for an unknown sub-type (no sub-type bank exists)", () => {
    const slots = selectSlots("unknown_subtype", noAnswers, 1);
    // Universal slots always fire; sub-type bank is empty → only universal slots returned.
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every(s => s.subType === "universal")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// selectSlots  -  already-answered exclusion
// ─────────────────────────────────────────────────────────────────────────────

describe("selectSlots  -  answered exclusion", () => {
  it("excludes a slot that has already been answered", () => {
    const answered = { "pi_slip_fall__location_type": "retail_store" };
    const slots = selectSlots("pi_slip_fall", answered, 1);
    const ids = slots.map(s => s.id);
    expect(ids).not.toContain("pi_slip_fall__location_type");
  });

  it("total count stays at 6 when one sub-type round-1 slot is pre-answered (6th sub-type slot fills in)", () => {
    // pi_slip_fall has 6 R1 sub-type slots. Universal consumes 1 cap unit → 5 sub-type slots served.
    // When one sub-type slot is answered, the 6th sub-type slot fills the freed position.
    const answered = { "pi_slip_fall__location_type": "retail_store" };
    const base = selectSlots("pi_slip_fall", {}, 1);
    const withAnswered = selectSlots("pi_slip_fall", answered, 1);
    expect(withAnswered.length).toBe(base.length);
  });

  it("returns empty when all round-1 slots (including universal) are pre-answered", () => {
    const answered: Record<string, string> = {
      "universal__court_centre":        "toronto",        // universal slot
      "pi_slip_fall__location_type":    "retail_store",
      "pi_slip_fall__incident_date":    "last_30_days",
      "pi_slip_fall__injury_status":    "yes_ongoing",
      "pi_slip_fall__medical_attention":"yes_same_day",
      "pi_slip_fall__reported_to_owner":"yes",
      "pi_slip_fall__evidence":         "photos",
    };
    expect(selectSlots("pi_slip_fall", answered, 1)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// selectSlots  -  priority ordering
// ─────────────────────────────────────────────────────────────────────────────

describe("selectSlots  -  priority ordering", () => {
  it("returns slots sorted descending by priorityWeight", () => {
    const slots = selectSlots("pi_slip_fall", {}, 1);
    for (let i = 0; i < slots.length - 1; i++) {
      expect(slots[i].priorityWeight).toBeGreaterThanOrEqual(slots[i + 1].priorityWeight);
    }
  });

  it("universal slot is first in round 1 (served before sub-type slots regardless of weight)", () => {
    const slots = selectSlots("pi_slip_fall", {}, 1);
    expect(slots[0].id).toBe("universal__court_centre");
  });

  it("highest-weight sub-type slot is first among sub-type slots in round 1", () => {
    const slots = selectSlots("pi_slip_fall", {}, 1);
    const subTypeSlots = slots.filter(s => s.subType !== "universal");
    // location_type has priorityWeight 100  -  highest pi_slip_fall R1 slot
    expect(subTypeSlots[0].id).toBe("pi_slip_fall__location_type");
  });

  it("highest-weight slot is first in round 2", () => {
    const slots = selectSlots("pi_slip_fall", {}, 2);
    // hazard_type has priorityWeight 100  -  highest in round 2
    expect(slots[0].id).toBe("pi_slip_fall__hazard_type");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// selectSlots  -  dependency satisfaction
// ─────────────────────────────────────────────────────────────────────────────

describe("selectSlots  -  dependency filtering", () => {
  // pi_slip_fall__warning_sign depends on hazard_type = ["wet_floor_no_sign", "wet_floor_with_sign"]

  it("excludes a conditional slot when its dependency slot is unanswered", () => {
    const slots = selectSlots("pi_slip_fall", {}, 2);
    const ids = slots.map(s => s.id);
    expect(ids).not.toContain("pi_slip_fall__warning_sign");
  });

  it("includes a conditional slot when the dependency is satisfied (matching value)", () => {
    // Pre-answer the 4 higher-weight round-2 slots so warning_sign (weight 60)
    // enters the top-5 window. Round-2 cap is 5; with 4 slots gone, the 4
    // remaining unconditional slots + warning_sign = 5 candidates, all returned.
    const answered: Record<string, string> = {
      "pi_slip_fall__hazard_type":    "wet_floor_no_sign", // dep slot  -  answered
      "pi_slip_fall__owner_knew":     "not_sure",          // weight 90  -  remove
      "pi_slip_fall__injury_severity":"minor",             // weight 85  -  remove
      "pi_slip_fall__missed_work":    "no",                // weight 80  -  remove
      "pi_slip_fall__treatment_ongoing": "no",             // weight 75  -  remove
    };
    const slots = selectSlots("pi_slip_fall", answered, 2);
    const ids = slots.map(s => s.id);
    expect(ids).toContain("pi_slip_fall__warning_sign");
  });

  it("includes a conditional slot when the dependency matches the second allowed value", () => {
    const answered: Record<string, string> = {
      "pi_slip_fall__hazard_type":       "wet_floor_with_sign",
      "pi_slip_fall__owner_knew":        "not_sure",
      "pi_slip_fall__injury_severity":   "minor",
      "pi_slip_fall__missed_work":       "no",
      "pi_slip_fall__treatment_ongoing": "no",
    };
    const slots = selectSlots("pi_slip_fall", answered, 2);
    const ids = slots.map(s => s.id);
    expect(ids).toContain("pi_slip_fall__warning_sign");
  });

  it("excludes a conditional slot when the dependency has a non-matching value", () => {
    const answered = { "pi_slip_fall__hazard_type": "broken_surface" };
    const slots = selectSlots("pi_slip_fall", answered, 2);
    const ids = slots.map(s => s.id);
    expect(ids).not.toContain("pi_slip_fall__warning_sign");
  });

  it("satisfies dependency from a multi_select answer when any element matches", () => {
    // Simulating multi_select answer that includes a matching value.
    // Also pre-answer higher-weight slots so warning_sign enters the top-5 cap.
    const answered: Record<string, string | string[]> = {
      "pi_slip_fall__hazard_type":       ["broken_surface", "wet_floor_no_sign"],
      "pi_slip_fall__owner_knew":        "not_sure",
      "pi_slip_fall__injury_severity":   "minor",
      "pi_slip_fall__missed_work":       "no",
      "pi_slip_fall__treatment_ongoing": "no",
    };
    const slots = selectSlots("pi_slip_fall", answered, 2);
    const ids = slots.map(s => s.id);
    expect(ids).toContain("pi_slip_fall__warning_sign");
  });

  it("excludes conditional slot when multi_select answer has no matching element", () => {
    const answered: Record<string, string | string[]> = {
      "pi_slip_fall__hazard_type": ["broken_surface", "poor_lighting"],
    };
    const slots = selectSlots("pi_slip_fall", answered, 2);
    const ids = slots.map(s => s.id);
    expect(ids).not.toContain("pi_slip_fall__warning_sign");
  });

  it("includes round-3 conditional slot (lost_income_amount) when lost_income=yes", () => {
    const answered = { "pi_slip_fall__lost_income": "yes" };
    const slots = selectSlots("pi_slip_fall", answered, 3);
    const ids = slots.map(s => s.id);
    expect(ids).toContain("pi_slip_fall__lost_income_amount");
  });

  it("excludes round-3 conditional slot (lost_income_amount) when lost_income=no", () => {
    const answered = { "pi_slip_fall__lost_income": "no" };
    const slots = selectSlots("pi_slip_fall", answered, 3);
    const ids = slots.map(s => s.id);
    expect(ids).not.toContain("pi_slip_fall__lost_income_amount");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scoreFromSlotAnswers
// ─────────────────────────────────────────────────────────────────────────────

describe("scoreFromSlotAnswers", () => {
  it("returns zeros for empty answers", () => {
    expect(scoreFromSlotAnswers({})).toEqual({ fit: 0, urgency: 0, friction: 0 });
  });

  it("applies fitDelta from a single_select answer", () => {
    const { fit } = scoreFromSlotAnswers({
      "pi_slip_fall__location_type": "retail_store", // fitDelta: 15
    });
    expect(fit).toBe(15);
  });

  it("applies urgencyDelta from city_property answer", () => {
    const { urgency } = scoreFromSlotAnswers({
      "pi_slip_fall__location_type": "city_property", // urgencyDelta: 20
    });
    expect(urgency).toBe(20);
  });

  it("applies frictionDelta from workplace answer", () => {
    const { friction } = scoreFromSlotAnswers({
      "pi_slip_fall__location_type": "workplace", // frictionDelta: 15
    });
    expect(friction).toBe(15);
  });

  it("applies negative fitDelta from no_injury answer", () => {
    const { fit } = scoreFromSlotAnswers({
      "pi_slip_fall__injury_status": "no_injury", // fitDelta: -25
    });
    expect(fit).toBe(-25);
  });

  it("accumulates deltas across multiple answered slots", () => {
    const { fit, urgency, friction } = scoreFromSlotAnswers({
      "pi_slip_fall__location_type":    "retail_store",   // fit+15
      "pi_slip_fall__injury_status":    "yes_ongoing",    // fit+25, urgency+10
      "pi_slip_fall__medical_attention": "yes_same_day",  // fit+20, urgency+10
    });
    expect(fit).toBe(60);
    expect(urgency).toBe(20);
    expect(friction).toBe(0);
  });

  it("scores all selected values from a multi_select answer", () => {
    // evidence: photos(fit+15), incident_report(fit+15), medical_records(fit+15)
    const { fit } = scoreFromSlotAnswers({
      "pi_slip_fall__evidence": ["photos", "incident_report", "medical_records"],
    });
    expect(fit).toBe(45);
  });

  it("ignores unknown slot IDs silently", () => {
    const result = scoreFromSlotAnswers({
      "non_existent__slot": "some_value",
    });
    expect(result).toEqual({ fit: 0, urgency: 0, friction: 0 });
  });

  it("ignores unknown option values silently", () => {
    const result = scoreFromSlotAnswers({
      "pi_slip_fall__location_type": "moon_base", // not a real option
    });
    expect(result).toEqual({ fit: 0, urgency: 0, friction: 0 });
  });

  it("handles yes_no slots correctly", () => {
    const { friction } = scoreFromSlotAnswers({
      "pi_slip_fall__reported_to_owner": "no", // frictionDelta: 10
    });
    expect(friction).toBe(10);
  });

  it("produces correct total across a realistic round-1 answer set", () => {
    // location_type: retail_store   → fit+15
    // incident_date: last_7_days    → fit+5, urgency+25
    // injury_status: yes_ongoing    → fit+25, urgency+10
    // medical_attention: yes_same_day → fit+20, urgency+10
    // reported_to_owner: yes        → fit+10
    // evidence: ["photos", "witness"] → fit+15+10 = +25
    const { fit, urgency, friction } = scoreFromSlotAnswers({
      "pi_slip_fall__location_type":     "retail_store",
      "pi_slip_fall__incident_date":     "last_7_days",
      "pi_slip_fall__injury_status":     "yes_ongoing",
      "pi_slip_fall__medical_attention": "yes_same_day",
      "pi_slip_fall__reported_to_owner": "yes",
      "pi_slip_fall__evidence":          ["photos", "witness"],
    });
    expect(fit).toBe(100);
    expect(urgency).toBe(45);
    expect(friction).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// shouldTriggerRound3
// ─────────────────────────────────────────────────────────────────────────────

describe("shouldTriggerRound3", () => {
  it("returns false for empty answers", () => {
    expect(shouldTriggerRound3({})).toBe(false);
  });

  it("returns false when no answered option has triggersRound3", () => {
    const answers = {
      "pi_slip_fall__location_type": "retail_store", // no triggersRound3
      "pi_slip_fall__reported_to_owner": "yes",       // no triggersRound3
    };
    expect(shouldTriggerRound3(answers)).toBe(false);
  });

  it("returns true when injury_status=yes_ongoing (has triggersRound3: true)", () => {
    expect(shouldTriggerRound3({
      "pi_slip_fall__injury_status": "yes_ongoing",
    })).toBe(true);
  });

  it("returns false when injury_status=yes_recovered (no triggersRound3)", () => {
    expect(shouldTriggerRound3({
      "pi_slip_fall__injury_status": "yes_recovered",
    })).toBe(false);
  });

  it("returns true when medical_attention=yes_same_day (has triggersRound3)", () => {
    expect(shouldTriggerRound3({
      "pi_slip_fall__medical_attention": "yes_same_day",
    })).toBe(true);
  });

  it("returns true when injury_severity=severe is selected from a multi_select answer", () => {
    // Simulating a scenario where multi_select includes a triggering value
    expect(shouldTriggerRound3({
      "pi_slip_fall__injury_severity": ["severe", "moderate"],
    })).toBe(true);
  });

  it("returns true when any one slot in a mixed set triggers Round 3", () => {
    expect(shouldTriggerRound3({
      "pi_slip_fall__location_type":    "retail_store",   // no trigger
      "pi_slip_fall__reported_to_owner":"no",             // no trigger
      "pi_slip_fall__injury_status":    "yes_ongoing",    // triggers!
    })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Universal slot behaviour (court_centre  -  KB-17)
// ─────────────────────────────────────────────────────────────────────────────

describe("selectSlots  -  universal slot behaviour", () => {
  it("universal__court_centre appears in round 1 results for pi_slip_fall", () => {
    const slots = selectSlots("pi_slip_fall", {}, 1);
    const ids = slots.map(s => s.id);
    expect(ids).toContain("universal__court_centre");
  });

  it("universal__court_centre is the first slot returned (served before sub-type slots)", () => {
    const slots = selectSlots("pi_slip_fall", {}, 1);
    expect(slots[0].id).toBe("universal__court_centre");
  });

  it("round 1 total count is still capped at 6 (universal + sub-type combined)", () => {
    const slots = selectSlots("pi_slip_fall", {}, 1);
    expect(slots.length).toBeLessThanOrEqual(6);
  });

  it("sub-type slots fill remaining capacity after universal slot (5 sub-type + 1 universal = 6)", () => {
    const slots = selectSlots("pi_slip_fall", {}, 1);
    const subTypeSlots = slots.filter(s => s.subType !== "universal");
    expect(subTypeSlots.length).toBe(5);
  });

  it("universal__court_centre is excluded from round 1 when already answered", () => {
    const answered = { "universal__court_centre": "toronto" };
    const slots = selectSlots("pi_slip_fall", answered, 1);
    const ids = slots.map(s => s.id);
    expect(ids).not.toContain("universal__court_centre");
  });

  it("when court_centre is answered, round 1 serves 6 sub-type slots (universal no longer consumes budget)", () => {
    const answered = { "universal__court_centre": "toronto" };
    const slots = selectSlots("pi_slip_fall", answered, 1);
    expect(slots.length).toBe(6);
    expect(slots.every(s => s.subType === "pi_slip_fall")).toBe(true);
  });

  it("universal__court_centre does NOT appear in round 2 (it is a round-1 slot)", () => {
    const slots = selectSlots("pi_slip_fall", {}, 2);
    const ids = slots.map(s => s.id);
    expect(ids).not.toContain("universal__court_centre");
  });

  it("unknown sub-type still receives universal__court_centre in round 1", () => {
    const slots = selectSlots("unknown_sub_type", {}, 1);
    const ids = slots.map(s => s.id);
    expect(ids).toContain("universal__court_centre");
  });

  it("universal slot with no sub-type bank returns only universal slots in round 1", () => {
    const slots = selectSlots("unknown_sub_type", {}, 1);
    // All returned slots must be universal (no sub-type bank for unknown_sub_type)
    expect(slots.every(s => s.subType === "universal")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// crim_indictable_sc bank
// ─────────────────────────────────────────────────────────────────────────────

describe("crim_indictable_sc  -  slot bank structure", () => {
  it("has exactly 6 round-1 slots", () => {
    const slots = selectSlots("crim_indictable_sc", {}, 1);
    const subType = slots.filter(s => s.subType === "crim_indictable_sc");
    expect(subType.length).toBe(5); // 6 R1 cap − 1 universal = 5 sub-type
  });

  it("round-2 returns 5 slots (ROUND_2_LIMIT cap applies; adjournment_count excluded  -  charge_date not answered)", () => {
    const answered = { "universal__court_centre": "toronto" };
    const slots = selectSlots("crim_indictable_sc", answered, 2);
    // 7 unconditional R2 candidates, cap is 5  -  top 5 by priorityWeight returned.
    // adjournment_count (weight 60) is also excluded because charge_date unanswered.
    expect(slots.length).toBe(5);
  });

  it("has exactly 4 round-3 slots", () => {
    const answered = { "universal__court_centre": "toronto" };
    const slots = selectSlots("crim_indictable_sc", answered, 3);
    expect(slots.length).toBe(4);
  });

  it("charge_category is the first sub-type slot in round 1 (highest priorityWeight = 100)", () => {
    const slots = selectSlots("crim_indictable_sc", {}, 1);
    const subType = slots.filter(s => s.subType === "crim_indictable_sc");
    expect(subType[0].id).toBe("crim_indictable_sc__charge_category");
  });

  it("disclosure_status is first in round 2 (priorityWeight 95)", () => {
    const slots = selectSlots("crim_indictable_sc", {}, 2);
    expect(slots[0].id).toBe("crim_indictable_sc__disclosure_status");
  });

  it("sentence_exposure is first in round 3 (priorityWeight 90)", () => {
    const answered = { "universal__court_centre": "toronto" };
    const slots = selectSlots("crim_indictable_sc", answered, 3);
    expect(slots[0].id).toBe("crim_indictable_sc__sentence_exposure");
  });
});

describe("crim_indictable_sc  -  adjournment_count dependency", () => {
  // adjournment_count has priorityWeight 60  -  lowest R2 slot.
  // With 7 unconditional R2 candidates and a cap of 5, it cannot enter the window
  // unless 4 higher-weight slots are pre-answered.
  // Pre-answer disclosure_status (95), crown_resolution (90), trial_election (85),
  // prelim_inquiry (80) to reduce the pool to 4 candidates (co_accused 75,
  // victim_named 70, weapons_involved 65, adjournment_count 60 if dep satisfied).
  const highWeightAnswered = {
    "crim_indictable_sc__disclosure_status": "received_reviewed",
    "crim_indictable_sc__crown_resolution":  "no_offer",
    "crim_indictable_sc__trial_election":    "not_yet",
    "crim_indictable_sc__prelim_inquiry":    "not_eligible",
  };

  it("adjournment_count excluded when charge_date is under_6_months (dep not satisfied)", () => {
    const answered = {
      ...highWeightAnswered,
      "crim_indictable_sc__charge_date": "under_6_months",
    };
    const slots = selectSlots("crim_indictable_sc", answered, 2);
    const ids = slots.map(s => s.id);
    expect(ids).not.toContain("crim_indictable_sc__adjournment_count");
  });

  it("adjournment_count excluded when charge_date is 6_12_months (below dep threshold)", () => {
    const answered = {
      ...highWeightAnswered,
      "crim_indictable_sc__charge_date": "6_12_months",
    };
    const slots = selectSlots("crim_indictable_sc", answered, 2);
    const ids = slots.map(s => s.id);
    expect(ids).not.toContain("crim_indictable_sc__adjournment_count");
  });

  it("adjournment_count included when charge_date is 12_18_months (dep satisfied)", () => {
    const answered = {
      ...highWeightAnswered,
      "crim_indictable_sc__charge_date": "12_18_months",
    };
    const slots = selectSlots("crim_indictable_sc", answered, 2);
    const ids = slots.map(s => s.id);
    expect(ids).toContain("crim_indictable_sc__adjournment_count");
  });

  it("adjournment_count included when charge_date is 18_30_months", () => {
    const answered = {
      ...highWeightAnswered,
      "crim_indictable_sc__charge_date": "18_30_months",
    };
    const slots = selectSlots("crim_indictable_sc", answered, 2);
    const ids = slots.map(s => s.id);
    expect(ids).toContain("crim_indictable_sc__adjournment_count");
  });

  it("adjournment_count included when charge_date is over_30_months", () => {
    const answered = {
      ...highWeightAnswered,
      "crim_indictable_sc__charge_date": "over_30_months",
    };
    const slots = selectSlots("crim_indictable_sc", answered, 2);
    const ids = slots.map(s => s.id);
    expect(ids).toContain("crim_indictable_sc__adjournment_count");
  });
});

describe("crim_indictable_sc  -  triggersRound3 options", () => {
  it("custody_status=in_custody triggers Round 3", () => {
    expect(shouldTriggerRound3({
      "crim_indictable_sc__custody_status": "in_custody",
    })).toBe(true);
  });

  it("charge_date=18_30_months triggers Round 3 (approaching Jordan ceiling)", () => {
    expect(shouldTriggerRound3({
      "crim_indictable_sc__charge_date": "18_30_months",
    })).toBe(true);
  });

  it("charge_date=over_30_months triggers Round 3 (past Superior Court ceiling)", () => {
    expect(shouldTriggerRound3({
      "crim_indictable_sc__charge_date": "over_30_months",
    })).toBe(true);
  });

  it("trial_date=yes_within_3_months triggers Round 3", () => {
    expect(shouldTriggerRound3({
      "crim_indictable_sc__trial_date": "yes_within_3_months",
    })).toBe(true);
  });

  it("charge_category=homicide triggers Round 3", () => {
    expect(shouldTriggerRound3({
      "crim_indictable_sc__charge_category": "homicide",
    })).toBe(true);
  });

  it("adjournment_count=over_8 triggers Round 3", () => {
    expect(shouldTriggerRound3({
      "crim_indictable_sc__adjournment_count": "over_8",
    })).toBe(true);
  });

  it("charge_date=under_6_months does NOT trigger Round 3", () => {
    expect(shouldTriggerRound3({
      "crim_indictable_sc__charge_date": "under_6_months",
    })).toBe(false);
  });
});

describe("crim_indictable_sc  -  scoring deltas", () => {
  it("in_custody produces high urgency delta (40)", () => {
    const delta = scoreFromSlotAnswers({
      "crim_indictable_sc__custody_status": "in_custody",
    });
    expect(delta.urgency).toBe(40);
  });

  it("over_30_months charge produces highest urgency delta (45)", () => {
    const delta = scoreFromSlotAnswers({
      "crim_indictable_sc__charge_date": "over_30_months",
    });
    expect(delta.urgency).toBe(45);
  });

  it("serious_record produces highest friction delta (35)", () => {
    const delta = scoreFromSlotAnswers({
      "crim_indictable_sc__prior_record": "serious_record",
    });
    expect(delta.friction).toBe(35);
  });

  it("homicide charge produces highest fit delta (30)", () => {
    const delta = scoreFromSlotAnswers({
      "crim_indictable_sc__charge_category": "homicide",
    });
    expect(delta.fit).toBe(30);
  });

  it("accumultes correctly across multiple crim slots", () => {
    const delta = scoreFromSlotAnswers({
      "crim_indictable_sc__custody_status": "in_custody",    // fit+15, urg+40
      "crim_indictable_sc__charge_date":    "18_30_months",  // fit+5,  urg+35, fric+10
      "crim_indictable_sc__prior_record":   "none",          // fit+15, urg+0,  fric+0
    });
    expect(delta.fit).toBe(35);
    expect(delta.urgency).toBe(75);
    expect(delta.friction).toBe(10);
  });
});

describe("scoreFromSlotAnswers  -  universal slot scoring", () => {
  it("court_centre=toronto produces zero deltas (neutral routing signal)", () => {
    const delta = scoreFromSlotAnswers({ "universal__court_centre": "toronto" });
    expect(delta.fit).toBe(0);
    expect(delta.urgency).toBe(0);
    expect(delta.friction).toBe(0);
  });

  it("court_centre=outside_ontario produces negative fit and high friction", () => {
    const delta = scoreFromSlotAnswers({ "universal__court_centre": "outside_ontario" });
    expect(delta.fit).toBe(-30);
    expect(delta.friction).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// civ_contract_dispute bank
// ─────────────────────────────────────────────────────────────────────────────

describe("civ_contract_dispute  -  slot bank structure", () => {
  it("round 1 returns 6 slots total (1 universal + 5 sub-type)", () => {
    const slots = selectSlots("civ_contract_dispute", {}, 1);
    expect(slots.length).toBe(6);
    const subType = slots.filter(s => s.subType === "civ_contract_dispute");
    expect(subType.length).toBe(5);
  });

  it("round-2 returns 5 slots (ROUND_2_LIMIT cap; interest_period excluded  -  breach_date unanswered, related_parties cut by cap)", () => {
    // 8 R2 slots: 7 unconditional (interest_period excluded  -  dep unsatisfied), cap 5.
    // Top 5 by weight: evidence_strength(95), counterclaim_risk(90), performance_dispute(85),
    // amount_agreed(80), defendant_served(75). mediation_status(70) and related_parties(60) cut.
    const answered = { "universal__court_centre": "toronto" };
    const slots = selectSlots("civ_contract_dispute", answered, 2);
    expect(slots.length).toBe(5);
  });

  it("has exactly 4 round-3 slots (no cap)", () => {
    const answered = { "universal__court_centre": "toronto" };
    const slots = selectSlots("civ_contract_dispute", answered, 3);
    expect(slots.length).toBe(4);
  });

  it("claim_amount is first sub-type slot in round 1 (priorityWeight 100)", () => {
    const slots = selectSlots("civ_contract_dispute", {}, 1);
    const subType = slots.filter(s => s.subType === "civ_contract_dispute");
    expect(subType[0].id).toBe("civ_contract_dispute__claim_amount");
  });

  it("evidence_strength is first in round 2 (priorityWeight 95)", () => {
    const slots = selectSlots("civ_contract_dispute", {}, 2);
    expect(slots[0].id).toBe("civ_contract_dispute__evidence_strength");
  });
});

describe("civ_contract_dispute  -  interest_period dependency", () => {
  // interest_period (priorityWeight 65) depends on breach_date ∈ {12_18_months, 18_24_months, over_2_years}.
  // To bring it into the cap window, pre-answer the 5 higher-weight unconditional R2 slots
  // (95/90/85/80/75) so only mediation_status(70), interest_period(65), related_parties(60)
  // remain  -  all 3 fit within the cap of 5.
  const highWeightAnswered: Record<string, string> = {
    "civ_contract_dispute__evidence_strength":   "strong",
    "civ_contract_dispute__counterclaim_risk":   "low_risk",
    "civ_contract_dispute__performance_dispute": "no",
    "civ_contract_dispute__amount_agreed":       "amount_agreed",
    "civ_contract_dispute__defendant_served":    "claim_not_issued",
  };

  it("interest_period excluded when breach_date is unanswered", () => {
    const slots = selectSlots("civ_contract_dispute", {}, 2);
    const ids = slots.map(s => s.id);
    expect(ids).not.toContain("civ_contract_dispute__interest_period");
  });

  it("interest_period excluded when breach_date=under_6_months (value not in dep list)", () => {
    const answered: Record<string, string> = {
      ...highWeightAnswered,
      "civ_contract_dispute__breach_date": "under_6_months",
    };
    const slots = selectSlots("civ_contract_dispute", answered, 2);
    const ids = slots.map(s => s.id);
    expect(ids).not.toContain("civ_contract_dispute__interest_period");
  });

  it("interest_period included when breach_date=12_18_months (dep satisfied)", () => {
    const answered: Record<string, string> = {
      ...highWeightAnswered,
      "civ_contract_dispute__breach_date": "12_18_months",
    };
    const slots = selectSlots("civ_contract_dispute", answered, 2);
    const ids = slots.map(s => s.id);
    expect(ids).toContain("civ_contract_dispute__interest_period");
  });

  it("interest_period included when breach_date=18_24_months (dep satisfied)", () => {
    const answered: Record<string, string> = {
      ...highWeightAnswered,
      "civ_contract_dispute__breach_date": "18_24_months",
    };
    const slots = selectSlots("civ_contract_dispute", answered, 2);
    const ids = slots.map(s => s.id);
    expect(ids).toContain("civ_contract_dispute__interest_period");
  });
});

describe("civ_contract_dispute  -  triggersRound3 options", () => {
  it("claim_amount=100k_500k triggers Round 3", () => {
    expect(shouldTriggerRound3({
      "civ_contract_dispute__claim_amount": "100k_500k",
    })).toBe(true);
  });

  it("claim_amount=over_500k triggers Round 3", () => {
    expect(shouldTriggerRound3({
      "civ_contract_dispute__claim_amount": "over_500k",
    })).toBe(true);
  });

  it("breach_date=18_24_months triggers Round 3 (approaching 2-year limitation window)", () => {
    expect(shouldTriggerRound3({
      "civ_contract_dispute__breach_date": "18_24_months",
    })).toBe(true);
  });

  it("claim_amount=35k_100k does NOT trigger Round 3 (Superior Court threshold met, no urgency signal)", () => {
    expect(shouldTriggerRound3({
      "civ_contract_dispute__claim_amount": "35k_100k",
    })).toBe(false);
  });
});

describe("civ_contract_dispute  -  scoring deltas", () => {
  it("claim_amount=under_10k produces negative fitDelta (-25) and high frictionDelta (30)  -  Small Claims gate", () => {
    const delta = scoreFromSlotAnswers({
      "civ_contract_dispute__claim_amount": "under_10k",
    });
    expect(delta.fit).toBe(-25);
    expect(delta.friction).toBe(30);
  });

  it("claim_amount=10k_35k produces negative fitDelta (-15) and moderate frictionDelta (20)", () => {
    const delta = scoreFromSlotAnswers({
      "civ_contract_dispute__claim_amount": "10k_35k",
    });
    expect(delta.fit).toBe(-15);
    expect(delta.friction).toBe(20);
  });

  it("defendant_solvency=company_dissolved produces highest frictionDelta (40)", () => {
    const delta = scoreFromSlotAnswers({
      "civ_contract_dispute__defendant_solvency": "company_dissolved",
    });
    expect(delta.friction).toBe(40);
  });

  it("breach_date=over_2_years produces negative fitDelta (-20) and highest frictionDelta (35)", () => {
    const delta = scoreFromSlotAnswers({
      "civ_contract_dispute__breach_date": "over_2_years",
    });
    expect(delta.fit).toBe(-20);
    expect(delta.urgency).toBe(30);
    expect(delta.friction).toBe(35);
  });

  it("accumulates correctly across multiple civ_contract_dispute slots", () => {
    // claim_amount=100k_500k  → fit+25, urg+0,  fric+0
    // contract_form=signed_written → fit+20, urg+0,  fric+0
    // defendant_solvency=likely_solvent → fit+20, urg+0,  fric+0
    const delta = scoreFromSlotAnswers({
      "civ_contract_dispute__claim_amount":       "100k_500k",
      "civ_contract_dispute__contract_form":      "signed_written",
      "civ_contract_dispute__defendant_solvency": "likely_solvent",
    });
    expect(delta.fit).toBe(65);
    expect(delta.urgency).toBe(0);
    expect(delta.friction).toBe(0);
  });

  it("demand_sent=yes_no_response produces urgencyDelta (15)  -  unanswered demand signal", () => {
    const delta = scoreFromSlotAnswers({
      "civ_contract_dispute__demand_sent": "yes_no_response",
    });
    expect(delta.fit).toBe(15);
    expect(delta.urgency).toBe(15);
    expect(delta.friction).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fam_separation bank
// ─────────────────────────────────────────────────────────────────────────────

describe("fam_separation  -  slot bank structure", () => {
  it("round 1 returns 6 slots total (1 universal + 5 sub-type)", () => {
    const slots = selectSlots("fam_separation", {}, 1);
    expect(slots.length).toBe(6);
    const subType = slots.filter(s => s.subType === "fam_separation");
    expect(subType.length).toBe(5);
  });

  it("round-2 returns 5 slots (ROUND_2_LIMIT cap; custody_arrangement excluded  -  children_involved unanswered; urgency_driver excluded  -  proceedings_started unanswered)", () => {
    // 8 R2 slots: custody_arrangement (dep: children_involved) and urgency_driver (dep: proceedings_started)
    // both excluded → 6 unconditional R2 candidates, cap 5 → top 5 returned.
    const answered = { "universal__court_centre": "toronto" };
    const slots = selectSlots("fam_separation", answered, 2);
    expect(slots.length).toBe(5);
  });

  it("has exactly 4 round-3 slots (no cap)", () => {
    const answered = { "universal__court_centre": "toronto" };
    const slots = selectSlots("fam_separation", answered, 3);
    expect(slots.length).toBe(4);
  });

  it("relationship_status is first sub-type slot in round 1 (priorityWeight 100)", () => {
    const slots = selectSlots("fam_separation", {}, 1);
    const subType = slots.filter(s => s.subType === "fam_separation");
    expect(subType[0].id).toBe("fam_separation__relationship_status");
  });

  it("custody_arrangement is first in round 2 (priorityWeight 95) when children_involved=yes", () => {
    const answered = { "fam_separation__children_involved": "yes" };
    const slots = selectSlots("fam_separation", answered, 2);
    expect(slots[0].id).toBe("fam_separation__custody_arrangement");
  });
});

describe("fam_separation  -  custody_arrangement dependency", () => {
  it("custody_arrangement excluded when children_involved is unanswered", () => {
    const slots = selectSlots("fam_separation", {}, 2);
    const ids = slots.map(s => s.id);
    expect(ids).not.toContain("fam_separation__custody_arrangement");
  });

  it("custody_arrangement excluded when children_involved=no", () => {
    const slots = selectSlots("fam_separation", { "fam_separation__children_involved": "no" }, 2);
    const ids = slots.map(s => s.id);
    expect(ids).not.toContain("fam_separation__custody_arrangement");
  });

  it("custody_arrangement included when children_involved=yes (dep satisfied)", () => {
    const slots = selectSlots("fam_separation", { "fam_separation__children_involved": "yes" }, 2);
    const ids = slots.map(s => s.id);
    expect(ids).toContain("fam_separation__custody_arrangement");
  });
});

describe("fam_separation  -  urgency_driver dependency", () => {
  // urgency_driver has priorityWeight 60  -  lowest R2 slot.
  // Pre-answer the 5 higher-weight unconditional R2 slots (90/85/80/75/70)
  // so only pension_or_business (65) and urgency_driver (60, if dep satisfied) remain.
  const highWeightAnswered: Record<string, string> = {
    "fam_separation__property_assets":              "home_and_accounts",
    "fam_separation__support_status":               "none_financially_stable",
    "fam_separation__separation_agreement_status":  "none_want_agreement",
    "fam_separation__dv_history":                   "no_history",
    "fam_separation__income_disparity":             "moderate_gap",
  };

  it("urgency_driver excluded when proceedings_started is unanswered", () => {
    const slots = selectSlots("fam_separation", {}, 2);
    const ids = slots.map(s => s.id);
    expect(ids).not.toContain("fam_separation__urgency_driver");
  });

  it("urgency_driver excluded when proceedings_started=no_not_yet (value not in dep list)", () => {
    const answered: Record<string, string> = {
      ...highWeightAnswered,
      "fam_separation__children_involved":    "no",  // exclude custody_arrangement
      "fam_separation__proceedings_started":  "no_not_yet",
    };
    const slots = selectSlots("fam_separation", answered, 2);
    const ids = slots.map(s => s.id);
    expect(ids).not.toContain("fam_separation__urgency_driver");
  });

  it("urgency_driver included when proceedings_started=yes_scheduled_hearing (dep satisfied)", () => {
    const answered: Record<string, string> = {
      ...highWeightAnswered,
      "fam_separation__children_involved":    "no",
      "fam_separation__proceedings_started":  "yes_scheduled_hearing",
    };
    const slots = selectSlots("fam_separation", answered, 2);
    const ids = slots.map(s => s.id);
    expect(ids).toContain("fam_separation__urgency_driver");
  });

  it("urgency_driver included when proceedings_started=served_with_application (dep satisfied)", () => {
    const answered: Record<string, string> = {
      ...highWeightAnswered,
      "fam_separation__children_involved":    "no",
      "fam_separation__proceedings_started":  "served_with_application",
    };
    const slots = selectSlots("fam_separation", answered, 2);
    const ids = slots.map(s => s.id);
    expect(ids).toContain("fam_separation__urgency_driver");
  });
});

describe("fam_separation  -  triggersRound3 options", () => {
  it("separation_date=over_5_years triggers Round 3 (approaching 6-yr FLA equalization deadline)", () => {
    expect(shouldTriggerRound3({
      "fam_separation__separation_date": "over_5_years",
    })).toBe(true);
  });

  it("proceedings_started=served_with_application triggers Round 3", () => {
    expect(shouldTriggerRound3({
      "fam_separation__proceedings_started": "served_with_application",
    })).toBe(true);
  });

  it("proceedings_started=yes_scheduled_hearing triggers Round 3", () => {
    expect(shouldTriggerRound3({
      "fam_separation__proceedings_started": "yes_scheduled_hearing",
    })).toBe(true);
  });

  it("cohabitation_duration=over_20_years triggers Round 3", () => {
    expect(shouldTriggerRound3({
      "fam_separation__cohabitation_duration": "over_20_years",
    })).toBe(true);
  });

  it("custody_arrangement=disputed_no_agreement triggers Round 3", () => {
    expect(shouldTriggerRound3({
      "fam_separation__custody_arrangement": "disputed_no_agreement",
    })).toBe(true);
  });

  it("dv_history=yes_ongoing_no_order triggers Round 3", () => {
    expect(shouldTriggerRound3({
      "fam_separation__dv_history": "yes_ongoing_no_order",
    })).toBe(true);
  });

  it("separation_date=under_1_year does NOT trigger Round 3", () => {
    expect(shouldTriggerRound3({
      "fam_separation__separation_date": "under_1_year",
    })).toBe(false);
  });
});

describe("fam_separation  -  scoring deltas", () => {
  it("relationship_status=dating_not_cohabiting produces negative fitDelta (-20) and high frictionDelta (30)", () => {
    const delta = scoreFromSlotAnswers({
      "fam_separation__relationship_status": "dating_not_cohabiting",
    });
    expect(delta.fit).toBe(-20);
    expect(delta.friction).toBe(30);
  });

  it("separation_date=over_5_years produces highest urgencyDelta (45)", () => {
    const delta = scoreFromSlotAnswers({
      "fam_separation__separation_date": "over_5_years",
    });
    expect(delta.urgency).toBe(45);
  });

  it("main_issue=all_of_above produces highest fitDelta (25)  -  full-scope retainer signal", () => {
    const delta = scoreFromSlotAnswers({
      "fam_separation__main_issue": "all_of_above",
    });
    expect(delta.fit).toBe(25);
  });

  it("support_status=none_financial_hardship produces highest urgencyDelta (30) among support options", () => {
    const delta = scoreFromSlotAnswers({
      "fam_separation__support_status": "none_financial_hardship",
    });
    expect(delta.urgency).toBe(30);
  });

  it("accumulates correctly across a strong-signal round-1 answer set", () => {
    // relationship_status=married         → fit+15, urg+0,  fric+0
    // separation_date=1_3_years           → fit+10, urg+15, fric+0
    // children_involved=yes               → fit+10, urg+10, fric+0
    // main_issue=all_of_above             → fit+25, urg+10, fric+0
    const delta = scoreFromSlotAnswers({
      "fam_separation__relationship_status": "married",
      "fam_separation__separation_date":     "1_3_years",
      "fam_separation__children_involved":   "yes",
      "fam_separation__main_issue":          "all_of_above",
    });
    expect(delta.fit).toBe(60);
    expect(delta.urgency).toBe(35);
    expect(delta.friction).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// div_tribunal_review bank
// ─────────────────────────────────────────────────────────────────────────────

describe("div_tribunal_review  -  slot bank structure", () => {
  it("round 1 returns 6 slots total (1 universal + 5 sub-type)", () => {
    const slots = selectSlots("div_tribunal_review", {}, 1);
    expect(slots.length).toBe(6);
    const subType = slots.filter(s => s.subType === "div_tribunal_review");
    expect(subType.length).toBe(5);
  });

  it("round-2 returns 5 slots (ROUND_2_LIMIT cap; stay_needed excluded  -  enforcement_risk unanswered)", () => {
    // 8 R2 slots: stay_needed excluded (dep: enforcement_risk unanswered) → 7 unconditional,
    // cap 5 → top 5 by weight: review_grounds(95), transcript(90), prior_recon(85),
    // enforcement_risk(80), prior_counsel(75). decision_impact(65) and record_below(60) cut.
    const answered = { "universal__court_centre": "toronto" };
    const slots = selectSlots("div_tribunal_review", answered, 2);
    expect(slots.length).toBe(5);
  });

  it("has exactly 4 round-3 slots (no cap)", () => {
    const answered = { "universal__court_centre": "toronto" };
    const slots = selectSlots("div_tribunal_review", answered, 3);
    expect(slots.length).toBe(4);
  });

  it("tribunal_body is first sub-type slot in round 1 (priorityWeight 100)", () => {
    const slots = selectSlots("div_tribunal_review", {}, 1);
    const subType = slots.filter(s => s.subType === "div_tribunal_review");
    expect(subType[0].id).toBe("div_tribunal_review__tribunal_body");
  });

  it("review_grounds is first in round 2 (priorityWeight 95)", () => {
    const slots = selectSlots("div_tribunal_review", {}, 2);
    expect(slots[0].id).toBe("div_tribunal_review__review_grounds");
  });
});

describe("div_tribunal_review  -  stay_needed dependency", () => {
  // stay_needed (priorityWeight 70) depends on enforcement_risk ∈ {enforcement_imminent, enforcement_underway}.
  // Pre-answer the 5 higher-weight unconditional R2 slots (95/90/85/80/75) to bring
  // stay_needed (70) into the cap window. enforcement_risk (80) is answered with the matching
  // value so it both removes itself from the pool AND satisfies the dep.
  // Remaining after pre-answers: decision_impact(65), stay_needed(70  -  if dep satisfied), record_below(60) → 3 candidates.
  const highWeightAnswered: Record<string, string> = {
    "div_tribunal_review__review_grounds":       "procedural_fairness",
    "div_tribunal_review__transcript_available": "yes_received",
    "div_tribunal_review__prior_reconsideration":"yes_denied",
    "div_tribunal_review__prior_counsel":        "yes_same_counsel",
  };

  it("stay_needed excluded when enforcement_risk is unanswered", () => {
    const slots = selectSlots("div_tribunal_review", {}, 2);
    const ids = slots.map(s => s.id);
    expect(ids).not.toContain("div_tribunal_review__stay_needed");
  });

  it("stay_needed excluded when enforcement_risk=no_enforcement_yet (value not in dep list)", () => {
    const answered: Record<string, string> = {
      ...highWeightAnswered,
      "div_tribunal_review__enforcement_risk": "no_enforcement_yet",
    };
    const slots = selectSlots("div_tribunal_review", answered, 2);
    const ids = slots.map(s => s.id);
    expect(ids).not.toContain("div_tribunal_review__stay_needed");
  });

  it("stay_needed included when enforcement_risk=enforcement_imminent (dep satisfied)", () => {
    const answered: Record<string, string> = {
      ...highWeightAnswered,
      "div_tribunal_review__enforcement_risk": "enforcement_imminent",
    };
    const slots = selectSlots("div_tribunal_review", answered, 2);
    const ids = slots.map(s => s.id);
    expect(ids).toContain("div_tribunal_review__stay_needed");
  });

  it("stay_needed included when enforcement_risk=enforcement_underway (dep satisfied)", () => {
    const answered: Record<string, string> = {
      ...highWeightAnswered,
      "div_tribunal_review__enforcement_risk": "enforcement_underway",
    };
    const slots = selectSlots("div_tribunal_review", answered, 2);
    const ids = slots.map(s => s.id);
    expect(ids).toContain("div_tribunal_review__stay_needed");
  });
});

describe("div_tribunal_review  -  triggersRound3 options", () => {
  it("decision_date_received=within_7_days triggers Round 3 (imminent 30-day deadline)", () => {
    expect(shouldTriggerRound3({
      "div_tribunal_review__decision_date_received": "within_7_days",
    })).toBe(true);
  });

  it("decision_date_received=8_to_21_days triggers Round 3", () => {
    expect(shouldTriggerRound3({
      "div_tribunal_review__decision_date_received": "8_to_21_days",
    })).toBe(true);
  });

  it("decision_date_received=22_to_30_days triggers Round 3 (critical  -  at deadline)", () => {
    expect(shouldTriggerRound3({
      "div_tribunal_review__decision_date_received": "22_to_30_days",
    })).toBe(true);
  });

  it("decision_date_received=over_60_days does NOT trigger Round 3", () => {
    expect(shouldTriggerRound3({
      "div_tribunal_review__decision_date_received": "over_60_days",
    })).toBe(false);
  });

  it("enforcement_risk=enforcement_imminent triggers Round 3", () => {
    expect(shouldTriggerRound3({
      "div_tribunal_review__enforcement_risk": "enforcement_imminent",
    })).toBe(true);
  });

  it("stay_needed=yes_urgent triggers Round 3", () => {
    expect(shouldTriggerRound3({
      "div_tribunal_review__stay_needed": "yes_urgent",
    })).toBe(true);
  });

  it("decision_impact=housing_loss triggers Round 3", () => {
    expect(shouldTriggerRound3({
      "div_tribunal_review__decision_impact": "housing_loss",
    })).toBe(true);
  });
});

describe("div_tribunal_review  -  scoring deltas", () => {
  it("tribunal_body=federal_tribunal produces negative fitDelta (-20) and high frictionDelta (25)  -  wrong court", () => {
    const delta = scoreFromSlotAnswers({
      "div_tribunal_review__tribunal_body": "federal_tribunal",
    });
    expect(delta.fit).toBe(-20);
    expect(delta.friction).toBe(25);
  });

  it("decision_date_received=22_to_30_days produces highest urgencyDelta (45)  -  at 30-day window", () => {
    const delta = scoreFromSlotAnswers({
      "div_tribunal_review__decision_date_received": "22_to_30_days",
    });
    expect(delta.urgency).toBe(45);
  });

  it("review_grounds=jurisdiction_error produces highest fitDelta (25)  -  correctness standard", () => {
    const delta = scoreFromSlotAnswers({
      "div_tribunal_review__review_grounds": "jurisdiction_error",
    });
    expect(delta.fit).toBe(25);
  });

  it("enforcement_risk=enforcement_imminent produces highest urgencyDelta (40) among enforcement options", () => {
    const delta = scoreFromSlotAnswers({
      "div_tribunal_review__enforcement_risk": "enforcement_imminent",
    });
    expect(delta.urgency).toBe(40);
  });

  it("accumulates correctly across a strong-signal div answer set", () => {
    // tribunal_body=hrto              → fit+20, urg+5,  fric+0
    // decision_date_received=8_to_21_days → fit+10, urg+30, fric+0
    // review_grounds=jurisdiction_error → fit+25, urg+0,  fric+0
    const delta = scoreFromSlotAnswers({
      "div_tribunal_review__tribunal_body":            "hrto",
      "div_tribunal_review__decision_date_received":   "8_to_21_days",
      "div_tribunal_review__review_grounds":           "jurisdiction_error",
    });
    expect(delta.fit).toBe(55);
    expect(delta.urgency).toBe(35);
    expect(delta.friction).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// pi_mva bank
// ─────────────────────────────────────────────────────────────────────────────

describe("pi_mva  -  slot bank structure", () => {
  it("round 1 returns 6 slots total (1 universal + 5 sub-type)", () => {
    const slots = selectSlots("pi_mva", {}, 1);
    expect(slots.length).toBe(6);
    const subType = slots.filter(s => s.subType === "pi_mva");
    expect(subType.length).toBe(5);
  });

  it("round-2 returns 5 slots (ROUND_2_LIMIT cap; tort_viability excluded  -  injury_severity unanswered)", () => {
    // 8 R2 slots: tort_viability (dep: injury_severity) excluded → 7 unconditional, cap 5.
    const answered = { "universal__court_centre": "toronto" };
    const slots = selectSlots("pi_mva", answered, 2);
    expect(slots.length).toBe(5);
  });

  it("has exactly 4 round-3 slots (no cap)", () => {
    const slots = selectSlots("pi_mva", { "universal__court_centre": "toronto" }, 3);
    expect(slots.length).toBe(4);
  });

  it("accident_date is first sub-type slot in round 1 (priorityWeight 100)", () => {
    const slots = selectSlots("pi_mva", {}, 1);
    const subType = slots.filter(s => s.subType === "pi_mva");
    expect(subType[0].id).toBe("pi_mva__accident_date");
  });

  it("injury_type is first in round 2 (priorityWeight 95)", () => {
    const slots = selectSlots("pi_mva", {}, 2);
    expect(slots[0].id).toBe("pi_mva__injury_type");
  });
});

describe("pi_mva  -  tort_viability dependency", () => {
  // tort_viability (priorityWeight 65) depends on injury_severity ∈ {serious_non_mig, catastrophic}.
  // Pre-answer weights 95/90/85/80/75 to bring weight-65 into window.
  const highWeightAnswered: Record<string, string> = {
    "pi_mva__injury_type":       "fracture_or_surgery",
    "pi_mva__mig_designated":    "no_not_designated",
    "pi_mva__income_loss":       "yes_employed_off_work",
    "pi_mva__prior_injuries":    "none",
    "pi_mva__litigation_status": "no_claim_not_issued",
  };

  it("tort_viability excluded when injury_severity is unanswered", () => {
    const slots = selectSlots("pi_mva", {}, 2);
    expect(slots.map(s => s.id)).not.toContain("pi_mva__tort_viability");
  });

  it("tort_viability excluded when injury_severity=minor_soft_tissue (not in dep list)", () => {
    const slots = selectSlots("pi_mva", {
      ...highWeightAnswered,
      "pi_mva__injury_severity": "minor_soft_tissue",
    }, 2);
    expect(slots.map(s => s.id)).not.toContain("pi_mva__tort_viability");
  });

  it("tort_viability included when injury_severity=serious_non_mig (dep satisfied)", () => {
    const slots = selectSlots("pi_mva", {
      ...highWeightAnswered,
      "pi_mva__injury_severity": "serious_non_mig",
    }, 2);
    expect(slots.map(s => s.id)).toContain("pi_mva__tort_viability");
  });

  it("tort_viability included when injury_severity=catastrophic", () => {
    const slots = selectSlots("pi_mva", {
      ...highWeightAnswered,
      "pi_mva__injury_severity": "catastrophic",
    }, 2);
    expect(slots.map(s => s.id)).toContain("pi_mva__tort_viability");
  });
});

describe("pi_mva  -  triggersRound3 options", () => {
  it("injury_severity=catastrophic triggers Round 3", () => {
    expect(shouldTriggerRound3({ "pi_mva__injury_severity": "catastrophic" })).toBe(true);
  });

  it("injury_severity=serious_non_mig triggers Round 3", () => {
    expect(shouldTriggerRound3({ "pi_mva__injury_severity": "serious_non_mig" })).toBe(true);
  });

  it("injury_type=brain_or_spinal triggers Round 3", () => {
    expect(shouldTriggerRound3({ "pi_mva__injury_type": "brain_or_spinal" })).toBe(true);
  });

  it("income_loss=yes_employed_off_work triggers Round 3", () => {
    expect(shouldTriggerRound3({ "pi_mva__income_loss": "yes_employed_off_work" })).toBe(true);
  });

  it("litigation_status=near_limitation triggers Round 3", () => {
    expect(shouldTriggerRound3({ "pi_mva__litigation_status": "near_limitation" })).toBe(true);
  });

  it("injury_severity=minor_soft_tissue does NOT trigger Round 3", () => {
    expect(shouldTriggerRound3({ "pi_mva__injury_severity": "minor_soft_tissue" })).toBe(false);
  });
});

describe("pi_mva  -  scoring deltas", () => {
  it("accident_date=today_or_yesterday produces highest urgencyDelta (45)  -  insurer 7-day notice window", () => {
    const delta = scoreFromSlotAnswers({ "pi_mva__accident_date": "today_or_yesterday" });
    expect(delta.urgency).toBe(45);
  });

  it("accident_date=over_2_years produces negative fitDelta (-20)  -  past limitation", () => {
    const delta = scoreFromSlotAnswers({ "pi_mva__accident_date": "over_2_years" });
    expect(delta.fit).toBe(-20);
    expect(delta.friction).toBe(35);
  });

  it("injury_severity=catastrophic produces highest fitDelta (30)", () => {
    const delta = scoreFromSlotAnswers({ "pi_mva__injury_severity": "catastrophic" });
    expect(delta.fit).toBe(30);
  });

  it("mig_designated=yes_not_disputing produces high frictionDelta (25)  -  stuck at $3,500 cap", () => {
    const delta = scoreFromSlotAnswers({ "pi_mva__mig_designated": "yes_not_disputing" });
    expect(delta.friction).toBe(25);
  });

  it("accumulates correctly across a strong-signal pi_mva answer set", () => {
    // accident_date=8_to_30_days  → fit+10, urg+25, fric+0
    // injury_severity=serious_non_mig → fit+25, urg+10, fric+0
    // fault_assessment=zero_fault → fit+20, urg+0,  fric+0
    const delta = scoreFromSlotAnswers({
      "pi_mva__accident_date":       "8_to_30_days",
      "pi_mva__injury_severity":     "serious_non_mig",
      "pi_mva__fault_assessment":    "zero_fault",
    });
    expect(delta.fit).toBe(55);
    expect(delta.urgency).toBe(35);
    expect(delta.friction).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// emp_dismissal bank
// ─────────────────────────────────────────────────────────────────────────────

describe("emp_dismissal  -  slot bank structure", () => {
  it("round 1 returns 6 slots total (1 universal + 5 sub-type)", () => {
    const slots = selectSlots("emp_dismissal", {}, 1);
    expect(slots.length).toBe(6);
    const subType = slots.filter(s => s.subType === "emp_dismissal");
    expect(subType.length).toBe(5);
  });

  it("round-2 returns 5 slots (ROUND_2_LIMIT cap; constructive_details excluded  -  termination_type unanswered)", () => {
    const answered = { "universal__court_centre": "toronto" };
    const slots = selectSlots("emp_dismissal", answered, 2);
    expect(slots.length).toBe(5);
  });

  it("has exactly 4 round-3 slots (no cap)", () => {
    const slots = selectSlots("emp_dismissal", { "universal__court_centre": "toronto" }, 3);
    expect(slots.length).toBe(4);
  });

  it("termination_type is first sub-type slot in round 1 (priorityWeight 100)", () => {
    const slots = selectSlots("emp_dismissal", {}, 1);
    const subType = slots.filter(s => s.subType === "emp_dismissal");
    expect(subType[0].id).toBe("emp_dismissal__termination_type");
  });

  it("cause_strength is first in round 2 (priorityWeight 95)", () => {
    const slots = selectSlots("emp_dismissal", {}, 2);
    expect(slots[0].id).toBe("emp_dismissal__cause_strength");
  });
});

describe("emp_dismissal  -  constructive_details dependency", () => {
  // constructive_details (priorityWeight 65) depends on termination_type = ["constructive"].
  // Pre-answer weights 95/90/85/80/75 to bring weight-65 into window.
  const highWeightAnswered: Record<string, string> = {
    "emp_dismissal__cause_strength":      "no_documentation",
    "emp_dismissal__mitigation_status":   "actively_searching",
    "emp_dismissal__compensation_level":  "100k_to_200k",
    "emp_dismissal__employment_agreement":"no_contract",
    "emp_dismissal__benefits_loss":       "salary_and_benefits",
  };

  it("constructive_details excluded when termination_type is unanswered", () => {
    const slots = selectSlots("emp_dismissal", {}, 2);
    expect(slots.map(s => s.id)).not.toContain("emp_dismissal__constructive_details");
  });

  it("constructive_details excluded when termination_type=without_cause (not in dep list)", () => {
    const slots = selectSlots("emp_dismissal", {
      ...highWeightAnswered,
      "emp_dismissal__termination_type": "without_cause",
    }, 2);
    expect(slots.map(s => s.id)).not.toContain("emp_dismissal__constructive_details");
  });

  it("constructive_details included when termination_type=constructive (dep satisfied)", () => {
    const slots = selectSlots("emp_dismissal", {
      ...highWeightAnswered,
      "emp_dismissal__termination_type": "constructive",
    }, 2);
    expect(slots.map(s => s.id)).toContain("emp_dismissal__constructive_details");
  });
});

describe("emp_dismissal  -  triggersRound3 options", () => {
  it("termination_date=18_to_24_months triggers Round 3 (approaching 2-year limitation)", () => {
    expect(shouldTriggerRound3({ "emp_dismissal__termination_date": "18_to_24_months" })).toBe(true);
  });

  it("years_of_service=over_20_years triggers Round 3 (high notice entitlement)", () => {
    expect(shouldTriggerRound3({ "emp_dismissal__years_of_service": "over_20_years" })).toBe(true);
  });

  it("years_of_service=10_to_20_years triggers Round 3", () => {
    expect(shouldTriggerRound3({ "emp_dismissal__years_of_service": "10_to_20_years" })).toBe(true);
  });

  it("severance_offered=package_unsigned triggers Round 3  -  active negotiation", () => {
    expect(shouldTriggerRound3({ "emp_dismissal__severance_offered": "package_unsigned" })).toBe(true);
  });

  it("human_rights_element=pregnancy_or_leave triggers Round 3", () => {
    expect(shouldTriggerRound3({ "emp_dismissal__human_rights_element": "pregnancy_or_leave" })).toBe(true);
  });

  it("compensation_level=over_200k triggers Round 3", () => {
    expect(shouldTriggerRound3({ "emp_dismissal__compensation_level": "over_200k" })).toBe(true);
  });

  it("termination_date=within_30_days does NOT trigger Round 3", () => {
    expect(shouldTriggerRound3({ "emp_dismissal__termination_date": "within_30_days" })).toBe(false);
  });
});

describe("emp_dismissal  -  scoring deltas", () => {
  it("termination_type=resigned_voluntarily produces negative fitDelta (-15)  -  no wrongful dismissal", () => {
    const delta = scoreFromSlotAnswers({ "emp_dismissal__termination_type": "resigned_voluntarily" });
    expect(delta.fit).toBe(-15);
    expect(delta.friction).toBe(20);
  });

  it("severance_offered=esa_minimum_only produces highest fitDelta (20)  -  clear gap to common law", () => {
    const delta = scoreFromSlotAnswers({ "emp_dismissal__severance_offered": "esa_minimum_only" });
    expect(delta.fit).toBe(20);
  });

  it("years_of_service=over_20_years produces highest fitDelta (30)  -  Bardal maximum", () => {
    const delta = scoreFromSlotAnswers({ "emp_dismissal__years_of_service": "over_20_years" });
    expect(delta.fit).toBe(30);
  });

  it("severance_offered=signed_full_release produces highest frictionDelta (35)", () => {
    const delta = scoreFromSlotAnswers({ "emp_dismissal__severance_offered": "signed_full_release" });
    expect(delta.friction).toBe(35);
  });

  it("accumulates correctly across a strong-signal emp_dismissal answer set", () => {
    // termination_type=without_cause    → fit+20, urg+5,  fric+0
    // years_of_service=10_to_20_years   → fit+25, urg+0,  fric+0
    // cause_alleged=no_cause_given      → fit+20, urg+0,  fric+0
    const delta = scoreFromSlotAnswers({
      "emp_dismissal__termination_type":  "without_cause",
      "emp_dismissal__years_of_service":  "10_to_20_years",
      "emp_dismissal__cause_alleged":     "no_cause_given",
    });
    expect(delta.fit).toBe(65);
    expect(delta.urgency).toBe(5);
    expect(delta.friction).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeJordanUrgency  -  Jordan s.11(b) delay clock
// R v Jordan [2016] SCC 27: 18-month ceiling (OCJ), 30-month ceiling (Superior).
// Net delay = elapsed months (charge_date bucket) − defence-caused months (adjournment_count bucket).
// ─────────────────────────────────────────────────────────────────────────────

describe("computeJordanUrgency  -  graceful degradation", () => {
  it("returns 0 for an unrecognised chargeDate value", () => {
    expect(computeJordanUrgency("unknown_value", "none")).toBe(0);
  });

  it("returns 0 for an unrecognised adjournmentCount value", () => {
    expect(computeJordanUrgency("12_18_months", "unknown_value")).toBe(0);
  });

  it("returns 0 when both inputs are unrecognised", () => {
    expect(computeJordanUrgency("bad", "also_bad")).toBe(0);
  });
});

describe("computeJordanUrgency  -  no Jordan concern (net delay < 12 months → delta 0)", () => {
  it("under_6_months / none → elapsed 3, defence 0, net 3 → delta 0", () => {
    expect(computeJordanUrgency("under_6_months", "none")).toBe(0);
  });

  it("6_12_months / none → elapsed 9, defence 0, net 9 → delta 0", () => {
    expect(computeJordanUrgency("6_12_months", "none")).toBe(0);
  });

  it("6_12_months / over_8 → elapsed 9, defence 6, net 3 → delta 0 (defence-caused delay absorbs Jordan clock)", () => {
    expect(computeJordanUrgency("6_12_months", "over_8")).toBe(0);
  });
});

describe("computeJordanUrgency  -  approaching OCJ ceiling (net 12–17 months → delta 5)", () => {
  it("12_18_months / none → elapsed 15, defence 0, net 15 → delta 5", () => {
    expect(computeJordanUrgency("12_18_months", "none")).toBe(5);
  });

  it("12_18_months / 1_3 → elapsed 15, defence 1.5, net 13.5 → delta 5", () => {
    expect(computeJordanUrgency("12_18_months", "1_3")).toBe(5);
  });

  it("12_18_months / over_8 → elapsed 15, defence 6, net 9 → delta 0 (heavy defence delay reduces net below threshold)", () => {
    expect(computeJordanUrgency("12_18_months", "over_8")).toBe(0);
  });
});

describe("computeJordanUrgency  -  at/past OCJ ceiling (net 18–29 months → delta 15)", () => {
  it("18_30_months / none → elapsed 24, defence 0, net 24 → delta 15", () => {
    expect(computeJordanUrgency("18_30_months", "none")).toBe(15);
  });

  it("18_30_months / 4_8 → elapsed 24, defence 3.5, net 20.5 → delta 15", () => {
    expect(computeJordanUrgency("18_30_months", "4_8")).toBe(15);
  });

  it("18_30_months / over_8 → elapsed 24, defence 6, net 18 → delta 15 (exactly at OCJ ceiling)", () => {
    expect(computeJordanUrgency("18_30_months", "over_8")).toBe(15);
  });
});

describe("computeJordanUrgency  -  past Superior Court ceiling (net ≥ 30 months → delta 25)", () => {
  it("over_30_months / none → elapsed 36, defence 0, net 36 → delta 25", () => {
    expect(computeJordanUrgency("over_30_months", "none")).toBe(25);
  });

  it("over_30_months / 4_8 → elapsed 36, defence 3.5, net 32.5 → delta 25", () => {
    expect(computeJordanUrgency("over_30_months", "4_8")).toBe(25);
  });

  it("over_30_months / over_8 → elapsed 36, defence 6, net 30 → delta 25 (exactly at Superior ceiling)", () => {
    expect(computeJordanUrgency("over_30_months", "over_8")).toBe(25);
  });
});
