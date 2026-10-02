import { describe, expect, it } from "vitest";
import { completeAnswers } from "./blueprint-helpers";
import { buildInterviewClarificationResponseSchema, buildInterviewClarificationUserPrompt, validateInterviewClarificationRequest } from "../interview-clarification";
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
  it("keeps an old follow-up in the answer history without treating its changed source as current", () => {
    const request=nextStageRequest();
    const followup=request.answers.interview.followups[0];
    followup.source_answer_fingerprint=interviewClarificationSourceFingerprint(request.answers,followup.source_answer_ids);
    request.answers.practice.direction="explore_direction";
    expect(validateInterviewClarificationRequest(request).valid).toBe(true);
  });
});
