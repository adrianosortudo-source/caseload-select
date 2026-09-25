import { describe, expect, it } from "vitest";
import { buildStructuredBrief, emptyAnswers } from "../brief";
import {
  advanceStage,
  answerClarification,
  applyAnalysis,
  beginAiRun,
  canEnterStage,
  commitComparison,
  editAnswers,
  failAnalysis,
  initialToolState,
  recordAiAttempt,
  type ToolState,
} from "../state";
import { DRAFT_TTL_MS, DRAFT_STORAGE_KEY, clearDraft, loadDraft, saveDraft } from "../storage";
import type { AnalysisResult, DesiredClientAnswers, SavedBrief } from "../types";

const B0: DesiredClientAnswers = {
  schema_version: "dcm-v2.1",
  revision: 4,
  focus: {
    area: "business", work: "business_agreements", work_other: "", service_area: "Ontario",
    certainty: "chosen", route: "established", comparison: null,
  },
  situation: { timing: "planning", role: "business_organization", role_other: "", contact: null },
  client: { goals: ["complete"], concerns: ["cost", "next"] },
  value: { reasons: ["client_benefit", "fees", "skills"], fee_effort: "worthwhile", collected_fee: null, team_hours: null, payment: null },
  delivery: { conditions: ["scope", "information"], capacity: "room", limit: null },
  direction: { aim: "more_current", evidence: ["repeated", "records"], less: null, less_note: "" },
  clarifications: {
    FOCUS_UNCLEAR: null, CLIENT_GOAL_UNCLEAR: null, CURRENT_CAPACITY_CONFLICT: null,
    FEE_EFFORT_CONFLICT: null, EXPERIENCE_DIRECTION_CONFLICT: null,
  },
};

const RUN_ID = "33333333-3333-4333-8333-333333333333";
const NOW = Date.parse("2026-09-24T12:00:00.000Z");

function reviewState(answers: DesiredClientAnswers = B0): ToolState {
  return {
    ...initialToolState(), mode: "ai", view: "review", answers, stage: 7,
    visitedStages: [1, 2, 3, 4, 5, 6], stagesToRevisit: [],
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } as Storage;
  return { storage, values };
}

function result(clarification_code: AnalysisResult["clarification_code"] = null): AnalysisResult {
  return { brief: buildStructuredBrief(B0), clarification_code };
}

