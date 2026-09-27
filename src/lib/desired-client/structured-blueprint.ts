import { CAPACITY_LABELS, CONCERN_LABELS, DECISION_NEED_LABELS, GOAL_LABELS, REASON_LABELS, TRIGGER_LABELS, getAnswerLabel, getRoleLabel, getWorkLabel, resolveAnswerReference } from "./catalog";
import type { AnswerReferencePath, DesiredClientAnswers, DesiredClientBrief, DesiredClientStatement } from "./types";

const statement = (text: string, kind: DesiredClientStatement["kind"], source_answer_ids: AnswerReferencePath[]): DesiredClientStatement => ({ text, kind, source_answer_ids: [...new Set(source_answer_ids)].slice(0, 8) });
const substantive = (value: string | undefined) => Boolean(value?.trim());
function source(answers: DesiredClientAnswers, ...paths: AnswerReferencePath[]): AnswerReferencePath[] {
  return paths.filter(path => { const resolved = resolveAnswerReference(path, answers); return resolved.present && resolved.value !== null && !resolved.unknown; });
}
function value(answers: DesiredClientAnswers, path: AnswerReferencePath, fallback: string): string { return getAnswerLabel(path, answers) ?? fallback; }
function workLabel(a: DesiredClientAnswers): string {
  if (a.focus.work === "other") return a.focus.work_other.trim() || "a type of work still to be clarified";
  return a.focus.area && a.focus.work ? getWorkLabel(a.focus.area, a.focus.work) : "the selected legal work";
}
function roleLabel(a: DesiredClientAnswers): string {
  if (a.situation.role === "other") return a.situation.role_other.trim() || "the client role still to be clarified";
  if (a.focus.area && a.situation.role && a.situation.role !== "unknown") return getRoleLabel(a.focus.area, a.situation.role);
  return "the client role still to be clarified";
}
function lowerFirst(value: string): string { return value ? value[0].toLowerCase() + value.slice(1) : value; }
function compact(value: string, limit: number, label: string): string { return value.length <= limit ? value : `firm-defined ${label}`; }
function triggerLabel(a: DesiredClientAnswers): string {
  if (substantive(a.write_ins?.trigger)) return a.write_ins!.trigger!.trim();
  if (!a.focus.area || !a.situation.trigger || a.situation.trigger === "unknown") return "a situation the firm will clarify";
  return TRIGGER_LABELS[a.focus.area][a.situation.trigger.split(".").at(-1)!] ?? "a situation the firm will clarify";
}
function goalLabel(a: DesiredClientAnswers): string {
  if (a.client.goals.includes("unknown") || !a.client.goals.length) return "better understand the legal options and decide what to do next";
  const goals = a.client.goals.filter(g => g !== "unknown");
  const labels = goals.map(g => lowerFirst(GOAL_LABELS[g]));
  if (substantive(a.write_ins?.goals)) labels.push(a.write_ins!.goals!.trim());
  return labels.join("; ") || "better understand the result they seek";
}
function reasonLabel(a: DesiredClientAnswers): string {
  const reasons = a.value.reasons.filter(x => x !== "undecided").slice(0, 2).map(x => lowerFirst(REASON_LABELS[x]));
  return reasons.join("; ") || "the direction the firm wants to build";
}
function slotKind(a: DesiredClientAnswers, paths: AnswerReferencePath[], fallback: DesiredClientStatement["kind"]): DesiredClientStatement["kind"] {
  if (paths.some(path => resolveAnswerReference(path, a).unknown)) return "unknown";
  return fallback;
}
function pickGoal(a: DesiredClientAnswers): keyof typeof BASIC_COPY {
  const priority = ["understand", "complete", "resolve", "protect", "prepare", "respond"] as const;
  return priority.find(goal => a.client.goals.includes(goal)) ?? "unknown";
}
const BASIC_COPY = {
  understand: ["Understand your options before deciding what to do.", "What to clarify before deciding your next step.", "Request an initial conversation."],
  complete: ["Understand the legal steps in your planned transaction or process.", "What to prepare for the planned work.", "Discuss the planned work."],
  resolve: ["Understand possible next steps in your disagreement.", "Questions to consider before addressing a disagreement.", "Discuss the disagreement."],
  protect: ["Understand the scope of legal support for your concern.", "What to clarify about the protection you are seeking.", "Discuss the concern."],
  prepare: ["Understand what to prepare for the change ahead.", "Questions to consider before the planned change.", "Discuss the planned change."],
  respond: ["Understand the process for responding to what needs attention.", "What to clarify before responding to a process or obligation.", "Discuss what needs attention."],
  unknown: ["Understand the legal service before deciding how to proceed.", "What to clarify in an initial conversation about the work.", "Request an initial conversation."],
} as const;

