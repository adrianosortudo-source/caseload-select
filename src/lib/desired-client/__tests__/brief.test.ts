import { describe, expect, it } from "vitest";
import { buildStructuredBlueprint } from "../structured-blueprint";
import { emptyAnswers } from "../brief";
import { buildBlueprintViewModel } from "../blueprint";
import { buildDefinitionSentence } from "../definition";
import { completeAnswers } from "./blueprint-helpers";
describe("Desired Client Blueprint synthesis", () => {
  it("connects firm, matter, reasons and outcome in the definition and six useful cards", () => {
    const answers = completeAnswers(), brief = buildStructuredBlueprint(answers);
    expect(brief.report_version).toBe("dcm-blueprint-v2");
    expect(brief.definition_sentence).toBe(buildDefinitionSentence(brief, false));
    expect(brief.definition_sentence).toContain("We help");
    expect([brief.practice_context, brief.desired_client_matter, brief.value_rationale, brief.relevance_signals, brief.opportunity_evidence, brief.repeatability]).toHaveLength(6);
    expect(brief.desired_client_matter.claims.map((claim) => claim.text).join(" ")).toMatch(/owner or founder.*buying or selling a business/i);
    expect(brief.opportunity_evidence.claims.some((claim) => claim.evidence_basis === "unknown")).toBe(true);
  });
  it("keeps missing details explicit in sparse drafts", () => {
    const brief = buildStructuredBlueprint(emptyAnswers());
    expect(brief.definition_sentence).toContain("measure of progress still to be agreed");
    expect(brief.practice_context.claims.some((claim) => claim.evidence_basis === "unknown")).toBe(true);
    expect(brief.opportunity_evidence.claims.some((claim) => claim.evidence_basis === "unknown")).toBe(true);
  });
  it("shows six report cards and provisional status in the view model", () => {
    const answers = completeAnswers(), brief = buildStructuredBlueprint(answers);
    const model = buildBlueprintViewModel(brief, answers, { mode: "structured", generatedAt: "2026-09-26T12:00:00Z", wordingReviewed: false });
    expect(model.cards).toHaveLength(6);
    expect(model.definition).toBe(brief.definition_sentence);
    expect(model.confirmed).toBe(false);
  });
});
