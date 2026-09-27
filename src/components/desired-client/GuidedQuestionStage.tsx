"use client";

import { useState, type ReactNode } from "react";
import {
  AIM_LABELS, AREA_ORDER, CAPACITY_LABELS, COLLECTED_FEE_LABELS, CONDITION_LABELS, CONTACT_LABELS, CONTACT_ROLE_IDS,
  CONCERN_LABELS, DECISION_NEED_OPTIONS, EVIDENCE_LABELS, FIT_SIGNAL_OPTIONS, GOAL_LABELS, LESS_LABELS, LIMIT_LABELS,
  PAYMENT_LABELS, REASON_LABELS, ROUTE_LABELS, TEAM_HOURS_LABELS, TIMING_LABELS, TRIGGER_EXAMPLES, TRIGGER_OPTIONS,
  getAreaLabel, getFeeEffortLabel, getReasonLabel, getRoleOptions, getWorkOptions,
} from "@/lib/desired-client/catalog";
import { COMMON_COPY, PRIVACY_FIELD_COPY } from "@/lib/desired-client/copy";
import { STAGE_DEFINITIONS, type StageId } from "@/lib/desired-client/screens";
import type { AreaId, DesiredClientAnswers, WriteInKey } from "@/lib/desired-client/types";
import { ChoiceGroup, type ChoiceGroupOption } from "./ChoiceGroup";
import { ConfirmationDialog } from "./ConfirmationDialog";

type Change = (edit: (answers: DesiredClientAnswers) => DesiredClientAnswers) => void;
const entries = (record: Record<string, string>): ChoiceGroupOption[] => Object.entries(record).map(([id, label]) => ({ id, label }));

const WRITE_IN_GROUPS: Record<string, WriteInKey> = {
  "dc-trigger": "trigger", "dc-timing": "timing", "dc-contact": "contact", "dc-goals": "goals",
  "dc-concerns": "concerns", "dc-decision-needs": "decision_needs", "dc-reasons": "reasons",
  "dc-fee-effort": "fee_effort", "dc-conditions": "conditions", "dc-capacity": "capacity",
  "dc-limit": "limit", "dc-fit-signals": "fit_signals", "dc-aim": "aim", "dc-evidence": "evidence",
};

