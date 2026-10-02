import { allowedSourceAnswerPathsForAnswers, BLUEPRINT_RESPONSE_SCHEMA } from "./output";
import { resolveAnswerReference } from "./catalog";
import type { AnswerReferencePath, DesiredClientAnswers } from "./types";

/** Keep provider constraints small; the full validator enforces semantic rules. */
export function providerStructureSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(providerStructureSchema);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(Object.entries(schema).filter(([key]) =>
    !["minItems", "maxItems"].includes(key),
  ).map(([key, value]) => [key, providerStructureSchema(value)]));
}

export function providerSourceAliases(answers: DesiredClientAnswers): Record<string, string> {
  const slots = ["definition_client_type", "definition_client_matter", "definition_reasons", "definition_outcome", "client_and_matter", "client_goals_needs", "why_firm_wants_work", "why_client_chooses_firm", "recognizable_circumstances", "evidence_and_open_questions", "decision_pathway"];
  const paths = [...new Set(slots.flatMap(slot => allowedSourceAnswerPathsForAnswers(slot, answers)))];
  return Object.fromEntries(paths.map((path, index) => [`s${index}`, path]));
}

export function decodeProviderSources(value: unknown, aliases: Record<string, string>): unknown {
  if (Array.isArray(value)) return value.map(item => decodeProviderSources(item, aliases));
  if (!value || typeof value !== "object") return value;
  const decoded = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "source_answer_ids" && Array.isArray(item)
    ? [...new Set(item.map(id => typeof id === "string" && Object.hasOwn(aliases, id) ? aliases[id] : id))]
    : decodeProviderSources(item, aliases)]));
  // The display kind is derived from the validated evidence basis, never guessed
  // independently by the model. Full provenance validation still follows.
  const kinds: Record<string,string> = { firm_reported_recorded:"experience",firm_reported_estimate:"hypothesis",firm_reported_experience:"experience",firm_reported_observation:"experience",client_reported:"experience",firm_preference:"preference",source_observed:"experience",hypothesis:"hypothesis",unknown:"unknown" };
  if (typeof decoded.evidence_basis === "string" && Object.hasOwn(kinds, decoded.evidence_basis)) decoded.kind = kinds[decoded.evidence_basis];
  if (Object.hasOwn(decoded, "brief") && !Object.hasOwn(decoded, "clarification_code")) decoded.clarification_code = null;
  return decoded;
}

