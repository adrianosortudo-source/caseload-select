import { extractRawSignals, initialiseState } from "./screen-engine/extractor";
import { runEvidencePass } from "./screen-engine/slotEvidence";
import { applyAnswer, getNextStep } from "./screen-engine/control";
import { computeBand } from "./screen-engine/band";
import { computeCoreCompleteness, getDecisionGap } from "./screen-engine/selector";
import type { EngineState } from "./screen-engine/types";
import { SLOT_REGISTRY } from "./screen-engine/slotRegistry";
import { normalizeVoiceScreenPhone } from "./voice-screen-phone";

/** Browser-safe domain logic shared by the caller API and independent tests. */
export interface ContinuationCallFacts {
  callerName: string;
  broadNeed: string;
  callback: { number: string };
  capturedSlots: Record<string, string>;
  deadline?: string;
}

export interface ContinuationAnswer {
  question: string;
  answer: string;
  source: "screen";
  at: string;
  slotId?: string;
  superseded?: boolean;
  engineValue?: string;
}

export interface ContinuationSummaryField {
  id: string;
  label: string;
  value: string;
  editable: boolean;
  uncertain: boolean;
}

interface ReviewState {
  confirmed: boolean;
  facts: ContinuationCallFacts;
  corrections?: Array<{ fieldId: string; previousValue: string; value: string; at: string }>;
}
type ReviewedEngineState = EngineState & { continuationReview?: ReviewState };

// Deliberate caller-facing allowlist. Never serialize engine slots wholesale.
const SUMMARY_LABELS: Record<string, string> = {
  amount_at_stake: "Amount involved", invoice_exists: "Invoice available",
  payment_status: "Payment received", dispute_reason: "What is disputed",
  documents_exist: "Documents available", advisory_timing: "Timing",
  hiring_timeline: "When you need help", residential_closing_timeline: "Closing timing",
  severance_deadline: "Response deadline", contract_review_timeline: "Review timing",
  litigation_documents: "Documents available", lien_documents: "Documents available",
  precon_documents: "Documents available", mortgage_documents: "Documents available",
};
const plainAnswer = (value: string) => value.startsWith("other:") ? value.slice(6).trim() : value;
const displayAnswer = (slotId: string, value: string) => SLOT_REGISTRY.find(slot => slot.id === slotId)?.options?.find(option => option.value === value)?.label ?? plainAnswer(value);
const maskPhone = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `••• ••• ${digits.slice(-4)}` : "Not captured";
};

function reviewState(state: EngineState, call?: ContinuationCallFacts): ReviewState {
  const saved = (state as ReviewedEngineState).continuationReview;
  if (saved) return structuredClone(saved);
  return { confirmed: false, facts: call ? structuredClone(call) : {
    callerName: state.slots.client_name ?? "", callback: { number: state.slots.client_phone ?? "" },
    broadNeed: state.input, capturedSlots: {},
  } };
}

function withReview(state: EngineState, review: ReviewState): EngineState {
  return { ...state, continuationReview: review } as ReviewedEngineState;
}

export interface ContinuationView {
  revision: number;
  status: string;
  question: { id: string; text: string; options: Array<{ value: string; label: string }> } | null;
  reviewConfirmed: boolean;
  summary: { fields: ContinuationSummaryField[]; answers: Array<{ question: string; answer: string }> };
}

export interface ContinuationPayload {
  revision: number;
  slotId?: string;
  value?: string;
  skip?: boolean;
  finish?: boolean;
  confirmReview?: boolean;
  correction?: { fieldId: string; value: string };
}

export interface ContinuationSession {
  state: EngineState;
  answers: ContinuationAnswer[];
  status: string;
  revision: number;
  call?: ContinuationCallFacts;
}

export class ContinuationError extends Error {
  constructor(public readonly code: "invalid_answer" | "refresh_required", public readonly status: 400 | 409) {
    super(code);
    this.name = "ContinuationError";
  }
}

export function scoreContinuationState(state: EngineState): EngineState {
  const band = computeBand(state);
  return { ...state, band: band.band, confidence: band.confidence, coreCompleteness: computeCoreCompleteness(state), currentGap: getDecisionGap(state) };
}

export function seedContinuationState(call: ContinuationCallFacts): EngineState {
  const input = [call.broadNeed, call.deadline ? `Timing reported: ${call.deadline}` : ""].filter(Boolean).join("\n");
  let state = runEvidencePass(input, initialiseState(input));
  for (const [slot, value] of Object.entries(call.capturedSlots)) state = applyAnswer(state, slot, value);
  if (call.callerName) state = applyAnswer(state, "client_name", call.callerName);
  if (call.callback.number) state = applyAnswer(state, "client_phone", call.callback.number);
  return withReview(scoreContinuationState({ ...state, questionHistory: [], contactCaptureStarted: false }), {
    confirmed: false, facts: structuredClone(call),
  });
}

