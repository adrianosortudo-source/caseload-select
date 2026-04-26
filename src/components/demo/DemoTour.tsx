"use client";

/**
 * DemoTour
 *
 * Renders the guided demo experience: full-page overlay + floating text balloon.
 *
 * Architecture:
 *   - Overlay: fixed, z-30. Dims everything except the widget (z-35) and header (z-40).
 *   - Exit button: fixed top-right, z-[60]. Always reachable.
 *   - Balloon: fixed bottom-left (desktop) / bottom (mobile), z-[60].
 *     Shows step-specific instructions as the widget progresses.
 *     Balloon tail points toward the widget on desktop.
 *
 * Animation: CSS keyframe entry, opacity/transform transitions via inline styles.
 * No external animation libraries needed.
 *
 * Props:
 *   active       -  whether the demo is currently running
 *   currentStep  -  the widget's current step, passed via onDemoStepChange callback
 *   scenarioId   -  which scenario is active (for labeling)
 *   onExit       -  called when user clicks Exit or presses Escape
 */

import { useEffect, useRef, useState } from "react";
import type { ScenarioId } from "./demo-scenarios";

// ── Step balloon content ──────────────────────────────────────────────────────

interface BalloonContent {
  title: string;
  body: string;
}

const BALLOON: Record<string, BalloonContent> = {
  intent: {
    title: "Step 1  -  Describe the situation",
    body: "The client types in plain language. No forms, no drop-downs, no practice area selection.",
  },
  intro: {
    title: "Practice area detected",
    body: "The AI reads the message and opens the right qualification flow automatically.",
  },
  submitting: {
    title: "Scoring in progress…",
    body: "Facts extracted, CPI calculated, case routed  -  in under 3 seconds.",
  },
  questions: {
    title: "Rounds 1 & 2  -  Qualification",
    body: "Adaptive questions build the Case Priority Index in real time. Every answer adjusts the score.",
  },
  identity: {
    title: "Identity captured",
    body: "Name and contact are collected after qualification  -  not as a gate at the start.",
  },
  otp: {
    title: "Verification",
    body: "A one-time code confirms a real person. Filters bots and protects the lawyer's time.",
  },
  round3: {
    title: "Round 3  -  Case details",
    body: "Evidence inventory, adverse parties, deadlines. Rounds 1 and 2 decide whether to meet. Round 3 decides how the lawyer walks in.",
  },
  result: {
    title: "Intake complete",
    body: "Tap \"See what your lawyer receives\" to see the case memo and automation log that arrives before the call.",
  },
  error: {
    title: "Error handled",
    body: "Failed submissions are caught and the client is guided to call or use another channel.",
  },
};

const DEFAULT_BALLOON: BalloonContent = {
  title: "Demo running",
  body: "Follow along as the intake engine qualifies this case.",
};

const SCENARIO_LABEL: Record<string, string> = {
  pi_strong:    "Band A  -  Motor vehicle accident",
  slip_fall:    "Band B  -  Slip and fall",
  emp_dismissal: "Band C  -  Wrongful dismissal",
  emp_wage:     "Band B  -  Unpaid overtime",
  imm_spousal:  "Band B  -  Spousal sponsorship",
  small_claims: "Band E  -  Outside scope",
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  active: boolean;
  currentStep: string;
  scenarioId: ScenarioId | null;
  onExit: () => void;
}

export default function DemoTour({ active, currentStep, scenarioId, onExit }: Props) {
  const [visible, setVisible] = useState(false);
  const [balloon, setBalloon] = useState<BalloonContent>(DEFAULT_BALLOON);
  const [balloonKey, setBalloonKey] = useState(0); // forces re-enter animation on step change
  const prevStepRef = useRef<string>("");

  // Fade overlay in shortly after mounting (gives widget time to remount)
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), 60);
    return () => clearTimeout(t);
  }, [active]);

  // Update balloon when step changes
  useEffect(() => {
    if (!active) return;
    if (currentStep === prevStepRef.current) return;
    prevStepRef.current = currentStep;
    setBalloon(BALLOON[currentStep] ?? DEFAULT_BALLOON);
    setBalloonKey(k => k + 1);
  }, [active, currentStep]);

  // Close on Escape
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, onExit]);

  if (!active) return null;

  const scenarioLabel = scenarioId ? SCENARIO_LABEL[scenarioId] : null;

  return (
    <>
      {/* ── Overlay ──────────────────────────────────────────────────── */}
      <div
        className="fixed inset-0 z-30 transition-opacity duration-300"
        style={{
          background: "rgba(13, 21, 32, 0.62)",
          backdropFilter: "blur(1.5px)",
          WebkitBackdropFilter: "blur(1.5px)",
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? "auto" : "none",
        }}
        onClick={onExit}
      />

      {/* ── Exit button ───────────────────────────────────────────────── */}
      <div
        className="fixed top-[68px] right-4 z-[60] transition-all duration-300"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(-6px)",
        }}
      >
        <button
          onClick={onExit}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-white shadow-lg border border-black/8 text-gray-600 hover:text-gray-900 hover:shadow-xl transition-all"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          Exit demo
        </button>
      </div>

      {/* ── Balloon ───────────────────────────────────────────────────── */}
      {/*
        Desktop: fixed bottom-left, tail points right toward the widget.
        Mobile: fixed bottom, above the sticky call bar (bottom-20).
      */}
      <div
        className="fixed z-[60] bottom-20 left-3 right-3 sm:bottom-auto sm:top-[200px] sm:right-[540px] sm:left-auto sm:w-[300px] transition-opacity duration-200"
        style={{ opacity: visible ? 1 : 0 }}
      >
        <div
          key={balloonKey}
          className="bg-white rounded-2xl shadow-2xl border border-black/[0.07] px-4 py-4 relative"
          style={{ animation: "balloon-enter 250ms cubic-bezier(0.22, 1, 0.36, 1) both" }}
        >
          {/* Tail  -  right side, desktop only, points toward widget */}
          <div
            className="absolute right-[-7px] top-5 w-0 h-0 hidden sm:block"
            style={{
              borderTop: "7px solid transparent",
              borderBottom: "7px solid transparent",
              borderLeft: "7px solid white",
            }}
          />
          {/* Shadow for tail */}
          <div
            className="absolute right-[-9px] top-[18px] w-0 h-0 hidden sm:block"
            style={{
              borderTop: "8px solid transparent",
              borderBottom: "8px solid transparent",
              borderLeft: "8px solid rgba(0,0,0,0.06)",
            }}
          />

          {/* Demo label */}
          <div className="flex items-center gap-2 mb-2.5">
            <div
              className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
              style={{ background: "#1E2F58" }}
            >
              <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#1E2F58]">
              CaseLoad Select Demo
            </span>
            {scenarioLabel && (
              <>
                <span className="text-[9px] text-black/20">·</span>
                <span className="text-[9px] text-black/40 font-medium">{scenarioLabel}</span>
              </>
            )}
          </div>

          {/* Content */}
          <p className="text-[13px] font-semibold text-gray-900 leading-snug mb-1.5">
            {balloon.title}
          </p>
          <p className="text-[12px] text-gray-500 leading-relaxed">
            {balloon.body}
          </p>
        </div>
      </div>

      <style>{`
        @keyframes balloon-enter {
          from { opacity: 0; transform: translateY(10px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    }
        }
      `}</style>
    </>
  );
}
