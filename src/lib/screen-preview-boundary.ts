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
  return { ...state, input: redactContact(state.input, contact), slots };
}

/** Use the same operational endpoint, provider and schema as the real widget. */
export function extractPreviewInquiry(description: string, state: EngineState, followUp?: { pendingSlotId: string; reply: string }) {
  return llmExtract(redactPreviewText(description, state), redactPreviewState(state),
    followUp && { ...followUp, reply: redactPreviewText(followUp.reply, state) });
}
