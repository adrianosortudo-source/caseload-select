import { emptyAnswers } from "./brief";
import { buildBlueprintViewModel } from "./blueprint";
import type { DesiredClientBrief, DesiredClientStatement, SavedBrief } from "./types";

/** Fictional business purchase/sale example, generated with the current prompt and edited for accuracy and length. */
export const fictionalExampleAnswers = (() => {
  const answers = emptyAnswers();
  answers.revision = 3;
  answers.focus = { ...answers.focus, area: "business", work: "business_acquisitions", service_area: "Ontario", route: "established", certainty: "chosen" };
  answers.situation = { ...answers.situation, trigger: "business.transaction", timing: "planning", role: "business_owner" };
  answers.client.goals = ["understand", "complete"];
  answers.client.concerns = ["next", "cost"];
  answers.client.decision_needs = ["options", "scope_cost"];
  answers.value.reasons = ["client_benefit", "skills", "fees"];
  answers.value.fee_effort = "worthwhile";
  answers.value.collected_fee = "15to50";
  answers.value.team_hours = "41to100";
  answers.delivery.conditions = ["scope", "information"];
  answers.delivery.capacity = "room";
  answers.delivery.fit_signals = ["scope", "information", "decision"];
  answers.direction.aim = "more_current";
  answers.direction.evidence = ["repeated", "records"];
  return answers;
})();

const statement = (text: string, kind: DesiredClientStatement["kind"], ...source_answer_ids: DesiredClientStatement["source_answer_ids"]): DesiredClientStatement => ({ text, kind, source_answer_ids });

export const fictionalExampleBrief: DesiredClientBrief = {
  report_version: "dcm-blueprint-v1",
  portrait: statement("Ontario business owners seek advice before buying or selling and help to complete the transaction.", "preference", "situation.role", "focus.work", "focus.service_area", "situation.timing", "client.goals", "focus.route"),
  client_need: statement("The firm has heard concerns about cost and what happens next. These clients want to understand their options and complete a planned transaction. Their decision needs still require confirmation.", "hypothesis", "client.concerns", "client.goals", "client.decision_needs"),
  firm_value: statement("This work uses the firm's skills and helps clients. The firm reports that fees of C$15,000 to under C$50,000 for more than 40, up to 100 team hours are usually worthwhile. It has capacity when scope is clear and necessary information is available.", "preference", "value.reasons", "value.collected_fee", "value.team_hours", "value.fee_effort", "delivery.capacity", "delivery.conditions"),
  marketing: {
    message: statement("Guidance for Ontario business buyers and sellers.", "suggestion", "focus.work", "focus.service_area", "situation.role"),
    content: statement("Buying or selling a business in Ontario: key steps and costs.", "suggestion", "focus.work", "client.concerns", "client.decision_needs"),
    next_step: statement("Discuss the planned transaction, scope and next steps.", "suggestion", "situation.trigger", "delivery.conditions", "client.goals"),
  },
  open_questions: [statement("Confirm which decision needs recent clients actually expressed.", "suggestion", "client.decision_needs", "direction.evidence")],
};

export const fictionalExampleSaved: SavedBrief = {
  brief: fictionalExampleBrief,
  sourceBriefRevision: fictionalExampleAnswers.revision,
  generatedAt: "2026-09-27T15:45:00.000Z",
  wordingReviewed: false,
  mode: "ai",
};

export const fictionalExampleModel = {
  ...buildBlueprintViewModel(fictionalExampleBrief, fictionalExampleAnswers, {
    mode: "ai", generatedAt: fictionalExampleSaved.generatedAt, wordingReviewed: false,
  }),
  title: "Fictional example: Desired Client Blueprint",
};