describe("Desired Client reducer and draft-storage lifecycle", () => {
  it("resets dependent work and role choices, increments revision, and invalidates clarification state on edits", () => {
    const answers = structuredClone(B0);
    answers.clarifications.CLIENT_GOAL_UNCLEAR = "complete";
    const state: ToolState = {
      ...reviewState(answers), reviewRunId: RUN_ID, requestCount: 2,
      askedClarifications: ["CLIENT_GOAL_UNCLEAR"],
      savedBrief: { brief: buildStructuredBrief(answers), sourceBriefRevision: answers.revision, generatedAt: new Date(NOW).toISOString(), wordingReviewed: false, mode: "structured" },
    };

    const areaChanged = editAnswers(state, (draft) => ({ ...draft, focus: { ...draft.focus, area: "family" } }));
    expect(areaChanged.answers.revision).toBe(B0.revision + 1);
    expect(areaChanged.answers.focus).toMatchObject({ area: "family", work: null, work_other: "", certainty: null, route: "established", service_area: "Ontario", comparison: null });
    expect(areaChanged.answers.situation).toMatchObject({ role: null, role_other: "", contact: null });
    expect(Object.values(areaChanged.answers.clarifications).every((answer) => answer === null)).toBe(true);
    expect(areaChanged).toMatchObject({ reviewRunId: null, requestCount: 0, askedClarifications: [], activeClarification: null, savedBrief: null });

    const workChanged = editAnswers(reviewState(), (draft) => ({ ...draft, focus: { ...draft.focus, work: "business_ongoing" } }));
    expect(workChanged.answers.focus).toMatchObject({ work: "business_ongoing", work_other: "", certainty: "chosen", comparison: null });

    const withOtherRole = structuredClone(B0);
    withOtherRole.situation.role = "other";
    withOtherRole.situation.role_other = "Operations lead";
    const roleChanged = editAnswers(reviewState(withOtherRole), (draft) => ({ ...draft, situation: { ...draft.situation, role: "business_owner" } }));
    expect(roleChanged.answers.situation).toMatchObject({ role: "business_owner", role_other: "", contact: null });
  });

  it("commits the selected comparison candidate and only fills missing value and capacity answers", () => {
    const answers = structuredClone(B0);
    answers.focus.work = null;
    answers.focus.certainty = null;
    answers.value.fee_effort = "scoped";
    answers.delivery.capacity = null;
    const state: ToolState = {
      ...reviewState(answers), view: "comparison", comparisonDraft: {
        a: { work: "business_agreements", fee_effort: "difficult", team_fit: "stretch", capacity: "limited", evidence: "few" },
        b: { work: "business_ongoing", fee_effort: "worthwhile", team_fit: "proven", capacity: "room", evidence: "repeated" },
        selected: "b",
      },
    };

    const committed = commitComparison(state, "provisional");
    expect(committed.answers.focus.work).toBe("business_ongoing");
    expect(committed.answers.focus.certainty).toBe("provisional");
    expect(committed.answers.focus.comparison).toEqual(state.comparisonDraft);
    expect(committed.answers.value.fee_effort).toBe("scoped");
    expect(committed.answers.delivery.capacity).toBe("room");
    expect(committed.answers.revision).toBe(B0.revision + 1);
  });

  it("does not allow a changed work focus to skip required stage revisits before review", () => {
    const edited = editAnswers(reviewState(), (draft) => ({ ...draft, focus: { ...draft.focus, work: "business_ongoing" } }));
    expect(edited.stagesToRevisit).toEqual([2, 3, 4, 5, 6]);
    expect(canEnterStage(edited, 7)).toBe(false);
    expect(advanceStage({ ...edited, stage: 6, visitedStages: [1, 2, 3, 4, 5, 6], stagesToRevisit: [2, 3, 4, 5] }).view).not.toBe("review");
  });

  it("starts a fresh AI run without changing an unchanged answer revision", () => {
    const started = beginAiRun(reviewState(), () => RUN_ID);
    expect(started.answers.revision).toBe(B0.revision);
    expect(started.reviewRunId).toBe(RUN_ID);
    expect(started.requestCount).toBe(1);
    expect(started.loading).toBe(true);
  });

  it("applies a prescribed clarification once and advances the same-run request index", () => {
    const answers = structuredClone(B0);
    answers.delivery.capacity = "change";
    const started = beginAiRun(reviewState(answers), () => RUN_ID);
    const pending = applyAnalysis(started, result("CURRENT_CAPACITY_CONFLICT"));
    const answered = answerClarification(pending, "limited_now");
    expect(answered.answers.revision).toBe(answers.revision + 1);
    expect(answered.answers.delivery.capacity).toBe("limited");
    expect(answered.answers.clarifications.CURRENT_CAPACITY_CONFLICT).toBe("limited_now");
    expect(answered.askedClarifications).toEqual(["CURRENT_CAPACITY_CONFLICT"]);
    expect(answered.requestCount).toBe(2);
    expect(answered.reviewRunId).toBe(RUN_ID);
  });

  it("retains a valid third response and never starts a fourth attempt", () => {
    const first = beginAiRun(reviewState(), () => RUN_ID);
    const second = recordAiAttempt(failAnalysis(first, "unavailable", true));
    const third = recordAiAttempt(failAnalysis(second, "unavailable", true));
    expect(third.requestCount).toBe(3);
    const completed = applyAnalysis(third, result());
    expect(completed.savedBrief?.brief).toEqual(result().brief);
    expect(completed.view).toBe("brief");
    expect(recordAiAttempt(completed)).toEqual(completed);
  });

  it("keeps the full generated brief and canonical answers when the user leaves a clarification open", () => {
    const answers = structuredClone(B0);
    answers.value.fee_effort = "difficult";
    const started = beginAiRun(reviewState(answers), () => RUN_ID);
    const fullResult = result("FEE_EFFORT_CONFLICT");
    const pending = applyAnalysis(started, fullResult);
    const open = answerClarification(pending, "open");
    expect(open.savedBrief?.brief).toEqual(fullResult.brief);
    expect(open.answers).toBe(pending.answers);
    expect(open.answers.revision).toBe(answers.revision);
    expect(open.answers.clarifications.FEE_EFFORT_CONFLICT).toBeNull();
    expect(open).toMatchObject({ view: "brief", dismissedCode: "FEE_EFFORT_CONFLICT", activeClarification: null, reviewRunId: null });
  });

  it("invalidates a saved brief after an ordinary answer edit", () => {
    const state = { ...reviewState(), savedBrief: { brief: buildStructuredBrief(B0), sourceBriefRevision: B0.revision, generatedAt: new Date(NOW).toISOString(), wordingReviewed: true, mode: "structured" } satisfies SavedBrief, reviewed: true };
    const edited = editAnswers(state, (draft) => ({ ...draft, client: { ...draft.client, concerns: ["time"] } }));
    expect(edited.savedBrief).toBeNull();
    expect(edited.reviewed).toBe(false);
    expect(edited.answers.revision).toBe(B0.revision + 1);
  });

  it("does not renew the seven-day expiry when the same revision is resumed or saved again", () => {
    const { storage } = memoryStorage();
    const first = saveDraft(storage, B0, 3, undefined, NOW)!;
    const loaded = loadDraft(storage, NOW + 2 * 24 * 60 * 60 * 1000);
    expect(loaded.status).toBe("ready");
    const second = saveDraft(storage, loaded.status === "ready" ? loaded.draft.answers : emptyAnswers(), 4, undefined, NOW + 2 * 24 * 60 * 60 * 1000)!;
    expect(Date.parse(first.expiresAt)).toBe(NOW + DRAFT_TTL_MS);
    expect(second.expiresAt).toBe(first.expiresAt);
    expect(second.lastEditedAt).toBe(first.lastEditedAt);
  });

  it.each([
    ["revision-mismatched", { brief: buildStructuredBrief(B0), sourceBriefRevision: B0.revision + 1, generatedAt: new Date(NOW).toISOString(), wordingReviewed: true, mode: "structured" }],
    ["corrupt", { brief: { definition: "not a statement" }, sourceBriefRevision: B0.revision, generatedAt: "not-a-date", wordingReviewed: true, mode: "ai" }],
  ])("discards a %s saved brief while preserving valid answer data", (_label, savedBrief) => {
    const { storage } = memoryStorage();
    storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ schemaVersion: 2, answers: B0, currentStage: 4, lastEditedAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + DRAFT_TTL_MS).toISOString(), savedBrief }));
    const loaded = loadDraft(storage, NOW);
    expect(loaded.status).toBe("ready");
    if (loaded.status === "ready") {
      expect(loaded.draft.answers).toEqual(B0);
      expect(loaded.draft.savedBrief).toBeUndefined();
    }
  });

  it("reports unavailable storage and safely fails writes or clears", () => {
    const broken = {
      getItem: () => { throw new Error("storage unavailable"); },
      setItem: () => { throw new Error("storage unavailable"); },
      removeItem: () => { throw new Error("storage unavailable"); },
    } as unknown as Storage;
    expect(loadDraft(broken, NOW)).toEqual({ status: "unavailable" });
    expect(saveDraft(broken, B0, 1, undefined, NOW)).toBeNull();
    expect(clearDraft(broken)).toBe(false);
  });
});