export function buildStructuredBlueprint(a: DesiredClientAnswers): DesiredClientBrief {
  const route = a.focus.route;
  const chosenWork = compact(workLabel(a), 45, "work"), rawRole = roleLabel(a), role = compact(rawRole, 40, "client role"), trigger = compact(triggerLabel(a), 90, "situation"), rawGoal = goalLabel(a), goal = rawGoal.length <= 55 ? rawGoal : "better understand the result they seek";
  const portraitSources = source(a, "focus.work", "focus.work_other", "situation.role", "situation.role_other", "situation.trigger", "write_ins.trigger", "client.goals", "write_ins.goals", "focus.route", "direction.aim", "value.reasons");
  const routeText = route === "established" ? "This is established work the firm wants to grow." : route === "new" ? "The firm is building toward this work." : route === "exploring" ? "The firm is exploring this direction." : "The firm is still defining this direction.";
  const rolePhrase = role.startsWith("the ") ? lowerFirst(role) : (/^[aeiou]/i.test(role) ? "an " : "a ") + lowerFirst(role);
  const portraitText = `The firm wants to attract ${rolePhrase} seeking help with ${lowerFirst(chosenWork)}. They tend to seek advice when ${lowerFirst(trigger)} and want to ${lowerFirst(goal)}. ${routeText}`;
  const knownNeedPaths = source(a, "client.goals", "write_ins.goals", "client.concerns", "write_ins.concerns", "client.decision_needs", "write_ins.decision_needs", "situation.timing", "write_ins.timing");
  const needPaths = knownNeedPaths.length ? knownNeedPaths : ["client.goals" as const];
  const concerns = a.client.concerns.filter(x => x !== "unheard").map(x => CONCERN_LABELS[x]);
  const decisionNeeds = a.client.decision_needs.filter(x => x !== "unknown").map(x => DECISION_NEED_LABELS[x]);
  const needText = `The client wants to ${goal}.${concerns.length ? ` The firm has heard concerns about ${concerns.map(lowerFirst).join("; ")}.` : " Client concerns remain to be confirmed."}${decisionNeeds.length ? ` They may need ${decisionNeeds.map(lowerFirst).join("; ")}.` : " What would help the client decide remains to be confirmed."}`;
  const firmSources = source(a, "value.reasons", "write_ins.reasons", "value.fee_effort", "write_ins.fee_effort", "delivery.capacity", "write_ins.capacity", "delivery.fit_signals", "write_ins.fit_signals", "delivery.conditions", "delivery.limit");
  const conflict = (a.delivery.capacity === "change" && a.focus.route === "established") || a.value.fee_effort === "difficult";
  const cap = a.delivery.capacity && a.delivery.capacity !== "unknown" ? CAPACITY_LABELS[a.delivery.capacity] : "Capacity is still to be established";
  const economics = a.value.fee_effort ? value(a, "value.fee_effort", "Fee compared with effort is still to be established") : "Fee compared with effort is still to be established";
  const firmText = `${conflict ? "A condition needs attention. " : "The firm is drawn to this work because "}${lowerFirst(reasonLabel(a))}. Fee compared with effort: ${lowerFirst(economics)}. Current capacity: ${lowerFirst(cap)}.`;
  const kind = route === "established" ? "preference" : "hypothesis";
  const chosenGoal = pickGoal(a), copy = BASIC_COPY[chosenGoal];
  const marketingSources = chosenGoal === "unknown" ? source(a, "focus.work", "focus.work_other", "focus.area") : source(a, "client.goals");
  const open: DesiredClientStatement[] = [];
  if (!a.focus.work || (a.focus.work === "other" && !substantive(a.focus.work_other))) open.push(statement("Define the work more specifically.", "unknown", ["focus.work"]));
  if (!a.situation.role || a.situation.role === "unknown" || (a.situation.role === "other" && !substantive(a.situation.role_other))) open.push(statement("Confirm the client role.", "unknown", ["situation.role"]));
  if (!a.situation.trigger || a.situation.trigger === "unknown") open.push(statement("Confirm what prompts the inquiry.", "unknown", ["situation.trigger"]));
  if (a.value.fee_effort === "unknown" || !a.value.fee_effort) open.push(statement("Confirm whether the fee supports the effort.", "unknown", ["value.fee_effort"]));
  if (a.delivery.capacity === "unknown" || !a.delivery.capacity) open.push(statement("Confirm delivery capacity.", "unknown", ["delivery.capacity"]));
  if (!a.delivery.fit_signals.length || a.delivery.fit_signals.includes("unknown")) open.push(statement("Define the early fit signals.", "unknown", ["delivery.fit_signals"]));
  const marketingKind = chosenGoal === "unknown" ? "unknown" : "suggestion";
  return {
    report_version: "dcm-blueprint-v1",
    portrait: statement(portraitText, slotKind(a, portraitSources, kind), portraitSources.length ? portraitSources : ["focus.area"]),
    client_need: statement(needText, slotKind(a, needPaths, a.client.decision_needs.some(x => x !== "unknown") || (route !== "established" && concerns.length) ? "hypothesis" : "preference"), needPaths),
    firm_value: statement(firmText, slotKind(a, firmSources, route === "established" ? "preference" : "hypothesis"), firmSources.length ? firmSources : ["value.reasons"]),
    marketing: {
      message: statement(copy[0], marketingKind, marketingSources),
      content: statement(copy[1], marketingKind, marketingSources),
      next_step: statement(copy[2], marketingKind, marketingSources),
    },
    open_questions: open.slice(0, 2),
  };
}
