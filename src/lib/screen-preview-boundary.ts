import { llmExtract } from "./screen-engine/llm/extractor";
import { SLOT_REGISTRY } from "./screen-engine/slotRegistry";
import type { EngineState, LawyerReport, PracticeArea } from "./screen-engine/types";

export type PreviewPracticeArea = Extract<PracticeArea, "corporate" | "employment" | "family" | "estates" | "real_estate">;
export interface PreviewSubmission {
  brief_json: LawyerReport;
  brief_html: string;
  contact: { name?: string; phone?: string; email?: string };
  slot_answers: { questionHistory: string[] };
}

export interface ScreenPreviewBoundary {
  startImmediately: boolean;
  comparison: boolean;
  phone?: string;
  onSubmission: (payload: PreviewSubmission) => void;
  onStage: (stage: string, step: string | null, question: string | null) => void;
}

const contactIds = new Set(SLOT_REGISTRY.filter(slot => slot.tier === "contact").map(slot => slot.id));
function redactContact(text: string, known: string[]): string {
  return known.reduce((value, field) => value.split(field).join("[contact detail]"), text)
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/g, "[phone]");
}

function knownContactDetails(state?: EngineState): string[] {
  return Object.entries(state?.slots ?? {})
    .filter(([id, value]) => contactIds.has(id) && typeof value === "string" && value.length >= 3)
    .map(([, value]) => value!).sort((a, b) => b.length - a.length);
}

export function redactPreviewText(text: string, state?: EngineState): string {
  return redactContact(text, knownContactDetails(state));
}

export function redactPreviewState(state: EngineState): EngineState {
  const contact = knownContactDetails(state);
  const slots = Object.fromEntries(Object.entries(state.slots)
    .filter(([id]) => !contactIds.has(id))
    .map(([id, value]) => [id, typeof value === "string" ? redactContact(value, contact) : value]));
  return { ...state, input: redactContact(state.input, contact), slots,
    ...(state.intake_reading ? { intake_reading: { ...state.intake_reading,
      turns: state.intake_reading.turns.map(turn => ({ ...turn,
        text: redactContact(turn.text, contact),
        ...(turn.question ? { question: redactContact(turn.question, contact) } : {}),
      })),
      ...(state.intake_reading.questionReview ? { questionReview: { ...state.intake_reading.questionReview,
        requests: state.intake_reading.questionReview.requests.map(request => ({ ...request,
          quote: redactContact(request.quote, contact),
          ...(request.same_as_quote ? { same_as_quote: redactContact(request.same_as_quote, contact) } : {}),
        })),
        ...(state.intake_reading.questionReview.withdrawn ? { withdrawn: state.intake_reading.questionReview.withdrawn.map(item => ({ ...item,
          request_quote: redactContact(item.request_quote, contact), withdrawal_quote: redactContact(item.withdrawal_quote, contact),
        })) } : {}),
      } } : {}),
    } } : {}),
  };
}

/** Use the same operational endpoint, provider and schema as the real widget. */
export function extractPreviewInquiry(description: string, state: EngineState, followUp?: { pendingSlotId: string; reply: string; question?: string; skipped?: boolean }, reviewState?: EngineState, firmCriteriaToken?: string) {
  return llmExtract(redactPreviewText(description, state), redactPreviewState(state),
    followUp && { ...followUp, reply: redactPreviewText(followUp.reply, state),
      ...(followUp.question ? { question: redactPreviewText(followUp.question, state) } : {}) },
    undefined, reviewState && redactPreviewState(reviewState), firmCriteriaToken);
}
