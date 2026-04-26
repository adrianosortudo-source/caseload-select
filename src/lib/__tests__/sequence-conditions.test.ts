/**
 * sequence-conditions.test.ts
 *
 * Coverage for evaluateStepCondition() in sequence-engine.ts.
 */

import { describe, it, expect } from "vitest";
import { evaluateStepCondition } from "../sequence-conditions";

const answers = {
  pi_slip_fall__location_type: "city_property",
  pi_slip_fall__incident_date:  "last_30_days",
  emp_dismissal__tenure_band:   "2_5_years",
};

describe("evaluateStepCondition", () => {
  it("returns true for null condition", () => {
    expect(evaluateStepCondition(null, answers)).toBe(true);
  });

  it("returns true for empty rules", () => {
    expect(evaluateStepCondition({ operator: "and", rules: [] }, answers)).toBe(true);
  });

  it("eq  -  matches expected value", () => {
    expect(evaluateStepCondition(
      { operator: "and", rules: [{ slot_id: "pi_slip_fall__location_type", op: "eq", value: "city_property" }] },
      answers,
    )).toBe(true);
  });

  it("eq  -  does not match wrong value", () => {
    expect(evaluateStepCondition(
      { operator: "and", rules: [{ slot_id: "pi_slip_fall__location_type", op: "eq", value: "retail_store" }] },
      answers,
    )).toBe(false);
  });

  it("neq  -  passes when value differs", () => {
    expect(evaluateStepCondition(
      { operator: "and", rules: [{ slot_id: "pi_slip_fall__location_type", op: "neq", value: "retail_store" }] },
      answers,
    )).toBe(true);
  });

  it("in  -  passes when actual is in list", () => {
    expect(evaluateStepCondition(
      { operator: "and", rules: [{ slot_id: "pi_slip_fall__location_type", op: "in", value: ["city_property", "retail_store"] }] },
      answers,
    )).toBe(true);
  });

  it("nin  -  passes when actual is not in list", () => {
    expect(evaluateStepCondition(
      { operator: "and", rules: [{ slot_id: "pi_slip_fall__location_type", op: "nin", value: ["workplace", "private_home"] }] },
      answers,
    )).toBe(true);
  });

  it("exists  -  passes when slot is present", () => {
    expect(evaluateStepCondition(
      { operator: "and", rules: [{ slot_id: "pi_slip_fall__location_type", op: "exists" }] },
      answers,
    )).toBe(true);
  });

  it("exists  -  fails when slot is absent", () => {
    expect(evaluateStepCondition(
      { operator: "and", rules: [{ slot_id: "unknown_slot", op: "exists" }] },
      answers,
    )).toBe(false);
  });

  it("not_exists  -  passes when slot is absent", () => {
    expect(evaluateStepCondition(
      { operator: "and", rules: [{ slot_id: "unknown_slot", op: "not_exists" }] },
      answers,
    )).toBe(true);
  });

  it("and  -  all rules must pass", () => {
    expect(evaluateStepCondition(
      {
        operator: "and",
        rules: [
          { slot_id: "pi_slip_fall__location_type", op: "eq", value: "city_property" },
          { slot_id: "pi_slip_fall__incident_date",  op: "eq", value: "last_30_days" },
        ],
      },
      answers,
    )).toBe(true);
  });

  it("and  -  fails when one rule fails", () => {
    expect(evaluateStepCondition(
      {
        operator: "and",
        rules: [
          { slot_id: "pi_slip_fall__location_type", op: "eq", value: "city_property" },
          { slot_id: "pi_slip_fall__incident_date",  op: "eq", value: "today" }, // wrong
        ],
      },
      answers,
    )).toBe(false);
  });

  it("or  -  passes when any rule passes", () => {
    expect(evaluateStepCondition(
      {
        operator: "or",
        rules: [
          { slot_id: "pi_slip_fall__location_type", op: "eq", value: "retail_store" }, // fails
          { slot_id: "pi_slip_fall__incident_date",  op: "eq", value: "last_30_days" }, // passes
        ],
      },
      answers,
    )).toBe(true);
  });

  it("or  -  fails when no rules pass", () => {
    expect(evaluateStepCondition(
      {
        operator: "or",
        rules: [
          { slot_id: "pi_slip_fall__location_type", op: "eq", value: "retail_store" },
          { slot_id: "pi_slip_fall__incident_date",  op: "eq", value: "today" },
        ],
      },
      answers,
    )).toBe(false);
  });

  it("handles missing slot gracefully for eq", () => {
    expect(evaluateStepCondition(
      { operator: "and", rules: [{ slot_id: "nonexistent_slot", op: "eq", value: "anything" }] },
      answers,
    )).toBe(false);
  });
});
