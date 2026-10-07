import { BLUEPRINT_RESPONSE_SCHEMA } from "./output";
import { attachProviderEvidenceSelection, buildDesiredClientEvidenceGroups, DESIRED_CLIENT_EVIDENCE_SLOTS, resolveEvidenceGroupSelection, type DesiredClientEvidenceSlot } from "./evidence-contract";
import { buildStructuredBlueprintV4 } from "./structured-blueprint";
import type { DesiredClientAnswers } from "./types";

/** Keep provider constraints small; the full validator enforces semantic rules. */
export function providerStructureSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(providerStructureSchema);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(Object.entries(schema).filter(([key]) => !["minItems", "maxItems"].includes(key))
    .map(([key, value]) => [key, providerStructureSchema(value)]));
}

/** App-owned target references keep the confirmed matter and its followups intact. */
export function providerTargetClaimIds(answers: DesiredClientAnswers): string[] {
  return buildStructuredBlueprintV4(answers).client_and_matter.claims.map((_, index) => `target_claim_${index + 1}`);
}

export function decodeProviderTargetCard(value: unknown, answers: DesiredClientAnswers): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const root = value as Record<string, unknown>;
  if (!root.brief || typeof root.brief !== "object" || Array.isArray(root.brief)) return value;
  const brief = root.brief as Record<string, unknown>;
  const card = brief.client_and_matter;
  if (!card || typeof card !== "object" || Array.isArray(card)) return value;
  const selection = card as Record<string, unknown>;
  const expectedIds = providerTargetClaimIds(answers);
  if (Object.keys(selection).length !== 1 || !Array.isArray(selection.claim_ids) ||
    selection.claim_ids.length !== expectedIds.length || !selection.claim_ids.every((id, index) => id === expectedIds[index])) {
    return { ...root, brief: { ...brief, client_and_matter: { provider_target_selection_invalid: true } } };
  }
  return { ...root, brief: { ...brief, client_and_matter: buildStructuredBlueprintV4(answers).client_and_matter } };
}

function decodeStatement(value: unknown, slot: DesiredClientEvidenceSlot, answers: DesiredClientAnswers): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const groups = buildDesiredClientEvidenceGroups(slot, answers);
  const rawIds = source.evidence_group_ids;
  const selection = resolveEvidenceGroupSelection(slot, rawIds, answers);
  const safeGroupIds = Array.isArray(rawIds)
    ? rawIds.filter((id): id is string => typeof id === "string" && groups.some(group => group.id === id)).slice(0, 8)
    : [];
  const validShape = Object.keys(source).length === 2 && Object.hasOwn(source, "text") && Object.hasOwn(source, "evidence_group_ids");
  const decoded: Record<string, unknown> = {
    text: source.text,
    kind: selection.kind ?? "unknown",
    source_answer_ids: selection.source_answer_ids,
    evidence_basis: selection.evidence_basis ?? "unknown",
  };
  attachProviderEvidenceSelection(decoded, { slot, groupIds: safeGroupIds, valid: selection.valid && validShape });
  return decoded;
}

/** Decode only registered group IDs. Source IDs, kind and basis are never provider decisions. */
export function decodeProviderEvidenceGroups(value: unknown, answers: DesiredClientAnswers): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const root = value as Record<string, unknown>;
  if (!root.brief || typeof root.brief !== "object" || Array.isArray(root.brief)) return value;
  const brief = root.brief as Record<string, unknown>;
  const components = brief.definition_components;
  if (components && typeof components === "object" && !Array.isArray(components)) {
    const partSlots = { client: "definition_client_type", client_matter: "definition_client_matter", reasons: "definition_reasons", outcome: "definition_outcome" } as const;
    const next = { ...(components as Record<string, unknown>) };
    for (const [field, slot] of Object.entries(partSlots) as Array<[keyof typeof partSlots, typeof partSlots[keyof typeof partSlots]]>) {
      if (Object.hasOwn(next, field)) next[field] = decodeStatement(next[field], slot, answers);
    }
    brief.definition_components = next;
  }
  for (const slot of ["client_goals_needs", "why_firm_wants_work", "why_client_chooses_firm", "recognizable_circumstances", "evidence_and_open_questions"] as const) {
    const card = brief[slot];
    if (!card || typeof card !== "object" || Array.isArray(card)) continue;
    const claims = (card as Record<string, unknown>).claims;
    if (Array.isArray(claims)) brief[slot] = { ...(card as Record<string, unknown>), claims: claims.map(claim => decodeStatement(claim, slot, answers)) };
  }
  const pathway = brief.decision_pathway;
  if (pathway && typeof pathway === "object" && !Array.isArray(pathway)) {
    const decodedPathway = { ...(pathway as Record<string, unknown>) };
    for (const field of ["trigger", "first_contact", "decision", "desired_progress"] as const) {
      const slot = `decision_pathway.${field}` as DesiredClientEvidenceSlot;
      if (Object.hasOwn(decodedPathway, field)) decodedPathway[field] = decodeStatement(decodedPathway[field], slot, answers);
    }
    brief.decision_pathway = decodedPathway;
  }
  return { ...root, brief, ...(Object.hasOwn(root, "clarification_code") ? {} : { clarification_code: null }) };
}

