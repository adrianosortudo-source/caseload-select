"use client";

/**
 * /widget-v2/preview — visual smoke test for the new widget primitives.
 *
 * Walks through one screen of every layout type with mock data:
 *   1. Situation kickoff (TextCard)
 *   2. Round transition (loading -> reveal)
 *   3. Decision card (single-select, 6 options, auto-advance)
 *   4. Decision card (multi-select with sticky Continue)
 *   5. Rapid-fire (3 yes/no questions on one screen)
 *   6. Slider (bucketed time elapsed)
 *   7. Free-text Round 3 question
 *   8. Done state
 *
 * No API calls. Pure presentation preview. Use to tune brand styling, tap
 * targets, transitions, and mobile breakpoints before wiring to the real flow.
 */

import { useEffect, useState } from "react";
import { Shell } from "@/components/intake-v2/Shell";
import { DecisionCard } from "@/components/intake-v2/DecisionCard";
import { RapidFire } from "@/components/intake-v2/RapidFire";
import { SliderCard } from "@/components/intake-v2/SliderCard";
import { TextCard } from "@/components/intake-v2/TextCard";
import { RoundTransition } from "@/components/intake-v2/RoundTransition";
import type { ScreenItem } from "@/components/intake-v2/types";

type Step =
  | "kickoff"
  | "transition_r1"
  | "card_single"
  | "card_multi"
  | "rapid_fire"
  | "slider"
  | "transition_r2"
  | "free_text_r3"
  | "done";

// ── Mock screen items ────────────────────────────────────────────────────────
const KICKOFF_ITEM: ScreenItem = {
  id: "situation",
  question: "Tell us what happened.",
  description: "A few sentences is enough. Your lawyer will see exactly what you write.",
  presentation: "text",
  placeholder: "I was rear-ended on the QEW last Tuesday...",
};

const CARD_SINGLE_ITEM: ScreenItem = {
  id: "pi_slip_fall__location_type",
  question: "Where did the fall happen?",
  presentation: "card",
  options: [
    { value: "retail_store",  label: "Retail store or mall" },
    { value: "grocery_store", label: "Grocery store or supermarket" },
    { value: "restaurant",    label: "Restaurant or café" },
    { value: "apartment",     label: "Apartment or condo building" },
    { value: "sidewalk",      label: "Public sidewalk" },
    { value: "workplace",     label: "Workplace" },
  ],
};

const CARD_MULTI_ITEM: ScreenItem = {
  id: "pi_mva__injuries",
  question: "What injuries are you dealing with?",
  description: "Select all that apply. We use this to estimate care needs.",
  presentation: "card",
  multiSelect: true,
  options: [
    { value: "neck",     label: "Neck or whiplash" },
    { value: "back",     label: "Back or spine" },
    { value: "head",     label: "Head or concussion" },
    { value: "limb",     label: "Arm or leg fracture" },
    { value: "soft",     label: "Soft tissue / bruising" },
    { value: "psych",    label: "Anxiety or PTSD symptoms" },
  ],
};

const RAPID_FIRE_ITEMS: ScreenItem[] = [
  {
    id: "treatment_ongoing",
    question: "Are you currently receiving treatment?",
    presentation: "chip",
    options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
  },
  {
    id: "missed_work",
    question: "Have you missed work because of this?",
    presentation: "chip",
    options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unsure", label: "Not sure" }],
  },
  {
    id: "witness",
    question: "Did anyone witness what happened?",
    presentation: "chip",
    options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
  },
];

const SLIDER_ITEM: ScreenItem = {
  id: "incident_when",
  question: "When did this happen?",
  description: "Best estimate is fine.",
  presentation: "slider",
  options: [
    { value: "today",       label: "Today" },
    { value: "this_week",   label: "This week" },
    { value: "this_month",  label: "This month" },
    { value: "months_ago",  label: "Months ago" },
    { value: "year_plus",   label: "Over a year" },
  ],
};