export function continuationView(state: EngineState, revision: number, status: string, answers: ContinuationAnswer[] = [], call?: ContinuationCallFacts): ContinuationView {
  const next = getNextStep(state);
  const review = reviewState(state, call);
  const field = (id: string, label: string, value: string, uncertain = false): ContinuationSummaryField => ({
    id, label, value: value || "Not captured", editable: status !== "completed" && status !== "stopped", uncertain: uncertain || !value || /^(not sure|unknown|unsure)$/i.test(value.trim()),
  });
  const fields = [
    field("client_name", "Your name", review.facts.callerName),
    field("client_phone", "Contact number", maskPhone(review.facts.callback.number), !review.facts.callback.number),
    field("situation", "What you need help with", review.facts.broadNeed),
    field("deadline", "Timing or deadline", review.facts.deadline ?? "", !review.facts.deadline),
  ];
  for (const [id, label] of Object.entries(SUMMARY_LABELS)) {
    const value = review.facts.capturedSlots[id];
    if (value) fields.push(field(id, label, displayAnswer(id, value), /^(not sure|unknown|unsure)$/i.test(value.trim())));
  }
  // Exact projection: no raw transcript, routing IDs, scores, report or full phone.
  return {
    revision,
    status,
    reviewConfirmed: review.confirmed,
    summary: { fields, answers: answers.filter(answer => !answer.superseded).map(answer => ({
      question: answer.question,
      answer: answer.slotId === "client_phone" || SLOT_REGISTRY.find(slot => slot.id === "client_phone")?.question === answer.question ? maskPhone(answer.answer) : plainAnswer(answer.answer),
    })) },
    question: status === "completed" || status === "stopped" || !next.slot ? null : {
      id: next.slot.id,
      text: next.slot.question,
      options: (next.slot.options ?? []).map(option => ({ value: option.value, label: option.label })),
    },
  };
}

