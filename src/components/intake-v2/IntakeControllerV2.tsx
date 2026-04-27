"use client";

/**
 * IntakeControllerV2 — the new web-channel renderer for the CaseLoad Screen engine.
 *
 * Flow:
 *   1. Kickoff: free-text "tell us what happened"
 *   2. AI thinking transition
 *   3. R1 questions, composed into screens (cards / chips / sliders)
 *   4. AI thinking transition
 *   5. R2 questions, composed into screens
 *   6. Identity capture (name + email + phone)
 *   7. OTP verification
 *   8. AI thinking transition (only if Band A/B/C — qualifies for R3)
 *   9. R3 questions
 *   10. Done
 *
 * The controller talks only to the existing engine endpoints:
 *   POST /api/screen                  — situation kickoff + R1/R2 batches
 *   POST /api/otp/send                — send code
 *   POST /api/otp/verify              — verify code
 *   POST /api/screen/round3/start     — fetch R3 questions
 *   POST /api/screen/round3           — submit R3 answers
 *
 * State is in-component. Sub-components are presentation-only.
 */

import { useEffect, useState } from "react";
import { Shell } from "./Shell";
import { TextCard } from "./TextCard";
import { DecisionCard } from "./DecisionCard";
import { RapidFire } from "./RapidFire";
import { SliderCard } from "./SliderCard";
import { IdentityCard } from "./IdentityCard";
import { OtpCard } from "./OtpCard";
import { RoundTransition } from "./RoundTransition";
import { composeScreens, type ApiQuestion } from "./screen-composer";
import type { Screen, AnswerMap } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// API response shapes
// ─────────────────────────────────────────────────────────────────────────────

interface ScreenResponse {
  session_id: string;
  practice_area: string | null;
  practice_area_confidence: string;
  next_question: ApiQuestion | null;
  next_questions: ApiQuestion[] | null;
  cpi: { band?: string | null; band_locked?: boolean } & Record<string, unknown>;
  response_text: string;
  finalize: boolean;
  collect_identity: boolean;
  situation_summary: string | null;
  cta: string | null;
  flags: string[];
  value_tier: string | null;
  prior_experience: string | null;
}

