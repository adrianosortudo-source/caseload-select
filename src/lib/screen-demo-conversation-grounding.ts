import type { EngineState } from "./screen-engine/types";
import { familyNegativeIsGrounded } from "./screen-engine/llm/extractor";
import { demoCapturedFacts } from "./screen-demo-confirmation";

/** Only a person's literal words can ground a demo fact; AI guesses remain inferred. */
export function groundDemoConversationFacts(state: EngineState, userText: string): EngineState {
  const text = userText.trim();
  if (!text) return state;
  const candidates: Record<string, string> = {};
  if (state.matter_type === "family_general") {
    const hasChildClause = text.split(/[.!?;\n]+/).find((part) =>
      !/\b(?:no|not|never|without|don't|do not|doesn't|does not)\b/i.test(part) &&
      /\b(?:i|we)\s+(?:have|share)\s+[^.!?;\n]{0,45}\b(?:son|daughter|child|children|kids)\b/i.test(part));
    if (/\b(?:my|our)\s+(?:son|daughter|child|children|kids)\b/i.test(text) || hasChildClause) candidates.family_children = "Yes";
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
    const datePattern = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi;
    const scheduledClauses = text.split(/[.!?;\n]+/).map((part) => part.trim()).filter((part) =>
      /\b(?:case conference|court date|hearing|trial|deadline|respond by|response due)\b/i.test(part) &&
      [...part.matchAll(datePattern)].length === 1 &&
      /\b(?:is|was|scheduled|set|on|by)\b/i.test(part) &&
      !/\b(?:no|not|never|without|unsure|maybe|might|could|if|whether|between|or)\b/i.test(part));
    const scheduledDate = scheduledClauses.length === 1 ? scheduledClauses[0] : undefined;
    if (!noDateSentence && scheduledDate) candidates.family_timing = scheduledDate;
    const date = state.slots.family_timing;
    const dateSentence = date && text.split(/[.!?;\n]+/).find((part) => part.toLowerCase().includes(date.toLowerCase()) && /\b(?:court|hearing|conference|deadline|respond|date)\b/i.test(part) && [...part.matchAll(datePattern)].length <= 1 && !/\b(?:no|not|never|without|unsure|maybe|if|between|or)\b/i.test(part));
    if (!noDateSentence && scheduledClauses.length === 0 && !scheduledDate && date && dateSentence) candidates.family_timing = date;
  }
  // A single literal dollar figure can support an already-proposed invoice range.
  // Refuse boundaries, approximations, multiple amounts and ranges rather than guessing.
  if (state.matter_type === "unpaid_invoice" && state.slot_meta.amount_at_stake?.source === "llm_inferred") {
    const amounts = [...text.matchAll(/\$\s*([0-9][0-9,.]*)([a-zA-Z]*)/g)];
    if (amounts.length === 1) {
      const match = amounts[0];
      const raw = match[1];
      const before = text.slice(Math.max(0, (match.index ?? 0) - 30), match.index);
      const after = text.slice((match.index ?? 0) + match[0].length);
      const valid = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(raw) && !match[2] &&
        !/\b(?:between|from|about|around|approximately|over|under|at least|up to|less than|more than|not|never)\s*$/i.test(before) &&
        !/^\s*(?:-|–|—|to\b|and\b|or\b)\s*\$?\s*\d/i.test(after);
      if (valid) {
        const amount = Number(raw.replace(/,/g, ""));
        const bucket = amount <= 0 || [5000, 25000, 100000].includes(amount) ? null :
          amount < 5000 ? "Under $5,000" : amount < 25000 ? "$5,000–$25,000" :
          amount < 100000 ? "$25,000–$100,000" : "Over $100,000";
        if (bucket && state.slots.amount_at_stake === bucket) candidates.amount_at_stake = bucket;
      }
    }
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
