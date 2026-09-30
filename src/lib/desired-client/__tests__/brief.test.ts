import { describe, expect, it } from "vitest";
import { buildStructuredBlueprintV4 } from "../structured-blueprint";
import { emptyAnswers } from "../brief";
import { buildBlueprintViewModel } from "../blueprint";
import { buildDefinitionSentence } from "../definition";
import { completeAnswers } from "./blueprint-helpers";
describe("Desired Client Blueprint synthesis", () => {
  it("connects firm, matter, reasons and outcome in the definition and six useful cards", () => {
    const answers = completeAnswers(), brief = buildStructuredBlueprintV4(answers);
    expect(brief.report_version).toBe("dcm-blueprint-v4");
    expect(brief.definition_sentence).toBe(buildDefinitionSentence(brief, false));
    expect(brief.definition_sentence).toContain("The firm wants to attract and serve");
    expect([brief.why_client_chooses_firm, brief.client_and_matter, brief.why_firm_wants_work, brief.recognizable_circumstances, brief.evidence_and_open_questions, brief.client_goals_needs]).toHaveLength(6);
    expect(brief.client_and_matter.claims.map((claim) => claim.text).join(" ")).toMatch(/owner or founder.*buying or selling a business/i);
    expect(brief.evidence_and_open_questions.claims.some((claim) => claim.evidence_basis === "unknown")).toBe(true);
  });
  it("keeps missing details explicit in sparse drafts", () => {
    const brief = buildStructuredBlueprintV4(emptyAnswers());
    expect(brief.definition_sentence).toContain("measure of progress still to be agreed");
    expect(brief.why_firm_wants_work.claims.some((claim) => claim.evidence_basis === "unknown")).toBe(true);
    expect(brief.evidence_and_open_questions.claims.some((claim) => claim.evidence_basis === "unknown")).toBe(true);
  });
  it("shows six report cards and provisional status in the view model", () => {
    const answers = completeAnswers(), brief = buildStructuredBlueprintV4(answers);
    const model = buildBlueprintViewModel(brief, answers, { mode: "structured", generatedAt: "2026-09-26T12:00:00Z", wordingReviewed: false });
    expect(model.cards).toHaveLength(6);
    expect(model.definition).toBe(brief.definition_sentence);
    expect(model.confirmed).toBe(false);
  });
});
