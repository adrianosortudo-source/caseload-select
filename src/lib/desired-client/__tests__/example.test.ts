import { describe, expect, it } from "vitest";
import { fictionalExampleAnswers, fictionalExampleBrief, fictionalExampleModel } from "../example";
import { validateAnalysisResult } from "../output";
import { validBlueprint } from "./blueprint-helpers";

describe("fictional public example", () => {
  it("passes the same grounded output validation as a generated brief", () => {
    const baseline = validBlueprint().brief;
    for (const slot of ["portrait", "client_need", "firm_value"] as const) {
      const brief = { ...baseline, [slot]: fictionalExampleBrief[slot] };
      expect(validateAnalysisResult({ brief, clarification_code: null }, fictionalExampleAnswers, []), slot).not.toBeNull();
    }
    for (const slot of ["message", "content", "next_step"] as const) {
      const brief = { ...baseline, marketing: { ...baseline.marketing, [slot]: fictionalExampleBrief.marketing[slot] } };
      expect(validateAnalysisResult({ brief, clarification_code: null }, fictionalExampleAnswers, []), slot).not.toBeNull();
    }
    expect(validateAnalysisResult({ brief: fictionalExampleBrief, clarification_code: null }, fictionalExampleAnswers, []))
      .not.toBeNull();
  });

  it("shows the proposed Screen checks without activating scoring", () => {
    expect(fictionalExampleModel.screens.activation).toBe("not_activated");
    expect(fictionalExampleModel.screens.rows).toHaveLength(4);
    expect(fictionalExampleModel.context.work).toBe("Buying or selling a business");
  });

  it("keeps the example traceable to fictional answers and visibly provisional", () => {
    expect(fictionalExampleModel.mode).toBe("ai");
    expect(fictionalExampleModel.status).toBe("Working draft");
    expect(fictionalExampleModel.sourceDetails).toHaveLength(7);
    expect(fictionalExampleModel.sourceDetails.every(source =>
      source.answers.length > 0 && source.answers.every(answer => answer.answer !== null),
    )).toBe(true);
    expect(fictionalExampleModel.allAnswers.length).toBeGreaterThan(15);
    expect(fictionalExampleModel.allNotes).toContain("Confirm which decision needs recent clients actually expressed.");
  });
});
