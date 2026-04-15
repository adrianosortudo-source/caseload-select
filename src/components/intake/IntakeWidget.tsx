"use client";

/**
 * IntakeWidget — 5-step client intake component for CaseLoad Screen.
 *
 * Flow:
 *   intro → submitting → questions → submitting → identity → otp → result
 *
 * OTP step is shown when an email address is provided. Skipped for phone-only.
 *
 * The widget is firm-agnostic. Firm config is loaded server-side; the widget
 * receives only firmId and cosmetic props.
 *
 * Channels: always uses "widget" mode (GPT returns all questions at once).
 */

import { useState, useCallback } from "react";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface Question {
  id: string;
  text: string;
  options: Array<{ label: string; value: string }>;
  allow_free_text: boolean;
}

interface ScreenResponse {
  session_id: string;
  practice_area: string | null;
  practice_area_confidence: string;
  next_question: Question | null;
  next_questions: Question[] | null;
  cpi: {
    total: number;
    band: "A" | "B" | "C" | "D" | "E" | null;
    band_locked: boolean;
    fit_score: number;
    value_score: number;
  };
  response_text: string;
  finalize: boolean;
  collect_identity: boolean;
  situation_summary: string | null;
  cta: string | null;
  flags: string[];
  value_tier: string | null;
  prior_experience: string | null;
}

type Step = "intro" | "questions" | "identity" | "otp" | "submitting" | "result" | "error";

// ─────────────────────────────────────────────
// Styling constants
// ─────────────────────────────────────────────

const BAND_CTA_STYLE: Record<string, { border: string; icon: string }> = {
  A: { border: "border-emerald-300 bg-emerald-50", icon: "text-emerald-600" },
  B: { border: "border-blue-300 bg-blue-50", icon: "text-blue-600" },
  C: { border: "border-blue-200 bg-blue-50", icon: "text-blue-500" },
  D: { border: "border-gray-200 bg-gray-50", icon: "text-gray-500" },
  E: { border: "border-gray-200 bg-gray-50", icon: "text-gray-400" },
};

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function ProgressBar({ step }: { step: Step }) {
  const steps = [
    { label: "Situation" },
    { label: "Your Case" },
    { label: "Your Details" },
    { label: "Verify" },
  ];

  const stepIndex = step === "intro" ? 0
    : step === "questions" ? 1
    : step === "submitting" ? 1
    : step === "identity" ? 2
    : step === "otp" ? 3
    : 4;

  if (step === "result" || step === "error") return null;

  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center flex-1">
          <div className="flex flex-col items-center flex-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
              i < stepIndex
                ? "bg-emerald-500 text-white"
                : i === stepIndex
                ? "bg-current text-white ring-4 ring-offset-0"
                : "bg-gray-100 text-gray-400"
            }`}
              style={i === stepIndex ? { backgroundColor: "var(--accent)" } : {}}
            >
              {i < stepIndex ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span className={`text-[10px] mt-1 font-medium ${
              i <= stepIndex ? "text-gray-600" : "text-gray-400"
            }`}>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 flex-1 mx-1 mt-[-14px] transition-all ${
              i < stepIndex ? "bg-emerald-400" : "bg-gray-200"
            }`} />
          )}
        </div>
      ))}
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      <div className="w-10 h-10 border-2 border-gray-200 border-t-current rounded-full animate-spin"
        style={{ borderTopColor: "var(--accent)" }} />
      <p className="text-sm text-gray-500 animate-pulse">Analyzing your case…</p>
    </div>
  );
}

function Disclaimer() {
  return (
    <p className="text-[10px] text-gray-400 mt-4 leading-relaxed text-center">
      This is general information, not legal advice. You are interacting with an automated screening system.
    </p>
  );
}

// ─────────────────────────────────────────────
// Main widget
// ─────────────────────────────────────────────

interface IntakeWidgetProps {
  firmId: string;
  firmName: string;
  accentColor?: string;
}

