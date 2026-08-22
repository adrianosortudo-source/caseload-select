"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DecisionCard } from "./DecisionCard";
import { Shell } from "./Shell";
import { TextCard } from "./TextCard";
import type { ScreenItem } from "./types";
import {
  answerDemoState,
  buildDemoReport,
  startDemoState,
} from "@/lib/screen-demo";
import {
  buildLeadSummary,
  getNextStep,
  WEB_DISCOVERY_HARD_CAP,
  WEB_DISCOVERY_TARGET_MAX,
  WEB_DISCOVERY_TARGET_MIN,
} from "@/lib/screen-engine/control";
import { getI18n } from "@/lib/screen-engine/i18n/loader";
import {
  getOptionDescription,
  getOptionDisplayLabel,
  getQuestionDisplayText,
} from "@/lib/screen-engine/i18n/display";
import type {
  EngineState,
  LawyerReport,
  SlotDefinition,
} from "@/lib/screen-engine/types";

const DEMO_SEED =
  "Fictional scenario: I own a small Toronto design studio. A client has not paid a $28,000 invoice for completed work. The invoice was due two weeks ago, the client now disputes the scope, and I have the signed proposal, invoice, and email thread.";

function demoItem(slot: SlotDefinition, state: EngineState): ScreenItem {
  const i18n = getI18n(state.language);
  return {
    id: slot.id,
    question: getQuestionDisplayText(
      slot.id,
      slot.question,
      state.language,
      i18n,
    ),
    presentation: (slot.options?.length ?? 0) <= 3 ? "chip" : "card",
    allowFreeText: true,
    options: (slot.options ?? []).map((option) => ({
      value: option.value,
      label: getOptionDisplayLabel(option, slot.id, state.language, i18n),
      description: getOptionDescription(option, slot.id, state.language, i18n),
    })),
  };
}

function List({
  items,
  empty = "None identified from this fictional scenario.",
}: {
  items: string[];
  empty?: string;
}) {
  if (items.length === 0)
    return <p className="text-sm text-slate-600">{empty}</p>;
  return (
    <ul className="space-y-2 text-sm leading-relaxed text-slate-700">
      {items.map((item) => (
        <li key={item}>• {item}</li>
      ))}
    </ul>
  );
}

function BriefSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[#1E2F58]/10 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[#1E2F58]/60">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ScreenDemoWidget() {
  const [situation, setSituation] = useState(DEMO_SEED);
  const [state, setState] = useState<EngineState | null>(null);
  const [history, setHistory] = useState<EngineState[]>([]);
  const [report, setReport] = useState<LawyerReport | null>(null);

  const next = state ? getNextStep(state) : null;
  const currentItem = useMemo(
    () => (next?.slot && state ? demoItem(next.slot, state) : null),
    [next, state],
  );

  function reset() {
    setSituation(DEMO_SEED);
    setState(null);
    setHistory([]);
    setReport(null);
  }

  function begin() {
    if (situation.trim().length >= 10) setState(startDemoState(situation));
  }

  function answer(slotId: string, value: string | string[]) {
    if (!state) return;
    setHistory((previous) => [...previous, state]);
    setState(answerDemoState(state, slotId, value));
  }

  function back() {
    const previous = history.at(-1);
    if (!previous) return reset();
    setHistory((items) => items.slice(0, -1));
    setState(previous);
  }

  if (report) {
    return (
      <div
        className="min-h-screen bg-[#F4F3EF] px-5 py-8"
        style={{ fontFamily: "DM Sans, sans-serif" }}
      >
        <div className="mx-auto max-w-4xl space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#1E2F58]/55">
                Fictional Screen brief
              </p>
              <h1
                className="mt-1 text-3xl font-extrabold text-[#1E2F58]"
                style={{ fontFamily: "Manrope, sans-serif" }}
              >
                What the lawyer receives
              </h1>
            </div>
            <button
              type="button"
              onClick={reset}
              className="rounded-full border border-[#1E2F58]/20 px-5 py-2.5 text-sm font-semibold text-[#1E2F58]"
            >
              New fictional situation
            </button>
          </div>
          <p className="rounded-lg border border-[#1E2F58]/10 bg-[#1E2F58]/5 px-4 py-3 text-sm text-[#1E2F58]">
            Demo only. This brief is generated in this browser from a fictional
            scenario. Nothing is saved, sent, or added to a CRM.
          </p>
          <BriefSection title="Matter snapshot">
            <p className="text-base leading-relaxed text-slate-800">
              {report.matter_snapshot}
            </p>
          </BriefSection>
          <div className="grid gap-5 md:grid-cols-2">
            <BriefSection title="Priority and cadence">
              <p className="text-lg font-bold text-[#1E2F58]">
                {report.lawyer_time_priority}
              </p>
              <p className="mt-2 text-sm text-slate-700">
                Band {report.band}. The lawyer sets the response and engagement
                decision.
              </p>
            </BriefSection>
            <BriefSection title="Confidence and gaps">
              <p className="text-sm text-slate-700">
                {report.confidence_calibration}
              </p>
              <div className="mt-3">
                <List
                  items={report.open_questions}
                  empty="No further gaps were identified by the demo."
                />
              </div>
            </BriefSection>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <BriefSection title="Captured facts">
              <ul className="space-y-2 text-sm text-slate-700">
                {report.resolved_facts_v2.map((fact) => (
                  <li key={`${fact.label}-${fact.value}`}>
                    <strong>{fact.label}:</strong> {fact.value}{" "}
                    <span className="text-slate-500">({fact.source})</span>
                  </li>
                ))}
              </ul>
            </BriefSection>
            <BriefSection title="Inferences, labeled">
              <List
                items={report.inferred_signals.map(
                  (signal) => `Inference: ${signal}`,
                )}
                empty="No inferences. The demo keeps unconfirmed signals separate from captured facts."
              />
            </BriefSection>
          </div>
          <BriefSection title="Priority rationale">
            <List items={report.band_reasoning_bullets} />
          </BriefSection>
          <div className="grid gap-5 md:grid-cols-2">
            <BriefSection title="What to confirm">
              <List items={report.what_to_confirm} />
            </BriefSection>
            <BriefSection title="Call preparation">
              <List items={report.call_openers} />
            </BriefSection>
          </div>
          <p className="py-3 text-center text-base font-semibold text-[#1E2F58]">
            The Screen prioritizes attention. The lawyer decides.
          </p>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <Shell
        totalScreens={1}
        currentScreen={0}
        roundLabel="Fictional situation"
      >
        <div className="space-y-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#1E2F58]/55">
              Demo only • no storage
            </p>
            <h1
              className="mt-2 text-3xl font-extrabold text-[#1E2F58]"
              style={{ fontFamily: "Manrope, sans-serif" }}
            >
              Try the Screen with a fictional situation.
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-[#1E2F58]/70">
              Use the sample or invent a scenario. Do not enter real names,
              contact details, or confidential information. Nothing is
              submitted, stored, or sent.
            </p>
          </div>
          <TextCard
            item={{
              id: "fictional-situation",
              question: "What is the fictional situation?",
              description: `The Screen usually asks ${WEB_DISCOVERY_TARGET_MIN}–${WEB_DISCOVERY_TARGET_MAX} short follow-up questions and never more than ${WEB_DISCOVERY_HARD_CAP} before preparing the demonstration brief.`,
              presentation: "text",
              placeholder: DEMO_SEED,
            }}
            value={situation}
            onChange={setSituation}
            onSubmit={begin}
            submitLabel="Run fictional Screen"
            minChars={10}
          />
        </div>
      </Shell>
    );
  }

  if (
    next?.type === "present_insight" ||
    next?.type === "capture_contact" ||
    next?.type === "stop"
  ) {
    const summary = buildLeadSummary(state, getI18n(state.language));
    return (
      <Shell
        totalScreens={3}
        currentScreen={2}
        roundLabel="Review"
        onBack={back}
      >
        <div className="flex flex-col gap-5">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#1E2F58]/55">
            Fictional demonstration • no storage
          </p>
          <h2
            className="text-[28px] font-extrabold text-[#1E2F58]"
            style={{ fontFamily: "Manrope, sans-serif" }}
          >
            Here is what the Screen understood.
          </h2>
          <p className="text-[15px] leading-relaxed text-[#1E2F58]/70">
            {summary.intro}
          </p>
          {summary.points.length > 0 && (
            <ul className="rounded-xl border border-[#1E2F58]/10 bg-white p-4 text-sm text-slate-700">
              {summary.points.map((point) => (
                <li key={point}>• {point}</li>
              ))}
            </ul>
          )}
          <p className="text-sm text-[#1E2F58]/70">
            This demonstration stops before contact, consent, or any handoff.
            The brief stays only in this browser.
          </p>
          <button
            type="button"
            onClick={() => setReport(buildDemoReport(state))}
            className="min-h-[52px] rounded-full bg-[#1E2F58] px-8 text-[15px] font-semibold text-white"
          >
            See what the lawyer receives
          </button>
        </div>
      </Shell>
    );
  }

  if (!currentItem)
    return (
      <Shell
        totalScreens={1}
        currentScreen={0}
        roundLabel="Fictional situation"
      >
        <div className="space-y-5 text-center">
          <h2 className="text-2xl font-bold text-[#1E2F58]">
            Choose a clearer fictional situation.
          </h2>
          <p className="text-sm text-[#1E2F58]/70">
            This demo does not ask for contact details or save an incomplete
            scenario.
          </p>
          <button
            type="button"
            onClick={reset}
            className="rounded-full bg-[#1E2F58] px-6 py-3 text-sm font-semibold text-white"
          >
            Start a new fictional situation
          </button>
        </div>
      </Shell>
    );

  return (
    <Shell
      totalScreens={WEB_DISCOVERY_HARD_CAP}
      currentScreen={Math.min(state.questionHistory.length, WEB_DISCOVERY_HARD_CAP - 1)}
      roundLabel="About the fictional case"
      onBack={back}
      onSkip={() => answer(currentItem.id, "Not sure")}
    >
      <DecisionCard
        item={currentItem}
        onChange={(value) => answer(currentItem.id, value)}
      />
    </Shell>
  );
}
