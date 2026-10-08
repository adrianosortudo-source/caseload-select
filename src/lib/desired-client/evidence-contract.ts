import { resolveAnswerReference } from "./catalog";
import { paymentContextEvidenceClaim, paymentEvidenceClaim, buildStructuredBlueprintV4 } from "./structured-blueprint";
import { isInterviewClarificationCurrent, type AnswerReferencePath, type DesiredClientAnswers, type EvidenceBasis, type EvidenceLinkedStatement } from "./types";

export const DESIRED_CLIENT_EVIDENCE_SLOTS = [
  "definition_client_type", "definition_client_matter", "definition_reasons", "definition_outcome",
  "client_and_matter", "client_goals_needs", "why_firm_wants_work", "why_client_chooses_firm",
  "recognizable_circumstances", "evidence_and_open_questions", "decision_pathway.trigger",
  "decision_pathway.first_contact", "decision_pathway.decision", "decision_pathway.desired_progress",
] as const;
export type DesiredClientEvidenceSlot = typeof DESIRED_CLIENT_EVIDENCE_SLOTS[number];
export type EvidenceGroup = {
  id: string;
  slot: DesiredClientEvidenceSlot;
  evidence_basis: EvidenceBasis;
  kind: EvidenceLinkedStatement["kind"];
  source_answer_ids: AnswerReferencePath[];
};
export type EvidenceGroupSelectionFailure = "selection_shape_invalid" | "duplicate_group_id" | "unknown_group_id" | "mixed_basis_or_kind" | "source_paths_overlap_or_exceed_limit";
export type ProviderEvidenceSelection = {
  slot: DesiredClientEvidenceSlot;
  groupIds: string[];
  rawGroupIds: unknown;
  valid: boolean;
  failure?: EvidenceGroupSelectionFailure;
  validShape: boolean;
};

const FOLLOWUP_STAGES: Partial<Record<DesiredClientEvidenceSlot, readonly number[]>> = {
  client_and_matter: [1, 2], client_goals_needs: [2], why_firm_wants_work: [3],
  why_client_chooses_firm: [4], recognizable_circumstances: [5, 6], evidence_and_open_questions: [1, 2, 3, 4, 5, 6],
  "decision_pathway.trigger": [2, 5, 6], "decision_pathway.first_contact": [2, 5, 6],
  "decision_pathway.decision": [2, 5, 6], "decision_pathway.desired_progress": [2, 5, 6],
  definition_client_type: [2], definition_client_matter: [2], definition_reasons: [3], definition_outcome: [6],
};

const SLOT_PREFIXES: Record<DesiredClientEvidenceSlot, readonly string[]> = {
  definition_client_type: ["situation.role", "situation.role_other", "client_context.geography", "client_context.community_focus"],
  definition_client_matter: ["focus.area", "focus.work", "focus.work_other", "situation.trigger", "situation.role", "situation.role_other", "situation.timing", "client_context.geography", "client_context.relevant_circumstances", "client_context.repeat_matter_pattern", "write_ins.trigger"],
  definition_reasons: ["value.", "delivery.", "practice.", "write_ins.reasons"],
  definition_outcome: ["repeatability.", "direction.", "value.", "delivery.capacity"],
  client_and_matter: ["focus.", "situation.", "client_context.geography", "client_context.relevant_circumstances", "client_context.repeat_matter_pattern", "write_ins.trigger"],
  client_goals_needs: ["client.", "situation.", "client_context.", "write_ins.goals", "write_ins.concerns", "write_ins.decision_needs"],
  why_firm_wants_work: ["practice.", "value.", "delivery.", "direction.", "repeatability.staffing_constraint", "repeatability.additional_matters", "write_ins.reasons", "write_ins.fee_effort", "write_ins.conditions", "write_ins.capacity", "write_ins.limit"],
  why_client_chooses_firm: ["client.choice_", "practice.client_strength", "practice.client_strength_effect", "practice.client_strength_support", "practice.capability", "practice.experience"],
  recognizable_circumstances: ["client_context.", "delivery.fit_signals", "delivery.conditions", "delivery.limit", "situation.trigger", "write_ins.fit_signals", "write_ins.conditions", "write_ins.limit"],
  evidence_and_open_questions: ["*"],
  "decision_pathway.trigger": ["situation.trigger", "write_ins.trigger", "client.pathway_basis"],
  "decision_pathway.first_contact": ["situation.timing", "situation.contact", "situation.role", "write_ins.contact", "client.pathway_basis"],
  "decision_pathway.decision": ["client.decision_context", "client.decision_needs", "situation.contact", "client.pathway_basis", "write_ins.decision_needs"],
  "decision_pathway.desired_progress": ["client.goals", "client.goal_detail", "client.pathway_basis", "write_ins.goals"],
};