const STRUCTURED_R3: ScreenItem = {
  id: "pi_mva_q2",
  question: "How did the collision happen?",
  description: "Pick the closest match. Your lawyer will get the full picture during the consultation.",
  presentation: "card",
  options: [
    { value: "rear_end_stopped",     label: "I was stopped, hit from behind" },
    { value: "rear_end_moving",      label: "I was moving, hit from behind" },
    { value: "intersection_other",   label: "Intersection, the other driver ran a light or sign" },
    { value: "intersection_me",      label: "Intersection, I may share fault" },
    { value: "lane_change",          label: "Lane-change or merge collision" },
    { value: "head_on",              label: "Head-on or oncoming" },
    { value: "single_vehicle",       label: "Single-vehicle (lost control, road conditions)" },
    { value: "other",                label: "Something else" },
  ],
};

const ROUND_LABEL: Record<Step, string | undefined> = {
  kickoff:        "Your situation",
  transition_r1:  undefined,
  card_single:    "About your case",
  card_multi:     "About your case",
  rapid_fire:     "Quick details",
  slider:         "Quick details",
  transition_r2:  undefined,
  free_text_r3:   "Final details",
  done:           undefined,
};

// Step ordering used to derive progress within the "About your case" group
const STEPS: Step[] = ["kickoff", "transition_r1", "card_single", "card_multi", "rapid_fire", "slider", "transition_r2", "free_text_r3", "done"];

