"use client";

/**
 * ScreenQuiz — the interactive five-question flow
 *
 * Owns: client-side answer state, current step, progress bar, navigation,
 * the post-Q5 email gate, and the rendering of the result report.
 *
 * State machine:
 *   step 0..4   → questions Q1..Q5
 *   step 5      → email gate
 *   step 6      → report
 *
 * The case fixture pre-fills defaultAnswers. The lawyer can adjust any
 * answer; the score recomputes live. The custom track starts with empty
 * state and the lawyer answers every question from scratch.
 */

import { useMemo, useState } from "react";
import { SCREEN_DEMO_QUESTIONS } from "../_data/questions";
import type { SampleCase } from "../_data/cases";
import { computeScore, type Answers } from "../_lib/scoring";
import ReportView from "./ReportView";

interface ScreenQuizProps {
  caseFixture: SampleCase;
}

export default function ScreenQuiz({ caseFixture }: ScreenQuizProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>(caseFixture.defaultAnswers);
  const [firmName, setFirmName] = useState("");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [emailDelivered, setEmailDelivered] = useState<boolean | null>(null);

  const TOTAL_QUESTIONS = SCREEN_DEMO_QUESTIONS.length;
  const EMAIL_STEP = TOTAL_QUESTIONS;     // 5
  const REPORT_STEP = TOTAL_QUESTIONS + 1; // 6

  const progress = useMemo(() => {
    if (step >= REPORT_STEP) return 100;
    if (step >= EMAIL_STEP)   return 100;
    return Math.round(((step + 1) / TOTAL_QUESTIONS) * 90); // 0-90% across the questions, 100% at the gate
  }, [step, EMAIL_STEP, REPORT_STEP, TOTAL_QUESTIONS]);

  const score = useMemo(() => computeScore(answers), [answers]);

  function selectAnswer(questionId: string, optionId: string, multi: boolean) {
    setAnswers((prev) => {
      if (multi) {
        const current = Array.isArray(prev[questionId]) ? (prev[questionId] as string[]) : [];
        const next = current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId];
        return { ...prev, [questionId]: next };
      }
      return { ...prev, [questionId]: optionId };
    });
  }

  function isAnswered(questionId: string, multi: boolean): boolean {
    const v = answers[questionId];
    if (!v) return false;
    if (multi) return Array.isArray(v) && v.length > 0;
    return typeof v === "string" && v.length > 0;
  }

  function next() {
    if (step < TOTAL_QUESTIONS) {
      const q = SCREEN_DEMO_QUESTIONS[step];
      if (!isAnswered(q.id, !!q.multi)) return;
    }
    setStep((s) => s + 1);
  }

  function back() {
    if (step > 0) setStep((s) => s - 1);
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!firmName.trim()) { setEmailError("Please enter your firm's name."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setEmailError("Please enter a valid email address."); return; }
    setEmailError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/screen-demo/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: caseFixture.id,
          answers,
          firmName: firmName.trim(),
          email: email.trim(),
        }),
      });
      const data = (await res.json()) as { ok: boolean; emailed?: boolean; error?: string };
      if (!data.ok) {
        // Surface the API error but still let the visitor see the inline report.
        setEmailError(data.error ?? "We could not email the PDF, but your report is ready below.");
        setEmailDelivered(false);
      } else {
        setEmailDelivered(!!data.emailed);
      }
    } catch {
      // Network failure should not block the visitor from seeing their report.
      setEmailError("We could not reach the mail server, but your report is ready below.");
      setEmailDelivered(false);
    } finally {
      setSubmitting(false);
      setStep(REPORT_STEP);
    }
  }

  // ── Report step ──────────────────────────────────────────────────
  if (step >= REPORT_STEP) {
    return (
      <ReportView
        caseFixture={caseFixture}
        score={score}
        firmName={firmName}
        email={email}
        answers={answers}
        emailDelivered={emailDelivered}
      />
    );
  }

  // ── Email gate step ──────────────────────────────────────────────
  if (step === EMAIL_STEP) {
    return (
      <div className="quiz-card">
        <ProgressBar percent={progress} />
        <h2 className="quiz-gate-title">Your Screen report is ready<span className="ts" /></h2>
        <p className="quiz-gate-sub">
          Five questions, scored. Add your firm name and email and we&apos;ll
          show you the report. You&apos;ll get a copy in your inbox you can
          share with a partner or save for later.
        </p>

        <form onSubmit={submitEmail} className="quiz-form" noValidate>
          <label className="quiz-label">
            Firm name
            <input
              type="text"
              autoComplete="organization"
              value={firmName}
              onChange={(e) => setFirmName(e.target.value)}
              placeholder="e.g. Sakuraba Law"
            />
          </label>
          <label className="quiz-label">
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourfirm.com"
            />
          </label>

          {emailError && <p className="quiz-error">{emailError}</p>}

          <button type="submit" className="quiz-primary" disabled={submitting}>
            {submitting ? "Generating your report…" : "Show my Screen report →"}
          </button>
          <button type="button" className="quiz-back" onClick={back} disabled={submitting}>← Back</button>

          <p className="quiz-fine">
            We&apos;ll never share your email. The report is marked clearly as a
            demonstration; it does not represent a real screening recommendation.
          </p>
        </form>

        <Styles />
      </div>
    );
  }

  // ── Question step ────────────────────────────────────────────────
  const question = SCREEN_DEMO_QUESTIONS[step];
  const multi = !!question.multi;
  const selected = answers[question.id];
  const canAdvance = isAnswered(question.id, multi);

  return (
    <div className="quiz-card">
      <ProgressBar percent={progress} />

      <div className="quiz-step-meta">
        Question {question.num} of {question.total}
        {multi && question.maxSelections && (
          <span className="quiz-step-multi">  ·  Select up to {question.maxSelections}</span>
        )}
      </div>

      <h2 className="quiz-prompt">{question.prompt}</h2>
      {question.context && <p className="quiz-context">{question.context}</p>}

      <div className="quiz-options">
        {question.options.map((opt) => {
          const isSelected = multi
            ? Array.isArray(selected) && selected.includes(opt.id)
            : selected === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              className={`quiz-option${isSelected ? " is-selected" : ""}`}
              onClick={() => selectAnswer(question.id, opt.id, multi)}
              aria-pressed={isSelected}
            >
              <span className="quiz-option-label">{opt.label}</span>
              {opt.sub && <span className="quiz-option-sub">{opt.sub}</span>}
            </button>
          );
        })}
      </div>

      <div className="quiz-controls">
        {step > 0 && (
          <button type="button" className="quiz-back" onClick={back}>← Back</button>
        )}
        <button
          type="button"
          className="quiz-primary"
          onClick={next}
          disabled={!canAdvance}
        >
          {step === TOTAL_QUESTIONS - 1 ? "See my report →" : "Continue →"}
        </button>
      </div>

      <Styles />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="quiz-progress" aria-hidden="true">
      <div className="quiz-progress-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