const BASIS_KIND: Record<EvidenceBasis, EvidenceLinkedStatement["kind"]> = {
  firm_reported_recorded: "experience", firm_reported_estimate: "hypothesis", firm_reported_experience: "experience",
  firm_reported_observation: "experience", client_reported: "experience", firm_preference: "preference",
  source_observed: "experience", hypothesis: "hypothesis", unknown: "unknown",
};
const slotKey = (slot: DesiredClientEvidenceSlot) => slot.replaceAll(".", "_");
const isFollowup = (path: string) => /^interview\.followups\.\d+$/.test(path);
function groupId(slot: DesiredClientEvidenceSlot, name: string, basis: EvidenceBasis, paths: readonly AnswerReferencePath[], answers: DesiredClientAnswers): string {
  const material = [slot, name, basis, ...paths.flatMap(path => [path, JSON.stringify(resolveAnswerReference(path, answers).value)])].join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < material.length; index += 1) hash = Math.imul(hash ^ material.charCodeAt(index), 16777619);
  return `eg_${slotKey(slot)}_${name}_${(hash >>> 0).toString(36)}`;
}
const sourceIsPresent = (path: AnswerReferencePath, answers: DesiredClientAnswers) => resolveAnswerReference(path, answers).present;
const hasActualAmount = (value: string) => /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value.trim());
function unresolved(path: AnswerReferencePath, answers: DesiredClientAnswers): boolean {
  const source = resolveAnswerReference(path, answers);
  return source.unknown || source.value === null || source.value === "" || path === "opportunity.uncertainty" ||
    (path === "opportunity.sources" && answers.opportunity.sources.includes("no_evidence"));
}
function pathAllowed(path: AnswerReferencePath, slot: DesiredClientEvidenceSlot): boolean {
  return isFollowup(path) ? !!FOLLOWUP_STAGES[slot] : SLOT_PREFIXES[slot].some(prefix => prefix === "*" || path.startsWith(prefix));
}
function currentFollowup(path: string, slot: DesiredClientEvidenceSlot, answers: DesiredClientAnswers): boolean {
  const match = /^interview\.followups\.(\d+)$/.exec(path);
  if (!match) return true;
  const item = answers.interview.followups[Number(match[1])];
  return !!item && !item.skipped && isInterviewClarificationCurrent(item, answers) && (FOLLOWUP_STAGES[slot] ?? []).includes(item.stage);
}
function allowedAnswerPaths(slot: DesiredClientEvidenceSlot, answers: DesiredClientAnswers): AnswerReferencePath[] {
  const paths: AnswerReferencePath[] = [
    "focus.area", "focus.work", "focus.work_other", "focus.service_area", "focus.certainty", "focus.route",
    "practice.direction", "practice.firm_type", "practice.capability", "practice.enjoys", "practice.experience", "practice.development_needs", "practice.client_strength", "practice.client_strength_effect", "practice.client_strength_support",
    "client_context.geography", "client_context.relevant_circumstances", "client_context.community_focus", "client_context.language_service_needs", "client_context.repeat_matter_pattern", "client_context.discovery_behaviour",
    "situation.trigger", "situation.timing", "situation.role", "situation.role_other", "situation.contact",
    "client.goals", "client.goal_detail", "client.concerns", "client.decision_needs", "client.decision_context", "client.pathway_basis", "client.choice_priorities", "client.choice_detail", "client.choice_basis",
    "value.reasons", "value.fee_effort", "value.collected_fee", "value.team_hours", "value.payment", "value.payment_context", "value.payment_context_basis", "value.currency", "value.fee_amount", "value.direct_cost_amount", "value.amount_basis", "value.amount_scope",
    "delivery.conditions", "delivery.capacity", "delivery.limit", "delivery.fit_signals", "direction.aim", "direction.evidence", "direction.less", "direction.less_reason", "direction.less_note",
    "opportunity.sources", "opportunity.data_basis", "opportunity.source_detail", "opportunity.period", "opportunity.enquiry_count", "opportunity.retained_count", "opportunity.conversion", "opportunity.acquisition_cost", "opportunity.uncertainty",
    "repeatability.success_measure", "repeatability.success_other", "repeatability.target", "repeatability.review_period", "repeatability.additional_matters", "repeatability.staffing_constraint",
    "write_ins.aim", "write_ins.capacity", "write_ins.concerns", "write_ins.conditions", "write_ins.contact", "write_ins.decision_needs", "write_ins.evidence", "write_ins.fee_effort", "write_ins.fit_signals", "write_ins.goals", "write_ins.limit", "write_ins.reasons", "write_ins.timing", "write_ins.trigger",
    "clarifications.CLIENT_MATTER_UNCLEAR", "clarifications.VALUE_EFFORT_CONFLICT", "clarifications.CAPACITY_CONFLICT", "clarifications.REPEATABILITY_UNPROVEN", "clarifications.OPPORTUNITY_UNSUPPORTED",
    "focus.comparison.a.work", "focus.comparison.a.fee_effort", "focus.comparison.a.team_fit", "focus.comparison.a.capacity", "focus.comparison.a.evidence", "focus.comparison.b.work", "focus.comparison.b.fee_effort", "focus.comparison.b.team_fit", "focus.comparison.b.capacity", "focus.comparison.b.evidence",
  ];
  return [...paths, ...answers.interview.followups.map((_, index) => `interview.followups.${index}` as AnswerReferencePath)]
    .filter(path => pathAllowed(path, slot) && currentFollowup(path, slot, answers) && sourceIsPresent(path, answers))
    .filter(path => !(slot === "decision_pathway.first_contact" && !answers.situation.contact && !answers.write_ins?.contact?.trim() && path === "write_ins.contact"));
}

