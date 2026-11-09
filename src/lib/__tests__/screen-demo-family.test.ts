import { describe, expect, it } from "vitest";
import { initialiseState } from "../screen-engine/extractor";
import { applyAnswer, getNextStep } from "../screen-engine/control";
import { getExtractableSlots } from "../screen-engine/llm/schema";
import { mergeLlmResults } from "../screen-engine/llm/extractor";
import { applyPendingSlotReply } from "../pending-slot-reply";
import { meetsDiscoveryFloor } from "../discovery-floor";
import { demoCapturedFacts, confirmDemoFacts } from "../screen-demo-confirmation";
import { prepareFamilyDemoState } from "../screen-demo-family";

const input = "The other parent will not let me see our children. There is a court order and I need help with parenting arrangements.";
describe("configured family demonstration", () => {
  it("leaves ordinary firm classification unchanged and avoids force fitting unrelated matters", () => {
    const original = initialiseState("I need a family lawyer about child custody.");
    expect(original.matter_type).toBe("out_of_scope");
    expect(prepareFamilyDemoState(original, [])).toBe(original);
    const unrelated = initialiseState("I need help with an unpaid business invoice.");
    expect(prepareFamilyDemoState(unrelated, ["family"])).toBe(unrelated);
    expect(getExtractableSlots("unknown").some((slot) => slot.id.startsWith("family_"))).toBe(false);
    for (const text of ["Our company disputes custody of business assets.", "I need advice on separation of commercial property parcels."]) {
      const business = initialiseState(text);
      expect(prepareFamilyDemoState(business, ["family"])).toBe(business);
    }
  });
  it("recognizes clear family descriptions without forcing unrelated commercial disputes", () => {
    for (const text of ["My former partner and I separated about a month ago. They have stopped letting me see our son.", "My spouse and I are living separately for now. We have not decided what happens next.", "We have two children and an Ontario parenting order, with a case conference December 12."]) {
      expect(prepareFamilyDemoState(initialiseState(text), ["family"]).matter_type).toBe("family_general");
    }
  });
  it("uses the provider schema, confirms captured facts and asks only unresolved questions", () => {
    const initial = prepareFamilyDemoState(initialiseState(input), ["family"]);
    expect(initial.matter_type).toBe("family_general");
    expect(getExtractableSlots(initial.matter_type).map((slot) => slot.id)).toEqual(expect.arrayContaining(["family_help_sought", "family_children", "family_existing_order", "family_timing"]));
    const proposed = mergeLlmResults(initial, { family_help_sought: "Parenting or decision-making", family_children: "Yes", family_existing_order: "Court order" });
    expect(demoCapturedFacts(proposed).filter((fact) => fact.id.startsWith("family_")).length).toBe(3);
    expect(meetsDiscoveryFloor(proposed)).toBe(false);
    const confirmed = confirmDemoFacts(proposed);
    expect(meetsDiscoveryFloor(confirmed)).toBe(true);
    expect(getNextStep(confirmed).slot?.id).toBe("family_timing");
    const next = applyPendingSlotReply("November 20, 2026", { ...confirmed, pendingAskedSlotId: "family_timing" });
    expect(next.slots.family_timing).toBe("November 20, 2026");
    expect(next.pendingAskedSlotId).toBeNull();
    expect(getNextStep(next).slot?.id).not.toBe("family_timing");
  });
  it("does not infer absence of children or orders from silence", () => {
    for (const input of ["My former partner and I separated. They stopped letting me see our son.", "My spouse and I are living separately for now. We have not decided what happens next.", "My family lawyer says there is no court order."]) {
      const state = prepareFamilyDemoState(initialiseState(input), ["family"]);
      const result = mergeLlmResults(state, { family_existing_order: "Neither", family_children: "No" });
      expect(result.slots.family_existing_order).toBeFalsy();
      expect(result.slots.family_children).toBeFalsy();
    }
  });
  it("retains explicit negative family facts and positive order and date", () => {
    const none = prepareFamilyDemoState(initialiseState("I need a family lawyer. We have no children, no court order and no written agreement."), ["family"]);
    const result = mergeLlmResults(none, { family_existing_order: "Neither", family_children: "No" });
    expect(result.slots.family_existing_order).toBe("Neither"); expect(result.slots.family_children).toBe("No");
    const positive = prepareFamilyDemoState(initialiseState("We have an Ontario parenting order and a court date on December 12, 2026."), ["family"]);
    const facts = mergeLlmResults(positive, { family_existing_order: "Court order", family_timing: "December 12, 2026" });
    expect(facts.slots.family_existing_order).toBe("Court order"); expect(facts.slots.family_timing).toBe("December 12, 2026");
  });
  it("asks all five family facts and readiness questions in order for a sparse case", () => {
    let state = prepareFamilyDemoState(initialiseState("I need a family lawyer about child custody."), ["family"]);
    const ids = ["family_help_sought", "family_children", "family_existing_order", "family_timing", "family_jurisdiction", "hiring_timeline", "other_counsel", "decision_authority"];
    for (const id of ids) {
      const step = getNextStep(state);
      expect(step.type).toBe("continue");
      expect(step.slot?.id).toBe(id);
      state = applyAnswer(state, id, id === "family_timing" ? "November 20, 2026" : step.slot!.options![0].value);
    }
    expect(getNextStep(state).type).toBe("present_insight");
  });
  it("does not stop before sparse family discovery", () => {
    const state = prepareFamilyDemoState(initialiseState("I need a family lawyer about child custody."), ["family"]);
    expect(meetsDiscoveryFloor(state)).toBe(false);
    expect(getNextStep(state)).toMatchObject({ type: "continue", slot: { id: "family_help_sought" } });
  });
});
