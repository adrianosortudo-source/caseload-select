import { SLOT_REGISTRY } from "./screen-engine/slotRegistry";
import type { EngineState } from "./screen-engine/types";
import { scoreDemoState } from "./screen-demo";

export interface DemoReviewFact { id: string; label: string; value: string }
const LABELS: Record<string, string> = {
  amount_at_stake: "Amount involved", decision_authority: "Hiring decision",
  hiring_timeline: "Hiring timeline", dispute_reason: "Reason for non-payment",
};

/** Proposals are shown for readback, never silently treated as client answers. */
export function demoReviewFacts(state: EngineState): DemoReviewFact[] {
  const proposed: Record<string, string> = {};
  for (const [id, value] of Object.entries(state.slots)) {
    if (value && state.slot_meta[id]?.source === "llm_inferred") proposed[id] = value;
  }
  // Readiness is intentionally excluded from live AI extraction. In this demo,
  // an explicit first-person statement can be offered for the same readback.
  // Owning a business alone is not evidence of authority to retain a lawyer.
  if (!state.slots.decision_authority && /\bI (?:(?:am the owner and )?can approve hiring a lawyer|alone (?:decide|can decide) (?:whether|to) hire a lawyer|make the (?:final )?decision (?:about hiring|to hire) a lawyer)\b/i.test(state.input)) {
    proposed.decision_authority = "Just me";
  }
  return SLOT_REGISTRY.flatMap((slot) => {
    const value = proposed[slot.id];
    if (!value || slot.id.startsWith("client_") || !slot.applies_to.includes(state.matter_type as never)) return [];
    // Only canonical selectable facts can be acknowledged here. Unknown keys,
    // free text, and routing proposals remain subject to normal follow-up.
    if (slot.input_type !== "single_select" || slot.question_group === "routing" || !slot.options?.some((option) => option.value === value)) return [];
    return [{ id: slot.id, value, label: LABELS[slot.id] ?? slot.id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) }];
  });
}

/** Called only by the explicit readback-confirmation control in demo mode. */
export function confirmDemoFacts(state: EngineState): EngineState {
  const slots = { ...state.slots };
  const slot_meta = { ...state.slot_meta };
  for (const fact of demoReviewFacts(state)) {
    slots[fact.id] = fact.value;
    slot_meta[fact.id] = { source: "answered", evidence: "Client confirmed this fact in the demonstration readback", confidence: 1 };
  }
  // This is one readback, not a synthetic sequence of answered questions.
  return scoreDemoState({ ...state, slots, slot_meta });
}