interface Round3Question {
  id: string;
  text: string;
  options?: Array<{ label: string; value: string }>;
  type?: string;
  description?: string;
  allow_free_text?: boolean;
  allow_multi_select?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step machine
// ─────────────────────────────────────────────────────────────────────────────

type Step =
  | "kickoff"          // initial situation text
  | "thinking"         // AI processing transition (between rounds)
  | "questions"        // rendering composed screens for current question batch
  | "identity"         // name + email + phone
  | "otp"              // 6-digit code
  | "thinking_r3"      // AI processing for round 3
  | "round3"           // round 3 questions
  | "done"             // terminal
  | "error";

type RoundLabel = "Your situation" | "About your case" | "A few more details" | "Final details";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

/** Snapshot of engine state for the live scoring panel. */
export interface ScoreSnapshot {
  cpi: Record<string, unknown>;
  band: string | null;
  practiceArea: string | null;
  practiceConfidence: string | null;
  situationSummary: string | null;
  flags: string[];
  valueTier: string | null;
  finalize: boolean;
  collectIdentity: boolean;
}

/** A single Q&A event for the live answer log. */
export interface AnswerLogEntry {
  id: string;
  question: string;
  answer: string | string[];
  ts: number;
}

interface Props {
  firmId: string;
  firmName?: string;
  /** Fired after every /api/screen response with the engine's latest scoring state. */
  onScoreUpdate?: (snapshot: ScoreSnapshot) => void;
  /** Fired when the user answers a question, before the next API call. */
  onAnswerLogged?: (entry: AnswerLogEntry) => void;
  /** Fired whenever the controller's internal step changes. Lets a wrapper
   * (e.g. demo split-screen) react to phase transitions. */
  onStepChange?: (step: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function IntakeControllerV2({ firmId, firmName, onScoreUpdate, onAnswerLogged, onStepChange }: Props) {
  // Core state
  const [step, setStep] = useState<Step>("kickoff");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Kickoff
  const [situation, setSituation] = useState("");

  // Round state
  const [screens, setScreens] = useState<Screen[]>([]);
  const [screenIdx, setScreenIdx] = useState(0);
  const [roundLabel, setRoundLabel] = useState<RoundLabel>("Your situation");
  const [collectIdentityNext, setCollectIdentityNext] = useState(false);
  const [finalizeNext, setFinalizeNext] = useState(false);

  // Identity / OTP
  const [identityEmail, setIdentityEmail] = useState("");
  const [identityPhone, setIdentityPhone] = useState("");
  const [identityName, setIdentityName] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  // Round 3
  const [r3Questions, setR3Questions] = useState<Round3Question[]>([]);
  const [r3Idx, setR3Idx] = useState(0);
  const [band, setBand] = useState<string | null>(null);

  // Transition
  const [transitionPhase, setTransitionPhase] = useState<"loading" | "reveal">("loading");
  const [transitionText, setTransitionText] = useState({ loading: "Reading your situation...", reveal: "Got the basics. A few questions." });

  // Latest snapshot we have — used to merge final state push when flow completes.
  const [latestSnapshot, setLatestSnapshot] = useState<ScoreSnapshot | null>(null);

  // Fire step-change callback whenever step changes
  useEffect(() => {
    if (onStepChange) onStepChange(step);
  }, [step, onStepChange]);

  // Final-state push — when reaching "done", merge in the verified band so the
  // operator panel reflects the engine's final classification even if no R3
  // batch returned cpi data.
  useEffect(() => {
    if (step !== "done" || !onScoreUpdate) return;
    const merged: ScoreSnapshot = {
      cpi: latestSnapshot?.cpi ?? {},
      band: band ?? latestSnapshot?.band ?? null,
      practiceArea: latestSnapshot?.practiceArea ?? null,
      practiceConfidence: latestSnapshot?.practiceConfidence ?? null,
      situationSummary: latestSnapshot?.situationSummary ?? null,
      flags: latestSnapshot?.flags ?? [],
      valueTier: latestSnapshot?.valueTier ?? null,
      finalize: true,
      collectIdentity: false,
    };
    onScoreUpdate(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function setAnswer(id: string, value: string | string[]) {
    setAnswers(a => ({ ...a, [id]: value }));

    // Log for demo panel — find the question text + resolve option values
    // back to human labels so the answer log reads naturally.
    if (onAnswerLogged) {
      let qText = id;
      let optionMap: Record<string, string> = {};
      for (const s of screens) {
        const found = s.items.find(i => i.id === id);
        if (found) {
          qText = found.question;
          if (found.options) optionMap = Object.fromEntries(found.options.map(o => [o.value, o.label]));
          break;
        }
      }
      const r3Match = r3Questions.find(q => q.id === id);
      if (r3Match) {
        qText = r3Match.text;
        if (r3Match.options) optionMap = Object.fromEntries(r3Match.options.map(o => [o.value, o.label]));
      }
      const labelOf = (v: string): string => {
        if (v.startsWith("other:")) return `Other: ${v.slice(6)}`;
        return optionMap[v] ?? v;
      };
      const humanAnswer = Array.isArray(value) ? value.map(labelOf) : labelOf(value);
      onAnswerLogged({ id, question: qText, answer: humanAnswer, ts: Date.now() });
    }
  }

  function goBack() {
    if (step === "questions") {
      if (screenIdx > 0) setScreenIdx(i => i - 1);
      else setStep("kickoff");
    } else if (step === "identity") {
      // No back from identity — answers already submitted to engine
    } else if (step === "round3") {
      if (r3Idx > 0) setR3Idx(i => i - 1);
    }
  }

  // ── 1. Kickoff submit ──────────────────────────────────────────────────────
  async function submitKickoff() {
    if (situation.trim().length < 10) return;
    setErrorMessage(null);
    setRoundLabel("About your case");
    setTransitionText({ loading: "Reading your situation...", reveal: "Got the basics. A few questions." });
    setTransitionPhase("loading");
    setStep("thinking");

    try {
      const res = await fetch("/api/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firm_id: firmId,
          channel: "widget",
          message: situation,
          message_type: "text",
        }),
      });
      const data = (await res.json()) as ScreenResponse;
      if (!data.session_id) throw new Error("No session returned by engine");
      setSessionId(data.session_id);
      applyResponse(data);
    } catch (err) {
      setErrorMessage(String(err instanceof Error ? err.message : err));
      setStep("error");
    }
  }

  // ── 2. Apply engine response: derive next step from response shape ────────
  function applyResponse(data: ScreenResponse) {
    setBand((data.cpi?.band as string | null) ?? null);
    setCollectIdentityNext(data.collect_identity);
    setFinalizeNext(data.finalize);

    // Snapshot used by the demo scoring panel and by the final-state effect.
    const snap: ScoreSnapshot = {
      cpi: (data.cpi ?? {}) as Record<string, unknown>,
      band: (data.cpi?.band as string | null) ?? null,
      practiceArea: data.practice_area,
      practiceConfidence: data.practice_area_confidence,
      situationSummary: data.situation_summary,
      flags: data.flags ?? [],
      valueTier: data.value_tier,
      finalize: data.finalize,
      collectIdentity: data.collect_identity,
    };
    setLatestSnapshot(snap);
    if (onScoreUpdate) onScoreUpdate(snap);

    const batch: ApiQuestion[] | null = data.next_questions ?? (data.next_question ? [data.next_question] : null);

    if (batch && batch.length > 0) {
      // We have questions — compose into screens, render
      const composed = composeScreens(batch);
      setScreens(composed);
      setScreenIdx(0);
      setTransitionPhase("reveal");
      // Brief pause then advance to questions
      setTimeout(() => setStep("questions"), 700);
    } else if (data.collect_identity) {
      setTransitionPhase("reveal");
      setTransitionText({ loading: "", reveal: "Almost there." });
      setTimeout(() => setStep("identity"), 700);
    } else if (data.finalize) {
      setTransitionPhase("reveal");
      setTransitionText({ loading: "", reveal: "All done." });
      setTimeout(() => setStep("done"), 700);
    } else {
      // No questions, no identity, no finalize — unexpected, fallback to identity
      setStep("identity");
    }
  }

  // ── 3. Submit answers from current question batch ──────────────────────────
  async function submitCurrentBatch() {
    if (!sessionId) return;
    setRoundLabel("A few more details");
    setTransitionText({ loading: "Looking at your answers...", reveal: "One more round." });
    setTransitionPhase("loading");
    setStep("thinking");

    // Collect only answers from the current screens' items
    const batchAnswers: AnswerMap = {};
    for (const s of screens) {
      for (const item of s.items) {
        if (answers[item.id] !== undefined) batchAnswers[item.id] = answers[item.id];
      }
    }

    try {
      const res = await fetch("/api/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          firm_id: firmId,
          channel: "widget",
          answers: batchAnswers,
        }),
      });
      const data = (await res.json()) as ScreenResponse;
      applyResponse(data);
    } catch (err) {
      setErrorMessage(String(err instanceof Error ? err.message : err));
      setStep("error");
    }
  }

