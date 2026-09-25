import { describe, expect, it } from "vitest";
import { buildOpenQuestions, buildStructuredBrief, emptyAnswers } from "../brief";
import type { DesiredClientAnswers } from "../types";

function completeAnswers(): DesiredClientAnswers {
  const answers = emptyAnswers();
  answers.focus = { ...answers.focus, area: "business", work: "business_agreements", certainty: "chosen", route: "established" };
  answers.situation = { ...answers.situation, timing: "planning", role: "business_organization" };
  answers.client.goals = ["complete"];
  answers.value.reasons = ["client_benefit"];
  answers.value.fee_effort = "worthwhile";
  answers.delivery.conditions = ["scope"];
  answers.delivery.capacity = "room";
  answers.direction.aim = "more_current";
  answers.direction.evidence = ["repeated"];
  return answers;
}

describe("deterministic brief completeness", () => {
  it("turns required unknown answers into useful open checks", () => {
    const cases: Array<[string, (a: DesiredClientAnswers) => void]> = [
      ["Establish how much of this work the firm can support.", a => { a.delivery.capacity = "unknown"; }],
      ["Clarify how this work supports the firm's future direction.", a => { a.direction.aim = "unknown"; }],
      ["Establish why this work is worth pursuing for the firm.", a => { a.value.reasons = ["undecided"]; }],
      ["Establish when this client usually seeks help.", a => { a.situation.timing = "unknown"; }],
    ];
    for (const [text, setUnknown] of cases) {
      const answers = completeAnswers();
      setUnknown(answers);
      expect(buildOpenQuestions(answers).map(item => item.text)).toContain(text);
    }
  });

  it("always preserves fee and direction, while keeping limits and ranges within four delivery statements", () => {
    const answers = completeAnswers();
    answers.delivery.capacity = "change";
    answers.delivery.limit = "scope";
    answers.value.collected_fee = "15to50";
    answers.value.team_hours = "41to100";
    answers.value.payment = "predictable";
    answers.direction.aim = "new_area";
    const brief = buildStructuredBrief(answers);
    expect(brief.delivery_conditions).toHaveLength(4);
    expect(brief.delivery_conditions[0].text).toContain("Important limit:");
    expect(brief.delivery_conditions[2].text).toContain("Fee compared with effort:");
    expect(brief.delivery_conditions[2].source_answer_ids).toEqual(["value.fee_effort"]);
    expect(brief.delivery_conditions[3].text).toContain("Commercial ranges supplied");
    const direction = brief.evidence.find(item => item.text.startsWith("Direction sought:"));
    expect(direction?.source_answer_ids).toEqual(["direction.aim"]);
    expect(direction?.kind).toBe("preference");
  });

  it("retains the full supplied work, role, and service-area text with bounded provenance", () => {
    const answers = completeAnswers();
    answers.focus.work = "other";
    answers.focus.certainty = "chosen";
    answers.focus.work_other = "W".repeat(180);
    answers.situation.role = "other";
    answers.situation.role_other = "R".repeat(180);
    answers.focus.service_area = "S".repeat(180);
    const definition = buildStructuredBrief(answers).definition;
    expect(definition.text).toContain(answers.focus.work_other);
    expect(definition.text).toContain(answers.situation.role_other);
    expect(definition.text).toContain(`Service area supplied: ${answers.focus.service_area}.`);
    expect(definition.source_answer_ids).toEqual([
      "focus.work_other", "situation.role_other", "situation.timing", "focus.route", "focus.service_area",
    ]);
  });
});