function definitionGroup(slot: DesiredClientEvidenceSlot, answers: DesiredClientAnswers): EvidenceGroup | null {
  const profile = buildStructuredBlueprintV4(answers);
  const field = slot === "definition_client_type" ? "client" : slot === "definition_client_matter" ? "client_matter" : slot === "definition_reasons" ? "reasons" : "outcome";
  const statement = profile.definition_components[field];
  if (!statement.source_answer_ids.length || statement.source_answer_ids.length > 8 ||
    statement.source_answer_ids.some(path => !pathAllowed(path, slot) || !sourceIsPresent(path, answers) || !currentFollowup(path, slot, answers))) return null;
  return { id: groupId(slot, "grounded", statement.evidence_basis, statement.source_answer_ids, answers), slot, evidence_basis: statement.evidence_basis, kind: statement.kind, source_answer_ids: [...statement.source_answer_ids] };
}

function addGroup(groups: EvidenceGroup[], slot: DesiredClientEvidenceSlot, name: string, basis: EvidenceBasis, paths: readonly string[], allowed: ReadonlySet<string>, answers: DesiredClientAnswers): void {
  const sources = [...paths] as AnswerReferencePath[];
  if (sources.length === 0 || sources.length > 8 || new Set(sources).size !== sources.length || sources.some(path => !allowed.has(path) || !sourceIsPresent(path, answers) || !currentFollowup(path, slot, answers))) return;
  const id = groupId(slot, name, basis, sources, answers);
  if (groups.some(group => group.id === id || group.slot === slot && group.source_answer_ids.some(path => sources.includes(path)))) return;
  groups.push({ id, slot, evidence_basis: basis, kind: BASIS_KIND[basis], source_answer_ids: sources });
}

