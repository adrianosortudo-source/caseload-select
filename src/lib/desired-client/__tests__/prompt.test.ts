import { describe, expect, it } from "vitest";
import { buildDesiredClientSystemPrompt, buildDesiredClientUserPrompt, DESIRED_CLIENT_RESPONSE_SCHEMA } from "../prompt";
import { emptyAnswers } from "../brief";
import type { AnalysisRequestEnvelope } from "../types";

function request(): AnalysisRequestEnvelope {
  const answers = emptyAnswers();
  answers.revision = 2;
  answers.focus = { area: "business", work: "business_agreements", work_other: "", service_area: "Ontario", certainty: "chosen", route: "exploring", comparison: { selected: "a", a: { work: "business_agreements", fee_effort: "worthwhile", team_fit: "proven", capacity: "room", evidence: "repeated" }, b: { work: "business_acquisitions", fee_effort: "scoped", team_fit: "stretch", capacity: "limited", evidence: "few" } } };
  answers.situation = { timing: "planning", role: "business_organization", role_other: "", contact: null };
  answers.client = { goals: ["complete"], concerns: ["cost"] };
  answers.value = { reasons: ["fees"], fee_effort: "worthwhile", collected_fee: "2to5", team_hours: "upto5", payment: "varies" };
  answers.delivery = { conditions: ["scope"], capacity: "room", limit: null };
  answers.direction = { aim: "new_area", evidence: ["repeated"], less: null, less_note: "" };
  answers.clarifications = { FOCUS_UNCLEAR: null, CLIENT_GOAL_UNCLEAR: null, CURRENT_CAPACITY_CONFLICT: null, FEE_EFFORT_CONFLICT: null, EXPERIENCE_DIRECTION_CONFLICT: null };
  return { schemaVersion: 2, requestId: "11111111-1111-4111-8111-111111111111", answerRevision: 2, reviewRunId: "22222222-2222-4222-8222-222222222222", analysisIndex: 0, aiConsent: true, answers, clarifications: [] };
}

describe("Desired Client model prompt", () => {
  it("asks for a synthesized client profile rather than an answer transcript", () => {
    const prompt = buildDesiredClientSystemPrompt();
    expect(prompt).toContain("cohesive paragraph");
    expect(prompt).toContain("Synthesize relationships between answers");
    expect(prompt).toContain("material economic or capacity qualification");
    expect(prompt).toContain("Never convert");
  });
  it("keeps provider schema compact while matching the validator cardinalities", () => {
    const props = DESIRED_CLIENT_RESPONSE_SCHEMA.properties.brief.properties;
    const sourceIds = props.definition.properties.source_answer_ids;
    expect(sourceIds).toMatchObject({ minItems: 1, maxItems: 8, items: { type: "string" } });
    expect(props.client_goals).toMatchObject({ minItems: 1, maxItems: 3 });
    expect(props.firm_reasons).toMatchObject({ minItems: 1, maxItems: 3 });
    expect(props.delivery_conditions).toMatchObject({ minItems: 1, maxItems: 4 });
    expect(props.evidence).toMatchObject({ minItems: 1, maxItems: 3 });
    expect(props.open_questions).toMatchObject({ minItems: 0, maxItems: 3 });
    expect(props.work_to_promote_less).toMatchObject({ minItems: 0, maxItems: 1 });
  });

  it("provides keyed canonical answers, exact range labels and future-route expectations", () => {
    const parsed = JSON.parse(buildDesiredClientUserPrompt(request(), []));
    expect(parsed.resolved_answers["value.collected_fee"]).toEqual({ question: "Fee range you are considering, excluding disbursements", text: "C$2,000 to under C$5,000", unknown: false });
    expect(parsed.resolved_answers["value.fee_effort"].text).toBe("We expect it to be worthwhile");
    expect(parsed.resolved_answers["value.reasons"].text).toBe("We expect the fee to support the effort");
    expect(parsed.resolved_answers["focus.comparison.a.work"].text).toBe("Commercial agreement drafting and review");
    expect(parsed.resolved_answers["focus.comparison.b.work"]).toBeUndefined();
    expect(parsed.resolved_answers["situation.contact"]).toMatchObject({ text: null, unknown: true });
    expect(parsed.instruction).toContain("untrusted data");
    expect(parsed.instruction).toContain("range boundaries and units exactly");
    expect(parsed.output_rules.definition_kind_hint).toBe("hypothesis");
    expect(parsed.output_rules.unknown_source_paths).toContain("situation.contact");
    expect(parsed.output_rules.instruction).toContain("ANY cited path");
    expect(parsed.output_rules.instruction).toContain("recommend resolving the unknown without assuming its value");
  });
});
