import { describe, expect, it } from "vitest";
import { buildStructuredBrief, emptyAnswers } from "../brief";
import { getWriteInAnswers } from "../write_ins";
import { getSourceDetails } from "../sources";
import { validateAnalysisResult } from "../output";
import { validateAnalysisRequest, validateDraftAnswers } from "../validation";
import { buildDesiredClientUserPrompt } from "../prompt";
import { formatBriefMarkdown, formatBriefText } from "../export";
import type { AnalysisRequestEnvelope, SavedBrief } from "../types";

function customAnswers() {
  const answers = emptyAnswers();
  answers.revision = 1;
  answers.focus = { area: "business", work: "business_acquisitions", work_other: "", service_area: "Ontario", certainty: "chosen", route: "established", comparison: null };
  answers.situation = { timing: null, role: "business_organization", role_other: "", contact: null };
  answers.client = { goals: [], concerns: [] };
  answers.value = { reasons: [], fee_effort: null, collected_fee: null, team_hours: null, payment: null };
  answers.delivery = { conditions: [], capacity: null, limit: null };
  answers.direction = { aim: null, evidence: [], less: null, less_note: "" };
  answers.write_ins = {
    timing: "When an owner considers a sale", contact: "An adviser engaged by the company",
    goals: "Plan a fair transition to new ownership", concerns: "Disruption to the team",
    reasons: "We enjoy complex transactions", conditions: "A reliable financial adviser",
    limit: "No time to review records", fee_effort: "Worthwhile only with clear scope", capacity: "Yes, once a colleague joins", aim: "Practical acquisition counsel",
    evidence: "Earlier work with business owners",
  };
  return answers;
}
function request(answers: ReturnType<typeof customAnswers>): AnalysisRequestEnvelope {
  return { schemaVersion: 2, requestId: "11111111-1111-4111-8111-111111111111", answerRevision: answers.revision,
    reviewRunId: "22222222-2222-4222-8222-222222222222", analysisIndex: 0, aiConsent: true, answers, clarifications: [] };
}

describe("Desired Client write-in answers", () => {
  it("accepts custom answers for required questions, retains older drafts, and rejects unsafe shapes", () => {
    const answers = customAnswers();
    expect(validateDraftAnswers(answers)).toBe(true);
    expect(validateAnalysisRequest(request(answers)).valid).toBe(true);
    const oldDraft = structuredClone(answers);
    delete oldDraft.write_ins;
    oldDraft.situation.timing = "planning";
    oldDraft.client.goals = ["complete"];
    oldDraft.value.reasons = ["skills"];
    oldDraft.direction.aim = "more_current";
    oldDraft.direction.evidence = ["repeated"];
    expect(validateDraftAnswers(oldDraft)).toBe(true);
    const tooLong = structuredClone(answers);
    tooLong.write_ins!.goals = "x".repeat(181);
    expect(validateDraftAnswers(tooLong)).toBe(false);
    const extraKey = structuredClone(answers);
    Object.assign(extraKey.write_ins!, { secret: "no" });
    expect(validateDraftAnswers(extraKey)).toBe(false);
    const multiline = structuredClone(answers);
    multiline.write_ins!.goals = "one\ntwo";
    expect(validateDraftAnswers(multiline)).toBe(false);
  });

  it("keeps the exact supplied wording through preview, brief, source labels, copy and Markdown", () => {
    const answers = customAnswers();
    const brief = buildStructuredBrief(answers);
    expect(validateAnalysisResult({ brief, clarification_code: null }, answers, [])).not.toBeNull();
    const saved: SavedBrief = { brief, sourceBriefRevision: answers.revision, generatedAt: "2026-09-25T12:00:00.000Z", wordingReviewed: false, mode: "structured" };
    expect(brief.definition.text).toContain("When an owner considers a sale");
    expect(brief.client_goals[0]).toMatchObject({ text: "Plan a fair transition to new ownership", source_answer_ids: ["write_ins.goals"] });
    expect(brief.firm_reasons[0].text).toBe("We enjoy complex transactions");
    expect(brief.delivery_conditions[0].text).toContain("A reliable financial adviser");
    expect(brief.delivery_conditions[0].text).toContain("No time to review records");
    expect(brief.delivery_conditions[1].text).toContain("Yes, once a colleague joins");
    expect(brief.delivery_conditions[2].text).toContain("Worthwhile only with clear scope");
    expect(brief.evidence[0].text).toContain("Earlier work with business owners");
    expect(brief.evidence[1].text).toContain("Practical acquisition counsel");
    expect(getSourceDetails("write_ins.goals", answers)).toEqual({ question: "Other answer to: What does the client most want to achieve?", answer: "Plan a fair transition to new ownership" });
    expect(getWriteInAnswers(answers)).toHaveLength(11);
    const plain = formatBriefText(saved, answers);
    const markdown = formatBriefMarkdown(saved, answers);
    for (const answer of Object.values(answers.write_ins!)) {
      expect(plain).toContain(answer);
      expect(markdown).toContain(answer);
    }
    expect(plain).toContain("Your own answers");
    expect(markdown).toContain("## Your own answers");
  });

  it("passes each custom answer as untrusted, labelled data to Gemini", () => {
    const parsed = JSON.parse(buildDesiredClientUserPrompt(request(customAnswers()), []));
    expect(parsed.resolved_answers["write_ins.goals"]).toEqual({
      question: "Other answer to: What does the client most want to achieve?",
      text: "Plan a fair transition to new ownership", unknown: false,
    });
    expect(parsed.untrusted_text_fields).toContainEqual({
      answer_id: "write_ins.goals", value: "Plan a fair transition to new ownership",
      framing: "untrusted user-authored data",
    });
  });
});