  // ── 4. Identity submit ─────────────────────────────────────────────────────
  async function submitIdentity(name: string, email: string, phone: string) {
    if (!sessionId) return;
    setIdentityName(name);
    setIdentityEmail(email);
    setIdentityPhone(phone);
    setOtpLoading(true);
    setOtpError(null);

    try {
      // Submit identity to engine first
      await fetch("/api/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          firm_id: firmId,
          channel: "widget",
          contact: { name, email, phone },
        }),
      });

      // Send OTP
      await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, email, firm_name: firmName }),
      });

      setStep("otp");
    } catch (err) {
      setOtpError(String(err instanceof Error ? err.message : err));
    } finally {
      setOtpLoading(false);
    }
  }

  // ── 5. OTP verify ──────────────────────────────────────────────────────────
  async function verifyOtp(code: string) {
    if (!sessionId) return;
    setOtpLoading(true);
    setOtpError(null);

    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, code, demo: true }),
      });
      const data = (await res.json()) as { verified: boolean; band?: string; reason?: string };
      if (!data.verified) {
        setOtpError(data.reason ?? "That code didn't match. Try again.");
        setOtpLoading(false);
        return;
      }

      // Verified — check if band qualifies for R3
      const verifiedBand = data.band ?? band;
      setBand(verifiedBand);

      if (verifiedBand === "A" || verifiedBand === "B" || verifiedBand === "C") {
        setRoundLabel("Final details");
        setTransitionText({ loading: "Building your case file...", reveal: "Three quick details and you're done." });
        setTransitionPhase("loading");
        setStep("thinking_r3");

        // Fetch R3 questions
        const r3Res = await fetch("/api/screen/round3/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        });
        const r3Data = (await r3Res.json()) as { ok: boolean; questions?: Round3Question[] };
        const qs = r3Data.questions ?? [];

        setOtpLoading(false);

        if (qs.length === 0) {
          setStep("done");
          return;
        }

        setR3Questions(qs);
        setR3Idx(0);
        setTransitionPhase("reveal");
        setTimeout(() => setStep("round3"), 700);
      } else {
        setOtpLoading(false);
        setStep("done");
      }
    } catch (err) {
      setOtpError(String(err instanceof Error ? err.message : err));
      setOtpLoading(false);
    }
  }

  async function resendOtp() {
    if (!sessionId || !identityEmail) return;
    await fetch("/api/otp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, email: identityEmail, firm_name: firmName }),
    });
  }

  // ── 6. R3 advance + submit ─────────────────────────────────────────────────
  function setR3Answer(id: string, value: string | string[]) {
    setAnswers(a => ({ ...a, [id]: value }));
    if (onAnswerLogged) {
      const q = r3Questions.find(qq => qq.id === id);
      const optionMap: Record<string, string> = q?.options
        ? Object.fromEntries(q.options.map(o => [o.value, o.label]))
        : {};
      const labelOf = (v: string): string => {
        if (v.startsWith("other:")) return `Other: ${v.slice(6)}`;
        return optionMap[v] ?? v;
      };
      const humanAnswer = Array.isArray(value) ? value.map(labelOf) : labelOf(value);
      onAnswerLogged({ id, question: q?.text ?? id, answer: humanAnswer, ts: Date.now() });
    }
  }

  function advanceR3(autoSubmit: boolean) {
    if (r3Idx + 1 < r3Questions.length) {
      setR3Idx(i => i + 1);
    } else if (autoSubmit) {
      void submitR3();
    }
  }

  async function submitR3() {
    if (!sessionId) return;
    try {
      // Collect only R3 answers
      const r3Answers: AnswerMap = {};
      for (const q of r3Questions) {
        if (answers[q.id] !== undefined) r3Answers[q.id] = answers[q.id];
      }
      await fetch("/api/screen/round3", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, answers: r3Answers }),
      });
      setStep("done");
    } catch (err) {
      setErrorMessage(String(err instanceof Error ? err.message : err));
      setStep("error");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render — by step
  // ─────────────────────────────────────────────────────────────────────────

  if (step === "kickoff") {
    return (
      <Shell totalScreens={1} currentScreen={0} roundLabel="Your situation">
        <TextCard
          item={{
            id: "situation",
            question: "Tell us what happened.",
            description: "A few sentences is enough. Your lawyer will see exactly what you write.",
            presentation: "text",
            placeholder: "I was rear-ended on the QEW last Tuesday...",
          }}
          value={situation}
          onChange={setSituation}
          onSubmit={submitKickoff}
          submitLabel="Continue"
          minChars={10}
        />
      </Shell>
    );
  }

  if (step === "thinking" || step === "thinking_r3") {
    return (
      <RoundTransition
        phase={transitionPhase}
        loadingText={transitionText.loading}
        revealText={transitionText.reveal}
      />
    );
  }

  if (step === "questions") {
    if (screens.length === 0) {
      // Defensive: no screens to render — advance to identity if collected, else done
      if (collectIdentityNext) { setStep("identity"); return null; }
      if (finalizeNext) { setStep("done"); return null; }
      setStep("error");
      return null;
    }

    const screen = screens[screenIdx];
    const isLast  = screenIdx === screens.length - 1;
    const total   = screens.length;
    const onBack  = screenIdx > 0 ? goBack : undefined;

    if (screen.kind === "rapid_fire") {
      const allAnswered = screen.items.every(i => answers[i.id] !== undefined && answers[i.id] !== "");
      return (
        <Shell
          totalScreens={total}
          currentScreen={screenIdx}
          roundLabel={roundLabel}
          onBack={onBack}
          footer={
            <button
              type="button"
              onClick={() => isLast ? submitCurrentBatch() : setScreenIdx(i => i + 1)}
              disabled={!allAnswered}
              className={`w-full min-h-[52px] rounded-full text-[15px] font-semibold transition-all ${
                allAnswered ? "bg-[#1E2F58] text-white hover:shadow-[0_4px_14px_rgba(30,47,88,0.25)]" : "bg-[#1E2F58]/15 text-[#1E2F58]/40 cursor-not-allowed"
              }`}
              style={{ fontFamily: "DM Sans, sans-serif" }}
            >
              Continue
            </button>
          }
        >
          <RapidFire items={screen.items} values={answers} onChange={setAnswer} />
        </Shell>
      );
    }

    // Solo screen — single item
    const item = screen.items[0];
    const handleChange = (v: string | string[]) => {
      setAnswer(item.id, v);
      if (item.presentation === "card" && !item.multiSelect) {
        // Auto-advance for single-select cards
        setTimeout(() => {
          if (isLast) submitCurrentBatch();
          else setScreenIdx(i => i + 1);
        }, 220);
      }
      if (item.presentation === "slider") {
        setTimeout(() => {
          if (isLast) submitCurrentBatch();
          else setScreenIdx(i => i + 1);
        }, 220);
      }
    };

    return (
      <Shell totalScreens={total} currentScreen={screenIdx} roundLabel={roundLabel} onBack={onBack}>
        {item.presentation === "card"   && <DecisionCard item={item} value={answers[item.id]} onChange={handleChange} />}
        {item.presentation === "slider" && <SliderCard   item={item} value={typeof answers[item.id] === "string" ? answers[item.id] as string : undefined} onChange={v => handleChange(v)} />}
        {item.presentation === "text"   && (
          <TextCard
            item={item}
            value={typeof answers[item.id] === "string" ? answers[item.id] as string : ""}
            onChange={v => setAnswer(item.id, v)}
            onSubmit={() => isLast ? submitCurrentBatch() : setScreenIdx(i => i + 1)}
            submitLabel="Continue"
            minChars={1}
          />
        )}
      </Shell>
    );
  }

  if (step === "identity") {
    return (
      <Shell totalScreens={1} currentScreen={0} roundLabel="Confirm your details">
        <IdentityCard
          initialName={identityName}
          initialEmail={identityEmail}
          initialPhone={identityPhone}
          onSubmit={submitIdentity}
          loading={otpLoading}
        />
      </Shell>
    );
  }

  if (step === "otp") {
    return (
      <Shell totalScreens={1} currentScreen={0} roundLabel="Confirm your details">
        <OtpCard
          destination={identityEmail}
          onVerify={verifyOtp}
          onResend={resendOtp}
          loading={otpLoading}
          errorMessage={otpError ?? undefined}
        />
      </Shell>
    );
  }

  if (step === "round3") {
    if (r3Questions.length === 0) {
      setStep("done");
      return null;
    }
    const q = r3Questions[r3Idx];
    const total = r3Questions.length;
    const onBack = r3Idx > 0 ? goBack : undefined;

    const isLast = r3Idx === total - 1;
    const allowMulti = !!q.allow_multi_select;
    const isFreeText = q.type === "free_text" || !q.options || q.options.length === 0;

    // Free-text R3 question → render as TextCard with explicit submit.
    // Bank rework note: round3.ts still has free_text questions for several
    // practice areas; long-term these become structured. For now we render
    // them as a textarea so the user can complete the flow.
    if (isFreeText) {
      const textItem = {
        id: q.id,
        question: q.text,
        description: q.description,
        presentation: "text" as const,
        placeholder: "Tell us in your own words...",
      };
      const value = typeof answers[q.id] === "string" ? (answers[q.id] as string) : "";
      return (
        <Shell totalScreens={total} currentScreen={r3Idx} roundLabel="Final details" onBack={onBack}>
          <TextCard
            item={textItem}
            value={value}
            onChange={v => setR3Answer(q.id, v)}
            onSubmit={() => advanceR3(true)}
            submitLabel={isLast ? "Finish" : "Continue"}
            minChars={1}
          />
        </Shell>
      );
    }

    // R3 question into ScreenItem shape (structured options path)
    const item = {
      id: q.id,
      question: q.text,
      description: q.description,
      presentation: "card" as const,
      options: q.options ?? [],
      multiSelect: !!q.allow_multi_select,
      allowFreeText: !!q.allow_free_text,
    };

    if (allowMulti) {
      const selected = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : [];
      return (
        <Shell
          totalScreens={total}
          currentScreen={r3Idx}
          roundLabel="Final details"
          onBack={onBack}
          footer={
            <button
              type="button"
              onClick={() => advanceR3(true)}
              disabled={selected.length === 0}
              className={`w-full min-h-[52px] rounded-full text-[15px] font-semibold transition-all ${
                selected.length > 0 ? "bg-[#1E2F58] text-white hover:shadow-[0_4px_14px_rgba(30,47,88,0.25)]" : "bg-[#1E2F58]/15 text-[#1E2F58]/40 cursor-not-allowed"
              }`}
              style={{ fontFamily: "DM Sans, sans-serif" }}
            >
              {isLast ? "Finish" : "Continue"}
            </button>
          }
        >
          <DecisionCard item={item} value={answers[q.id]} onChange={v => setR3Answer(q.id, v)} />
        </Shell>
      );
    }

    return (
      <Shell totalScreens={total} currentScreen={r3Idx} roundLabel="Final details" onBack={onBack}>
        <DecisionCard
          item={item}
          value={answers[q.id]}
          onChange={v => {
            setR3Answer(q.id, v);
            setTimeout(() => advanceR3(true), 220);
          }}
        />
      </Shell>
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
          <h2 className="text-[28px] font-extrabold text-[#1E2F58]" style={{ fontFamily: "Manrope, sans-serif" }}>
            Your case file is ready.
          </h2>
          <p className="text-[15px] text-[#1E2F58]/70 leading-relaxed" style={{ fontFamily: "DM Sans, sans-serif" }}>
            {firmName ? `${firmName} will reach out within hours.` : "Your lawyer will reach out within hours."}
            {band === "A" || band === "B" ? " You'll get a retainer agreement to review by email shortly." : ""}
          </p>
        </div>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="min-h-screen bg-[#F4F3EF] flex flex-col items-center justify-center px-5">
        <div className="max-w-[480px] text-center flex flex-col gap-5">
          <h2 className="text-[24px] font-bold text-[#1E2F58]" style={{ fontFamily: "Manrope, sans-serif" }}>
            Something went wrong.
          </h2>
          <p className="text-[14px] text-[#1E2F58]/70" style={{ fontFamily: "DM Sans, sans-serif" }}>
            {errorMessage ?? "Please try again. If this keeps happening, contact the firm directly."}
          </p>
          <button
            type="button"
            onClick={() => { setStep("kickoff"); setErrorMessage(null); }}
            className="self-center px-6 py-3 rounded-full bg-[#1E2F58] text-white text-[14px] font-semibold"
            style={{ fontFamily: "DM Sans, sans-serif" }}
          >
            Start over
          </button>
        </div>
      </div>
    );
  }

  return null;
}