export default function WidgetV2Preview() {
  const [step, setStep] = useState<Step>("kickoff");
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [transitionPhase, setTransitionPhase] = useState<"loading" | "reveal">("loading");

  // Fake the round transitions: 2s loading, then reveal, then auto-advance
  useEffect(() => {
    if (step !== "transition_r1" && step !== "transition_r2") return;
    setTransitionPhase("loading");
    const t1 = setTimeout(() => setTransitionPhase("reveal"), 1800);
    return () => clearTimeout(t1);
  }, [step]);

  function next(target: Step) {
    setStep(target);
  }

  function answer(id: string, value: string | string[]) {
    setAnswers(a => ({ ...a, [id]: value }));
  }

  function back() {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  }

  // Auto-advance for single-select decision card
  function answerAndAdvance(id: string, value: string | string[], target: Step) {
    answer(id, value);
    setTimeout(() => setStep(target), 220);
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (step === "transition_r1") {
    return (
      <RoundTransition
        phase={transitionPhase}
        loadingText="Reading your situation..."
        revealText="Got the basics. A few quick questions."
        onComplete={() => next("card_single")}
      />
    );
  }

  if (step === "transition_r2") {
    return (
      <RoundTransition
        phase={transitionPhase}
        loadingText="Looking at your answers..."
        revealText="One more round to round out your file."
        onComplete={() => next("free_text_r3")}
      />
    );
  }

  if (step === "done") {
    return (
      <div className="min-h-screen bg-[#F4F3EF] flex flex-col items-center justify-center px-5">
        <div className="max-w-[480px] text-center flex flex-col gap-5">
          <div className="w-16 h-16 mx-auto rounded-full bg-[#1E2F58] flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="text-[26px] font-extrabold text-[#1E2F58]" style={{ fontFamily: "Manrope, sans-serif" }}>
            All done.
          </h2>
          <p className="text-[15px] text-[#1E2F58]/70" style={{ fontFamily: "DM Sans, sans-serif" }}>
            Your case file is ready. Your lawyer will see it within minutes.
          </p>
          <pre className="mt-4 text-left text-[11px] bg-white border border-[#1E2F58]/10 rounded-lg p-3 overflow-auto max-h-[260px]" style={{ fontFamily: "monospace" }}>
            {JSON.stringify(answers, null, 2)}
          </pre>
          <button
            type="button"
            onClick={() => { setAnswers({}); setStep("kickoff"); }}
            className="mt-2 text-[13px] text-[#1E2F58]/60 underline"
            style={{ fontFamily: "DM Sans, sans-serif" }}
          >
            Reset preview
          </button>
        </div>
      </div>
    );
  }

  // Calculate screen progress per round-label group
  const groupSteps = STEPS.filter(s => ROUND_LABEL[s] === ROUND_LABEL[step] && ROUND_LABEL[s] !== undefined);
  const totalScreens = groupSteps.length || 1;
  const currentScreen = Math.max(0, groupSteps.indexOf(step));

  // Per-step content + footer rendering
  if (step === "kickoff") {
    return (
      <Shell totalScreens={totalScreens} currentScreen={currentScreen} roundLabel={ROUND_LABEL[step]}>
        <TextCard
          item={KICKOFF_ITEM}
          value={typeof answers.situation === "string" ? answers.situation : ""}
          onChange={v => answer("situation", v)}
          onSubmit={() => next("transition_r1")}
          submitLabel="Continue"
          minChars={10}
        />
      </Shell>
    );
  }

  if (step === "card_single") {
    return (
      <Shell totalScreens={totalScreens} currentScreen={currentScreen} roundLabel={ROUND_LABEL[step]} onBack={back}>
        <DecisionCard
          item={CARD_SINGLE_ITEM}
          value={answers[CARD_SINGLE_ITEM.id]}
          onChange={v => answerAndAdvance(CARD_SINGLE_ITEM.id, v, "card_multi")}
        />
      </Shell>
    );
  }

  if (step === "card_multi") {
    const selected = Array.isArray(answers[CARD_MULTI_ITEM.id]) ? (answers[CARD_MULTI_ITEM.id] as string[]) : [];
    const canContinue = selected.length > 0;
    return (
      <Shell
        totalScreens={totalScreens}
        currentScreen={currentScreen}
        roundLabel={ROUND_LABEL[step]}
        onBack={back}
        footer={
          <button
            type="button"
            onClick={() => next("rapid_fire")}
            disabled={!canContinue}
            className={`w-full min-h-[52px] rounded-full text-[15px] font-semibold transition-all ${
              canContinue
                ? "bg-[#1E2F58] text-white hover:shadow-[0_4px_14px_rgba(30,47,88,0.25)]"
                : "bg-[#1E2F58]/15 text-[#1E2F58]/40 cursor-not-allowed"
            }`}
            style={{ fontFamily: "DM Sans, sans-serif" }}
          >
            Continue
          </button>
        }
      >
        <DecisionCard
          item={CARD_MULTI_ITEM}
          value={answers[CARD_MULTI_ITEM.id]}
          onChange={v => answer(CARD_MULTI_ITEM.id, v)}
        />
      </Shell>
    );
  }

  if (step === "rapid_fire") {
    const allAnswered = RAPID_FIRE_ITEMS.every(i => answers[i.id] !== undefined && answers[i.id] !== "");
    return (
      <Shell
        totalScreens={totalScreens}
        currentScreen={currentScreen}
        roundLabel={ROUND_LABEL[step]}
        onBack={back}
        footer={
          <button
            type="button"
            onClick={() => next("slider")}
            disabled={!allAnswered}
            className={`w-full min-h-[52px] rounded-full text-[15px] font-semibold transition-all ${
              allAnswered
                ? "bg-[#1E2F58] text-white hover:shadow-[0_4px_14px_rgba(30,47,88,0.25)]"
                : "bg-[#1E2F58]/15 text-[#1E2F58]/40 cursor-not-allowed"
            }`}
            style={{ fontFamily: "DM Sans, sans-serif" }}
          >
            Continue
          </button>
        }
      >
        <RapidFire items={RAPID_FIRE_ITEMS} values={answers} onChange={answer} />
      </Shell>
    );
  }

  if (step === "slider") {
    return (
      <Shell totalScreens={totalScreens} currentScreen={currentScreen} roundLabel={ROUND_LABEL[step]} onBack={back}>
        <SliderCard
          item={SLIDER_ITEM}
          value={typeof answers[SLIDER_ITEM.id] === "string" ? (answers[SLIDER_ITEM.id] as string) : undefined}
          onChange={v => answerAndAdvance(SLIDER_ITEM.id, v, "transition_r2")}
        />
      </Shell>
    );
  }

  if (step === "free_text_r3") {
    return (
      <Shell totalScreens={totalScreens} currentScreen={currentScreen} roundLabel={ROUND_LABEL[step]} onBack={back}>
        <DecisionCard
          item={STRUCTURED_R3}
          value={answers[STRUCTURED_R3.id]}
          onChange={v => answerAndAdvance(STRUCTURED_R3.id, v, "done")}
        />
      </Shell>
    );
  }

  return null;
}
