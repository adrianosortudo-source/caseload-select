"use client";

/**
 * WhyYourFirm · wizard shell
 *
 * Owns the single source of truth for the five-step flow: state, localStorage
 * persistence, resume/restart, the step indicator, and the embed protocol
 * hooks (§3.5 of the build plan). Step components are controlled: they read
 * a slice of WizardData and call back with patches, never touching storage
 * or navigation themselves.
 *
 * State persists in localStorage only (key wyf-state-v1). Refresh,
 * interruption and browser back never lose work; nothing reaches the server
 * until the report POST at step 5. This mirrors the Firm Voice Builder's own
 * resume pattern (loading -> resume-prompt -> active), because it is the
 * established convention for this class of tool in this codebase, not a new
 * invention.
 */

import { useEffect, useRef, useState } from "react";
import { copy } from "@/lib/why-your-firm/compliance";
import { GATE_MODE } from "@/lib/why-your-firm/config";
import { watchEmbedHeight, announceStepChange } from "@/lib/why-your-firm/embed";
import { trackEvent, EVENTS } from "@/lib/why-your-firm/analytics";
import AlternativesStep from "./AlternativesStep";
import DifferentiatorPicker from "./DifferentiatorPicker";
import TestsStep from "./TestsStep";
import StatementStep from "./StatementStep";
import ResultsStep from "./ResultsStep";

export interface CardEntry {
  inputValue: string;
  proof: string;
  tests: { provable: boolean; inDemand: boolean; unique: boolean };
}

export interface WizardData {
  step: 1 | 2 | 3 | 4 | 5;

  // Step 1
  alternativeIds: string[];
  alternativeOther: string;

  // Step 2
  passOneIds: string[];
  passOneConfirmed: boolean;
  passTwoIds: string[];

  // Step 3, keyed by card id (subset of passTwoIds)
  cardEntries: Record<string, CardEntry>;

  // Step 4
  anchorCardId: string | null;
  patternId: string | null;
  statementValues: string[];

  // Collected once, reused at the gate
  firmName: string;
}

const STORAGE_KEY = "wyf-state-v1";
const TOTAL_STEPS = 5;

function defaultData(): WizardData {
  return {
    step: 1,
    alternativeIds: [],
    alternativeOther: "",
    passOneIds: [],
    passOneConfirmed: false,
    passTwoIds: [],
    cardEntries: {},
    anchorCardId: null,
    patternId: null,
    statementValues: [],
    firmName: "",
  };
}

function hasProgress(data: WizardData): boolean {
  return data.step > 1 || data.alternativeIds.length > 0 || data.passOneIds.length > 0;
}

function loadSaved(): WizardData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WizardData;
    if (typeof parsed.step !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function save(data: WizardData) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Persistence is a convenience, not a requirement. See FirmVoiceBuilder's
    // identical rationale: storage can fail (private browsing, quota) and
    // the wizard keeps working without it.
  }
}

function clearSaved() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See save().
  }
}

type Phase = "loading" | "intro" | "resume-prompt" | "wizard";

const STEP_LABELS: Record<WizardData["step"], string> = {
  1: "Real alternatives",
  2: "Your differentiators",
  3: "The tests",
  4: "Your statement",
  5: "Your brief",
};