function clientBasis(value: DesiredClientAnswers["client"]["choice_basis"]): EvidenceBasis {
  return value === "client_feedback" ? "client_reported" : value === "firm_observation" ? "firm_reported_observation" : value === "firm_hypothesis" ? "hypothesis" : "unknown";
}
function pathwayBasis(value: DesiredClientAnswers["client"]["pathway_basis"]): EvidenceBasis { return clientBasis(value); }
function defaultBasis(slot: DesiredClientEvidenceSlot, path: string, answers: DesiredClientAnswers): EvidenceBasis {
  if (isFollowup(path)) {
    const item = answers.interview.followups[Number(path.slice("interview.followups.".length))];
    return item && item.stage <= 3 ? "firm_preference" : "hypothesis";
  }
  if (path === "practice.experience") return ["regular", "occasional", "adjacent"].includes(answers.practice.experience ?? "") ? "firm_reported_experience" : "firm_preference";
  if (path === "practice.firm_type") return "firm_reported_experience";
  if (path === "delivery.fit_signals") return "hypothesis";
  if (["practice.capability", "practice.client_strength_support"].includes(path)) return "firm_reported_experience";
  if (["practice.client_strength", "practice.client_strength_effect"].includes(path)) return "firm_preference";
  if (["practice.development_needs", "practice.enjoys", "value.reasons", "value.fee_effort", "direction.aim", "direction.evidence", "direction.less", "direction.less_reason", "direction.less_note", "repeatability.target", "repeatability.review_period", "repeatability.success_measure", "repeatability.success_other", "repeatability.staffing_constraint"].includes(path)) return "firm_preference";
  if (path === "opportunity.sources") return "source_observed";
  if (["delivery.capacity", "write_ins.capacity", "repeatability.additional_matters"].includes(path)) return "firm_reported_observation";
  if (["value.collected_fee", "value.team_hours"].includes(path)) return answers.focus.route === "established" ? "firm_reported_observation" : "hypothesis";
  if (slot === "why_firm_wants_work" || slot === "why_client_chooses_firm" || slot.startsWith("definition_")) return "firm_preference";
  return "hypothesis";
}

