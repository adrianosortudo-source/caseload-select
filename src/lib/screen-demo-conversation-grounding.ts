import type { EngineState } from "./screen-engine/types";
import { familyNegativeIsGrounded } from "./screen-engine/llm/extractor";
import { demoCapturedFacts } from "./screen-demo-confirmation";

/** Only a person's literal words can ground a demo fact; AI guesses remain inferred. */
export function groundDemoConversationFacts(state: EngineState, userText: string): EngineState {
  const text = userText.trim();
  if (!text) return state;
  const candidates: Record<string, string> = {};
  if (state.matter_type === "family_general") {
    if (/\b(?:my|our)\s+(?:son|daughter|child|children|kids)\b/i.test(text)) candidates.family_children = "Yes";
    else if (/\b(?:no (?:children|kids)|(?:do not|don't|dont) have (?:any )?(?:children|kids))\b/i.test(text)) candidates.family_children = "No";
    const parentingClause = text.split(/[.!?;\n]+/).find((part) => /\b(?:parenting|custody|access to (?:my|our) (?:son|daughter|child|children|kids))\b/i.test(part) && !/\b(?:not seeking|do not want|don't want|no need for|not about)\b/i.test(part));
    if (state.slots.family_help_sought === "Parenting or decision-making" && (parentingClause ||
        /\b(?:not|won't|wont|refus(?:es|ing)|prevent(?:s|ing)?|stopp?ed)\b[^.!?\n]{0,80}\bsee\b[^.!?\n]{0,40}\b(?:my|our)\s+(?:son|daughter|child|children|kids)\b/i.test(text) ||
        /\bkeep(?:s|ing)?\s+me\s+away\s+from\s+(?:my|our)\s+(?:son|daughter|child|children|kids)\b/i.test(text))) {
      candidates.family_help_sought = "Parenting or decision-making";
    }
    if (/\b(?:i|we)\s+(?:live|reside|are based)\s+in\s+(?:[a-z][a-z .'-]{0,40},\s*)?ontario\b/i.test(text)) candidates.family_jurisdiction = "Ontario";
    const orderValue = state.slots.family_existing_order;
    if (orderValue === "Neither" && familyNegativeIsGrounded("family_existing_order", orderValue, text)) candidates.family_existing_order = orderValue;
    const orderSentence = text.split(/[.!?;\n]+/).find((part) =>
      !/\b(?:no|not|never|without|unsure|maybe|if)\b/i.test(part) &&
      /\b(?:(?:i|we) have (?:an? |the |existing )?(?:(?:court|parenting) )?order|there is (?:an? |the |existing )?(?:(?:court|parenting) )?order|(?:a |the )?(?:judge|court) (?:made|issued) (?:an? |the )?order|(?:court|parenting) order (?:is |was )?(?:in place|issued|dated))\b/i.test(part));
    if (orderValue === "Court order" && orderSentence) candidates.family_existing_order = orderValue;
    const noDateSentence = text.split(/[.!?;\n]+/).map((part) => part.trim()).find((part) =>
      /\bno\s+(?:upcoming\s+)?(?:court\s+)?(?:date|hearing|deadline)\b/i.test(part) &&
      !/\b(?:not sure|unsure|maybe|if|whether|don't know|do not know)\b/i.test(part));
    if (noDateSentence) candidates.family_timing = noDateSentence;
    const date = state.slots.family_timing;
    const dateSentence = date && text.split(/[.!?;\n]+/).find((part) => part.toLowerCase().includes(date.toLowerCase()) && /\b(?:court|hearing|conference|deadline|respond|date)\b/i.test(part) && !/\b(?:no|not|never|without|unsure|maybe|if)\b/i.test(part));
    if (!noDateSentence && date && dateSentence) candidates.family_timing = date;
  }
  // These existing proposals already require literal, clause-local evidence.
  const proposed = demoCapturedFacts({ ...state, input: text });
  for (const id of ["decision_authority", "proof_of_performance", "desired_outcome_unpaid_invoice"]) {
    const fact = proposed.find((item) => item.id === id && item.source === "inferred");
    if (!fact) continue;
    const expected: Record<string, string> = { decision_authority: "Just me", proof_of_performance: "Yes", desired_outcome_unpaid_invoice: "Send demand letter" };
    if (fact.value !== expected[id]) continue;
    const supportingClause = text.split(/[.!?;\n]+/).find((clause) => {
      if (/\b(?:not|never|cannot|can't|don't|might|may|maybe|unsure|uncertain|if)\b/i.test(clause)) return false;
      if (id === "decision_authority") return /\b(?:i (?:am the owner and )?can approve hiring a lawyer|i (?:own|run) [^.!?;\n]{1,100}\band can decide whether to hire a lawyer|i alone (?:decide|can decide) (?:whether(?: to)?|to) hire a lawyer)\b/i.test(clause);
      if (id === "proof_of_performance") return /\b(?:i|we) (?:have|possess) (?:the |our |some )?(?:emails?|records?|documents?) (?:confirming|showing|proving) (?:the )?delivery\b/i.test(clause);
      return /\bi (?:want|would like)(?: advice about| help (?:with|sending)| to send)? (?:a )?demand letter\b/i.test(clause);
    });
    if (supportingClause) candidates[id] = fact.value;
  }
  const slots = { ...state.slots };
  const slot_meta = { ...state.slot_meta };
  let changed = false;
  for (const [id, value] of Object.entries(candidates)) {
    const current = slot_meta[id]?.source;
    if (current && current !== "llm_inferred" && current !== "unknown") continue;
    slots[id] = value;
    slot_meta[id] = { source: "explicit", confidence: 1, evidence: text };
    changed = true;
  }
  return changed ? { ...state, slots, slot_meta } : state;
}
