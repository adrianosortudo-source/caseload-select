import { describe, expect, it } from "vitest";
import { validateAnalysisResult } from "../output";
import type { AnalysisResult, DesiredClientAnswers, DesiredClientStatement } from "../types";

const B0: DesiredClientAnswers = {
  schema_version: "dcm-v2.1", revision: 1,
  focus: { area: "business", work: "business_agreements", work_other: "", service_area: "Ontario", certainty: "chosen", route: "established", comparison: null },
  situation: { timing: "planning", role: "business_organization", role_other: "", contact: null },
  client: { goals: ["complete"], concerns: ["cost", "next"] },
  value: { reasons: ["client_benefit", "fees", "skills"], fee_effort: "worthwhile", collected_fee: null, team_hours: null, payment: null },
  delivery: { conditions: ["scope", "information"], capacity: "room", limit: null },
  direction: { aim: "more_current", evidence: ["repeated", "records"], less: null, less_note: "" },
  clarifications: { FOCUS_UNCLEAR: null, CLIENT_GOAL_UNCLEAR: null, CURRENT_CAPACITY_CONFLICT: null, FEE_EFFORT_CONFLICT: null, EXPERIENCE_DIRECTION_CONFLICT: null },
};

function statement(text: string, source: DesiredClientStatement["source_answer_ids"][number], kind: DesiredClientStatement["kind"] = "preference"): DesiredClientStatement {
  return { text, kind, source_answer_ids: [source] };
}

function result(): AnalysisResult {
  return {
    clarification_code: null,
    brief: {
      definition: { text: "Commercial agreement work for organizations in Ontario.", kind: "preference", source_answer_ids: ["focus.area", "focus.work", "focus.service_area"] },
      client_goals: [statement("Clients want to complete a planned process.", "client.goals")],
      firm_reasons: [statement("The firm values client benefit.", "value.reasons")],
      delivery_conditions: [statement("Clear scope helps the team deliver.", "delivery.conditions")],
      evidence: [statement("The firm reports repeated work.", "direction.evidence", "experience")],
      open_questions: [],
      marketing: {
        topic: statement("Explain a planned agreement review.", "focus.work", "suggestion"),
        inquiry_question: statement("What decision is planned?", "situation.timing", "suggestion"),
        validation_step: statement("Review relevant matter records.", "direction.evidence", "suggestion"),
      },
      work_to_promote_less: [],
    },
  };
}

describe("validateAnalysisResult", () => {
  it("accepts a complete result grounded in the canonical fixture", () => {
    const candidate = result();
    expect(validateAnalysisResult(candidate, B0, [])).toEqual(candidate);
  });

  it("rejects unknown keys, missing sections, and fabricated source paths", () => {
    expect(validateAnalysisResult({ ...result(), score: 0.9 }, B0, [])).toBeNull();
    const missing = result();
    delete (missing.brief as Partial<typeof missing.brief>).evidence;
    expect(validateAnalysisResult(missing, B0, [])).toBeNull();
    const fabricated = result();
    fabricated.brief.definition.source_answer_ids = ["focus.industry" as never];
    expect(validateAnalysisResult(fabricated, B0, [])).toBeNull();
  });

  it("rejects unsupported numbers and accepts tokens present in the cited fee label", () => {
    const unsupported = result();
    unsupported.brief.definition = statement("The firm has 20 years of acquisition experience.", "focus.work", "experience");
    expect(validateAnalysisResult(unsupported, B0, [])).toBeNull();
    const answers = structuredClone(B0);
    answers.value.collected_fee = "2to5";
    const supported = result();
    supported.brief.definition = statement("The supplied fee band is C$2,000 to under C$5,000.", "value.collected_fee", "unknown");
    expect(validateAnalysisResult(supported, answers, [])).not.toBeNull();
  });

  it("rejects markup, external links, email, percentages and em dashes", () => {
    for (const text of ["<script>alert(1)</script>", "See https://example.com", "Write a@b.com", "[brief](https://example.com)", "A 20% increase", "Clear scope — matters"]) {
      const candidate = result();
      candidate.brief.definition.text = text;
      expect(validateAnalysisResult(candidate, B0, [])).toBeNull();
    }
  });

  it("allows only the selected comparison candidate as a source", () => {
    const answers = structuredClone(B0);
    answers.focus.comparison = {
      a: { work: "business_agreements", fee_effort: "worthwhile", team_fit: "proven", capacity: "room", evidence: "repeated" },
      b: { work: "business_acquisitions", fee_effort: "unknown", team_fit: "stretch", capacity: "change", evidence: "none" }, selected: "b",
    };
    answers.focus.work = "business_acquisitions";
    answers.focus.certainty = "provisional";
    const candidate = result();
    candidate.brief.definition = statement("The selected work is buying or selling a business.", "focus.comparison.b.work");
    expect(validateAnalysisResult(candidate, answers, [])).not.toBeNull();
    candidate.brief.definition.source_answer_ids = ["focus.comparison.a.work"];
    expect(validateAnalysisResult(candidate, answers, [])).toBeNull();
  });

  it("rejects ineligible clarifications and experience claims for developing work", () => {
    const candidate = result();
    candidate.clarification_code = "FOCUS_UNCLEAR";
    expect(validateAnalysisResult(candidate, B0, [])).toBeNull();
    const answers = structuredClone(B0);
    answers.focus.route = "new";
    candidate.clarification_code = null;
    candidate.brief.evidence[0] = statement("The firm has demonstrated capability.", "direction.evidence", "experience");
    expect(validateAnalysisResult(candidate, answers, [])).toBeNull();
  });

  it("accepts reported commercial and heard-concern sources as experience, but rejects preference-only support", () => {
    const commercial = result();
    commercial.brief.evidence[0] = statement("The firm reports that the fee is usually worthwhile.", "value.fee_effort", "experience");
    expect(validateAnalysisResult(commercial, B0, [])).not.toBeNull();

    const concern = result();
    concern.brief.evidence[0] = statement("The firm has heard concerns about cost.", "client.concerns", "experience");
    expect(validateAnalysisResult(concern, B0, [])).not.toBeNull();

    const preferenceOnlyAnswers = structuredClone(B0);
    preferenceOnlyAnswers.direction.evidence = ["preference"];
    preferenceOnlyAnswers.client.concerns = ["unheard"];
    const preferenceOnly = result();
    preferenceOnly.brief.evidence[0] = statement("The firm has handled this repeatedly.", "direction.evidence", "experience");
    expect(validateAnalysisResult(preferenceOnly, preferenceOnlyAnswers, [])).toBeNull();
    preferenceOnly.brief.evidence[0].source_answer_ids = ["client.concerns"];
    expect(validateAnalysisResult(preferenceOnly, preferenceOnlyAnswers, [])).toBeNull();
    preferenceOnly.brief.evidence[0].source_answer_ids = ["focus.work"];
    expect(validateAnalysisResult(preferenceOnly, B0, [])).toBeNull();
  });
});