export function providerBlueprintSchema(answers: DesiredClientAnswers): unknown {
  const schema = providerStructureSchema(BLUEPRINT_RESPONSE_SCHEMA) as unknown as {
    properties: { clarification_code?: unknown; brief: { properties: Record<string, any>; required: string[] } };
    required: string[];
  };
  delete schema.properties.clarification_code;
  schema.required = ["brief"];
  const sections = schema.properties.brief.properties;
  const canonical = buildStructuredBlueprintV4(answers);
  const setStatement = (value: unknown, slot: DesiredClientEvidenceSlot, textDescription: string, exactText?: string) => {
    const node = value as { required: string[]; properties: { text: { description?: string; enum?: string[] }; evidence_group_ids: { description?: string; items: { enum?: string[] }; minItems?: number; maxItems?: number } } };
    const groups = buildDesiredClientEvidenceGroups(slot, answers);
    node.required = ["text", "evidence_group_ids"];
    const firstContactGap = slot === "decision_pathway.first_contact" && !answers.situation.contact && !answers.write_ins?.contact?.trim()
      ? " The answers do not establish first contact. State that gap plainly, select only the registered unanswered situation.contact group, and do not infer contact behaviour from the client's role, timing or decision context."
      : "";
    node.properties.text.description = `${textDescription}${firstContactGap} Use only the facts supported by the selected evidence groups. A number is valid only with the same value, unit, currency, range and period in a selected source; never calculate, round or invent a figure.`;
    if (exactText !== undefined) node.properties.text.enum = [exactText];
    node.properties.evidence_group_ids.items.enum = groups.map(group => group.id);
    node.properties.evidence_group_ids.minItems = 1;
    node.properties.evidence_group_ids.maxItems = Math.min(8, groups.length);
    node.properties.evidence_group_ids.description = "Select one or more registered evidence_group_ids for this exact slot. Each group already binds its source answer IDs, evidence basis and display kind. Groups may be bundled only when their basis and kind match, their source IDs do not overlap, and the claim preserves every supported fact. Do not return source_answer_ids, kind or evidence_basis; the application derives those fields.";
  };
  const textDescriptions: Record<string, string> = {
    definition_client_type: "A concise, specific noun phrase for the desired client. Prefer a plural group such as 'Ontario business owners'; for one person, use a grammatically complete phrase such as 'an owner or founder of an Ontario owner-managed company'. Do not capitalize a common role label or describe the law firm as its own client.",
    definition_client_matter: "At most 75 words and 600 characters. Preserve the specific client situation, legal engagement and timing supplied by the firm. Keep it focused on the engagement and stage, without replacing it with a broad practice area.",
    definition_reasons: "A grammatical clause with its own subject, at most 35 words and 300 characters.",
    definition_outcome: "A concise proposed outcome, target and review period. Preserve the firm's exact measure and timing.",
    client_goals_needs: "One grounded claim, at most 50 words and 400 characters. Keep known goals separate from unknown choice factors.",
    why_firm_wants_work: "One grounded claim, at most 50 words and 400 characters. Preserve separate payment and payment-context statements when their evidence groups have different bases. This card may contain up to seven claims.",
    why_client_chooses_firm: "One grounded claim, at most 50 words and 400 characters. Separate client-choice details from the firm's selected strength and from reported experience.",
    recognizable_circumstances: "One grounded claim, at most 50 words and 400 characters. Keep observable facts and evidence gaps separate.",
    evidence_and_open_questions: "One grounded claim, at most 50 words and 400 characters. Preserve consequential gaps, records, feedback, estimates and preferences as separate evidence.",
    "decision_pathway.trigger": "One concise statement, at most 30 words and 240 characters, about the event that prompts the client to seek help.",
    "decision_pathway.first_contact": "One concise statement, at most 30 words and 240 characters, about how the client reaches the firm. Do not infer a contact pattern from other answers.",
    "decision_pathway.decision": "One concise statement, at most 30 words and 240 characters, about the client's decision or participants.",
    "decision_pathway.desired_progress": "One concise statement, at most 30 words and 240 characters, about progress the client seeks.",
  };
  const componentSlots = { client: "definition_client_type", client_matter: "definition_client_matter", reasons: "definition_reasons", outcome: "definition_outcome" } as const;
  for (const [field, slot] of Object.entries(componentSlots) as Array<[keyof typeof componentSlots, typeof componentSlots[keyof typeof componentSlots]]>) {
    const statement = (sections.definition_components.properties as Record<string, unknown>)[field];
    setStatement(statement, slot, textDescriptions[slot], canonical.definition_components[field].text);
  }
  for (const slot of ["client_goals_needs", "why_firm_wants_work", "why_client_chooses_firm", "recognizable_circumstances", "evidence_and_open_questions"] as const) {
    const card = sections[slot] as { properties: { claims: { items: unknown; minItems?: number; maxItems?: number } } };
    card.properties.claims.minItems = 1;
    card.properties.claims.maxItems = slot === "why_firm_wants_work" ? 7 : 6;
    setStatement(card.properties.claims.items, slot, textDescriptions[slot]);
  }
  const pathway = sections.decision_pathway as { properties: Record<string, unknown> };
  for (const field of ["trigger", "first_contact", "decision", "desired_progress"] as const) {
    const slot = `decision_pathway.${field}` as DesiredClientEvidenceSlot;
    setStatement(pathway.properties[field], slot, textDescriptions[slot]);
  }
  const targetIds = providerTargetClaimIds(answers);
  sections.client_and_matter = {
    type: "object",
    properties: { claim_ids: { type: "array", items: { type: "string", enum: targetIds }, minItems: targetIds.length, maxItems: targetIds.length,
      description: "Copy the complete ordered grounded_target_claim_ids list. The application resolves each reference to its confirmed claim and citations." } },
    required: ["claim_ids"],
  };
  return schema;
}
