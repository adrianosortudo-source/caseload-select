import {
  answerDemoState,
  buildDemoReport,
  startDemoState,
} from "@/lib/screen-demo";
import {
  applyClarifyChoice,
  getNextStep,
} from "@/lib/screen-engine/control";
import type {
  EngineState,
  LawyerReport,
  NextStep,
} from "@/lib/screen-engine/types";
import type { ScreenQaAction, ScreenQaFixture } from "./scenarios";

export type ScreenQaRun = {
  fixtureId: string;
  state: EngineState;
  report: LawyerReport | null;
  askedSlots: string[];
  questionCount: number;
  maxObservedQuestionCount: number;
  progressiveRoutingSlots: string[];
  stepTypes: NextStep["type"][];
};

const ROUTING_SLOT_PREFIX = "corporate_";
const ROUTING_SLOT_IDS = new Set([
  "clarify_area",
  "corporate_help_category",
  "corporate_dispute_problem_type",
  "corporate_internal_problem_type",
  "corporate_support_problem_type",
]);

function activeSlot(state: EngineState): string | null {
  const next = getNextStep(state);
  return next.type === "continue" ||
    next.type === "deepen" ||
    next.type === "recover" ||
    next.type === "capture_contact"
    ? next.slot?.id ?? null
    : next.type === "clarify"
      ? "clarify_area"
      : null;
}

function recordStep(
  state: EngineState,
  askedSlots: string[],
  stepTypes: NextStep["type"][],
): void {
  const next = getNextStep(state);
  stepTypes.push(next.type);
  const slotId = activeSlot(state);
  if (slotId && !askedSlots.includes(slotId)) askedSlots.push(slotId);
}

function startFixtureState(fixture: ScreenQaFixture): EngineState {
  const state = startDemoState(fixture.opening);
  return fixture.locale === "pt" ? { ...state, language: "pt" } : state;
}

function applyQaAction(
  fixture: ScreenQaFixture,
  state: EngineState,
  action: ScreenQaAction,
): EngineState {
  if (action.type === "answer") {
    if (action.slotId === "clarify_area") {
      return applyClarifyChoice(state, action.value as EngineState["matter_type"]);
    }
    return answerDemoState(state, action.slotId, action.value);
  }
  if (action.type === "skip") {
    const slotId = activeSlot(state);
    if (!slotId || slotId === "clarify_area") {
      throw new Error(`${fixture.id}: skip has no active answerable slot`);
    }
    return answerDemoState(state, slotId, "Not sure");
  }
  if (action.type === "restart") return startFixtureState(fixture);
  return state;
}

/**
 * Runs a fixture without browser, network, extraction, persistence, or
 * telemetry. It deliberately uses the same deterministic adapter as the
 * Main Screen demo so QA cannot silently exercise a second policy.
 */
export function runScreenQaFixture(fixture: ScreenQaFixture): ScreenQaRun {
  let state = startFixtureState(fixture);
  let report: LawyerReport | null = null;
  let history: EngineState[] = [];
  const askedSlots: string[] = [];
  const progressiveRoutingSlots: string[] = [];
  const stepTypes: NextStep["type"][] = [];
  let maxObservedQuestionCount = 0;

  recordStep(state, askedSlots, stepTypes);

  for (const action of fixture.actions) {
    if (action.type === "open_report") {
      report = buildDemoReport(state);
      continue;
    }

    if (action.type === "back") {
      const previous = history.at(-1);
      if (previous) {
        history = history.slice(0, -1);
        state = previous;
      } else {
        state = startFixtureState(fixture);
        history = [];
      }
    } else {
      history = [...history, state];
      state = applyQaAction(fixture, state, action);
      if (action.type === "restart") history = [];
    }

    recordStep(state, askedSlots, stepTypes);
    maxObservedQuestionCount = Math.max(
      maxObservedQuestionCount,
      state.questionHistory.length,
    );

    const recent = state.questionHistory.at(-1);
    if (
      recent &&
      recent !== "clarify_area" &&
      recent !== "corporate_help_category" &&
      ROUTING_SLOT_IDS.has(recent) &&
      !progressiveRoutingSlots.includes(recent)
    ) {
      progressiveRoutingSlots.push(recent);
    }

    if (maxObservedQuestionCount > fixture.expected.maxQuestions) {
      throw new Error(
        `${fixture.id}: question cap exceeded (${maxObservedQuestionCount} > ${fixture.expected.maxQuestions})`,
      );
    }
  }

  return {
    fixtureId: fixture.id,
    state,
    report,
    askedSlots,
    questionCount: state.questionHistory.length,
    maxObservedQuestionCount,
    progressiveRoutingSlots,
    stepTypes,
  };
}

export function reportText(report: LawyerReport | null): string {
  return report ? JSON.stringify(report) : "";
}

export function isRoutingSlot(slotId: string): boolean {
  return ROUTING_SLOT_IDS.has(slotId) || slotId.startsWith(ROUTING_SLOT_PREFIX);
}
