/**
 * event-question-generator tests — REPLACED
 *
 * generateQuestion() and generatePreamble() were removed. Questions now come
 * from the slot bank via selectSlots() → slotToApiQuestion(). The tests below
 * verify that the slot bank serves the timing question correctly for the
 * event types that previously relied on the generator.
 */

import { describe, it, expect } from "vitest";
import { selectSlots, slotToApiQuestion } from "../slot-selector";

describe("slot bank replaces generateQuestion — timing questions on turn 1", () => {
  const emptyAnswered: Record<string, string | string[]> = {};

  it("pi_slip_fall: round 1 includes incident_date slot", () => {
    const slots = selectSlots("pi_slip_fall", emptyAnswered, 1);
    const ids = slots.map(s => s.id);
    expect(ids).toContain("pi_slip_fall__incident_date");
  });

  it("pi_mva: round 1 includes accident_date slot", () => {
    const slots = selectSlots("pi_mva", emptyAnswered, 1);
    const ids = slots.map(s => s.id);
    expect(ids).toContain("pi_mva__accident_date");
  });

  it("emp_dismissal: round 1 includes termination_date slot", () => {
    const slots = selectSlots("emp_dismissal", emptyAnswered, 1);
    const ids = slots.map(s => s.id);
    expect(ids).toContain("emp_dismissal__termination_date");
  });

  it("slotToApiQuestion maps slot to ApiQuestion shape", () => {
    const slots = selectSlots("pi_slip_fall", emptyAnswered, 1);
    const dateSlot = slots.find(s => s.id === "pi_slip_fall__incident_date");
    expect(dateSlot).toBeDefined();
    const q = slotToApiQuestion(dateSlot!);
    expect(q.id).toBe("pi_slip_fall__incident_date");
    expect(typeof q.text).toBe("string");
    expect(q.text.length).toBeGreaterThan(0);
    expect(Array.isArray(q.options)).toBe(true);
    expect(q.options.length).toBeGreaterThan(0);
    // Options must have label and value
    expect(q.options[0]).toHaveProperty("label");
    expect(q.options[0]).toHaveProperty("value");
    // Timing slot is single_select — not free text
    expect(q.allow_free_text).toBe(false);
  });

  it("timing question options have no pronouns", () => {
    const slots = selectSlots("pi_mva", emptyAnswered, 1);
    const dateSlot = slots.find(s => s.id === "pi_mva__accident_date");
    expect(dateSlot).toBeDefined();
    const q = slotToApiQuestion(dateSlot!);
    const pronounPattern = /\b(they|them|their|he|she|him|his|her)\b/i;
    expect(q.text).not.toMatch(pronounPattern);
    for (const opt of q.options) {
      expect(opt.label).not.toMatch(pronounPattern);
    }
  });

  it("answered slots are excluded from selection", () => {
    const answered = { "pi_slip_fall__incident_date": "within_3_months" };
    const slots = selectSlots("pi_slip_fall", answered, 1);
    const ids = slots.map(s => s.id);
    expect(ids).not.toContain("pi_slip_fall__incident_date");
  });
});
