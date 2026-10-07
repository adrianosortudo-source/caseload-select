import { describe, expect, it } from "vitest";
import { completeAnswers } from "@/lib/desired-client/__tests__/blueprint-helpers";
import { initialToolState } from "@/lib/desired-client/state";
import { advanceWithoutClarification, aiAvailabilityFromProbe, clarificationNoticeFor, providerCallLimitFromProbe, providerCallUsageFromResponse, reserveClarificationRequest, showValidClarificationPrompt } from "../DesiredClientTool";

const prompt = {
  outcome: "ask",
  id: "d8c05f50-ec59-4c5d-a2f9-139e0748838a",
  stage: 1,
  purpose: "firm_desirability",
  source_answer_ids: ["practice.direction"],
  question: "What makes this work attractive to the firm?",
  choices: [{ id: "client_value", label: "It creates meaningful value for clients" }, { id: "other", label: "Something else" }],
  reflection: "The firm may particularly value client impact.",
} as const;

describe("clarification question allowance", () => {
  it("treats only a successful probe with a boolean enabled field as known availability", () => {
    expect(aiAvailabilityFromProbe(true, { enabled: true })).toBe(true);
    expect(aiAvailabilityFromProbe(true, { enabled: false })).toBe(false);
    expect(aiAvailabilityFromProbe(false, { enabled: false })).toBeNull();
    expect(aiAvailabilityFromProbe(true, { enabled: "false" })).toBeNull();
    expect(aiAvailabilityFromProbe(true, {})).toBeNull();
    expect(aiAvailabilityFromProbe(true, null)).toBeNull();
  });

  it("accepts only server call limits and usage within the reported limit", () => {
    expect(providerCallLimitFromProbe({ enabled: true, providerCallLimit: 1 })).toBe(1);
    expect(providerCallLimitFromProbe({ enabled: true, providerCallLimit: 3 })).toBe(3);
    expect(providerCallLimitFromProbe({ enabled: true, providerCallLimit: 9 })).toBeNull();
    expect(providerCallUsageFromResponse({ providerCallsUsed: 1, providerCallLimit: 3 })).toEqual({ providerCallsUsed: 1, providerCallLimit: 3 });
    expect(providerCallUsageFromResponse({ providerCallsUsed: 2, providerCallLimit: 1 })).toBeNull();
  });

  it("counts only a valid prompt that is shown", () => {
    const state = { ...initialToolState(), answers: completeAnswers(), stage: 1 as const, view: "questions" as const };
    const shown = showValidClarificationPrompt(state, 1, "ed4758bb-8155-4b73-99dd-d7ed30b16078", prompt);
    expect(shown?.view).toBe("interviewClarification");
    expect(shown?.answers.interview.clarification_count).toBe(1);
    expect(shown?.answers.interview.clarified_stages).toEqual([1]);
  });

  it("does not spend question allowance on malformed or mismatched prompts", () => {
    const state = { ...initialToolState(), answers: completeAnswers(), stage: 1 as const, view: "questions" as const };
    expect(showValidClarificationPrompt(state, 1, "ed4758bb-8155-4b73-99dd-d7ed30b16078", { ...prompt, choices: [prompt.choices[0]] })).toBeNull();
    expect(showValidClarificationPrompt(state, 1, "ed4758bb-8155-4b73-99dd-d7ed30b16078", { ...prompt, stage: 2 })).toBeNull();
    expect(state.answers.interview.clarification_count).toBe(0);
    expect(state.answers.interview.clarified_stages).toEqual([]);
  });

  it("never shows or counts more than three prompts or repeats a shown stage", () => {
    const answers = completeAnswers();
    answers.interview.clarification_count = 3;
    answers.interview.clarified_stages = [1, 2, 3];
    const capped = { ...initialToolState(), answers, stage: 1 as const, view: "questions" as const };
    expect(showValidClarificationPrompt(capped, 1, "ed4758bb-8155-4b73-99dd-d7ed30b16078", prompt)).toBeNull();
    const repeatedAnswers = completeAnswers();
    repeatedAnswers.interview.clarification_count = 1;
    repeatedAnswers.interview.clarified_stages = [1];
    const repeated = { ...initialToolState(), answers: repeatedAnswers, stage: 1 as const, view: "questions" as const };
    expect(showValidClarificationPrompt(repeated, 1, "ed4758bb-8155-4b73-99dd-d7ed30b16078", prompt)).toBeNull();
  });

  it("does not count a valid continue response or an unavailable clarification", () => {
    const base = { ...initialToolState(), answers: completeAnswers(), stage: 1 as const, view: "questions" as const };
    const continued = advanceWithoutClarification(base, "ed4758bb-8155-4b73-99dd-d7ed30b16078");
    expect(continued.stage).toBe(2);
    expect(continued.answers.interview.clarification_count).toBe(0);
    expect(continued.answers.interview.clarified_stages).toEqual([]);

    const unavailable = advanceWithoutClarification(base, "ed4758bb-8155-4b73-99dd-d7ed30b16078", "unavailable");
    expect(unavailable.stage).toBe(2);
    expect(unavailable.error).toBe("clarificationUnavailable");
    expect(unavailable.answers.interview.clarification_count).toBe(0);
    expect(unavailable.answers.interview.clarified_stages).toEqual([]);
  });

  it("bounds clarification requests and resets the budget for a new interview run", () => {
    const budget = { runId: null as string | null, count: 0 };
    const firstRun = "ed4758bb-8155-4b73-99dd-d7ed30b16078";
    for (let attempt = 0; attempt < 6; attempt += 1) expect(reserveClarificationRequest(budget, firstRun)).toBe(true);
    expect(reserveClarificationRequest(budget, firstRun)).toBe(false);
    const secondRun = "346c5073-8bcb-41fa-a73d-bf81797d44f0";
    expect(reserveClarificationRequest(budget, secondRun)).toBe(true);
    expect(budget).toEqual({ runId: secondRun, count: 1 });
  });

  it("explains when the local request budget ends follow-ups without misreporting provider availability", () => {
    const base = { ...initialToolState(), answers: completeAnswers(), stage: 4 as const, view: "questions" as const };
    const limited = advanceWithoutClarification(base, "ed4758bb-8155-4b73-99dd-d7ed30b16078", "limit");
    expect(limited.stage).toBe(5);
    expect(limited.error).toBe("clarificationLimitReached");
    expect(limited.answers).toEqual(base.answers);
    expect(clarificationNoticeFor(limited.error)).toContain("reached its limit");
    expect(clarificationNoticeFor("clarificationUnavailable")).toContain("could not complete");
    expect(clarificationNoticeFor("clarificationUnavailable")).not.toContain("limit");
    expect(clarificationNoticeFor("clarificationUnavailable", false)).toContain("AI follow-ups are unavailable");
    expect(clarificationNoticeFor("clarificationUnavailable", null)).toContain("could not complete");
  });
});
