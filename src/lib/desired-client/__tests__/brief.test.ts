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
    expect(brief.definition_sentence).toBe(buildDefinitionSentence(brief, false, answers.client.goal_detail, answers.client.goals.includes("unknown")));
    expect(brief.definition_sentence).toContain("The firm wants to attract and serve");
    expect([brief.why_client_chooses_firm, brief.client_and_matter, brief.why_firm_wants_work, brief.recognizable_circumstances, brief.evidence_and_open_questions, brief.client_goals_needs]).toHaveLength(6);
    expect(brief.client_and_matter.claims.map((claim) => claim.text).join(" ")).toContain(answers.client_context.repeat_matter_pattern);
    expect(brief.evidence_and_open_questions.claims.some((claim) => claim.evidence_basis === "unknown")).toBe(true);
  });
  it("keeps missing details explicit in sparse drafts", () => {
    const brief = buildStructuredBlueprintV4(emptyAnswers());
    const model=buildBlueprintViewModel(brief,emptyAnswers(),{mode:"structured",generatedAt:"2026-09-26T12:00:00Z",wordingReviewed:false});
    expect(model.progressReview.metric).toBe("Not selected");
    expect(model.progressReview.status).toBe("Needs definition");
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
  it("surfaces negative economics and a proposed target that exceeds stated capacity", () => {
    const answers=completeAnswers();
    answers.value.fee_amount="8000";
    answers.value.direct_cost_amount="8500";
    answers.value.currency="CAD";
    answers.value.amount_scope="per_matter";
    answers.value.amount_basis="recorded";
    answers.repeatability.additional_matters="1 additional matter per quarter";
    answers.repeatability.target="2 retained matters per quarter";
    const brief=buildStructuredBlueprintV4(answers);
    const model=buildBlueprintViewModel(brief,answers,{mode:"structured",generatedAt:"2026-10-05T12:00:00Z",wordingReviewed:false});
    expect(model.conditions.some((condition)=>condition.includes("negative contribution of")&&condition.includes("before overhead and acquisition costs"))).toBe(true);
    expect(model.conditions).toContain("The proposed target of 2 matters per quarter exceeds the stated additional capacity of 1 matter per quarter; resolve the mismatch before treating the target as available volume.");
    expect(model.progressReview.target).toBe("2 retained matters per quarter");
  });
  it("does not compare capacity and target across different periods", () => {
    const answers=completeAnswers();
    answers.repeatability.additional_matters="1 additional matter per quarter";
    answers.repeatability.target="2 retained matters per year";
    const model=buildBlueprintViewModel(buildStructuredBlueprintV4(answers),answers,{mode:"structured",generatedAt:"2026-10-05T12:00:00Z",wordingReviewed:false});
    expect(model.conditions.some((condition)=>condition.includes("exceeds the stated additional capacity"))).toBe(false);
  });
});