export function GuidedQuestionStage({
  stage, answers, onEdit, onBack, onNext, onCompare, error, notice, preview,
}: {
  stage: StageId; answers: DesiredClientAnswers; onEdit: Change; onBack: () => void; onNext: () => void;
  onCompare: () => void; error: boolean; notice?: string; preview?: ReactNode;
}) {
  const [pendingArea, setPendingArea] = useState<AreaId | null>(null);
  const area = answers.focus.area;
  const route = answers.focus.route;
  const ownAnswer = (key?: WriteInKey | null) => key ? answers.write_ins?.[key]?.trim() ?? "" : "";
  const setWriteIn = (key: WriteInKey, text: string) => onEdit((current) => {
    const next: DesiredClientAnswers = { ...current, write_ins: { ...current.write_ins, [key]: text } };
    if (!text.trim()) return next;
    if (key === "trigger") next.situation = { ...next.situation, trigger: null };
    if (key === "timing") next.situation = { ...next.situation, timing: null };
    if (key === "contact") next.situation = { ...next.situation, contact: null };
    if (key === "goals" && next.client.goals.includes("unknown")) next.client = { ...next.client, goals: [] };
    if (key === "decision_needs" && next.client.decision_needs.includes("unknown")) next.client = { ...next.client, decision_needs: [] };
    if (key === "concerns" && next.client.concerns.includes("unheard")) next.client = { ...next.client, concerns: [] };
    if (key === "reasons" && next.value.reasons.includes("undecided")) next.value = { ...next.value, reasons: [] };
    if (key === "fee_effort") next.value = { ...next.value, fee_effort: null };
    if (key === "capacity") next.delivery = { ...next.delivery, capacity: null };
    if (key === "conditions" && next.delivery.conditions.includes("unknown")) next.delivery = { ...next.delivery, conditions: [] };
    if (key === "fit_signals" && next.delivery.fit_signals.includes("unknown")) next.delivery = { ...next.delivery, fit_signals: [] };
    if (key === "limit") next.delivery = { ...next.delivery, limit: null };
    if (key === "aim") next.direction = { ...next.direction, aim: null };
    if (key === "evidence" && next.direction.evidence.includes("preference")) next.direction = { ...next.direction, evidence: [] };
    return next;
  });
  const writeInField = (key: WriteInKey | null | undefined, question: string) => key ? (
    <label className="dc-text-field" data-ui-component-content="desired-client-text-answer">
      <span data-ui-copy="supporting">Other: write your own answer</span>
      <input aria-label={"Other answer to: " + question} value={answers.write_ins?.[key] ?? ""} maxLength={180}
        onChange={(event) => setWriteIn(key, event.currentTarget.value)} />
      <span className="dc-text-field__count" data-ui-copy="supporting">{(answers.write_ins?.[key] ?? "").length} of 180 characters</span>
      <span data-ui-copy="body">{PRIVACY_FIELD_COPY}</span>
    </label>
  ) : null;
  const radio = (id: string, key: WriteInKey | null, legend: string, options: ChoiceGroupOption[], value: string | null,
    update: (current: DesiredClientAnswers, selected: string) => DesiredClientAnswers, help?: string, required = true) => (
    <div className="dc-question-block" data-ui-component-content="desired-client-question">
      <ChoiceGroup idPrefix={id} name={id} legend={legend} options={options} type="radio" value={value}
        required={required && !ownAnswer(key)} hideLegend={legend === STAGE_DEFINITIONS[stage - 1].heading} help={help}
        error={error && required && value === null && !ownAnswer(key) ? COMMON_COPY.requiredSingle : undefined}
        onChange={(selected) => onEdit((current) => {
          const next = update(current, String(selected));
          return key ? { ...next, write_ins: { ...next.write_ins, [key]: "" } } : next;
        })} />
      {writeInField(key, legend)}
    </div>
  );
  const multi = (id: string, key: WriteInKey, legend: string, options: ChoiceGroupOption[], value: string[],
    update: (current: DesiredClientAnswers, selected: string[]) => DesiredClientAnswers, maximum: number,
    exclusiveOptions: string[] = [], exclusiveGroups: string[][] = [], help?: string, required = true) => (
    <div className="dc-question-block" data-ui-component-content="desired-client-question">
      <ChoiceGroup idPrefix={id} name={id} legend={legend} options={options} type="checkbox" value={value}
        maximum={maximum} additionalSelectionCount={ownAnswer(key) ? 1 : 0} exclusiveOptions={exclusiveOptions}
        exclusiveGroups={exclusiveGroups} required={required && !ownAnswer(key)}
        hideLegend={legend === STAGE_DEFINITIONS[stage - 1].heading}
        help={help ?? (id === "dc-goals" ? "Choose one or two." : id === "dc-concerns" ? "Optional. Choose up to two." : undefined)}
        error={error && required && value.length === 0 && !ownAnswer(key) ? COMMON_COPY.requiredMulti : undefined}
        onChange={(selected) => onEdit((current) => {
          const choices = selected as string[];
          const next = update(current, choices);
          return choices.some((choice) => exclusiveOptions.includes(choice))
            ? { ...next, write_ins: { ...next.write_ins, [key]: "" } }
            : next;
        })} />
      {writeInField(key, legend)}
    </div>
  );
  const textField = (label: string, value: string, update: (current: DesiredClientAnswers, text: string) => DesiredClientAnswers, help: string) => (
    <label className="dc-text-field" data-ui-component-content="desired-client-text-answer">
      <span data-ui-copy="supporting">{label}</span>
      <input aria-label={label} value={value} maxLength={180} onChange={(event) => onEdit((current) => update(current, event.currentTarget.value))} />
      <span className="dc-text-field__count" data-ui-copy="supporting">{value.length} of 180 characters</span>
      <span data-ui-copy="body">{PRIVACY_FIELD_COPY}</span>
      <span data-ui-copy="body">{help}</span>
    </label>
  );
  const roleOptions = area ? getRoleOptions(area) : [];
  const roleCanContact = answers.situation.role !== null && CONTACT_ROLE_IDS.has(answers.situation.role as never);
  const contactQuestionVisible = roleCanContact;

  return (
    <section className="dc-stage" data-ui-component-content={"desired-client-stage-" + stage}>
      <div className="dc-stage__intro" data-ui-component-content={"desired-client-stage-intro-" + stage}>
        <h1 tabIndex={-1} data-ui-copy="heading">{STAGE_DEFINITIONS[stage - 1].heading}</h1>
        <p data-ui-copy="body">{STAGE_DEFINITIONS[stage - 1].explanation}</p>
      </div>
      {notice && <p className="dc-alert" role="status" data-ui-copy="supporting">{notice}</p>}
      <div className="dc-stage__layout">
        <div className="dc-stage__questions">
          {stage === 1 && <>
            {radio("dc-area", null, "What legal work do you want more of?", AREA_ORDER.map((id) => ({ id, label: getAreaLabel(id) })), area,
              (current, selected) => ({ ...current, focus: { ...current.focus, area: selected as AreaId } }),
              "Choose one area first. You can define another profile for other work.")}
            {area && <>
              {radio("dc-work", null, "Which type of work should we focus on?", getWorkOptions(area), answers.focus.work,
                (current, selected) => ({ ...current, focus: { ...current.focus, work: selected as typeof current.focus.work, work_other: selected === "other" ? current.focus.work_other : "" } }),
                "Start with one service or type of matter. You can define another profile for other work.")}
              {answers.focus.work === "other" && textField("Describe the work in a few words", answers.focus.work_other,
                (current, text) => ({ ...current, focus: { ...current.focus, work_other: text } }), "Use a general description. Leave out client names and confidential matter details.")}
              <button type="button" className="dc-button dc-button--secondary" onClick={onCompare}>Help me compare two</button>
              {answers.focus.work && radio("dc-route", "capacity", "Where does this work sit today?", entries(ROUTE_LABELS), route,
                (current, selected) => ({ ...current, focus: { ...current.focus, route: selected as typeof current.focus.route, certainty: current.focus.certainty ?? "chosen" } }))}
              {answers.focus.work && route && textField("Where can your firm offer this work?", answers.focus.service_area,
                (current, text) => ({ ...current, focus: { ...current.focus, service_area: text } }),
                "Name the city, province or region you are set up to serve. Leave blank if this needs review.")}
            </>}
          </>}
          {stage === 2 && <>
            {area && <>
              {radio("dc-trigger", "trigger", "What usually happens that makes this client seek help?", [...TRIGGER_OPTIONS[area], {id:"unknown",label:"Not sure yet"}], answers.situation.trigger,
                (current, selected) => ({ ...current, situation: { ...current.situation, trigger: selected as typeof current.situation.trigger } }),
                "Choose the event that starts the need for advice. The next question asks how far the matter has progressed.")}
              <p className="dc-question-example" data-ui-copy="supporting"><strong>Example, not a suggested answer:</strong> {TRIGGER_EXAMPLES[area]}</p>
              {radio("dc-timing", "timing", "At what stage do they usually contact you?", entries(TIMING_LABELS), answers.situation.timing,
                (current, selected) => ({ ...current, situation: { ...current.situation, timing: selected as typeof current.situation.timing } }),
                "The same event can bring someone to you early, partway through, or close to a deadline.")}
                {radio("dc-role", null, "Who usually needs the help?", roleOptions, answers.situation.role,
                (current, selected) => ({ ...current, situation: { ...current.situation, role: selected as typeof current.situation.role, role_other: selected === "other" ? current.situation.role_other : "", contact: selected !== "other" && selected !== "unknown" && CONTACT_ROLE_IDS.has(selected as never) ? current.situation.contact : null } }))}
              {answers.situation.role === "other" && textField("Describe the role in a few words", answers.situation.role_other,
                (current, text) => ({ ...current, situation: { ...current.situation, role_other: text } }), "Use a general description. Leave out client names and confidential matter details.")}
              {contactQuestionVisible && <section className="dc-optional"><h2>First contact (optional)</h2>
                {radio("dc-contact", "contact", "Who makes the first contact?", entries(CONTACT_LABELS), answers.situation.contact,
                  (current, selected) => ({ ...current, situation: { ...current.situation, contact: selected as typeof current.situation.contact } }), undefined, false)}
              </section>}
            </>}
          </>}
          {stage === 3 && <>
            {multi("dc-goals", "goals", "What does the client most want to achieve?", entries(GOAL_LABELS), answers.client.goals,
              (current, selected) => ({ ...current, client: { ...current.client, goals: selected as typeof current.client.goals } }), 2, ["unknown"])}
            <section className="dc-optional"><h2>Client concerns (optional)</h2>
              {multi("dc-concerns", "concerns", route === "established" ? "What concern have you heard from these clients?" : "What might concern these clients?",
                entries(CONCERN_LABELS), answers.client.concerns,
                (current, selected) => ({ ...current, client: { ...current.client, concerns: selected as typeof current.client.concerns } }),
                2, ["unheard"], [], route === "established" ? "Choose concerns clients have expressed to you. If you have not heard them directly, say so." : "These are hypotheses to check with clients.", false)}
            </section>
            {multi("dc-decision-needs", "decision_needs", "What would help this client feel ready to take the next step?", DECISION_NEED_OPTIONS, answers.client.decision_needs,
              (current, selected) => ({ ...current, client: { ...current.client, decision_needs: selected as typeof current.client.decision_needs } }),
              2, ["unknown"], [], "Choose what clients may need to understand or trust before proceeding. Leave this open if you do not know yet.", false)}
          </>}
          {stage === 4 && <>
            {multi("dc-reasons", "reasons", "What makes this work especially desirable for your firm?",
              entries(REASON_LABELS).map((option) => ({ ...option, label: getReasonLabel(option.id as keyof typeof REASON_LABELS, route) })),
              answers.value.reasons, (current, selected) => ({ ...current, value: { ...current.value, reasons: selected as typeof current.value.reasons } }),
              3, ["undecided"], [], route === "established"
                ? "Think about why you would choose more of this work when other inquiries also compete for the team's time."
                : "Choose up to three reasons this direction appeals to you. We will distinguish expectations from experience.")}
            {radio("dc-fee-effort", "fee_effort", route === "established" ? "How does the fee compare with the work involved?" : "How do you expect the fee to compare with the work involved?",
              entries({ worthwhile: getFeeEffortLabel("worthwhile", route), scoped: getFeeEffortLabel("scoped", route), difficult: getFeeEffortLabel("difficult", route), unknown: getFeeEffortLabel("unknown", route) }),
              answers.value.fee_effort, (current, selected) => ({ ...current, value: { ...current.value, fee_effort: selected as typeof current.value.fee_effort } }),
              "Consider the fee alongside the total effort needed to deliver the work. A larger fee alone does not establish better value.")}
            <section className="dc-optional"><h2>Commercial detail (optional)</h2>
              {radio("dc-collected-fee", null, route === "established" ? "Typical collected fee, excluding disbursements" : "Fee range you are considering, excluding disbursements",
                entries(COLLECTED_FEE_LABELS), answers.value.collected_fee,
                (current, selected) => ({ ...current, value: { ...current.value, collected_fee: selected as typeof current.value.collected_fee } }), undefined, false)}
              {radio("dc-team-hours", null, "Typical total team time", entries(TEAM_HOURS_LABELS), answers.value.team_hours,
                (current, selected) => ({ ...current, value: { ...current.value, team_hours: selected as typeof current.value.team_hours } }), undefined, false)}
              {radio("dc-payment", null, "How predictable is payment?", entries(PAYMENT_LABELS), answers.value.payment,
                (current, selected) => ({ ...current, value: { ...current.value, payment: selected as typeof current.value.payment } }), undefined, false)}
            </section>
          </>}
          {stage === 5 && <>
            {multi("dc-conditions", "conditions", "What helps your team deliver this work well?", entries(CONDITION_LABELS), answers.delivery.conditions,
              (current, selected) => ({ ...current, delivery: { ...current.delivery, conditions: selected as typeof current.delivery.conditions } }), 3, ["unknown"], [],
              "Optional. Choose up to three conditions.", false)}
            {radio("dc-capacity", "capacity", "Could the firm take on more of this work now?", entries(CAPACITY_LABELS), answers.delivery.capacity,
              (current, selected) => ({ ...current, delivery: { ...current.delivery, capacity: selected as typeof current.delivery.capacity } }))}
            <section className="dc-optional"><h2>Important limit (optional)</h2>
              {radio("dc-limit", "limit", "What makes this work hard?", entries(LIMIT_LABELS), answers.delivery.limit,
                (current, selected) => ({ ...current, delivery: { ...current.delivery, limit: selected as typeof current.delivery.limit } }), undefined, false)}
            </section>
            {multi("dc-fit-signals", "fit_signals", "Which early signs would make this inquiry worth a closer look?", FIT_SIGNAL_OPTIONS, answers.delivery.fit_signals,
              (current, selected) => ({ ...current, delivery: { ...current.delivery, fit_signals: selected as typeof current.delivery.fit_signals } }), 3, ["unknown"], [],
              "Choose up to three things you would want to establish in an initial conversation. Missing information should lead to a question.")}
            <p data-ui-copy="supporting">These are proposed signals to explore. The firm still decides scope, suitability and whether to accept a matter.</p>
          </>}
          {stage === 6 && <>
            {radio("dc-aim", "aim", "What should this work help the firm become known for?", entries(AIM_LABELS), answers.direction.aim,
              (current, selected) => ({ ...current, direction: { ...current.direction, aim: selected as typeof current.direction.aim } }))}
            {multi("dc-evidence", "evidence", "What supports this direction?", entries(EVIDENCE_LABELS), answers.direction.evidence,
              (current, selected) => ({ ...current, direction: { ...current.direction, evidence: selected as typeof current.direction.evidence } }),
              6, ["preference"], [["repeated", "few"]])}
            <section className="dc-optional"><h2>Work to promote less (optional)</h2>
              {radio("dc-less", null, "Which work should the firm promote less?", entries(LESS_LABELS), answers.direction.less,
                (current, selected) => ({ ...current, direction: { ...current.direction, less: selected as typeof current.direction.less, less_note: selected === "none" ? "" : current.direction.less_note } }), undefined, false)}
              {answers.direction.less && answers.direction.less !== "none" && textField("Name the work in a few words", answers.direction.less_note,
                (current, text) => ({ ...current, direction: { ...current.direction, less_note: text } }), "Use a general description.")}
            </section>
          </>}
        </div>
        {preview && <div className="dc-stage__preview">{preview}</div>}
      </div>
      <div className="dc-actions">
        <button type="button" className="dc-button dc-button--secondary" onClick={onBack}>Back</button>
        <button type="button" className="dc-button dc-button--primary" onClick={onNext}>Continue</button>
      </div>
      <ConfirmationDialog open={pendingArea !== null} onClose={() => setPendingArea(null)} labelledBy="dc-area-confirm">
        <h2 id="dc-area-confirm" data-ui-copy="heading">Changing the practice area clears the selected work, client role, situation and comparison. Continue?</h2>
        <p data-ui-copy="body">You can answer the situation, decision-needs and fit-signal questions again for the new focus.</p>
        <button className="dc-button dc-button--primary" onClick={() => {
          const selected = pendingArea; if (!selected) return; setPendingArea(null);
          onEdit((current) => ({ ...current, focus: { ...current.focus, area: selected } }));
        }}>Continue</button>
        <button className="dc-button dc-button--secondary" onClick={() => setPendingArea(null)}>Keep draft</button>
      </ConfirmationDialog>
    </section>
  );
}
