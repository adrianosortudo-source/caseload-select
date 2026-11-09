import { demoDeadlineProposal } from "./screen-demo-deadline";
import { SLOT_REGISTRY } from "./screen-engine/slotRegistry";
import { applyAnswer } from "./screen-engine/control";
import type { EngineState } from "./screen-engine/types";
import { scoreDemoState } from "./screen-demo";

export interface DemoReviewFact {
  id: string; label: string; value: string; source: "provided" | "inferred" | "confirmed";
  options: readonly { value: string; label: string }[];
}
const LABELS: Record<string, string> = {
  amount_at_stake: "Amount involved", decision_authority: "Hiring decision",
  hiring_timeline: "Hiring timeline", dispute_reason: "Reason for non-payment",
  desired_outcome_unpaid_invoice: "Requested next step", proof_of_performance: "Proof of delivery",
  invoice_status: "Invoice status", days_overdue: "Time overdue", agreement_proof: "Agreement",
  other_counsel: "Other legal help",
};

/** Explicit phrases are proposals for review, never silently accepted answers. */
function proposals(state: EngineState, now: Date): Record<string, string> {
  const proposed: Record<string, string> = {};
  for (const [id, value] of Object.entries(state.slots)) {
    if (value && state.slot_meta[id]?.source === "llm_inferred") proposed[id] = value;
  }
  const deadline = state.matter_type === "severance_review" && !state.slots.severance_deadline && state.slot_meta.severance_deadline?.source !== "answered"
    ? demoDeadlineProposal(state.input, now) : null;
  if (deadline) proposed.severance_deadline = deadline.value;
  const explicitAuthority = state.input.split(/[.!?;\n]+/).some((sentence) =>
    !/\b(?:not|never|cannot|can't|don't|doesn't|doubt|might|may|maybe|unsure|uncertain|if)\b/i.test(sentence) &&
    /\bI (?:(?:am the owner and )?can (?:approve hiring|decide to hire) a lawyer|alone (?:decide|can decide) (?:whether(?: to)?|to) hire a lawyer|make the (?:final )?decision (?:about hiring|to hire) a lawyer)\b/i.test(sentence),
  );
  if (!state.slots.decision_authority && state.slot_meta.decision_authority?.source !== "answered" &&
      !/\b(?:partner|board|co-owner|joint|together)\b/i.test(state.input) && explicitAuthority) {
    proposed.decision_authority = "Just me";
  }
  if (state.matter_type === "unpaid_invoice" && !state.slots.desired_outcome_unpaid_invoice &&
      state.slot_meta.desired_outcome_unpaid_invoice?.source !== "answered" &&
      /\bI (?:want|would like)(?: advice about| help (?:with|sending)| to send)? (?:a )?demand letter\b/i.test(state.input)) {
    proposed.desired_outcome_unpaid_invoice = "Send demand letter";
  }
  // Only propose explicitly available delivery documentation; the client must confirm it.
  if (state.matter_type === "unpaid_invoice" && !state.slots.proof_of_performance &&
      !state.slot_meta.proof_of_performance && !state.slot_evidence.proof_of_performance) {
    const sentences = state.input.split(/[.!?;\n]+/);
    const availableEvidence = sentences.some((sentence) => {
      if (/\b(?:no|not|never|without|cannot|can't|dont|don't|doesn't|didn't|wouldn't|might|may|maybe|unsure|uncertain|unavailable|missing|lost|destroyed|not sure|no longer|if|whether|client|customer|they|their|opponent|other side)\b/i.test(sentence)) return false;
      return /\b(?:i|we) (?:have|possess) (?:the |our |some )?(?:emails?|records?|documents?) (?:confirming|showing|proving) (?:the )?delivery\b/i.test(sentence) ||
        /\b(?:emails?|records?|documents?) (?:confirming|showing|proving) (?:the )?delivery (?:are|is) (?:ready|available|in hand)\b/i.test(sentence);
    });
    if (availableEvidence) proposed.proof_of_performance = "Yes";
  }
  return proposed;
}

/** All reviewable captured facts, with provenance and canonical correction choices. */
export function demoCapturedFacts(state: EngineState, now: Date = new Date()): DemoReviewFact[] {
  const proposed = proposals(state, now);
  const deadline = demoDeadlineProposal(state.input, now);
  return SLOT_REGISTRY.flatMap((slot) => {
    if (slot.id.startsWith("client_") || slot.question_group === "routing" ||
        !slot.applies_to.includes(state.matter_type as never)) return [];
    const value = proposed[slot.id] ?? state.slots[slot.id];
    const meta = state.slot_meta[slot.id]?.source;
    if (!value || (!proposed[slot.id] && meta !== "explicit" && meta !== "answered")) return [];
    if (slot.input_type !== "single_select" || !slot.options?.some((option) => option.value === value)) return [];
    return [{
      id: slot.id, value, label: slot.id === "severance_deadline" && deadline && value === deadline.value ? `Deadline to respond (${deadline.dateText})` : LABELS[slot.id] ?? slot.id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
      source: proposed[slot.id] ? "inferred" as const : meta === "answered" ? "confirmed" as const : "provided" as const,
      options: slot.options.map(({ value, label }) => ({ value, label })),
    }];
  });
}

export function demoReviewFacts(state: EngineState): DemoReviewFact[] {
  return demoCapturedFacts(state).filter((fact) => fact.source === "inferred");
}

/** Readback is not a hidden set of discovery questions. Live intake never calls this adapter. */
export function confirmDemoFacts(state: EngineState, corrections: Readonly<Record<string, string>> = {}, now: Date = new Date()): EngineState {
  let next = state;
  const deadline = demoDeadlineProposal(state.input, now);
  for (const fact of demoCapturedFacts(state, now)) {
    const value = Object.hasOwn(corrections, fact.id) ? corrections[fact.id] : fact.value;
    if (value === "") {
      const slot_evidence = { ...next.slot_evidence };
      delete slot_evidence[fact.id];
      next = { ...next, slot_evidence, slots: { ...next.slots, [fact.id]: null }, slot_meta: { ...next.slot_meta, [fact.id]: { source: "answered", confidence: 1, evidence: "Client chose to leave this unanswered during demo review" } } };
      continue;
    }
    if (!fact.options.some((option) => option.value === value)) continue;
    if (fact.source === "inferred" || value !== fact.value) {
      next = applyAnswer(next, fact.id, value);
      const slot_evidence = { ...next.slot_evidence };
      if (value !== fact.value) delete slot_evidence[fact.id];
      next = { ...next, slot_evidence, slot_meta: { ...next.slot_meta, [fact.id]: { source: "answered", confidence: 1, evidence: value !== fact.value ? "Client corrected this fact during demo review" : fact.id === "severance_deadline" && deadline ? `Client confirmed this fact during demo review; stated response date: ${deadline.dateText}` : "Client confirmed this fact during demo review" } } };
    }
  }
  return scoreDemoState({ ...next, questionHistory: state.questionHistory });
}