export function buildDesiredClientEvidenceGroups(slot: DesiredClientEvidenceSlot, answers: DesiredClientAnswers): EvidenceGroup[] {
  if (slot.startsWith("definition_")) { const group = definitionGroup(slot, answers); return group ? [group] : []; }
  if (slot === "client_and_matter") {
    return buildStructuredBlueprintV4(answers).client_and_matter.claims.flatMap((claim, index) => claim.source_answer_ids.length && claim.source_answer_ids.length <= 8 && claim.source_answer_ids.every(path => pathAllowed(path, slot) && sourceIsPresent(path, answers) && currentFollowup(path, slot, answers))
      ? [{ id: groupId(slot, `target_${index + 1}`, claim.evidence_basis, claim.source_answer_ids, answers), slot, evidence_basis: claim.evidence_basis, kind: claim.kind, source_answer_ids: [...claim.source_answer_ids] }]
      : []);
  }
  const allowedPaths = allowedAnswerPaths(slot, answers);
  const allowed = new Set(allowedPaths);
  const groups: EvidenceGroup[] = [];
  const consumed = new Set<string>();
  const add = (name: string, basis: EvidenceBasis, paths: readonly string[]) => {
    if (paths.some(path => consumed.has(path))) return;
    const before = groups.length;
    addGroup(groups, slot, name, basis, paths, allowed, answers);
    const registered = groups.length > before ? groups[groups.length - 1] : undefined;
    if (registered) registered.source_answer_ids.forEach(path => consumed.add(path));
  };

  if (slot === "why_firm_wants_work") {
    const capacity = (["delivery.capacity", "write_ins.capacity", "repeatability.additional_matters"] as AnswerReferencePath[]).filter(path => allowed.has(path) && !unresolved(path, answers));
    if (capacity.length) add("current_capacity", "firm_reported_observation", capacity);
    const ranges = (["value.collected_fee", "value.team_hours"] as AnswerReferencePath[]).filter(path => allowed.has(path) && !unresolved(path, answers));
    if (ranges.length && answers.focus.route === "established") add("current_fee_or_effort_range", "firm_reported_observation", ranges);
  }

  if (slot === "why_firm_wants_work" || slot === "evidence_and_open_questions") {
    const payment = paymentEvidenceClaim(answers);
    if (payment && allowed.has("value.payment")) add("payment", payment.evidence_basis, payment.source_answer_ids);
    const context = paymentContextEvidenceClaim(answers);
    if (context && allowed.has("value.payment_context") && allowed.has("value.payment_context_basis")) add("payment_context", context.evidence_basis, context.source_answer_ids);
    const financial = ["value.fee_amount", "value.direct_cost_amount", "value.currency", "value.amount_basis", "value.amount_scope"] as AnswerReferencePath[];
    if ((answers.value.amount_basis === "recorded" || answers.value.amount_basis === "estimated") &&
      hasActualAmount(answers.value.fee_amount) && hasActualAmount(answers.value.direct_cost_amount) && answers.value.currency.trim() && answers.value.amount_scope &&
      financial.every(path => allowed.has(path))) {
      add(`financial_${answers.value.amount_basis}`, answers.value.amount_basis === "recorded" ? "firm_reported_recorded" : "firm_reported_estimate", financial);
    }
    const opportunityFigures = (["opportunity.sources", "opportunity.data_basis", "opportunity.period", "opportunity.enquiry_count", "opportunity.retained_count", "opportunity.conversion", "opportunity.acquisition_cost"] as AnswerReferencePath[])
      .filter(path => allowed.has(path) && !unresolved(path, answers));
    if ((answers.opportunity.data_basis === "recorded" || answers.opportunity.data_basis === "estimated") &&
      opportunityFigures.some(path => path === "opportunity.enquiry_count" || path === "opportunity.retained_count" || path === "opportunity.conversion" || path === "opportunity.acquisition_cost")) {
      add(`opportunity_${answers.opportunity.data_basis}`, answers.opportunity.data_basis === "recorded" ? "firm_reported_recorded" : "firm_reported_estimate", opportunityFigures);
    }
  }

  const isChoiceSlot = slot === "why_client_chooses_firm" || slot === "evidence_and_open_questions";
  if (isChoiceSlot) {
    const details = (["client.choice_priorities", "client.choice_detail"] as AnswerReferencePath[]).filter(path => allowed.has(path) && !unresolved(path, answers));
    const basisPath = "client.choice_basis" as AnswerReferencePath;
    const basis = clientBasis(answers.client.choice_basis);
    if (details.length && basis !== "unknown") {
      add("client_choice", basis, [...details, ...(allowed.has(basisPath) ? [basisPath] : [])]);
    } else if (details.length && allowed.has(basisPath)) {
      add("client_choice_details_unknown", "unknown", [...details, basisPath]);
    } else {
      if (allowed.has(basisPath)) add("client_choice_unknown", "unknown", [basisPath]);
    }
  }

  if (slot === "evidence_and_open_questions" && clientBasis(answers.client.pathway_basis) === "unknown" && allowed.has("client.pathway_basis")) {
    add("pathway_evidence_basis_unknown", "unknown", ["client.pathway_basis"]);
  }

  if (slot.startsWith("decision_pathway.")) {
    const field = slot.slice("decision_pathway.".length);
    const detailPaths: Record<string, AnswerReferencePath[]> = {
      trigger: ["situation.trigger", "write_ins.trigger"], first_contact: ["situation.timing", "situation.contact", "situation.role", "write_ins.contact"],
      decision: ["client.decision_context", "client.decision_needs", "situation.contact", "write_ins.decision_needs"],
      desired_progress: ["client.goals", "client.goal_detail", "write_ins.goals"],
    };
    const details = (detailPaths[field] ?? []).filter(path => allowed.has(path) && !unresolved(path, answers));
    const basisPath = "client.pathway_basis" as AnswerReferencePath;
    const basis = answers.client.pathway_basis ? pathwayBasis(answers.client.pathway_basis) : "unknown";
    if (details.length && basis !== "unknown") {
      add(`pathway_${field}`, basis, [...details, ...(allowed.has(basisPath) ? [basisPath] : [])]);
    } else if (details.length && allowed.has(basisPath)) {
      add(`pathway_${field}_details_unknown`, "unknown", [...details, basisPath]);
    } else {
      if (allowed.has(basisPath)) add(`pathway_${field}_unknown`, "unknown", [basisPath]);
    }
  }

  if (slot === "client_goals_needs") {
    const pathSets: Array<[string, AnswerReferencePath[]]> = [
      ["goals", ["client.goals", "client.goal_detail", "write_ins.goals"]],
      ["concerns", ["client.concerns", "write_ins.concerns"]],
      ["decision_needs", ["client.decision_needs", "client.decision_context", "write_ins.decision_needs"]],
    ];
    for (const [name, candidates] of pathSets) {
      const details = candidates.filter(path => allowed.has(path) && !unresolved(path, answers));
      details.forEach((path, index) => add(`client_${name}_${index + 1}`, "hypothesis", [path]));
    }
  }

  const pathsForGeneric = allowedPaths.filter(path => !consumed.has(path));
  const byBasis = new Map<EvidenceBasis, AnswerReferencePath[]>();
  for (const path of pathsForGeneric) {
    if (["client.pathway_basis", "client.choice_basis", "value.payment_context_basis"].includes(path)) continue;
    if (isFollowup(path)) {
      const item = answers.interview.followups[Number(path.slice("interview.followups.".length))];
      if (!item || item.skipped || !isInterviewClarificationCurrent(item, answers)) continue;
      const basis = item.stage <= 3 ? "firm_preference" : "hypothesis";
      byBasis.set(basis, [...(byBasis.get(basis) ?? []), path]);
      continue;
    }
    const basis: EvidenceBasis = unresolved(path, answers) ? "unknown" : defaultBasis(slot, path, answers);
    if (basis === "source_observed" && answers.opportunity.sources.every(source => source === "unknown" || source === "no_evidence")) continue;
    byBasis.set(basis, [...(byBasis.get(basis) ?? []), path]);
  }
  for (const [basis, paths] of byBasis) {
    paths.forEach((path, index) => add(`${basis}_${index}`, basis, [path]));
  }
  return groups;
}