export function providerBlueprintSchema(answers: DesiredClientAnswers): unknown {
  const schema = providerStructureSchema(BLUEPRINT_RESPONSE_SCHEMA) as typeof BLUEPRINT_RESPONSE_SCHEMA;
  delete (schema.properties as {clarification_code?:unknown}).clarification_code;
  (schema as {required:readonly string[]}).required = ["brief"];
  const aliases = providerSourceAliases(answers);
  const sections = schema.properties.brief.properties;
  const setPaths = (statement: unknown, slot: string) => {
    const node = statement as { required:string[]; properties: { kind?:unknown; text:{description?:string}; source_answer_ids: { items: { enum?: string[] }; minItems?:number; maxItems?:number }; evidence_basis: { enum: string[]; description?:string } } };
    delete node.properties.kind;
    node.required = node.required.filter(key => key !== "kind");
    node.properties.text.description = slot === "definition_client_matter"
      ? "At most 75 words and 600 characters. Preserve the specific legal work or agreement, represented side, situation and timing supplied by the firm. Do not reduce the engagement to a broad transaction category."
      : slot === "definition_reasons"
      ? "A grammatical clause with its own subject, such as 'the work fits the firm's experience'. At most 35 words and 300 characters. Do not start with 'because' or a subjectless verb such as 'uses'."
      : slot.startsWith("definition_")
      ? "A concise fragment, at most 25 words and 240 characters. Put supporting details in the cards."
      : slot === "decision_pathway" ? "One concise statement, at most 30 words and 240 characters."
      : "One grounded claim, at most 50 words and 400 characters. Preserve additional detail in separate claims.";
    const allowed: string[] = allowedSourceAnswerPathsForAnswers(slot, answers).filter(path => {
      try {
        const source = resolveAnswerReference(path as AnswerReferencePath, answers);
        return source.present && source.value !== null && source.value !== "" && (!Array.isArray(source.value) || source.value.length > 0);
      } catch { return false; }
    });
    node.properties.source_answer_ids.items.enum = Object.entries(aliases).filter(([,path]) => allowed.includes(path)).map(([alias]) => alias);
    node.properties.source_answer_ids.minItems = 1;
    // Contribution validation needs all five economics sources. The provider
    // must be able to cite that complete set if it returns such a statement.
    node.properties.source_answer_ids.maxItems = slot === "why_firm_wants_work" ? 6 : 4;
    const bases = ["firm_preference", "hypothesis", "unknown"];
    if (["practice.experience", "practice.capability", "practice.client_strength_support"].some(path => allowed.includes(path))) bases.push("firm_reported_experience");
    for (const [prefix, basis] of [["value.", answers.value.amount_basis], ["opportunity.", answers.opportunity.data_basis]] as const) {
      if (allowed.some(path => path.startsWith(prefix)) && basis === "recorded") bases.push("firm_reported_recorded");
      if (allowed.some(path => path.startsWith(prefix)) && basis === "estimated") bases.push("firm_reported_estimate");
    }
    for (const [path, basis] of [["client.choice_basis", answers.client.choice_basis], ["client.pathway_basis", answers.client.pathway_basis]] as const) {
      if (allowed.includes(path) && basis === "client_feedback") bases.push("client_reported");
      if (allowed.includes(path) && basis === "firm_observation") bases.push("firm_reported_observation");
    }
    if (allowed.includes("opportunity.sources") && answers.opportunity.sources.some(source => source !== "unknown" && source !== "no_evidence")) bases.push("source_observed");
    node.properties.evidence_basis.enum = slot.startsWith("definition_") ? ["firm_preference", "hypothesis", "unknown"] : [...new Set(bases)];
    const experienceIds = Object.entries(aliases).filter(([,path]) => allowed.includes(path) && ["practice.experience", "practice.capability", "practice.client_strength_support"].includes(path)).map(([id]) => id);
    const financialEvidenceIds = (basis: "recorded" | "estimated") => Object.entries(aliases).filter(([, path]) => allowed.includes(path) && (
      path.startsWith("value.") && answers.value.amount_basis === basis ||
      path.startsWith("opportunity.") && answers.opportunity.data_basis === basis
    )).map(([id]) => id).join(", ") || "none (do not use this basis)";
    const feedbackIds = Object.entries(aliases).filter(([, path]) => allowed.includes(path) && path.startsWith("client.choice_") && path !== "client.choice_basis").map(([id]) => id).join(", ") || "none (do not use client_reported)";
    const observedPathwayIds = Object.entries(aliases).filter(([, path]) => allowed.includes(path) && (
      path.startsWith("situation.") || ["client.goals", "client.goal_detail", "client.concerns", "client.decision_needs", "client.decision_context"].includes(path)
    )).map(([id]) => id).join(", ") || "none (do not use firm_reported_observation)";
    node.properties.evidence_basis.description = `For client_reported, cite relevant client choice details from ${feedbackIds} and client.choice_basis; do not combine them with situation or client-goal sources in the same claim unless client.pathway_basis is also cited and both selected bases are client_feedback. For firm_reported_observation, cite relevant observed situation or client-pathway details from ${observedPathwayIds} and client.pathway_basis; do not combine them with client choice sources unless client.choice_basis is also cited and both selected bases are firm_observation. Keep claims separate when client.choice_basis and client.pathway_basis differ. For firm_reported_recorded you MUST cite at least one of ${financialEvidenceIds("recorded")}. For firm_reported_estimate you MUST cite at least one of ${financialEvidenceIds("estimated")}; a qualitative preference or capability alone is not an estimate. For firm_reported_experience you MUST cite at least one of ${experienceIds.join(", ") || "none (do not use this basis)"}. For unknown, cite only unknown/empty answers and state the gap. For any statement with a known source and no supporting record, estimate or observation, use firm_preference or hypothesis. Never select a basis supported only by some other claim in the report.`;
  };
  for (const [key, slot] of Object.entries({client:"definition_client_type",client_matter:"definition_client_matter",reasons:"definition_reasons",outcome:"definition_outcome"})) {
    setPaths(sections.definition_components.properties[key as keyof typeof sections.definition_components.properties], slot);
  }
  for (const slot of ["client_and_matter","client_goals_needs","why_firm_wants_work","why_client_chooses_firm","recognizable_circumstances","evidence_and_open_questions"] as const) setPaths(sections[slot].properties.claims.items, slot);
  for (const statement of Object.values(sections.decision_pathway.properties)) setPaths(statement, "decision_pathway");
  if (!answers.client.decision_context.trim() && (!answers.client.pathway_basis || answers.client.pathway_basis === "unknown")) {
    const contextId = Object.keys(aliases).find(id => aliases[id] === "client.decision_context")!;
    for (const key of ["first_contact", "decision"] as const) {
      const statement = sections.decision_pathway.properties[key];
      (statement.properties.source_answer_ids.items as {enum?:string[]}).enum = [contextId];
      (statement.properties.evidence_basis as {enum:readonly string[]}).enum = ["unknown"];
      (statement.properties.text as {description?:string}).description = "State plainly that this part of the client's decision pathway has not yet been established. Do not invent a behaviour or sequence.";
    }
  }
  return schema;
}
