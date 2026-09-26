import { describe, expect, it } from "vitest";
import { validateAnalysisRequest, validateDraftAnswers } from "../validation";
import type { AnalysisRequestEnvelope, DesiredClientAnswers } from "../types";

const B0: DesiredClientAnswers = {
  schema_version: "dcm-v2.1", revision: 1,
  focus: { area: "business", work: "business_agreements", work_other: "", service_area: "Ontario", certainty: "chosen", route: "established", comparison: null },
  situation: { timing: "planning", role: "business_organization", role_other: "", contact: null },
  client: { goals: ["complete"], concerns: ["cost", "next"] },
  value: { reasons: ["client_benefit", "fees", "skills"], fee_effort: "worthwhile", collected_fee: null, team_hours: null, payment: null },
  delivery: { conditions: ["scope", "information"], capacity: "room", limit: null },
  direction: { aim: "more_current", evidence: ["repeated", "records"], less: null, less_note: "" },
  clarifications: { FOCUS_UNCLEAR: null, CLIENT_GOAL_UNCLEAR: null, CURRENT_CAPACITY_CONFLICT: null, FEE_EFFORT_CONFLICT: null, EXPERIENCE_DIRECTION_CONFLICT: null },
};

function request(answers: DesiredClientAnswers = B0, patch: Partial<AnalysisRequestEnvelope> = {}): AnalysisRequestEnvelope {
  return {
    schemaVersion: 2, requestId: "11111111-1111-4111-8111-111111111111", answerRevision: answers.revision,
    reviewRunId: "22222222-2222-4222-8222-222222222222", analysisIndex: 0, aiConsent: true, answers, clarifications: [], ...patch,
  };
}

function emptyAnswers(): DesiredClientAnswers {
  return {
    schema_version: "dcm-v2.1", revision: 0,
    focus: { area: null, work: null, work_other: "", service_area: "", certainty: null, route: null, comparison: null },
    situation: { timing: null, role: null, role_other: "", contact: null },
    client: { goals: [], concerns: [] },
    value: { reasons: [], fee_effort: null, collected_fee: null, team_hours: null, payment: null },
    delivery: { conditions: [], capacity: null, limit: null },
    direction: { aim: null, evidence: [], less: null, less_note: "" },
    clarifications: { FOCUS_UNCLEAR: null, CLIENT_GOAL_UNCLEAR: null, CURRENT_CAPACITY_CONFLICT: null, FEE_EFFORT_CONFLICT: null, EXPERIENCE_DIRECTION_CONFLICT: null },
  };
}

describe("Desired Client validation", () => {
  it("accepts the completed fixed baseline and permits a failed-attempt retry index without history", () => {
    expect(validateAnalysisRequest(request()).valid).toBe(true);
    expect(validateAnalysisRequest(request(B0, { analysisIndex: 1 })).valid).toBe(true);
    expect(validateAnalysisRequest(request(B0, { analysisIndex: 2 })).valid).toBe(true);
  });

  it("rejects missing consent, mismatched revision, unknown keys and incomplete generation requests", () => {
    expect(validateAnalysisRequest(request(B0, { aiConsent: false as never })).valid).toBe(false);
    expect(validateAnalysisRequest(request(B0, { answerRevision: 2 })).valid).toBe(false);
    expect(validateAnalysisRequest({ ...request(), extra: "no" }).valid).toBe(false);
    const incomplete = structuredClone(B0);
    incomplete.client.goals = [];
    expect(validateAnalysisRequest(request(incomplete)).valid).toBe(false);
  });

  it("rejects mismatched area/work and role combinations and contradictory exclusives", () => {
    const wrongWork = structuredClone(B0);
    wrongWork.focus.area = "family";
    expect(validateAnalysisRequest(request(wrongWork)).valid).toBe(false);
    const wrongRole = structuredClone(B0);
    wrongRole.situation.role = "family_advice_seeker";
    expect(validateAnalysisRequest(request(wrongRole)).valid).toBe(false);
    const conflicting = structuredClone(B0);
    conflicting.client.concerns = ["unheard", "cost"];
    expect(validateAnalysisRequest(request(conflicting)).valid).toBe(false);
  });

  it("requires exact, distinct, same-run clarification history and the prescribed field update", () => {
    const answers = structuredClone(B0);
    answers.revision = 2;
    answers.clarifications.CLIENT_GOAL_UNCLEAR = "understand";
    answers.client.goals = ["understand"];
    const validHistory = [{ code: "CLIENT_GOAL_UNCLEAR", answer: "understand" }] as const;
    expect(validateAnalysisRequest(request(answers, { answerRevision: 2, analysisIndex: 1, clarifications: [...validHistory] })).valid).toBe(true);
    expect(validateAnalysisRequest(request(answers, { answerRevision: 2, analysisIndex: 1, clarifications: [] })).valid).toBe(false);
    expect(validateAnalysisRequest(request(answers, { answerRevision: 2, analysisIndex: 1, clarifications: [{ code: "CLIENT_GOAL_UNCLEAR", answer: "resolve" }] as never })).valid).toBe(false);
  });

  it("accepts incomplete saved drafts, including the temporary work reselection state", () => {
    expect(validateDraftAnswers(emptyAnswers())).toBe(true);
    const stageTwo = emptyAnswers();
    stageTwo.focus.area = "business";
    stageTwo.situation.timing = "planning";
    expect(validateDraftAnswers(stageTwo)).toBe(true);
    const reselection = structuredClone(B0);
    reselection.focus.area = "family";
    reselection.focus.work = null;
    reselection.focus.certainty = null;
    reselection.focus.comparison = null;
    reselection.situation.role = null;
    expect(validateDraftAnswers(reselection)).toBe(true);
  });

  it("rejects corrupt or unsupported saved draft shapes without requiring completion", () => {
    const unknown = emptyAnswers() as DesiredClientAnswers & Record<string, unknown>;
    unknown.extra = true;
    expect(validateDraftAnswers(unknown)).toBe(false);
    const invalid = emptyAnswers();
    invalid.focus.area = "not-an-area" as never;
    expect(validateDraftAnswers(invalid)).toBe(false);
  });
});