export function allowedSourceAnswerPathsForAnswers(slot: string, answers: DesiredClientAnswers): string[] {
  if (!DESIRED_CLIENT_EVIDENCE_SLOTS.includes(slot as DesiredClientEvidenceSlot)) return [];
  return [...new Set(buildDesiredClientEvidenceGroups(slot as DesiredClientEvidenceSlot, answers).flatMap(group => group.source_answer_ids))];
}
export function isUnresolvedEvidenceSource(path: string, answers: DesiredClientAnswers): boolean {
  return unresolved(path as AnswerReferencePath, answers);
}
export function allowedEvidenceSlots(): readonly DesiredClientEvidenceSlot[] { return DESIRED_CLIENT_EVIDENCE_SLOTS; }
export function getProviderEvidenceSelection(value: object): ProviderEvidenceSelection | undefined {
  return providerSelections.get(value);
}
const providerSelections = new WeakMap<object, ProviderEvidenceSelection>();
export function attachProviderEvidenceSelection(value: object, selection: ProviderEvidenceSelection): void {
  providerSelections.set(value, selection);
}

export function resolveEvidenceGroupSelection(slot: DesiredClientEvidenceSlot, groupIds: unknown, answers: DesiredClientAnswers): { valid: boolean; failure?: EvidenceGroupSelectionFailure; evidence_basis?: EvidenceBasis; kind?: EvidenceLinkedStatement["kind"]; source_answer_ids: AnswerReferencePath[]; groupIds: string[] } {
  const groups = buildDesiredClientEvidenceGroups(slot, answers);
  if (!Array.isArray(groupIds) || groupIds.length < 1 || groupIds.length > 8 || groupIds.some(id => typeof id !== "string")) return { valid: false, failure: "selection_shape_invalid", source_answer_ids: [], groupIds: [] };
  const selectedIds = groupIds as string[];
  if (new Set(selectedIds).size !== selectedIds.length) return { valid: false, failure: "duplicate_group_id", source_answer_ids: [], groupIds: [] };
  const selected = selectedIds.map(id => groups.find(group => group.id === id));
  if (selected.some(group => !group)) return { valid: false, failure: "unknown_group_id", source_answer_ids: [], groupIds: [] };
  const first = selected[0]!;
  if (selected.some(group => group!.evidence_basis !== first.evidence_basis || group!.kind !== first.kind)) return { valid: false, failure: "mixed_basis_or_kind", source_answer_ids: [], groupIds: [...selectedIds] };
  const paths = selected.flatMap(group => group!.source_answer_ids);
  if (paths.length > 8 || new Set(paths).size !== paths.length) return { valid: false, failure: "source_paths_overlap_or_exceed_limit", source_answer_ids: [], groupIds: [...selectedIds] };
  return { valid: true, evidence_basis: first.evidence_basis, kind: first.kind, source_answer_ids: paths, groupIds: selectedIds };
}

