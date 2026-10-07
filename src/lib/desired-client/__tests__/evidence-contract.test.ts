import { describe, expect, it } from "vitest";
import { completeAnswers, evidence, type ProviderSchemaProbe } from "./blueprint-helpers";
import {
  buildDesiredClientEvidenceGroups,
  getProviderEvidenceSelection,
  resolveEvidenceGroupSelection,
  safeEvidenceDiagnostic,
  statementMatchesEvidenceGroups,
  type DesiredClientEvidenceSlot,
} from "../evidence-contract";
import { decodeProviderEvidenceGroups, providerBlueprintSchema } from "../provider-schema";
import { buildDesiredClientUserPrompt } from "../prompt";
import { isSafeDiagnosticSourcePath } from "../output";
import { interviewClarificationSourceFingerprint } from "../types";
import type { AnswerReferencePath, DesiredClientAnswers, EvidenceLinkedStatement } from "../types";

const firstGroup = (answers: DesiredClientAnswers, slot: Parameters<typeof buildDesiredClientEvidenceGroups>[0], sourcePath: AnswerReferencePath) =>
  buildDesiredClientEvidenceGroups(slot, answers).find(group => group.source_answer_ids.includes(sourcePath));

describe("Desired Client evidence-group contract", () => {
  it("keeps slot-specific registry IDs in the prompt and decodes them to the persisted report shape", () => {
    const answers = completeAnswers();
    const schema = providerBlueprintSchema(answers) as unknown as ProviderSchemaProbe;
    const envelope = { schemaVersion: 4 as const, operation: "generate" as const, requestId: "11111111-1111-4111-8111-111111111111", answerRevision: answers.revision, reviewRunId: "22222222-2222-4222-8222-222222222222", analysisIndex: 0 as const, aiConsent: true as const, answers, clarifications: [] };
    const prompt = JSON.parse(buildDesiredClientUserPrompt(envelope, [])) as { evidence_groups_by_slot: Record<string, Array<{ evidence_group_id: string }>> };
    const slots: Array<[DesiredClientEvidenceSlot, string[]]> = [
      ["definition_client_type", prompt.evidence_groups_by_slot.definition_client_type.map(group => group.evidence_group_id)],
      ["definition_client_matter", prompt.evidence_groups_by_slot.definition_client_matter.map(group => group.evidence_group_id)],
      ["definition_reasons", prompt.evidence_groups_by_slot.definition_reasons.map(group => group.evidence_group_id)],
      ["definition_outcome", prompt.evidence_groups_by_slot.definition_outcome.map(group => group.evidence_group_id)],
      ...(["client_goals_needs", "why_firm_wants_work", "why_client_chooses_firm", "recognizable_circumstances", "evidence_and_open_questions"] as const).map(slot => [slot, prompt.evidence_groups_by_slot[slot].map(group => group.evidence_group_id)] as [DesiredClientEvidenceSlot, string[]]),
      ...(["trigger", "first_contact", "decision", "desired_progress"] as const).map(field => [`decision_pathway.${field}`, prompt.evidence_groups_by_slot[`decision_pathway.${field}`].map(group => group.evidence_group_id)] as [DesiredClientEvidenceSlot, string[]]),
    ];
    for (const [slot, promptIds] of slots) {
      expect(promptIds).toEqual(buildDesiredClientEvidenceGroups(slot, answers).map(group => group.id));
    }
    const statementSchema = schema.properties.brief.properties.definition_components.properties.client.properties.evidence_group_ids;
    expect(statementSchema.items).toEqual({ type: "string" });
    expect(statementSchema).not.toHaveProperty("minItems");
    expect(statementSchema).not.toHaveProperty("maxItems");

    const group = firstGroup(answers, "client_goals_needs", "client.goals")!;
    const decoded = decodeProviderEvidenceGroups({ brief: { client_goals_needs: { claims: [{ text: "The client wants to understand the available options.", evidence_group_ids: [group.id] }] } } }, answers) as unknown as { clarification_code: null; brief: { client_goals_needs: { claims: EvidenceLinkedStatement[] } } };
    expect(decoded.clarification_code).toBeNull();
    expect(decoded.brief.client_goals_needs.claims[0]).toEqual({
      text: "The client wants to understand the available options.",
      kind: group.kind,
      source_answer_ids: group.source_answer_ids,
      evidence_basis: group.evidence_basis,
    });
    expect(Object.keys(decoded.brief.client_goals_needs.claims[0]).sort()).toEqual(["evidence_basis", "kind", "source_answer_ids", "text"]);
    expect(getProviderEvidenceSelection(decoded.brief.client_goals_needs.claims[0])).toMatchObject({ slot: "client_goals_needs", groupIds: [group.id], valid: true });
  });

  it("keeps pre-registry app-built claims valid when the model cites only the relevant goal source", () => {
    const answers = completeAnswers();
    const goal = firstGroup(answers, "client_goals_needs", "client.goals")!;
    expect(goal.source_answer_ids).toEqual(["client.goals"]);
    const legacyClaim = evidence("The client wants to understand their options.", "hypothesis", "client.goals");
    expect(statementMatchesEvidenceGroups("client_goals_needs", legacyClaim, answers)).toBe(true);
  });

  it("decodes provider group IDs before validation and rejects provider-forged citation fields", () => {
    const answers = completeAnswers();
    const group = firstGroup(answers, "client_goals_needs", "client.goals")!;
    const decoded = decodeProviderEvidenceGroups({brief:{client_goals_needs:{claims:[{
      text:"The client wants to understand their options.",
      evidence_group_ids:[group.id],
      source_answer_ids:["opportunity.sources"],
      evidence_basis:"unknown",
      kind:"unknown",
    }]}}}, answers) as {brief:{client_goals_needs:{claims:EvidenceLinkedStatement[]}}};
    const statement = decoded.brief.client_goals_needs.claims[0];
    expect(statement).toMatchObject({
      kind:group.kind,
      evidence_basis:group.evidence_basis,
      source_answer_ids:group.source_answer_ids,
    });
    expect(Object.keys(statement).sort()).toEqual(["evidence_basis","kind","source_answer_ids","text"]);
    expect(getProviderEvidenceSelection(statement)).toMatchObject({slot:"client_goals_needs",groupIds:[group.id],valid:false});
    expect(statementMatchesEvidenceGroups("client_goals_needs", statement, answers)).toBe(false);
  });

  it("rejects a provider selection after its source answer changes", () => {
    const answers = completeAnswers();
    const group = firstGroup(answers, "client_goals_needs", "client.goals")!;
    const decoded = decodeProviderEvidenceGroups({brief:{client_goals_needs:{claims:[{
      text:"The client wants to understand their options.",
      evidence_group_ids:[group.id],
    }]}}}, answers) as {brief:{client_goals_needs:{claims:EvidenceLinkedStatement[]}}};
    const statement = decoded.brief.client_goals_needs.claims[0];
    expect(getProviderEvidenceSelection(statement)?.valid).toBe(true);
    expect(statementMatchesEvidenceGroups("client_goals_needs", statement, answers)).toBe(true);
    answers.client.goals = ["complete"];
    expect(resolveEvidenceGroupSelection("client_goals_needs", [group.id], answers).valid).toBe(false);
    expect(statementMatchesEvidenceGroups("client_goals_needs", statement, answers)).toBe(false);
  });

  it("rejects empty, unknown, duplicate, stale, out-of-slot and mixed-basis selections", () => {
    const answers = completeAnswers();
    Object.assign(answers.value, { payment: "predictable", payment_context: "Clients told the firm that the first invoice was usually paid on schedule.", payment_context_basis: "client_feedback", fee_amount: "8000", direct_cost_amount: "8500", currency: "CAD", amount_basis: "recorded", amount_scope: "per_matter" });
    const payment = firstGroup(answers, "why_firm_wants_work", "value.payment")!;
    const context = firstGroup(answers, "why_firm_wants_work", "value.payment_context")!;
    const financial = buildDesiredClientEvidenceGroups("why_firm_wants_work", answers).find(group => group.id.includes("financial_recorded"))!;

    expect(resolveEvidenceGroupSelection("why_firm_wants_work", [], answers).valid).toBe(false);
    expect(resolveEvidenceGroupSelection("why_firm_wants_work", ["eg_unknown"], answers).valid).toBe(false);
    expect(resolveEvidenceGroupSelection("why_firm_wants_work", [payment.id, payment.id], answers).valid).toBe(false);
    expect(resolveEvidenceGroupSelection("why_firm_wants_work", [payment.id, context.id], answers)).toMatchObject({ valid: false, failure: "mixed_basis_or_kind" });
    expect(resolveEvidenceGroupSelection("why_firm_wants_work", [payment.id, payment.id], answers).failure).toBe("duplicate_group_id");
    expect(resolveEvidenceGroupSelection("why_firm_wants_work", ["eg_unknown"], answers).failure).toBe("unknown_group_id");
    expect(resolveEvidenceGroupSelection("why_firm_wants_work", [payment.id], answers).failure).toBeUndefined();
    expect(resolveEvidenceGroupSelection("recognizable_circumstances", [payment.id], answers).valid).toBe(false);
    expect(resolveEvidenceGroupSelection("why_firm_wants_work", [financial.id], answers).valid).toBe(true);
    const openFinancial = buildDesiredClientEvidenceGroups("evidence_and_open_questions", answers).find(group => group.id.includes("financial_recorded"))!;
    expect(openFinancial.id).not.toBe(financial.id);
    expect(resolveEvidenceGroupSelection("evidence_and_open_questions", [financial.id], answers).valid).toBe(false);
    expect(resolveEvidenceGroupSelection("evidence_and_open_questions", [openFinancial.id], answers).valid).toBe(true);

    answers.value.fee_amount = "9000";
    expect(resolveEvidenceGroupSelection("why_firm_wants_work", [financial.id], answers).valid).toBe(false);
  });

  it("requires actual financial amount fields and keeps qualitative fee preferences out of recorded economics", () => {
    const answers = completeAnswers();
    answers.value.fee_effort = "worthwhile";
    expect(buildDesiredClientEvidenceGroups("why_firm_wants_work", answers).some(group => /financial_(recorded|estimated)/.test(group.id))).toBe(false);
    Object.assign(answers.value, { fee_amount: "8000", direct_cost_amount: "8500", currency: "CAD", amount_basis: "recorded", amount_scope: "per_matter" });
    const financial = buildDesiredClientEvidenceGroups("why_firm_wants_work", answers).find(group => group.id.includes("financial_recorded"));
    expect(financial?.source_answer_ids).toEqual(["value.fee_amount", "value.direct_cost_amount", "value.currency", "value.amount_basis", "value.amount_scope"]);
    answers.value.direct_cost_amount = "";
    expect(buildDesiredClientEvidenceGroups("why_firm_wants_work", answers).some(group => /financial_(recorded|estimated)/.test(group.id))).toBe(false);
    answers.value.direct_cost_amount = "8.5k";
    expect(buildDesiredClientEvidenceGroups("why_firm_wants_work", answers).some(group => /financial_(recorded|estimated)/.test(group.id))).toBe(false);
    answers.value.direct_cost_amount = "8500";
    answers.value.currency = "";
    expect(buildDesiredClientEvidenceGroups("why_firm_wants_work", answers).some(group => /financial_(recorded|estimated)/.test(group.id))).toBe(false);
    answers.value.currency = "CAD";
    answers.value.amount_scope = null;
    expect(buildDesiredClientEvidenceGroups("why_firm_wants_work", answers).some(group => /financial_(recorded|estimated)/.test(group.id))).toBe(false);
  });

  it("retains the exact payment-context note as an unknown-basis evidence gap", () => {
    const answers = completeAnswers();
    answers.value.payment_context = "Clients told the firm that the first invoice was usually paid on schedule.";
    answers.value.payment_context_basis = null;
    const context = firstGroup(answers, "why_firm_wants_work", "value.payment_context")!;
    expect(context.source_answer_ids).toEqual(["value.payment_context", "value.payment_context_basis"]);
    expect(context.evidence_basis).toBe("unknown");
    expect(context.kind).toBe("unknown");
    const statement = {
      text: `Payment context supplied by the firm: "${answers.value.payment_context}". Basis not specified.`,
      kind: context.kind,
      evidence_basis: context.evidence_basis,
      source_answer_ids: context.source_answer_ids,
    };
    expect(statementMatchesEvidenceGroups("why_firm_wants_work", statement, answers)).toBe(true);
    expect(statement.text).toContain(answers.value.payment_context);
  });

  it("keeps supplied choice and pathway details visible when their basis is unknown", () => {
    const answers = completeAnswers();
    answers.client.choice_priorities = ["clear_fees"];
    answers.client.choice_detail = "The client asked for a predictable fee and a clear closing timetable.";
    answers.client.choice_basis = "unknown";
    const choice = firstGroup(answers, "why_client_chooses_firm", "client.choice_detail")!;
    expect(choice.evidence_basis).toBe("unknown");
    expect(choice.source_answer_ids).toEqual(["client.choice_priorities", "client.choice_detail", "client.choice_basis"]);
    expect(resolveEvidenceGroupSelection("why_client_chooses_firm", [choice.id], answers).valid).toBe(true);

    answers.client.pathway_basis = "unknown";
    const firstContact = firstGroup(answers, "decision_pathway.first_contact", "situation.timing")!;
    expect(firstContact.evidence_basis).toBe("unknown");
    expect(firstContact.source_answer_ids).toEqual(["situation.timing", "situation.role", "client.pathway_basis"]);
    expect(resolveEvidenceGroupSelection("decision_pathway.first_contact", [firstContact.id], answers).valid).toBe(true);
  });

  it("keeps capacity observations, staffing preferences and pathway evidence in their own slots", () => {
    const answers = completeAnswers();
    answers.delivery.capacity = "room";
    answers.repeatability.additional_matters = "2 comparable matters per quarter";
    answers.repeatability.staffing_constraint = "Hire an associate before increasing volume.";
    answers.client.pathway_basis = "firm_observation";
    answers.client.decision_context = "The owner decides, with an accountant involved.";
    const capacity = firstGroup(answers, "why_firm_wants_work", "delivery.capacity")!;
    const staffing = firstGroup(answers, "why_firm_wants_work", "repeatability.staffing_constraint")!;
    const decision = firstGroup(answers, "decision_pathway.decision", "client.decision_context")!;
    expect(capacity.evidence_basis).toBe("firm_reported_observation");
    expect(capacity.source_answer_ids).toContain("repeatability.additional_matters");
    expect(capacity.source_answer_ids).not.toContain("repeatability.staffing_constraint");
    expect(staffing.evidence_basis).toBe("firm_preference");
    expect(resolveEvidenceGroupSelection("why_firm_wants_work", [capacity.id, staffing.id], answers).valid).toBe(false);
    expect(resolveEvidenceGroupSelection("why_firm_wants_work", [decision.id], answers).valid).toBe(false);
    expect(resolveEvidenceGroupSelection("decision_pathway.decision", [capacity.id], answers).valid).toBe(false);
    expect(resolveEvidenceGroupSelection("evidence_and_open_questions", [capacity.id], answers).valid).toBe(false);
    const goal = firstGroup(answers, "client_goals_needs", "client.goals")!;
    expect(goal.evidence_basis).toBe("hypothesis");
    expect(goal.source_answer_ids).not.toContain("client.pathway_basis");
  });

  it("keeps recorded opportunity evidence tied to a source, period, basis and actual figure", () => {
    const answers = completeAnswers();
    answers.opportunity.sources = ["comparable_enquiries"];
    answers.opportunity.data_basis = "recorded";
    answers.opportunity.period = "Q3 2026";
    answers.opportunity.enquiry_count = "12";
    answers.opportunity.retained_count = "4";
    const recorded = buildDesiredClientEvidenceGroups("evidence_and_open_questions", answers)
      .find(group => group.id.includes("opportunity_recorded"));
    expect(recorded?.source_answer_ids).toContain("opportunity.sources");
    expect(recorded?.source_answer_ids).toContain("opportunity.period");
    expect(recorded?.source_answer_ids).toContain("opportunity.enquiry_count");
    answers.opportunity.enquiry_count = "";
    answers.opportunity.retained_count = "";
    expect(buildDesiredClientEvidenceGroups("evidence_and_open_questions", answers)
      .some(group => group.id.includes("opportunity_recorded"))).toBe(false);
  });

  it("offers only current, non-skipped follow-ups and bounds diagnostics to registry metadata", () => {
    const answers = completeAnswers();
    const paths = ["value.reasons"] as const;
    answers.interview = { ai_clarification_consent: true, clarification_count: 1, clarified_stages: [3], followups: [{
      id: "33333333-3333-4333-8333-333333333333", stage: 3, purpose: "firm_desirability", source_answer_ids: [...paths],
      source_answer_fingerprint: interviewClarificationSourceFingerprint(answers, [...paths]), question: "Why does this work fit?",
      answer: "This private clarification text is an application-owned fixture.", skipped: false,
    }] };
    const current = firstGroup(answers, "why_firm_wants_work", "interview.followups.0")!;
    expect(current).toBeDefined();
    expect(resolveEvidenceGroupSelection("why_firm_wants_work", [current.id], answers).valid).toBe(true);
    expect(isSafeDiagnosticSourcePath("interview.followups.0", answers)).toBe(true);
    expect(isSafeDiagnosticSourcePath("interview.followups.1", answers)).toBe(false);
    const decodedFollowup = decodeProviderEvidenceGroups({ brief: { why_firm_wants_work: { claims: [{ text: "The firm prefers this work.", evidence_group_ids: [current.id] }] } } }, answers) as { brief: { why_firm_wants_work: { claims: object[] } } };

    answers.value.reasons = ["skills"];
    expect(buildDesiredClientEvidenceGroups("why_firm_wants_work", answers).some(group => group.id === current.id)).toBe(false);
    expect(resolveEvidenceGroupSelection("why_firm_wants_work", [current.id], answers).valid).toBe(false);
    expect(isSafeDiagnosticSourcePath("interview.followups.0", answers)).toBe(false);
    const staleDiagnostic = safeEvidenceDiagnostic("why_firm_wants_work", decodedFollowup.brief.why_firm_wants_work.claims[0], 0, answers);
    expect(staleDiagnostic.sourceAnswerIds).not.toContain("interview.followups.0");
    expect(staleDiagnostic.groupIds).not.toContain(current.id);
    expect(staleDiagnostic.expectedGroups).toEqual([]);

    answers.interview.followups[0].source_answer_fingerprint = interviewClarificationSourceFingerprint(answers, [...paths]);
    answers.interview.followups[0].skipped = true;
    expect(buildDesiredClientEvidenceGroups("why_firm_wants_work", answers).some(group => group.source_answer_ids.includes("interview.followups.0"))).toBe(false);
    expect(isSafeDiagnosticSourcePath("interview.followups.0", answers)).toBe(false);
    const diagnostic = safeEvidenceDiagnostic("why_firm_wants_work", {
      text: "PRIVATE RAW CLAIM MUST NOT BE LOGGED",
      kind: "unknown",
      evidence_basis: "unknown",
      source_answer_ids: ["value.payment_context", "private.answer.path"],
    }, 0, answers);
    expect(diagnostic.sourceAnswerIds).not.toContain("private.answer.path");
    expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE RAW CLAIM");
    expect(JSON.stringify(diagnostic)).not.toContain("private.answer.path");
    expect(Object.keys(diagnostic).sort()).toEqual(["claimIndex", "evidenceBasis", "expectedGroups", "groupIds", "kind", "slot", "sourceAnswerIds"].sort());
  });
});
