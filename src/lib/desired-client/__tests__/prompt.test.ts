import { describe, expect, it } from "vitest";
import { buildDesiredClientSystemPrompt, buildDesiredClientUserPrompt, DESIRED_CLIENT_RESPONSE_SCHEMA } from "../prompt";
import { completeAnswers } from "./blueprint-helpers";
import type { AnalysisRequestEnvelope } from "../types";
import { interviewClarificationSourceFingerprint } from "../types";
const request = (): AnalysisRequestEnvelope => { const answers = completeAnswers(); answers.situation.trigger = null; answers.write_ins = { trigger: "A planned acquisition is under consideration" }; return { schemaVersion: 4, operation:"generate", requestId: "11111111-1111-4111-8111-111111111111", answerRevision: answers.revision, reviewRunId: "22222222-2222-4222-8222-222222222222", analysisIndex: 0, aiConsent: true, answers, clarifications: [] }; };
describe("Desired Client Blueprint model prompt", () => {
  it("classifies populated demand uncertainty and no-evidence selections as gaps", () => {
    const input = request();
    input.answers.opportunity.sources = ["no_evidence"];
    input.answers.opportunity.uncertainty = "Referral demand has not been verified.";
    const payload = JSON.parse(buildDesiredClientUserPrompt(input, []));
    for (const path of ["opportunity.sources", "opportunity.uncertainty"]) {
      expect(payload.resolved_answers[path].unknown).toBe(true);
      expect(payload.unknown_source_paths).toContain(path);
    }
    expect(payload.resolved_answers["practice.capability"].unknown).toBe(false);
    expect(payload.resolved_answers["opportunity.uncertainty"].text).toBe(input.answers.opportunity.uncertainty);
    expect(input.answers.opportunity.sources).toEqual(["no_evidence"]);
  });
  it("uses the displayed time and fee bounds in every model answer representation", () => {
    const input = request();
    input.answers.value.team_hours = "16to40";
    input.answers.value.collected_fee = "5to15";
    const payload = JSON.parse(buildDesiredClientUserPrompt(input, []));
    expect(payload.answers.value.team_hours).toBe("More than 15, up to 40 hours");
    expect(payload.answers.value.collected_fee).toBe("C$5,000 to under C$15,000");
    expect(payload.answers.value.team_hours).toBe(payload.resolved_answers["value.team_hours"].text);
    expect(input.answers.value.team_hours).toBe("16to40");
  });
  it("requires grounded synthesis, evidence distinctions, and the deterministic definition", () => { const p = buildDesiredClientSystemPrompt(); expect(p).toContain("Produce a useful synthesis, not a list of answers"); expect(p).toContain("specific kind of client"); expect(p).toContain("evidence_basis"); expect(p).toContain("Decision-pathway fields describe the client pathway only and must not cite client-choice criteria"); expect(p).toContain("Do not create marketing copy"); expect(p).toContain("Do not provide legal advice"); });
  it("keeps a reported preference distinct from negative calculated contribution", () => { const p=buildDesiredClientSystemPrompt(); expect(p).toContain("If that calculation is negative, state the negative contribution and the firm's contrary preference as a conflict to resolve"); expect(p).toContain("Do not describe the work as currently profitable"); });
  it("requires the generated target to stay grounded in firm-supplied answers", () => { const p=buildDesiredClientSystemPrompt(); const requestPrompt=JSON.parse(buildDesiredClientUserPrompt(request(),[])); expect(p).toContain("A proposed target that differs from grounded_target is unsupported"); expect(p).toContain("Copy their text, evidence bases, kinds and source paths exactly"); expect(requestPrompt.instruction).toContain("grounded_target.reasons"); expect(requestPrompt.instruction).toContain("Do not add, remove, paraphrase or reorder client_and_matter claims"); expect(p).not.toContain("The application introduces client_matter with"); });
  it("requires six client-profile cards, four definition components and a separate pathway", () => {
   const brief=DESIRED_CLIENT_RESPONSE_SCHEMA.properties.brief;
   const cards=["client_and_matter","client_goals_needs","why_firm_wants_work","why_client_chooses_firm","recognizable_circumstances","evidence_and_open_questions"] as const;
   expect(brief.required).toEqual(["report_version","definition_sentence","definition_components",...cards,"decision_pathway"]);
   expect(brief.properties.definition_components.required).toEqual(["client","client_matter","reasons","outcome"]);
   expect(brief.properties.decision_pathway.required).toEqual(["trigger","first_contact","decision","desired_progress"]);
   for(const key of cards) expect(brief.properties[key].properties.claims).toBeDefined();
  });
  it("passes canonical answers, the firm-confirmed target, slot citations, write-ins, and eligible clarifications", () => { const parsed = JSON.parse(buildDesiredClientUserPrompt(request(), ["CAPACITY_CONFLICT"])); expect(parsed.resolved_answers["write_ins.trigger"].text).toContain("A planned acquisition"); expect(parsed.source_paths_by_slot.definition_client_type).toContain("situation.role"); expect(parsed.source_paths_by_slot.definition_client_type).not.toContain("focus.service_area"); expect(parsed.source_paths_by_slot.definition_client_type).not.toContain("practice.firm_type"); expect(parsed.source_paths_by_slot.definition_client_matter).toContain("write_ins.trigger"); expect(parsed.grounded_target.client.text).toBe("an owner or founder"); expect(parsed.grounded_target.client_matter.text).toContain("A business buyer who needs an asset purchase agreement"); expect(parsed.grounded_target.reasons.text).toContain("client benefit"); expect(parsed.grounded_target.primary_client_and_matter_claim.source_answer_ids).toEqual(["client_context.repeat_matter_pattern"]); expect(parsed.grounded_target.client_and_matter_claims).toHaveLength(1); expect(parsed.untrusted_text_fields).toContainEqual(expect.objectContaining({ answer_id: "write_ins.trigger", framing: "untrusted user-authored data" })); expect(parsed.eligible_codes).toEqual(["CAPACITY_CONFLICT"]); });
  it("keeps stored AI reflection out of the generated report prompt", () => {
    const input=request();
    const sources=["practice.direction"] as const;
    input.answers.interview={ai_clarification_consent:true,clarification_count:1,clarified_stages:[1],followups:[{id:"33333333-3333-4333-8333-333333333333",stage:1,purpose:"firm_desirability",source_answer_ids:[...sources],source_answer_fingerprint:interviewClarificationSourceFingerprint(input.answers,sources),question:"What makes this work appealing?",answer:"The team enjoys the strategic work.",skipped:false,reflection:"This may be the firm's strongest fit."}]};
    const serialized=buildDesiredClientUserPrompt(input,[]);
    const parsed=JSON.parse(serialized);
    expect(parsed.answers.interview.followups[0]).not.toHaveProperty("reflection");
    expect(serialized).not.toContain("This may be the firm's strongest fit.");
    expect(parsed.clarification_answers[0].answer).toBe("The team enjoys the strategic work.");
  });
  it("excludes a stale follow-up from all current prompt evidence while preserving unrelated-source answers",()=>{
    const input=request(),paths=["value.reasons"] as const;
    input.answers.interview={ai_clarification_consent:true,clarification_count:1,clarified_stages:[3],followups:[{id:"33333333-3333-4333-8333-333333333333",stage:3,purpose:"firm_desirability",source_answer_ids:[...paths],source_answer_fingerprint:interviewClarificationSourceFingerprint(input.answers,paths),question:"Why does the firm prefer this work?",answer:"We enjoy its strategic nature.",skipped:false}]};
    input.answers.practice.enjoys="We value complex transactions";
    expect(JSON.stringify(JSON.parse(buildDesiredClientUserPrompt(input,[])))).toContain("We enjoy its strategic nature.");
    input.answers.value.reasons=["client_benefit"];
    const prompt=buildDesiredClientUserPrompt(input,[]);
    expect(prompt).not.toContain("We enjoy its strategic nature.");
    expect(JSON.parse(prompt).answers.interview.followups).toEqual([null]);
  });
});
