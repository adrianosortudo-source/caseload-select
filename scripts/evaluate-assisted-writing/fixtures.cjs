const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const id = (i, series) => "00000000-0000-4000-8000-" + String(series * 100 + i).padStart(12, "0");
const areas = ["business", "employment", "family", "immigration", "nonprofit", "criminal", "ip", "regulatory", "injury", "estates"];
const { AREA_CATALOG, TRIGGER_LABELS } = require("../../src/lib/desired-client/catalog.ts");
const { completeAnswers, negativeEconomicsAnswers } = require("../../src/lib/desired-client/__tests__/blueprint-helpers.ts");
const { validateAnalysisRequest } = require("../../src/lib/desired-client/validation.ts");
const { validateInterviewClarificationRequest } = require("../../src/lib/desired-client/interview-clarification.ts");
const { validateAssistBody } = require("../../src/lib/why-your-firm/assist.ts");

function makeFixture(i) {
  const area = areas[i % areas.length];
  const answers = i < 10 ? completeAnswers() : negativeEconomicsAnswers();
  const pack = AREA_CATALOG[area];
  const work = Object.keys(pack.works)[0];
  const role = Object.keys(pack.roles)[0];
  const workName = pack.works[work];
  Object.assign(answers.focus, { area, work });
  Object.assign(answers.practice, {
    firm_type: "A small Ontario " + pack.label + " practice",
    capability: workName,
    enjoys: "Preparing a clearly scoped plan for the next decision",
  });
  Object.assign(answers.situation, { trigger: area + "." + Object.keys(TRIGGER_LABELS[area])[0], role });
  answers.client_context.repeat_matter_pattern = "A " + pack.roles[role] + " seeks help with " + workName + " before committing to a next step.";
  answers.client.goal_detail = "Understand the options, the scope of the work and what to do next.";
  if (i >= 20) {
    Object.assign(answers.value, {
      fee_amount: "6500", direct_cost_amount: "3200", payment: "varies",
      payment_context: "The firm observed that invoice timing varied across the matters it reviewed.",
      payment_context_basis: "firm_observation",
    });
    answers.delivery.capacity = "limited";
  }
  answers.interview.ai_clarification_consent = true;
  const why = [
    { claim: "We give clients a written checklist for " + workName + ".", proof: "A written checklist is in the standard client packet." },
    { claim: "We are the best for " + workName + ".", proof: "We explain the next step at the end of every call." },
    { claim: "We send the fee estimate in writing before " + workName + ".", proof: "The first written estimate names the scope and the assumptions." },
  ][Math.floor(i / 10)];
  const request = { schemaVersion: 4, requestId: id(i, 1), answerRevision: answers.revision, aiConsent: true, answers };
  const clarify = { ...request, operation: "clarify", stage: i % 6 + 1, interviewRunId: id(i, 2), clarificationIndex: 0 };
  const profile = { ...request, operation: "generate", reviewRunId: id(i, 3), analysisIndex: 0, clarifications: [] };
  assert(validateAssistBody(why).valid && validateAnalysisRequest(profile).valid && validateInterviewClarificationRequest(clarify).valid);
  return { case: i + 1, area, hash: digest({ why, answers, stage: clarify.stage }), why, clarify, profile };
}

module.exports = { makeFixture };
