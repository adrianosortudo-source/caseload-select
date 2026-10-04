import { describe, expect, it } from "vitest";
import { completeAnswers } from "./blueprint-helpers";
import { buildInterviewClarificationResponseSchema, buildInterviewClarificationUserPrompt, validateInterviewClarificationRequest } from "../interview-clarification";
import { isInterviewClarificationAskPrompt, isInterviewClarificationSourceForStage, normalizeInterviewClarificationContinuePrompt, normalizeInterviewClarificationModelPrompt } from "../interview-clarification-contract";
import { interviewClarificationSourceFingerprint } from "../types";
import type { InterviewClarificationRequestEnvelope } from "../types";

function nextStageRequest(): InterviewClarificationRequestEnvelope {
  const answers = completeAnswers();
  answers.practice.experience = "regular";
  answers.interview = {
    ai_clarification_consent: true,
    clarification_count: 1,
    clarified_stages: [1],
    followups: [{
      id: "33333333-3333-4333-8333-333333333333",
      stage: 1,
      purpose: "firm_desirability",
      source_answer_ids: ["practice.direction"],
      question: "What makes this work appealing to the firm?",
      answer: "The team enjoys the strategic work.",
      skipped: false,
      reflection: "This may be the firm's strongest fit.",
    }],
  };
  return {
    schemaVersion: 4,
    operation: "clarify",
    requestId: "11111111-1111-4111-8111-111111111111",
    answerRevision: answers.revision,
    interviewRunId: "22222222-2222-4222-8222-222222222222",
    clarificationIndex: 1,
    stage: 2,
    aiConsent: true,
    answers,
  };
}

