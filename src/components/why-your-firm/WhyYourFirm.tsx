"use client";

/**
 * WhyYourFirm · wizard shell
 *
 * Owns the single source of truth for the run: state, localStorage
 * persistence, resume/restart, navigation, and the embed protocol hooks.
 * Screen components are controlled: they read a slice of WizardData and call
 * back with patches, never touching storage or navigation themselves.
 *
 * ONE QUESTION PER SCREEN, SO NAVIGATION IS BY KEY AND NOT BY NUMBER
 * The sequence is derived from the answers (screens.buildScreens), because
 * every kept claim earns its own test screen and the number of them is the
 * lawyer's own choice. A step number cannot address a sequence that changes
 * shape, so state carries a screenKey and Continue/Back walk the derived
 * list. The counter reports the run the lawyer is actually on.
 *
 * THE SEQUENCE CAN SHRINK UNDER THE LAWYER'S FEET
 * Going back to the keep screen and un-keeping a claim deletes that claim's
 * test screen. If the lawyer was standing on it, screenKey now names a screen
 * that no longer exists. Rather than render nothing, the shell resolves the
 * nearest valid screen: the most recent visited key that is still in the
 * sequence, or the first screen. That resolution happens during render and
 * writes no state, which keeps it out of an effect.
 *
 * State persists in localStorage only (key wyf-state-v2). Refresh,
 * interruption and browser back never lose work. The v1 payload from the
 * five-step build is simply never read: it describes a shape this wizard no
 * longer has, and pre-launch there is no run worth migrating.
 */

import { useEffect, useRef, useState } from "react";
import { copy } from "@/lib/why-your-firm/compliance";
import { GATE_MODE } from "@/lib/why-your-firm/config";
import { watchEmbedHeight, announceStepChange } from "@/lib/why-your-firm/embed";
import { trackEvent, EVENTS } from "@/lib/why-your-firm/analytics";
import {
  buildScreens,
  questionNumber,
  SCREEN_KEY_ALTERNATIVES,
  type WizardData,
  type WizardScreen,
} from "@/lib/why-your-firm/screens";
import SideMenu from "./SideMenu";
import AlternativesStep from "./AlternativesStep";
import PassOneStep from "./PassOneStep";
import KeepStep from "./KeepStep";
import TestStep from "./TestStep";
import StatementStep from "./StatementStep";
import ResultsStep from "./ResultsStep";

const STORAGE_KEY = "wyf-state-v2";

function defaultData(): WizardData {
  return {
    screenKey: SCREEN_KEY_ALTERNATIVES,
    visitedKeys: [SCREEN_KEY_ALTERNATIVES],
    alternativeIds: [],
    alternativeOther: "",
    passOneIds: [],
    passTwoIds: [],
    customClaims: {},
    cardEntries: {},
    anchorCardId: null,
    patternId: null,
    statementValues: [],
    firmName: "",
  };
}

function hasProgress(data: WizardData): boolean {
  return (
    data.screenKey !== SCREEN_KEY_ALTERNATIVES ||
    data.alternativeIds.length > 0 ||
    data.passOneIds.length > 0
  );
}

function loadSaved(): WizardData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WizardData>;
    if (typeof parsed.screenKey !== "string" || !Array.isArray(parsed.visitedKeys)) return null;
    return { ...defaultData(), ...parsed };
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

/**
 * The index of the screen to render. Falls back to the nearest still-valid
 * screen when screenKey names one the current answers no longer produce.
 */
function resolveActiveIndex(screens: WizardScreen[], data: WizardData): number {
  const direct = screens.findIndex((s) => s.key === data.screenKey);
  if (direct !== -1) return direct;

  for (let i = data.visitedKeys.length - 1; i >= 0; i -= 1) {
    const candidate = screens.findIndex((s) => s.key === data.visitedKeys[i]);
    if (candidate !== -1) return candidate;
  }
  return 0;
}