export default function WhyYourFirm() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<WizardData>(defaultData());
  const [savedSnapshot, setSavedSnapshot] = useState<WizardData | null>(null);

  useEffect(() => {
    const saved = loadSaved();
    if (saved && hasProgress(saved)) {
      setSavedSnapshot(saved);
      setPhase("resume-prompt");
    } else {
      setPhase("intro");
    }
  }, []);

  useEffect(() => {
    const stop = watchEmbedHeight();
    return stop;
  }, []);

  useEffect(() => {
    if (phase === "wizard") {
      announceStepChange();
      trackEvent(EVENTS.step, { step: data.step });
    }
  }, [phase, data.step]);

  const startedRef = useRef(false);

  /**
   * Accepts either a plain patch or an updater that computes the patch from
   * the LATEST state. The plain form is fine for anything that doesn't read
   * existing array/object state (setting a text field, advancing a step).
   * Anything that toggles membership in an array (passOneIds, passTwoIds,
   * alternativeIds, cardEntries) MUST use the updater form: computing the
   * next array from the `data` prop closure instead of `prev` is a real bug,
   * not a style preference. React 18's automatic batching can run several
   * clicks fired in the same task against the SAME stale `data` closure
   * before any of them re-renders, so each toggle computes its new array
   * from the same starting point and only the last call's result survives,
   * silently dropping every toggle before it. Confirmed by reproduction
   * during Phase 2 QA: three card picks in one batch left only one selected.
   */
  function patch(changesOrUpdater: Partial<WizardData> | ((prev: WizardData) => Partial<WizardData>)) {
    if (!startedRef.current) {
      startedRef.current = true;
      trackEvent(EVENTS.start);
    }
    setData((prev) => {
      const changes = typeof changesOrUpdater === "function" ? changesOrUpdater(prev) : changesOrUpdater;
      const next = { ...prev, ...changes };
      save(next);
      return next;
    });
  }

  function goToStep(step: WizardData["step"]) {
    if (step > data.step) return; // never skip ahead from the indicator
    patch({ step });
  }

  function startFresh() {
    clearSaved();
    const fresh = defaultData();
    setData(fresh);
    setSavedSnapshot(null);
    setPhase("wizard");
  }

  function resumeSaved() {
    if (savedSnapshot) setData(savedSnapshot);
    setSavedSnapshot(null);
    setPhase("wizard");
  }

  if (phase === "loading") return null;

  if (phase === "intro") {
    return (
      <div className="card p-6 max-w-xl mx-auto">
        <p className="label mb-2">{copy.tool.eyebrow}</p>
        <h1 className="text-2xl font-display font-semibold text-navy mb-3">{copy.tool.name}</h1>
        <p className="text-sm text-body leading-relaxed mb-3">{copy.tool.intro}</p>
        <p className="text-sm text-body leading-relaxed mb-3">{GATE_MODE === "no_gate" ? copy.tool.privacyNoGate : copy.tool.privacy}</p>
        <button type="button" className="btn-gold mt-2" onClick={startFresh}>
          {copy.tool.start}
        </button>
      </div>
    );
  }

  if (phase === "resume-prompt") {
    return (
      <div className="card p-6 max-w-xl mx-auto text-center">
        <p className="label mb-2">Welcome back</p>
        <h2 className="text-lg font-display font-semibold text-navy mb-3">
          {copy.tool.resume}
        </h2>
        <p className="text-sm text-body mb-5">{GATE_MODE === "no_gate" ? copy.tool.privacyNoGate : copy.tool.privacy}</p>
        <div className="flex gap-2 justify-center">
          <button type="button" className="btn-gold" onClick={resumeSaved}>
            {copy.tool.resumeAction}
          </button>
          <button type="button" className="btn-ghost" onClick={startFresh}>
            {copy.tool.restartAction}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-5 sticky top-0 bg-parchment/95 backdrop-blur py-3 z-10 wyf-step-chrome">
        <StepIndicator current={data.step} onSelect={goToStep} />
      </div>

      {data.step === 1 && (
        <AlternativesStep
          data={data}
          onPatch={patch}
          onContinue={() => patch({ step: 2 })}
        />
      )}

      {data.step === 2 && (
        <DifferentiatorPicker
          data={data}
          onPatch={patch}
          onContinue={() => patch({ step: 3 })}
          onBack={() => patch({ step: 1 })}
        />
      )}

      {data.step === 3 && (
        <TestsStep
          data={data}
          onPatch={patch}
          onContinue={() => patch({ step: 4 })}
          onBack={() => patch({ step: 2, passOneConfirmed: true })}
        />
      )}

      {data.step === 4 && (
        <StatementStep
          data={data}
          onPatch={patch}
          onContinue={() => patch({ step: 5 })}
          onBack={() => patch({ step: 3 })}
        />
      )}

      {data.step === 5 && (
        <ResultsStep data={data} onBack={() => patch({ step: 4 })} />
      )}
    </div>
  );
}

function StepIndicator({
  current,
  onSelect,
}: {
  current: WizardData["step"];
  onSelect: (step: WizardData["step"]) => void;
}) {
  const steps = [1, 2, 3, 4, 5] as WizardData["step"][];
  return (
    <div>
      <p className="text-[10px] font-display font-semibold uppercase tracking-widest text-muted mb-1.5">
        {copy.tool.stepLabel} {current} {copy.tool.stepOf} {TOTAL_STEPS} &middot; {STEP_LABELS[current]}
      </p>
      <div className="flex gap-1.5">
        {steps.map((n) => {
          const done = n < current;
          const active = n === current;
          const clickable = n <= current;
          return (
            <button
              key={n}
              type="button"
              disabled={!clickable}
              onClick={() => onSelect(n)}
              aria-current={active ? "step" : undefined}
              aria-label={`${copy.tool.stepLabel} ${n}: ${STEP_LABELS[n]}`}
              className={[
                "h-1.5 flex-1 transition",
                done ? "bg-navy" : active ? "bg-gold" : "bg-border-brand",
                clickable ? "cursor-pointer" : "cursor-default",
              ].join(" ")}
            />
          );
        })}
      </div>
    </div>
  );
}