function Styles() {
  return (
    <style jsx global>{`
      .quiz-card {
        max-width: 680px;
        margin: 0 auto;
        background: var(--white);
        border: 1px solid var(--border);
        border-radius: var(--r-card);
        padding: 36px 32px 32px;
        box-shadow: var(--shadow-2);
      }

      .quiz-progress {
        height: 4px;
        background: var(--border);
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: var(--sp-6);
      }
      .quiz-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--stone), var(--stone-light));
        transition: width 0.4s var(--ease-out-soft);
      }

      .quiz-step-meta {
        font-family: var(--font-display);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 2.4px;
        text-transform: uppercase;
        color: var(--text-muted);
        text-align: center;
        margin-bottom: var(--sp-3);
      }
      .quiz-step-multi { color: var(--stone-on-light); }

      .quiz-prompt {
        font-family: var(--font-display);
        font-size: 22px;
        font-weight: 800;
        color: var(--navy);
        line-height: 1.3;
        text-align: center;
        margin: 0 0 var(--sp-3);
      }
      .quiz-context {
        font-size: 13.5px;
        color: var(--text-muted);
        line-height: 1.6;
        text-align: center;
        margin: 0 auto var(--sp-6);
        max-width: 520px;
      }

      .quiz-options {
        display: flex;
        flex-direction: column;
        gap: var(--sp-3);
        margin-bottom: var(--sp-6);
      }
      .quiz-option {
        text-align: left;
        background: var(--white);
        border: 1.5px solid var(--border);
        border-radius: var(--r-card);
        padding: 14px 18px;
        cursor: pointer;
        transition: border-color 0.2s, background 0.2s, transform 0.2s;
        font-family: var(--font-body);
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .quiz-option:hover {
        border-color: var(--stone);
        background: #FBF9F3;
      }
      .quiz-option.is-selected {
        border-color: var(--stone-on-light);
        background: #F5EFE3;
      }
      .quiz-option-label {
        font-size: 14.5px;
        font-weight: 600;
        color: var(--navy);
        line-height: 1.4;
      }
      .quiz-option-sub {
        font-size: 12.5px;
        color: var(--text-muted);
        line-height: 1.5;
      }

      .quiz-controls {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--sp-4);
      }
      .quiz-controls .quiz-back { margin-right: auto; }
      .quiz-primary {
        font-family: var(--font-body);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 1.2px;
        text-transform: uppercase;
        color: var(--navy-deep);
        background: var(--stone);
        border: none;
        padding: 14px 28px;
        border-radius: var(--r-tight);
        cursor: pointer;
        transition: background 0.2s, transform 0.2s, opacity 0.2s;
      }
      .quiz-primary:hover:not(:disabled) {
        background: var(--stone-light);
        transform: translateY(-1px);
      }
      .quiz-primary:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .quiz-back {
        font-family: var(--font-body);
        font-size: 13px;
        color: var(--text-muted);
        background: none;
        border: none;
        cursor: pointer;
        padding: 8px 4px;
        transition: color 0.2s;
      }
      .quiz-back:hover { color: var(--navy); }

      .quiz-gate-title {
        font-family: var(--font-display);
        font-size: 26px;
        font-weight: 800;
        color: var(--navy);
        text-align: center;
        line-height: 1.2;
        margin: 0 0 var(--sp-3);
      }
      .quiz-gate-sub {
        font-size: 14.5px;
        color: var(--text-muted);
        line-height: 1.65;
        text-align: center;
        margin: 0 auto var(--sp-6);
        max-width: 520px;
      }

      .quiz-form {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4);
      }
      .quiz-label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-family: var(--font-display);
        font-size: 10.5px;
        font-weight: 700;
        letter-spacing: 1.6px;
        text-transform: uppercase;
        color: var(--text-muted);
      }
      .quiz-form input {
        font-family: var(--font-body);
        font-size: 15px;
        color: var(--navy);
        padding: 12px 14px;
        background: var(--white);
        border: 1.5px solid var(--border);
        border-radius: var(--r-tight);
        transition: border-color 0.2s;
        letter-spacing: normal;
        text-transform: none;
        font-weight: 400;
      }
      .quiz-form input:focus {
        outline: none;
        border-color: var(--stone);
      }
      .quiz-form input::placeholder {
        color: rgba(96, 107, 131, 0.55);
      }
      .quiz-error {
        font-size: 13px;
        color: #A33B2A;
        margin: 0;
      }
      .quiz-fine {
        font-size: 11.5px;
        color: var(--text-muted);
        line-height: 1.55;
        margin: var(--sp-3) 0 0;
        opacity: 0.8;
      }
    `}</style>
  );
}