type Phase = "loading" | "intro" | "resume-prompt" | "wizard";

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

  const screens = buildScreens(data);
  const activeIndex = resolveActiveIndex(screens, data);
  const active = screens[activeIndex];
  const activeKey = active?.key ?? SCREEN_KEY_ALTERNATIVES;

  useEffect(() => {
    if (phase !== "wizard") return;
    announceStepChange();
    trackEvent(EVENTS.step, { step: activeKey });
  }, [phase, activeKey]);

  const startedRef = useRef(false);

  /**
   * Accepts either a plain patch or an updater that computes the patch from
   * the LATEST state. The plain form is fine for anything that doesn't read
   * existing array/object state (setting a text field, naming a screen).
   * Anything that toggles membership in an array or object (passOneIds,
   * passTwoIds, alternativeIds, customClaims, cardEntries, visitedKeys) MUST
   * use the updater form: computing the next array from the `data` prop
   * closure instead of `prev` is a real bug, not a style preference. React
   * 18's automatic batching can run several clicks fired in the same task
   * against the SAME stale `data` closure before any of them re-renders, so
   * each toggle computes its new array from the same starting point and only
   * the last call's result survives, silently dropping every toggle before
   * it. Confirmed by reproduction during Phase 2 QA: three card picks in one
   * batch left only one selected. The custom-claim handlers are held to the
   * same rule, and for the same reason: clearing the text has to drop the id
   * out of two arrays in one updater, not in two patches.
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

  /** Navigate to a key, recording the arrival. Dedupes visitedKeys. */
  function goToKey(key: string) {
    patch((prev) => ({
      screenKey: key,
      visitedKeys: prev.visitedKeys.includes(key) ? prev.visitedKeys : [...prev.visitedKeys, key],
    }));
  }

  function goToIndex(index: number) {
    const target = screens[index];
    if (!target) return;
    goToKey(target.key);
  }

  function goNext() {
    goToIndex(activeIndex + 1);
  }

  function goBack() {
    goToIndex(activeIndex - 1);
  }

  /** The menu never moves forward: only a visited screen is selectable. */
  function selectFromMenu(key: string) {
    if (!data.visitedKeys.includes(key)) return;
    goToKey(key);
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

  const privacyLine = GATE_MODE === "no_gate" ? copy.tool.privacyNoGateAssist : copy.tool.privacy;

  if (phase === "loading") return null;

  if (phase === "intro") {
    return (
      <div className="card p-6 max-w-xl mx-auto">
        <p className="label mb-2">{copy.tool.eyebrow}</p>
        <h1 className="text-2xl font-display font-semibold text-navy mb-3">{copy.tool.name}</h1>
        <p className="text-sm text-body leading-relaxed mb-3">{copy.tool.intro}</p>
        <p className="text-sm text-body leading-relaxed mb-3">{privacyLine}</p>
        <button type="button" className="btn-gold mt-2" onClick={startFresh}>
          {copy.tool.start}
        </button>
      </div>
    );
  }

  if (phase === "resume-prompt") {
    return (
      <div className="card p-6 max-w-xl mx-auto text-center">
        <p className="label mb-2">{copy.tool.resumeEyebrow}</p>
        <h2 className="text-lg font-display font-semibold text-navy mb-3">{copy.tool.resume}</h2>
        <p className="text-sm text-body mb-5">{privacyLine}</p>
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

  function renderScreen(screen: WizardScreen | undefined) {
    if (!screen) return null;
    switch (screen.kind) {
      case "alternatives":
        return <AlternativesStep data={data} onPatch={patch} onContinue={goNext} />;
      case "passone":
        return screen.category ? (
          // Keyed so the custom entry's own state (a pending suggestion, an
          // empty-claim warning) belongs to one category and does not follow
          // the lawyer into the next group.
          <PassOneStep
            key={screen.key}
            category={screen.category}
            data={data}
            onPatch={patch}
            onContinue={goNext}
            onBack={goBack}
          />
        ) : null;
      case "keep":
        return <KeepStep data={data} onPatch={patch} onContinue={goNext} onBack={goBack} />;
      case "test":
        return screen.cardId ? (
          <TestStep
            key={screen.key}
            cardId={screen.cardId}
            data={data}
            onPatch={patch}
            onContinue={goNext}
            onBack={goBack}
          />
        ) : null;
      case "statement":
        return <StatementStep data={data} onPatch={patch} onContinue={goNext} onBack={goBack} />;
      case "results":
        return <ResultsStep data={data} onBack={goBack} />;
      default:
        return null;
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="lg:flex lg:gap-8">
        <SideMenu
          screens={screens}
          activeKey={activeKey}
          visitedKeys={data.visitedKeys}
          counter={questionNumber(screens, activeKey)}
          onSelect={selectFromMenu}
        />
        <div className="flex-1 min-w-0">{renderScreen(active)}</div>
      </div>
    </div>
  );
}