/** Validate and apply one answer identically in production and segment tests. */
export function transitionContinuation(session: ContinuationSession, payload: unknown, now = new Date().toISOString()): ContinuationSession {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ContinuationError("invalid_answer", 400);
  const body = payload as ContinuationPayload;
  if (!Number.isInteger(body.revision) || (body.skip !== undefined && typeof body.skip !== "boolean") ||
      (body.finish !== undefined && typeof body.finish !== "boolean") ||
      (body.confirmReview !== undefined && body.confirmReview !== true) ||
      Object.keys(body).some(key => !["revision", "slotId", "value", "skip", "finish", "confirmReview", "correction"].includes(key))) {
    throw new ContinuationError("invalid_answer", 400);
  }
  if (body.finish === true && (body.slotId !== undefined || body.value !== undefined || body.skip !== undefined)) {
    throw new ContinuationError("invalid_answer", 400);
  }
  const reviewAction = body.confirmReview === true || body.correction !== undefined;
  if (reviewAction && (body.finish !== undefined || body.skip !== undefined || body.slotId !== undefined || body.value !== undefined ||
      (body.confirmReview !== undefined && body.correction !== undefined))) throw new ContinuationError("invalid_answer", 400);
  if (body.revision !== session.revision || session.status === "completed" || session.status === "stopped") {
    throw new ContinuationError("refresh_required", 409);
  }
  let state = session.state;
  let answers = session.answers.map(answer => ({ ...answer }));
  const review = reviewState(state, session.call);
  if (body.confirmReview) review.confirmed = true;
  else if (body.correction !== undefined) {
    const correction = body.correction;
    if (!correction || typeof correction !== "object" || Array.isArray(correction) ||
        Object.keys(correction).some(key => !["fieldId", "value"].includes(key)) ||
        typeof correction.fieldId !== "string" || typeof correction.value !== "string" ||
        !correction.value.trim() || correction.value.length > 1500) throw new ContinuationError("invalid_answer", 400);
    const { fieldId } = correction;
    let value = correction.value.trim();
    const previousValue = fieldId === "client_name" ? review.facts.callerName : fieldId === "client_phone" ? review.facts.callback.number :
      fieldId === "situation" ? review.facts.broadNeed : fieldId === "deadline" ? review.facts.deadline ?? "" : review.facts.capturedSlots[fieldId] ?? "";
    if (!continuationView(state, session.revision, session.status, answers, session.call).summary.fields.some(field => field.id === fieldId && field.editable)) {
      throw new ContinuationError("invalid_answer", 400);
    }
    if (fieldId === "client_phone") {
      value = normalizeVoiceScreenPhone(value);
      if (!value) throw new ContinuationError("invalid_answer", 400);
      review.facts.callback = { number: value };
      state = applyAnswer(state, fieldId, value);
    } else if (fieldId === "client_name") {
      if (value.length > 120) throw new ContinuationError("invalid_answer", 400);
      review.facts.callerName = value;
      state = applyAnswer(state, fieldId, value);
    } else if (fieldId === "situation" || fieldId === "deadline") {
      // Replacing the situation invalidates old inferred evidence and call-slot
      // assumptions. Replay only compatible explicit answers not contradicted by
      // the new situation; retain superseded answers in the audit history.
      const previousCaptured = { ...review.facts.capturedSlots };
      if (fieldId === "situation") {
        review.facts.broadNeed = value;
        review.facts.capturedSlots = {};
      } else {
        if (value.length > 300) throw new ContinuationError("invalid_answer", 400);
        review.facts.deadline = value;
        for (const id of Object.keys(review.facts.capturedSlots)) if (/deadline|timing|timeline/.test(id)) delete review.facts.capturedSlots[id];
      }
      state = seedContinuationState(review.facts);
      state = { ...state, lead_id: session.state.lead_id, submitted_at: session.state.submitted_at };
      if (fieldId === "situation" && state.matter_type === session.state.matter_type) {
        for (const [id, captured] of Object.entries(previousCaptured)) {
          if (!state.slots[id] || state.slots[id] === captured) {
            review.facts.capturedSlots[id] = captured;
            state = applyAnswer(state, id, captured);
          }
        }
      }
      answers = answers.map(answer => {
        const slot = SLOT_REGISTRY.find(candidate => candidate.id === answer.slotId || (!answer.slotId && candidate.question === answer.question));
        if (answer.superseded || !slot || (fieldId === "deadline" && /deadline|timing|timeline|urgency/.test(slot.id)) ||
            !(slot.applies_to as readonly string[]).some(matter => matter === state.matter_type || matter === "*") ||
            (state.slots[slot.id] && state.slots[slot.id] !== (answer.engineValue ?? answer.answer))) return { ...answer, superseded: true };
        state = applyAnswer(state, slot.id, answer.answer === "Skipped by caller" ? "Not sure" : answer.engineValue ?? answer.answer);
        return answer;
      });
      if (fieldId === "deadline" || review.corrections?.some(correction => correction.fieldId === "deadline")) {
        // A caller's explicit correction takes precedence over an old date or
        // urgency word still present in the original situation description,
        // including when a later situation edit rebuilds the engine again.
        const deadline = review.facts.deadline ?? "";
        const timingSlot = SLOT_REGISTRY.find(slot => (slot.applies_to as readonly string[]).includes(state.matter_type) &&
          slot.resolves === "urgency" && /deadline|timeline|urgency/.test(slot.id));
        if (timingSlot) state = applyAnswer(state, timingSlot.id, `other:${deadline}`);
        state = { ...state, raw: { ...state.raw, mentions_urgency: !/\b(no deadline|no rush|not urgent|no longer urgent)\b/i.test(deadline) && extractRawSignals(deadline).mentions_urgency } };
      }
    } else {
      review.facts.capturedSlots[fieldId] = value;
      state = applyAnswer(state, fieldId, value);
      answers = answers.map(answer => answer.slotId === fieldId ? { ...answer, superseded: true } : answer);
    }
    review.corrections = [...(review.corrections ?? []), { fieldId, previousValue, value, at: now }];
    // Editing a captured fact is not a new discovery question. Preserve the
    // cumulative question budget even when a situation rebuild reroutes it.
    state = { ...state, questionHistory: [...session.state.questionHistory],
      answeredQuestionGroups: fieldId === "situation" || fieldId === "deadline" ? state.answeredQuestionGroups : [...session.state.answeredQuestionGroups] };
    state = scoreContinuationState(state);
  } else if (body.finish !== true) {
    const next = getNextStep(state);
    if (!next.slot || body.slotId !== next.slot.id || typeof body.value !== "string" || body.value.length > 1500 || (!body.skip && !body.value.trim())) {
      throw new ContinuationError("invalid_answer", 400);
    }
    const value = body.skip ? "Not sure" : body.value.trim();
    const explained = value.startsWith("other:");
    if (explained && !plainAnswer(value)) throw new ContinuationError("invalid_answer", 400);
    if (!body.skip && next.slot.options?.length && !next.slot.options.some(option => option.value === value) && !explained) {
      throw new ContinuationError("invalid_answer", 400);
    }
    state = scoreContinuationState(applyAnswer(state, next.slot.id, value));
    const answer = body.skip ? "Skipped by caller" : displayAnswer(next.slot.id, value);
    answers.push({ question: next.slot.question, answer, source: "screen", at: now, slotId: next.slot.id, ...(answer !== value ? { engineValue: value } : {}) });
  }
  return { state: withReview(state, review), answers, status: body.finish ? "completed" : reviewAction ? session.status : "partial", revision: session.revision + 1 };
}