describe("adaptive interview clarification validation", () => {
  it("limits model purposes and sources to the current completed stage", () => {
    const request = nextStageRequest();
    request.stage = 3;
    const schema = buildInterviewClarificationResponseSchema(request);
    expect(schema.properties.purpose.enum).toContain("economics_effort_conflict");
    expect(schema.properties.purpose.enum).not.toContain("client_choice_criteria");
    expect(schema.properties.source_answer_ids.items.enum).toContain("value.fee_effort");
    expect(schema.properties.source_answer_ids.items.enum).not.toContain("focus.work");
    expect(schema.properties.source_answer_ids.items.enum).not.toContain("value.fee_amount");
  });
  it("shares stage-five delivery source rules with the browser and accepts list-valued answers", () => {
    const answers = completeAnswers();
    answers.delivery.conditions = ["scope", "information"];
    answers.delivery.limit = "scope";
    answers.delivery.capacity = "room";
    const request = nextStageRequest();
    request.stage = 5;
    request.answers = answers;
    const allowed = buildInterviewClarificationResponseSchema(request).properties.source_answer_ids.items.enum;
    expect(allowed).toEqual(expect.arrayContaining(["delivery.conditions", "delivery.limit", "delivery.capacity"]));
    for (const path of ["delivery.conditions", "delivery.limit", "delivery.capacity"] as const) {
      const prompt = {
        outcome: "ask", id: "33333333-3333-4333-8333-333333333333", stage: 5,
        purpose: "client_matter_specificity", source_answer_ids: [path],
        question: "What does the client need resolved before proceeding?",
        choices: [{ id: "scope", label: "Scope" }, { id: "timing", label: "Timing" }],
        reflection: "This detail can help distinguish relevant enquiries.",
      };
      expect(isInterviewClarificationAskPrompt(prompt, 5, answers)).toBe(true);
      expect(isInterviewClarificationSourceForStage(path, 5)).toBe(true);
      const { id: _ignoredModelId, ...modelPrompt } = prompt;
      const normalized = normalizeInterviewClarificationModelPrompt(modelPrompt, 5, answers, () => prompt.id);
      expect(normalized).toMatchObject(prompt);
      expect(isInterviewClarificationAskPrompt(normalized, 5, answers)).toBe(true);
    }
    expect(isInterviewClarificationSourceForStage("delivery.capacity", 3)).toBe(false);
    expect(isInterviewClarificationAskPrompt({
      outcome: "ask", id: "33333333-3333-4333-8333-333333333333", stage: 3,
      purpose: "economics_effort_conflict", source_answer_ids: ["delivery.capacity"],
      question: "What limits the work?", choices: [{ id: "one", label: "One" }, { id: "two", label: "Two" }],
      reflection: "This helps frame delivery.",
    }, 3, answers)).toBe(false);
  });
  it("normalizes a multiline continuation consistently before the browser sees it", () => {
    const answers = completeAnswers();
    const raw = { outcome: "continue", reason: "No material ambiguity remains.\nContinue to the next section." };
    const expected = { outcome: "continue", reason: "No material ambiguity remains. Continue to the next section." };
    expect(normalizeInterviewClarificationContinuePrompt(raw)).toEqual(expected);
    expect(normalizeInterviewClarificationModelPrompt(raw, 5, answers, () => "unused-id")).toEqual(expected);
    expect(normalizeInterviewClarificationContinuePrompt({ ...raw, extra: true })).toBeNull();
    expect(normalizeInterviewClarificationContinuePrompt({ outcome: "continue", reason: "x".repeat(181) })).toBeNull();
  });
  it("sends display labels instead of internal fee and effort codes to the model", () => {
    const request = nextStageRequest();
    request.stage = 3;
    request.answers.value.collected_fee = "5to15";
    request.answers.value.team_hours = "16to40";
    request.answers.value.fee_effort = "scoped";
    const payload = JSON.parse(buildInterviewClarificationUserPrompt(request));
    expect(payload.completed_stage_answers).toContain("value.collected_fee: C$5,000 to under C$15,000");
    expect(payload.completed_stage_answers).toContain("value.team_hours: More than 15, up to 40 hours");
    expect(payload.completed_stage_answers).toContain("value.fee_effort: Worthwhile when the scope is clear");
    expect(payload.completed_stage_answers).not.toContain("value.collected_fee: 5to15");
  });
  it("accepts prior answered clarification history containing its stored reflection", () => {
    expect(validateInterviewClarificationRequest(nextStageRequest()).valid).toBe(true);
  });
  it("accepts bounded multiline clarification answers and rejects overlong histories", () => {
    const request=nextStageRequest();
    request.answers.interview.followups[0].answer="The team enjoys the strategic work.\nIt also draws on our transaction experience.";
    expect(validateInterviewClarificationRequest(request).valid).toBe(true);
    request.answers.interview.followups[0].answer=Array(13).fill("line").join("\n");
    expect(validateInterviewClarificationRequest(request).valid).toBe(false);
  });
  it("accepts a fingerprinted answered follow-up on the next clarification request", () => {
    const request=nextStageRequest();
    const followup=request.answers.interview.followups[0];
    followup.source_answer_fingerprint=interviewClarificationSourceFingerprint(request.answers,followup.source_answer_ids);
    expect(validateInterviewClarificationRequest(request).valid).toBe(true);
  });
  it("accepts the multiline reflection produced by its own prompt normalizer in later history",()=>{
    const answers=completeAnswers();
    const prompt=normalizeInterviewClarificationModelPrompt({
      outcome:"ask",stage:1,purpose:"firm_desirability",source_answer_ids:["practice.direction"],
      question:"What makes this work appealing?",choices:[{id:"fit",label:"It fits"},{id:"other",label:"Something else"}],
      reflection:"The direction is clear.\nThe reason would sharpen the profile.",
    },1,answers,()=>"33333333-3333-4333-8333-333333333333");
    expect(prompt?.outcome).toBe("ask");
    if(prompt?.outcome!=="ask")return;
    answers.interview={ai_clarification_consent:true,clarification_count:1,clarified_stages:[1],followups:[{
      id:prompt.id,stage:prompt.stage,purpose:prompt.purpose,source_answer_ids:prompt.source_answer_ids,
      source_answer_fingerprint:interviewClarificationSourceFingerprint(answers,prompt.source_answer_ids),
      question:prompt.question,answer:"It fits",choiceId:"fit",skipped:false,reflection:prompt.reflection,
    }]};
    const request=nextStageRequest();
    request.answers=answers;request.answerRevision=answers.revision;request.clarificationIndex=1;
    expect(validateInterviewClarificationRequest(request).valid).toBe(true);
  });
  it("keeps an old follow-up in the answer history without treating its changed source as current", () => {
    const request=nextStageRequest();
    const followup=request.answers.interview.followups[0];
    followup.source_answer_fingerprint=interviewClarificationSourceFingerprint(request.answers,followup.source_answer_ids);
    request.answers.practice.direction="explore_direction";
    expect(validateInterviewClarificationRequest(request).valid).toBe(true);
  });
});
