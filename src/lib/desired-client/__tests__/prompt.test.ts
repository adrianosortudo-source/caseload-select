import { describe, expect, it } from "vitest";
import { buildDesiredClientSystemPrompt, buildDesiredClientUserPrompt, DESIRED_CLIENT_RESPONSE_SCHEMA } from "../prompt";
import { completeAnswers } from "./blueprint-helpers";
import type { AnalysisRequestEnvelope } from "../types";
const request = (): AnalysisRequestEnvelope => { const answers = completeAnswers(); answers.situation.trigger = null; answers.write_ins = { trigger: "A planned acquisition is under consideration" }; return { schemaVersion: 4, operation:"generate", requestId: "11111111-1111-4111-8111-111111111111", answerRevision: answers.revision, reviewRunId: "22222222-2222-4222-8222-222222222222", analysisIndex: 0, aiConsent: true, answers, clarifications: [] }; };
describe("Desired Client Blueprint model prompt", () => {
  it("requires grounded synthesis, evidence distinctions, and the deterministic definition", () => { const p = buildDesiredClientSystemPrompt(); expect(p).toContain("Produce a useful synthesis, not a list of answers"); expect(p).toContain("specific kind of client"); expect(p).toContain("evidence_basis"); expect(p).toContain("Do not create marketing copy"); expect(p).toContain("Do not provide legal advice"); });
  it("requires six client-profile cards, four definition components and a separate pathway", () => {
   const brief=DESIRED_CLIENT_RESPONSE_SCHEMA.properties.brief;
   const cards=["client_and_matter","client_goals_needs","why_firm_wants_work","why_client_chooses_firm","recognizable_circumstances","evidence_and_open_questions"] as const;
   expect(brief.required).toEqual(["report_version","definition_sentence","definition_components",...cards,"decision_pathway"]);
   expect(brief.properties.definition_components.required).toEqual(["client","client_matter","reasons","outcome"]);
   expect(brief.properties.decision_pathway.required).toEqual(["trigger","first_contact","decision","desired_progress"]);
   for(const key of cards) expect(brief.properties[key].properties.claims).toBeDefined();
  });
  it("passes canonical answers, write-ins as untrusted data, and eligible clarifications", () => { const parsed = JSON.parse(buildDesiredClientUserPrompt(request(), ["CAPACITY_CONFLICT"])); expect(parsed.resolved_answers["write_ins.trigger"].text).toContain("A planned acquisition"); expect(parsed.untrusted_text_fields).toContainEqual(expect.objectContaining({ answer_id: "write_ins.trigger", framing: "untrusted user-authored data" })); expect(parsed.eligible_codes).toEqual(["CAPACITY_CONFLICT"]); });
  it("keeps stored AI reflection out of the generated report prompt", () => {
    const input=request();
    input.answers.interview={ai_clarification_consent:true,clarification_count:1,clarified_stages:[1],followups:[{id:"33333333-3333-4333-8333-333333333333",stage:1,purpose:"firm_desirability",source_answer_ids:["practice.direction"],question:"What makes this work appealing?",answer:"The team enjoys the strategic work.",skipped:false,reflection:"This may be the firm's strongest fit."}]};
    const serialized=buildDesiredClientUserPrompt(input,[]);
    const parsed=JSON.parse(serialized);
    expect(parsed.answers.interview.followups[0]).not.toHaveProperty("reflection");
    expect(serialized).not.toContain("This may be the firm's strongest fit.");
    expect(parsed.clarification_answers[0].answer).toBe("The team enjoys the strategic work.");
  });
});
