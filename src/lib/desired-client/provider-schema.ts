import { allowedSourceAnswerPathsForAnswers, BLUEPRINT_RESPONSE_SCHEMA, isUnresolvedEvidenceSource } from "./output";
import { resolveAnswerReference } from "./catalog";
import { buildStructuredBlueprintV4 } from "./structured-blueprint";
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

/** Present confirmed statements in the same compact form the provider returns.
 * Display kind is derived on decoding, so it is never an extra model decision. */
export function encodeProviderSources(value: unknown, aliases: Record<string, string>): unknown {
  const ids = Object.fromEntries(Object.entries(aliases).map(([id, path]) => [path, id]));
  const encode = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(encode);
    if (!item || typeof item !== "object") return item;
    const statement = Object.hasOwn(item, "evidence_basis");
    return Object.fromEntries(Object.entries(item).filter(([key]) => !statement || key !== "kind").map(([key, child]) => [
      key, key === "source_answer_ids" && Array.isArray(child)
        ? child.map(path => typeof path === "string" && Object.hasOwn(ids, path) ? ids[path] : path)
        : encode(child),
    ]));
  };
  return encode(value);
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
    const textDescription = slot === "definition_client_type"
      ? "A concise, specific noun phrase for the desired client. Prefer a plural group such as 'Ontario business owners'; for one person, use a grammatically complete phrase such as 'an owner or founder of an Ontario owner-managed company'. Do not capitalize a common role label or describe the law firm as its own client."
      : slot === "definition_client_matter"
      ? "At most 75 words and 600 characters. Return a concise description of the client's situation, specific legal engagement and timing. A noun phrase or complete clause is acceptable because the application presents this as a quoted matter description. Preserve the represented side, specific legal work or agreement, and timing supplied by the firm. Do not infer a client type, geography, transaction or agreement that the firm did not supply. Keep the description focused on the legal engagement and stage; do not repeat the supplied practical benefit or the same decision endpoint, and do not reduce the engagement to a broad transaction category. The application rebuilds the final client type and matter definition directly from the firm's answers."
      : slot === "definition_reasons"
      ? "A grammatical clause with its own subject, such as 'the work fits the firm's experience'. At most 35 words and 300 characters. Do not start with 'because' or a subjectless verb such as 'uses'."
      : slot.startsWith("definition_")
      ? "A concise fragment, at most 25 words and 240 characters. Put supporting details in the cards."
      : slot === "client_and_matter" ? "Copy the confirmed grounded_target claims exactly. Each may contain up to 95 words and 650 characters; do not shorten or paraphrase the supplied legal engagement."
      : slot === "decision_pathway" ? "One concise statement, at most 30 words and 240 characters."
      : "One grounded claim, at most 50 words and 400 characters. Preserve additional detail in separate claims.";
    node.properties.text.description = `${textDescription} A simple count written as a word or digits is equivalent only for the same value (for example, “two matters” and “2 matters”). Keep its unit, currency, range and period faithful to the cited answer; never calculate, round or invent a figure.`;
    const allowed: string[] = allowedSourceAnswerPathsForAnswers(slot, answers).filter(path => {
      try {
        const source = resolveAnswerReference(path as AnswerReferencePath, answers);
        // Unknown or unanswered answers are valid citations for an explicit
        // evidence gap. The validator accepts them only with evidence_basis
        // "unknown"; omitting them here makes the provider unable to support
        // gaps such as an unrecorded first-contact pattern.
        // The registered source path determines which answers are relevant to
        // this claim. The two evidence-gap cards may cite an unanswered value;
        // output.ts then requires evidence_basis "unknown". Other cards retain
        // their populated-source contract so empty fields do not dilute claims.
        const empty=source.value===null||source.value===""||(Array.isArray(source.value)&&source.value.length===0);
        const supportsGaps=slot==="recognizable_circumstances"||slot==="evidence_and_open_questions";
        return source.present&&(supportsGaps||(slot==="decision_pathway"&&source.unknown)||!empty);
      } catch { return false; }
    });
    node.properties.source_answer_ids.items.enum = Object.entries(aliases).filter(([,path]) => allowed.includes(path)).map(([alias]) => alias);
    node.properties.source_answer_ids.minItems = 1;
    // Match the application contract, including a confirmed negative-economics
    // rationale that cites both preference and the five economics sources.
    node.properties.source_answer_ids.maxItems = 8;
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
    const hasChoiceSources = feedbackIds !== "none (do not use client_reported)";
    const hasPathwaySources = observedPathwayIds !== "none (do not use firm_reported_observation)";
    const clientEvidenceGuidance = [
      hasChoiceSources ? `For client-choice details, client_reported requires client.choice_basis=client_feedback and firm_reported_observation requires client.choice_basis=firm_observation; cite only relevant details from ${feedbackIds}.` : "Do not use client-choice details in this statement.",
      hasPathwaySources ? `For pathway or situation details, client_reported requires client.pathway_basis=client_feedback and firm_reported_observation requires client.pathway_basis=firm_observation; cite only relevant details from ${observedPathwayIds}.` : "Do not use pathway or situation details in this statement.",
      hasChoiceSources && hasPathwaySources ? "If a statement cites both source groups, cite both basis answers and use the evidence basis only when both selections match; otherwise keep the claims separate." : "Do not add a second source group to this statement.",
    ].join(" ");
    const gapIds = Object.entries(aliases).filter(([, path]) => allowed.includes(path) && isUnresolvedEvidenceSource(path, answers)).map(([id]) => id);
    node.properties.evidence_basis.description = `${clientEvidenceGuidance} For firm_reported_recorded you MUST cite at least one of ${financialEvidenceIds("recorded")}. For firm_reported_estimate you MUST cite at least one of ${financialEvidenceIds("estimated")}; a qualitative preference or capability alone is not an estimate. For firm_reported_experience you MUST cite at least one of ${experienceIds.join(", ") || "none (do not use this basis)"}. For unknown, cite only these evidence-gap IDs: ${gapIds.join(", ") || "none (no gap claim is supported for this slot)"}, and state the gap. Any statement citing an evidence-gap ID MUST use unknown, including a populated description of demand uncertainty or 'No evidence yet'; neither is proof of demand. Known claims must not cite evidence-gap IDs. For any statement with a known source and no supporting record, estimate or observation, use firm_preference or hypothesis. Never select a basis supported only by some other claim in the report.`;
    if (slot === "why_client_chooses_firm") node.properties.evidence_basis.description += " A selected practice.client_strength and its proposed effect are firm_preference, not firm_reported_experience. Keep the stated strength separate from reported experience, which must cite practice.experience, practice.capability or practice.client_strength_support. A label containing the word 'experience' is not itself supporting experience.";
  };
  for (const [key, slot] of Object.entries({client:"definition_client_type",client_matter:"definition_client_matter",reasons:"definition_reasons",outcome:"definition_outcome"})) {
    setPaths(sections.definition_components.properties[key as keyof typeof sections.definition_components.properties], slot);
  }
  // These components are already determined from the firm's answers. A single
  // enum value prevents the provider's prose instructions from paraphrasing a
  // target that the unchanged grounding validator must reject.
  const groundedProfile = buildStructuredBlueprintV4(answers);
  const grounded = groundedProfile.definition_components;
  for (const key of ["client", "client_matter", "reasons"] as const) {
    const node = sections.definition_components.properties[key];
    (node.properties.text as {enum?: string[]}).enum = [grounded[key].text];
    (node.properties.evidence_basis as {enum: readonly string[]}).enum = [grounded[key].evidence_basis];
    (node.properties.source_answer_ids.items as {enum?: string[]}).enum = Object.entries(aliases)
      .filter(([, path]) => grounded[key].source_answer_ids.includes(path as AnswerReferencePath)).map(([id]) => id);
    const sourceCount = node.properties.source_answer_ids as {minItems: number; maxItems: number};
    sourceCount.minItems = grounded[key].source_answer_ids.length;
    sourceCount.maxItems = grounded[key].source_answer_ids.length;
  }
  for (const slot of ["client_and_matter","client_goals_needs","why_firm_wants_work","why_client_chooses_firm","recognizable_circumstances","evidence_and_open_questions"] as const) setPaths(sections[slot].properties.claims.items, slot);
  // The confirmed card can contain a current stage-two clarification as well
  // as the primary matter. Both are required by the grounding validator.
  const targetClaims = groundedProfile.client_and_matter.claims;
  const targetArray = sections.client_and_matter.properties.claims as typeof sections.client_and_matter.properties.claims & { minItems: number; maxItems: number; description: string };
  targetArray.minItems = targetClaims.length;
  targetArray.maxItems = targetClaims.length;
  targetArray.description = "Copy every grounded_target.client_and_matter_claims statement exactly in its supplied order, including current clarification claims. Do not omit a clarification, add a claim, paraphrase its text, or change its evidence status.";
  (targetArray.items.properties.text as {enum?: string[]}).enum = targetClaims.map(claim => claim.text);
  (targetArray.items.properties.evidence_basis as {enum: readonly string[]}).enum = [...new Set(targetClaims.map(claim => claim.evidence_basis))];
  (targetArray.items.properties.source_answer_ids.items as {enum?: string[]}).enum = Object.entries(aliases)
    .filter(([, path]) => targetClaims.some(claim => claim.source_answer_ids.includes(path as AnswerReferencePath))).map(([id]) => id);
  for (const [field, statement] of Object.entries(sections.decision_pathway.properties)) {
    setPaths(statement, "decision_pathway");
    if (field === "first_contact" && !answers.situation.contact && !answers.write_ins?.contact?.trim()) {
      (statement.properties.text as {description?:string}).description = "The answers do not establish who initiates first contact or how the client reaches the firm. State that gap plainly. Cite only the unanswered situation.contact answer and use evidence_basis unknown. Do not infer a contact behaviour from the client's role, timing or decision context.";
    }
  }
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