export function IntakeWidget({ firmId, firmName, accentColor = "#1a3a5c" }: IntakeWidgetProps) {
  const [step, setStep] = useState<Step>("intro");
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Step 1 state
  const [situation, setSituation] = useState("");

  // Step 2 state
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answerLabels, setAnswerLabels] = useState<Record<string, string>>({});
  const [responseText, setResponseText] = useState<string>("");

  // Step 3 state
  const [contact, setContact] = useState({ name: "", email: "", phone: "" });

  // OTP state
  const [otpCode, setOtpCode] = useState("");
  const [otpAttempts, setOtpAttempts] = useState(0);
  const [otpSending, setOtpSending] = useState(false);

  // Result state
  const [result, setResult] = useState<ScreenResponse | null>(null);
  const [pendingResult, setPendingResult] = useState<ScreenResponse | null>(null); // finalized before identity collected
  const [identityCollected, setIdentityCollected] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // ── API call helper ───────────────────────────────────────────────
  const callScreen = useCallback(async (payload: {
    message: string;
    message_type?: string;
    structured_data?: Record<string, unknown>;
  }): Promise<ScreenResponse> => {
    const res = await fetch("/api/screen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        firm_id: firmId,
        channel: "widget",
        ...payload,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `Error ${res.status}`);
    }
    return res.json();
  }, [sessionId, firmId]);

  function applyResponse(data: ScreenResponse, fallbackStep: Step) {
    if (!sessionId && data.session_id) setSessionId(data.session_id);
    setResponseText(stripDisclaimer(data.response_text ?? ""));

    if (data.finalize && !identityCollected) {
      // Band locked — but we still need contact info before showing result
      setPendingResult(data);
      setStep("identity");
    } else if (data.finalize) {
      setResult(data);
      setStep("result");
    } else if (data.collect_identity) {
      setStep("identity");
    } else if (data.next_questions?.length) {
      setQuestions(data.next_questions);
      setAnswers({});
      setAnswerLabels({});
      setStep("questions");
    } else if (data.next_question) {
      setQuestions([data.next_question]);
      setAnswers({});
      setAnswerLabels({});
      setStep("questions");
    } else {
      setStep(fallbackStep);
    }
  }

  // ── Step 1: Submit initial situation ─────────────────────────────
  async function handleSituationSubmit() {
    if (!situation.trim()) return;
    setApiError(null);
    setStep("submitting");
    try {
      const data = await callScreen({ message: situation.trim(), message_type: "text" });
      applyResponse(data, "identity");
    } catch (err) {
      setApiError(String(err instanceof Error ? err.message : err));
      setStep("intro");
    }
  }

  // ── Step 2: Submit branching question answers ─────────────────────
  async function handleQuestionsSubmit() {
    setApiError(null);
    setStep("submitting");

    const summary = questions
      .filter(q => answers[q.id])
      .map(q => `${q.text}: ${answerLabels[q.id] ?? answers[q.id]}`)
      .join(". ");

    try {
      const data = await callScreen({
        message: summary || "Answers provided",
        message_type: "answer",
        structured_data: answers,
      });
      applyResponse(data, "identity");
    } catch (err) {
      setApiError(String(err instanceof Error ? err.message : err));
      setStep("questions");
    }
  }

  // ── Step 3: Submit contact identity ──────────────────────────────
  async function handleIdentitySubmit() {
    setApiError(null);
    setStep("submitting");
    setIdentityCollected(true);
    const nameParts = contact.name.trim().split(/\s+/);
    const email = contact.email.trim();

    // Send contact to screen API (stores in session, triggers partial GHL sync)
    const screenPayload = {
      message: "Contact details provided",
      message_type: "contact",
      structured_data: {
        first_name: nameParts[0] ?? "",
        last_name: nameParts.slice(1).join(" ") || undefined,
        email: email || undefined,
        phone: contact.phone.trim() || undefined,
      },
    };

    try {
      if (!pendingResult) {
        // Normal path: screen API processes contact and may return finalize
        const data = await callScreen(screenPayload);
        if (!sessionId && data.session_id) setSessionId(data.session_id);
        const resultData = pendingResult ?? data;
        if (email && sessionId) {
          await sendOtp(sessionId, email);
          setOtpCode("");
          setOtpAttempts(0);
          setResult(resultData);
          setStep("otp");
        } else {
          setResult(resultData);
          setStep("result");
        }
      } else {
        // Band-locked path: send contact, then OTP or result
        await callScreen(screenPayload).catch(() => {/* non-fatal */});
        if (email && sessionId) {
          await sendOtp(sessionId, email);
          setOtpCode("");
          setOtpAttempts(0);
          setResult(pendingResult);
          setStep("otp");
        } else {
          setResult(pendingResult);
          setStep("result");
        }
      }
    } catch (err) {
      setApiError(String(err instanceof Error ? err.message : err));
      setStep("identity");
    }
  }

  // ── OTP helpers ───────────────────────────────────────────────────
  async function sendOtp(sid: string, email: string) {
    setOtpSending(true);
    try {
      await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid, email, firm_name: firmName }),
      });
    } finally {
      setOtpSending(false);
    }
  }

  async function handleOtpVerify() {
    if (otpCode.trim().length !== 6 || !sessionId) return;
    setApiError(null);
    setOtpAttempts(prev => prev + 1);

    const res = await fetch("/api/otp/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, code: otpCode.trim() }),
    });
    const data = await res.json() as { verified: boolean; reason?: string };

    if (data.verified) {
      setStep("result");
    } else if (data.reason === "expired") {
      setApiError("This code has expired. Please request a new one.");
    } else {
      setApiError(otpAttempts >= 2
        ? "Too many incorrect attempts. Please request a new code."
        : "Incorrect code. Please try again."
      );
    }
  }

  async function handleOtpResend() {
    if (!sessionId || !contact.email.trim()) return;
    setApiError(null);
    setOtpCode("");
    setOtpAttempts(0);
    await sendOtp(sessionId, contact.email.trim());
  }

  // ── Helpers ───────────────────────────────────────────────────────
  function selectAnswer(questionId: string, value: string, label: string) {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
    setAnswerLabels(prev => ({ ...prev, [questionId]: label }));
  }

  function reset() {
    setStep("intro");
    setSessionId(null);
    setSituation("");
    setQuestions([]);
    setAnswers({});
    setAnswerLabels({});
    setResponseText("");
    setContact({ name: "", email: "", phone: "" });
    setOtpCode("");
    setOtpAttempts(0);
    setOtpSending(false);
    setResult(null);
    setPendingResult(null);
    setIdentityCollected(false);
    setApiError(null);
  }

  const allAnswered = questions.length > 0 && questions.every(q => !!answers[q.id]);
  const canSubmitIdentity = contact.name.trim().length >= 2
    && (contact.email.trim().includes("@") || contact.phone.trim().length >= 7);

  // CSS custom properties for accent color
  const accentStyle = {
    "--accent": accentColor,
    "--accent-ring": `${accentColor}33`,
  } as React.CSSProperties;

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-lg mx-auto" style={accentStyle}>
      <div className="bg-white rounded-2xl shadow-lg border border-black/5 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold tracking-wide uppercase"
              style={{ color: accentColor }}>
              {firmName}
            </span>
            {step !== "result" && step !== "submitting" && (
              <button onClick={reset}
                className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors">
                Start over
              </button>
            )}
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {step === "intro" ? "Tell us about your situation" :
             step === "questions" ? "A few quick questions" :
             step === "identity" ? "How can we reach you?" :
             step === "otp" ? "Verify your email" :
             step === "submitting" ? "One moment…" :
             step === "result" ? "Case review complete" :
             "Something went wrong"}
          </h2>
          <ProgressBar step={step} />
        </div>

        {/* Body */}
        <div className="px-6 pb-6">

          {/* ── Step 1: Situation ── */}
          {step === "intro" && (
            <div className="space-y-4">
              <textarea
                value={situation}
                onChange={e => setSituation(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSituationSubmit();
                }}
                placeholder="Describe what happened in your own words. The more detail you share, the better we can assess your situation."
                rows={5}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-current focus:ring-2 focus:ring-offset-0 resize-none transition"
                style={{ ["--tw-ring-color" as string]: `${accentColor}33` }}
              />
              {apiError && (
                <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{apiError}</p>
              )}
              <button
                onClick={handleSituationSubmit}
                disabled={situation.trim().length < 10}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98]"
                style={{ backgroundColor: accentColor }}
              >
                Continue
              </button>
              <Disclaimer />
            </div>
          )}

          {/* ── Submitting ── */}
          {step === "submitting" && <Spinner />}

          {/* ── Step 2: Branching questions ── */}
          {step === "questions" && (
            <div className="space-y-5">
              {responseText && (
                <p className="text-sm text-gray-600 bg-gray-50 rounded-xl px-4 py-3 leading-relaxed">
                  {responseText}
                </p>
              )}

              {questions.map(q => (
                <div key={q.id}>
                  <p className="text-sm font-medium text-gray-800 mb-2.5">{q.text}</p>
                  {q.options && q.options.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {q.options.map(opt => {
                        const selected = answers[q.id] === opt.value;
                        return (
                          <button
                            key={opt.value}
                            onClick={() => selectAnswer(q.id, opt.value, opt.label)}
                            className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all ${
                              selected
                                ? "border-current text-white"
                                : "border-gray-200 text-gray-600 bg-gray-50 hover:border-gray-300 hover:bg-gray-100"
                            }`}
                            style={selected ? { backgroundColor: accentColor, borderColor: accentColor } : {}}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={answers[q.id] ?? ""}
                      onChange={e => selectAnswer(q.id, e.target.value, e.target.value)}
                      placeholder="Your answer…"
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-current transition"
                    />
                  )}
                </div>
              ))}

              {apiError && (
                <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{apiError}</p>
              )}

              <button
                onClick={handleQuestionsSubmit}
                disabled={!allAnswered}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98]"
                style={{ backgroundColor: accentColor }}
              >
                Continue
              </button>
              <Disclaimer />
            </div>
          )}

          {/* ── Step 3: Identity ── */}
          {step === "identity" && (
            <div className="space-y-4">
              {responseText && (
                <p className="text-sm text-gray-600 bg-gray-50 rounded-xl px-4 py-3 leading-relaxed">
                  {responseText}
                </p>
              )}

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Full name *</label>
                  <input
                    type="text"
                    value={contact.name}
                    onChange={e => setContact(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Jane Smith"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-current transition"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Email address</label>
                  <input
                    type="email"
                    value={contact.email}
                    onChange={e => setContact(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="jane@example.com"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-current transition"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Phone number</label>
                  <input
                    type="tel"
                    value={contact.phone}
                    onChange={e => setContact(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="+1 (416) 555-0100"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-current transition"
                  />
                </div>
              </div>

              <p className="text-[11px] text-gray-400">
                Email or phone required. Your information is confidential and used only to follow up on your inquiry.
              </p>

              {apiError && (
                <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{apiError}</p>
              )}

              <button
                onClick={handleIdentitySubmit}
                disabled={!canSubmitIdentity}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98]"
                style={{ backgroundColor: accentColor }}
              >
                Submit Inquiry
              </button>
              <Disclaimer />
            </div>
          )}

          {/* ── OTP verification ── */}
          {step === "otp" && (
            <div className="space-y-5">
              <p className="text-sm text-gray-600 leading-relaxed">
                We sent a 6-digit code to <span className="font-medium text-gray-800">{contact.email}</span>.
                Enter it below to view your case review.
              </p>

              <div>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={e => e.key === "Enter" && handleOtpVerify()}
                  placeholder="000000"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-2xl font-mono text-center text-gray-800 tracking-[0.4em] placeholder-gray-300 focus:outline-none focus:border-current transition"
                  autoFocus
                />
              </div>

              {apiError && (
                <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{apiError}</p>
              )}

              <button
                onClick={handleOtpVerify}
                disabled={otpCode.trim().length !== 6}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98]"
                style={{ backgroundColor: accentColor }}
              >
                Verify Code
              </button>

              <div className="flex items-center justify-center gap-1">
                <span className="text-xs text-gray-400">Didn&apos;t receive it?</span>
                <button
                  onClick={handleOtpResend}
                  disabled={otpSending}
                  className="text-xs font-medium underline text-gray-500 hover:text-gray-700 disabled:opacity-50 transition-colors"
                >
                  {otpSending ? "Sending…" : "Resend code"}
                </button>
              </div>
            </div>
          )}

          {/* ── Result ── */}
          {step === "result" && result && (
            <div className="space-y-4 pt-1">
              {/* Check icon */}
              <div className="flex justify-center">
                <div className="w-14 h-14 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: `${accentColor}18` }}>
                  <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    strokeWidth={2.5} style={{ color: accentColor }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>

              {/* Practice area badge */}
              {result.practice_area && (
                <div className="flex justify-center">
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold"
                    style={{ backgroundColor: `${accentColor}15`, color: accentColor }}>
                    {result.practice_area}
                  </span>
                </div>
              )}

              {/* Situation summary */}
              {result.situation_summary && (
                <div className="bg-gray-50 rounded-xl px-4 py-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Case Summary</p>
                  <p className="text-sm text-gray-700 leading-relaxed">{result.situation_summary}</p>
                </div>
              )}

              {/* CTA */}
              {result.cta && (() => {
                const style = BAND_CTA_STYLE[result.cpi.band ?? "E"] ?? BAND_CTA_STYLE["E"];
                return (
                  <div className={`rounded-xl border px-4 py-3.5 flex items-start gap-3 ${style.border}`}>
                    <svg className={`w-5 h-5 mt-0.5 flex-shrink-0 ${style.icon}`} fill="none"
                      viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p className="text-sm font-medium text-gray-800">{result.cta}</p>
                  </div>
                );
              })()}

              <button
                onClick={reset}
                className="w-full py-2.5 rounded-xl text-xs font-medium text-gray-500 border border-gray-200 hover:bg-gray-50 transition-all"
              >
                Start a new inquiry
              </button>

              <Disclaimer />
            </div>
          )}

          {/* ── Error ── */}
          {step === "error" && (
            <div className="space-y-4 text-center py-6">
              <p className="text-sm text-gray-600">Something went wrong. Please try again.</p>
              {apiError && (
                <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{apiError}</p>
              )}
              <button
                onClick={reset}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ backgroundColor: accentColor }}
              >
                Try again
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function stripDisclaimer(text: string): string {
  return text
    .replace(/\n?This (is general information|communication) (is )?not legal advice\.?.*/gi, "")
    .replace(/\n?You (are|have been) interacting with an automated.*/gi, "")
    .trim();
}

export default IntakeWidget;