export function statementMatchesEvidenceGroups(slot: DesiredClientEvidenceSlot, statement: EvidenceLinkedStatement, answers: DesiredClientAnswers): boolean {
  const providerSelection = getProviderEvidenceSelection(statement);
  if (providerSelection) {
    if (!providerSelection.valid) return false;
    const resolved = resolveEvidenceGroupSelection(slot, providerSelection.groupIds, answers);
    return resolved.valid && resolved.evidence_basis === statement.evidence_basis && resolved.kind === statement.kind &&
      resolved.source_answer_ids.length === statement.source_answer_ids.length && resolved.source_answer_ids.every(path => statement.source_answer_ids.includes(path));
  }
  if (slot === ("decision_pathway" as DesiredClientEvidenceSlot)) {
    return DESIRED_CLIENT_EVIDENCE_SLOTS.filter(candidate => candidate.startsWith("decision_pathway.")).some(candidate =>
      statementMatchesEvidenceGroups(candidate, statement, answers));
  }
  const groups = buildDesiredClientEvidenceGroups(slot, answers).filter(group => group.evidence_basis === statement.evidence_basis && group.kind === statement.kind);
  if (!Array.isArray(statement.source_answer_ids) || statement.source_answer_ids.length < 1 || statement.source_answer_ids.length > 8 || new Set(statement.source_answer_ids).size !== statement.source_answer_ids.length) return false;
  const paths = new Set(statement.source_answer_ids);
  const matched = groups.filter(group => group.source_answer_ids.every(path => paths.has(path)));
  const flattened = matched.flatMap(group => group.source_answer_ids);
  return flattened.length === statement.source_answer_ids.length && flattened.every(path => paths.has(path));
}

export function evidenceGroupIdsForStatement(slot: DesiredClientEvidenceSlot, statement: EvidenceLinkedStatement, answers: DesiredClientAnswers): string[] {
  const groups = buildDesiredClientEvidenceGroups(slot, answers).filter(group => group.evidence_basis === statement.evidence_basis && group.kind === statement.kind);
  const paths = new Set(statement.source_answer_ids);
  const selected = groups.filter(group => group.source_answer_ids.every(path => paths.has(path)));
  const flattened = selected.flatMap(group => group.source_answer_ids);
  return flattened.length === statement.source_answer_ids.length && flattened.every(path => paths.has(path)) ? selected.map(group => group.id) : [];
}

export function safeEvidenceDiagnostic(slot: DesiredClientEvidenceSlot, value: unknown, claimIndex: number, answers: DesiredClientAnswers) {
  const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rawPaths = Array.isArray(object.source_answer_ids) ? object.source_answer_ids : [];
  const paths = allowedSourceAnswerPathsForAnswers(slot, answers);
  const groups = buildDesiredClientEvidenceGroups(slot, answers);
  const selection = getProviderEvidenceSelection(value as object);
  const groupIds = (selection?.groupIds ?? []).filter(id => groups.some(group => group.id === id)).slice(0, 8);
  const sourceAnswerIds = rawPaths.filter((path): path is string => typeof path === "string" && paths.includes(path)).slice(0, 8);
  const expectedGroups = groups.filter(group => groupIds.includes(group.id) || group.source_answer_ids.some(path => sourceAnswerIds.includes(path)))
    .slice(0, 8).map(group => ({ id: group.id, kind: group.kind, evidenceBasis: group.evidence_basis, sourceAnswerIds: [...group.source_answer_ids] }));
  const rawIds = Array.isArray(selection?.rawGroupIds) ? selection.rawGroupIds : null;
  const uniqueIds = rawIds ? [...new Set(rawIds)] : null;
  const resolvedIdCount = rawIds?.filter(id => typeof id === "string" && groups.some(group => group.id === id)).length ?? null;
  const validKinds = ["experience", "preference", "hypothesis", "unknown", "suggestion"];
  const validBases: EvidenceBasis[] = ["firm_reported_recorded", "firm_reported_estimate", "firm_reported_experience", "firm_reported_observation", "client_reported", "firm_preference", "source_observed", "hypothesis", "unknown"];
  return {
    slot,
    claimIndex: Math.min(32, Math.max(1, claimIndex + 1)),
    claimIndexCapped: claimIndex >= 32,
    selectionMetadataPresent: !!selection,
    selectionShapeValid: selection?.validShape ?? false,
    selectionFailure: selection?.failure ?? null,
    rawGroupIdCount: rawIds === null ? null : Math.min(rawIds.length, 32),
    uniqueGroupIdCount: uniqueIds === null ? null : Math.min(uniqueIds.length, 32),
    resolvedGroupIdCount: resolvedIdCount === null ? null : Math.min(resolvedIdCount, 32),
    groupIdCountsCapped: (rawIds?.length ?? 0) > 32,
    kind: typeof object.kind === "string" && validKinds.includes(object.kind) ? object.kind : "invalid",
    evidenceBasis: typeof object.evidence_basis === "string" && validBases.includes(object.evidence_basis as EvidenceBasis) ? object.evidence_basis : "invalid",
    sourceAnswerIds,
    groupIds,
    expectedGroups,
  };
}
