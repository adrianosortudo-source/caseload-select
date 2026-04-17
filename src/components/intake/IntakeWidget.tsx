"use client";

/**
 * IntakeWidget — 6-step client intake component for CaseLoad Screen.
 *
 * Flow:
 *   intent → intro → submitting → questions → submitting → identity → otp → result
 *
 * New in this version:
 *   - Named persona with avatar (assistantName, assistantAvatar)
 *   - Intent routing step before the situation textarea
 *   - Welcome-back session resume via localStorage
 *   - Escape hatch to reach a human at any point
 *   - Upgraded consent footer with privacy policy link
 *   - Progress label on the questions step
 *
 * Channels: always uses "widget" mode (GPT returns all questions at once).
 */

import { useState, useCallback, useEffect, useRef } from "react";
import LawyerViewPanel, { type FullCpi } from "@/components/demo/LawyerViewPanel";
import { getRound3Questions, qualifiesForRound3, type Round3Question } from "@/lib/round3";

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
  cpi: FullCpi & { band_locked: boolean };
  response_text: string;
  finalize: boolean;
  collect_identity: boolean;
  situation_summary: string | null;
  cta: string | null;
  flags: string[];
  value_tier: string | null;
  prior_experience: string | null;
}

type Step = "intent" | "intro" | "questions" | "identity" | "otp" | "round3" | "submitting" | "result" | "error";

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

function Avatar({
  name,
  avatarUrl,
  size = 44,
  accentColor,
}: {
  name: string;
  avatarUrl?: string;
  size?: number;
  accentColor: string;
}) {
  const initials = name
    .split(" ")
    .map(p => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0"
      style={{ width: size, height: size, backgroundColor: accentColor, fontSize: Math.round(size * 0.35) }}
    >
      {initials}
    </div>
  );
}

function ProgressBar({ step }: { step: Step }) {
  const steps = [
    { label: "Situation" },
    { label: "Your Case" },
    { label: "Your Details" },
    { label: "Verify" },
    { label: "Step 3 of 3" },
  ];

  if (step === "intent" || step === "result" || step === "error") return null;

  const stepIndex =
    step === "intro" ? 0
    : step === "questions" ? 1
    : step === "submitting" ? 1
    : step === "identity" ? 2
    : step === "otp" ? 3
    : step === "round3" ? 4
    : 4;

  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center flex-1">
          <div className="flex flex-col items-center flex-1">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
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
            <span className={`text-[10px] mt-1 font-medium ${i <= stepIndex ? "text-gray-600" : "text-gray-400"}`}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={`h-0.5 flex-1 mx-1 mt-[-14px] transition-all ${i < stepIndex ? "bg-emerald-400" : "bg-gray-200"}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

const PROCESSING_MESSAGES = [
  "Reading your situation…",
  "Identifying the practice area…",
  "Preparing your questions…",
];

function Spinner() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setIdx(i => (i + 1) % PROCESSING_MESSAGES.length),
      1400,
    );
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      <div
        className="w-10 h-10 border-2 border-gray-200 border-t-current rounded-full animate-spin"
        style={{ borderTopColor: "var(--accent)" }}
      />
      <p className="text-sm text-gray-500 transition-all duration-300">{PROCESSING_MESSAGES[idx]}</p>
    </div>
  );
}

function Disclaimer({ privacyUrl }: { privacyUrl?: string }) {
  return (
    <div className="mt-4 text-center space-y-1">
      <p className="text-[10px] text-gray-400 leading-relaxed">
        This is general information, not legal advice. You are interacting with an automated screening system.
      </p>
      <p className="text-[10px] text-gray-400 leading-relaxed">
        This conversation is stored securely.{" "}
        {privacyUrl && (
          <a
            href={privacyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-600 transition-colors"
          >
            Privacy Policy
          </a>
        )}
      </p>
    </div>
  );
}

function EscapeHatch({
  firmPhone,
  firmPhoneTel,
  firmBookingUrl,
}: {
  firmPhone?: string;
  firmPhoneTel?: string;
  firmBookingUrl?: string;
}) {
  if (!firmPhone && !firmBookingUrl) return null;
  return (
    <p className="text-[10px] text-gray-400 text-center mt-1">
      Prefer to speak with someone?{" "}
      {firmPhone && (
        <a
          href={firmPhoneTel ?? `tel:${firmPhone.replace(/\D/g, "")}`}
          className="underline hover:text-gray-600 transition-colors"
        >
          {firmPhone}
        </a>
      )}
      {firmPhone && firmBookingUrl && " · "}
      {firmBookingUrl && (
        <a
          href={firmBookingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-600 transition-colors"
        >
          Book a call
        </a>
      )}
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
  /** Display name for the AI assistant, e.g. "Alex" */
  assistantName?: string;
  /** Optional avatar image URL; falls back to initials if omitted */
  assistantAvatar?: string;
  /** Human-readable phone number, e.g. "(416) 555-2847" */
  firmPhone?: string;
  /** Tel URI for the phone link, e.g. "tel:+14165552847" */
  firmPhoneTel?: string;
  /** Booking page URL, e.g. "https://calendly.com/..." */
  firmBookingUrl?: string;
  /** Privacy policy URL shown in the consent footer */
  firmPrivacyUrl?: string;
  /**
   * Demo mode — skips OTP, suppresses GHL delivery, shows LawyerViewPanel
   * after finalization. Set by the /demo scenario launcher and DemoLandingPage.
   */
  demoMode?: boolean;
  /**
   * Pre-loaded scenario ID. When set, the widget auto-sends the scenario's
   * first message on mount. Scenario messages are defined in DemoLandingPage.
   * The widget page decodes the ?scenario= URL param and passes it here.
   */
  demoScenario?: string;
  /**
   * Called whenever the widget's step changes during a guided tour.
   * Used by DemoTour to sync balloon content with the active step.
   */
  onDemoStepChange?: (step: string) => void;
  /**
   * Guided tour mode — when true, the widget plays through the scenario with
   * phantom typing and auto-advancing, simulating a real user session.
   * Used by the DemoLandingPage scenario chips. Requires demoScenario to be set.
   */
  guidedTour?: boolean;
}

// Pre-loaded scenario messages (mirrors DEMO_SCENARIOS in DemoLandingPage.tsx)
const SCENARIO_MESSAGES: Record<string, string> = {
  pi_strong:
    "I was rear-ended on the 401 about three weeks ago. The other driver hit me from behind at highway speed. I've been seeing a doctor since.",
  emp_mid:
    "My employer let me go last Friday. I'd been there for four years.",
  small_claims:
    "I want to sue my contractor for $8,000. He didn't finish the job and won't return my calls.",
};

// Realistic contact info for guided tour scenarios (internal lawyer view only)
// Used when contact form is skipped in guided tour so the lawyer panel still
// shows a plausible lead record.
const DEMO_CONTACTS: Record<string, { name: string; email: string; phone: string }> = {
  pi_strong: {
    name: "Jane Matthews",
    email: "jane.matthews@gmail.com",
    phone: "+1 (416) 555-2847",
  },
  emp_mid: {
    name: "Daniel Chen",
    email: "d.chen@outlook.com",
    phone: "+1 (647) 555-0192",
  },
  small_claims: {
    name: "Ryan Bishop",
    email: "ryan.b@yahoo.com",
    phone: "+1 (905) 555-3316",
  },
};

// ── Pre-recorded fixture responses for guided tour ────────────────────────
// Replaces real API calls during guided tour so transitions are instant.
// Each array has one entry per question round, ending with a finalize response.

const EMPTY_TOUR_CPI: FullCpi & { band_locked: boolean } = {
  total: 0, band: null, fit_score: 0, value_score: 0, band_locked: false,
  geo_score: 0, practice_score: 0, legitimacy_score: 0, referral_score: 0,
  urgency_score: 0, complexity_score: 0, multi_practice_score: 0, fee_score: 0,
};

const TOUR_FIXTURES: Record<string, ScreenResponse[]> = {
  pi_strong: [
    // Round 1 questions
    {
      session_id: "demo-pi", practice_area: "Personal Injury",
      practice_area_confidence: "high", next_question: null,
      next_questions: [
        { id: "timing", text: "When did the accident happen?", allow_free_text: false, options: [
          { label: "Within the past week", value: "within_week" },
          { label: "Within the past month", value: "within_month" },
          { label: "1 to 6 months ago", value: "1_6_months" },
          { label: "Over 6 months ago", value: "over_6_months" },
        ]},
        { id: "treatment", text: "Are you currently receiving medical treatment?", allow_free_text: false, options: [
          { label: "Yes, ongoing treatment", value: "yes_ongoing" },
          { label: "Treated and discharged", value: "discharged" },
          { label: "Haven't sought treatment yet", value: "no_treatment" },
        ]},
        { id: "police_report", text: "Was a police report filed at the scene?", allow_free_text: false, options: [
          { label: "Yes", value: "yes" },
          { label: "No", value: "no" },
          { label: "I'm not sure", value: "unsure" },
        ]},
      ],
      cpi: EMPTY_TOUR_CPI, response_text: "I'm sorry to hear about your accident. Let me ask a few more questions to assess your claim.",
      finalize: false, collect_identity: false, situation_summary: null, cta: null,
      flags: [], value_tier: null, prior_experience: null,
    },
    // Round 2 questions
    {
      session_id: "demo-pi", practice_area: "Personal Injury",
      practice_area_confidence: "high", next_question: null,
      next_questions: [
        { id: "work_loss", text: "Have you missed work or lost income because of your injuries?", allow_free_text: false, options: [
          { label: "Yes, significant time off", value: "yes_significant" },
          { label: "Yes, a few days", value: "yes_minor" },
          { label: "No income impact", value: "no" },
        ]},
        { id: "other_insured", text: "Is the other driver insured, to your knowledge?", allow_free_text: false, options: [
          { label: "Yes, they were insured", value: "yes" },
          { label: "Likely, but not certain", value: "likely" },
          { label: "No or unknown", value: "no" },
        ]},
      ],
      cpi: EMPTY_TOUR_CPI, response_text: "Thank you. Two more questions and the assessment will be complete.",
      finalize: false, collect_identity: false, situation_summary: null, cta: null,
      flags: [], value_tier: null, prior_experience: null,
    },
    // Finalize — Band A
    {
      session_id: "demo-pi", practice_area: "Personal Injury",
      practice_area_confidence: "high", next_question: null, next_questions: null,
      cpi: { total: 87, band: "A", fit_score: 37, value_score: 50, band_locked: true,
        geo_score: 10, practice_score: 10, legitimacy_score: 9, referral_score: 8,
        urgency_score: 18, complexity_score: 22, multi_practice_score: 3, fee_score: 7 },
      response_text: "Your case presents strong indicators across liability, injury severity, and financial damages.",
      finalize: true, collect_identity: false,
      situation_summary: "Client was rear-ended on the 401 approximately three weeks ago at highway speed. A police report was filed. Ongoing medical treatment is in progress and significant work income was lost. Clear liability with documented injuries: strong personal injury claim.",
      cta: "Your case has been rated Band A (priority). A lawyer will contact you within 24 hours to discuss your options and next steps.",
      flags: ["strong_liability", "documented_injuries", "income_loss"],
      value_tier: "high", prior_experience: null,
    },
  ],

  emp_mid: [
    // Round 1 questions
    {
      session_id: "demo-emp", practice_area: "Employment Law",
      practice_area_confidence: "high", next_question: null,
      next_questions: [
        { id: "cause", text: "Were you given a written reason for the termination?", allow_free_text: false, options: [
          { label: "Restructuring or economic", value: "restructuring" },
          { label: "Performance or conduct", value: "performance" },
          { label: "No clear reason given", value: "no_reason" },
        ]},
        { id: "severance", text: "What notice or severance were you offered?", allow_free_text: false, options: [
          { label: "2 weeks or less", value: "statutory_or_less" },
          { label: "More than 2 weeks", value: "above_statutory" },
          { label: "Nothing at all", value: "none" },
        ]},
        { id: "contract", text: "Do you have a written employment contract?", allow_free_text: false, options: [
          { label: "Yes, written contract", value: "yes" },
          { label: "Verbal agreement only", value: "verbal" },
          { label: "Not sure", value: "unsure" },
        ]},
      ],
      cpi: EMPTY_TOUR_CPI, response_text: "I can look into this for you. A few quick questions to understand the full picture.",
      finalize: false, collect_identity: false, situation_summary: null, cta: null,
      flags: [], value_tier: null, prior_experience: null,
    },
    // Finalize — Band C
    {
      session_id: "demo-emp", practice_area: "Employment Law",
      practice_area_confidence: "high", next_question: null, next_questions: null,
      cpi: { total: 54, band: "C", fit_score: 28, value_score: 26, band_locked: true,
        geo_score: 8, practice_score: 9, legitimacy_score: 7, referral_score: 4,
        urgency_score: 10, complexity_score: 12, multi_practice_score: 2, fee_score: 2 },
      response_text: "Your situation falls in a borderline range. The claim may have merit but limited recoverable damages affect the overall priority.",
      finalize: true, collect_identity: false,
      situation_summary: "Client was terminated without stated cause after four years of employment and offered two weeks of severance (the statutory minimum). No written employment contract confirmed. Potential wrongful dismissal claim exists but limited damages given tenure and lack of negotiated terms.",
      cta: "Your inquiry has been reviewed. A team member will follow up within a few business days to discuss whether and how we can assist.",
      flags: ["potential_wrongful_dismissal", "statutory_minimum_severance"],
      value_tier: "medium_low", prior_experience: null,
    },
  ],

  small_claims: [
    // Round 1 — one question
    {
      session_id: "demo-sc", practice_area: "Small Claims",
      practice_area_confidence: "high", next_question: null,
      next_questions: [
        { id: "amount", text: "What is the total amount of the dispute?", allow_free_text: false, options: [
          { label: "Under $5,000", value: "under_5k" },
          { label: "$5,000 to $10,000", value: "5k_10k" },
          { label: "Over $10,000", value: "over_10k" },
        ]},
      ],
      cpi: EMPTY_TOUR_CPI, response_text: "I see. One quick question before completing your assessment.",
      finalize: false, collect_identity: false, situation_summary: null, cta: null,
      flags: [], value_tier: null, prior_experience: null,
    },
    // Finalize — Band E
    {
      session_id: "demo-sc", practice_area: "Small Claims",
      practice_area_confidence: "high", next_question: null, next_questions: null,
      cpi: { total: 12, band: "E", fit_score: 8, value_score: 4, band_locked: true,
        geo_score: 4, practice_score: 2, legitimacy_score: 1, referral_score: 1,
        urgency_score: 2, complexity_score: 2, multi_practice_score: 0, fee_score: 0 },
      response_text: "Based on your inquiry, this matter falls outside the firm's caseload for cases of this type and size.",
      finalize: true, collect_identity: false,
      situation_summary: "Client seeks $8,000 from a contractor for incomplete work. This is a small claims matter outside the firm's civil litigation scope for disputes at this amount.",
      cta: "This type of dispute is handled most efficiently through Ontario Small Claims Court, where you can self-represent. See the resources below.",
      flags: ["small_claims_only"],
      value_tier: "low", prior_experience: null,
    },
  ],
};

export function IntakeWidget({
  firmId,
  firmName,
  accentColor = "#1a3a5c",
  assistantName = "Alex",
  assistantAvatar,
  firmPhone,
  firmPhoneTel,
  firmBookingUrl,
  firmPrivacyUrl,
  demoMode = false,
  demoScenario,
  guidedTour = false,
  onDemoStepChange,
}: IntakeWidgetProps) {
  const LS_KEY = `cls_session_${firmId}`;

  const [step, setStep] = useState<Step>("intent");

  // Notify parent of step changes during guided tour (for DemoTour balloon sync)
  useEffect(() => {
    if (guidedTour && onDemoStepChange) {
      onDemoStepChange(step);
    }
  }, [step, guidedTour, onDemoStepChange]);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  const [sourceHint, setSourceHint] = useState<string | null>(null);

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
  const [pendingResult, setPendingResult] = useState<ScreenResponse | null>(null);
  const [identityCollected, setIdentityCollected] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Round 3 state
  const [round3Questions, setRound3Questions] = useState<Round3Question[]>([]);
  const [round3Answers, setRound3Answers] = useState<Record<string, string | string[]>>({});
  const [round3Submitting, setRound3Submitting] = useState(false);

  // Demo mode state
  const [showLawyerPanel, setShowLawyerPanel] = useState(false);
  const autoSentRef = useRef(false);

  // Guided tour state
  const tourTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isSkippedRef = useRef(false);
  const tourStartedRef = useRef(false);
  const [isSkipped, setIsSkipped] = useState(false);
  // tourAction controls what the user clicks next during guided tour
  const [tourAction, setTourAction] = useState<"show-answers" | "submit-answers" | null>(null);
  // intakeTrail accumulates Q&A pairs across all question rounds
  const [intakeTrail, setIntakeTrail] = useState<Array<{ question: string; answer: string }>>([]);
  // tracks which fixture index to use next in the guided tour
  const tourFixtureStepRef = useRef(0);
  // tracks how many question rounds have been shown (1 = Round 1, 2 = Round 2, etc.)
  const questionsRoundRef = useRef(0);
  const [questionRound, setQuestionRound] = useState(1);

  // ── Welcome back: check localStorage on mount ─────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) setResumeSessionId(saved);
    } catch {
      // localStorage unavailable (private mode, etc.) — ignore silently
    }
  }, [LS_KEY]);

  // ── Source hint: capture UTM params + page path on mount ─────────
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const parts: string[] = [];
      if (url.pathname && url.pathname !== "/") parts.push(`page:${url.pathname}`);
      const utmSource = url.searchParams.get("utm_source");
      const utmMedium = url.searchParams.get("utm_medium");
      const utmCampaign = url.searchParams.get("utm_campaign");
      if (utmSource) parts.push(`utm_source:${utmSource}`);
      if (utmMedium) parts.push(`utm_medium:${utmMedium}`);
      if (utmCampaign) parts.push(`utm_campaign:${utmCampaign}`);
      if (parts.length > 0) setSourceHint(parts.join(", "));
    } catch {
      // ignore — not critical
    }
  }, []);

  // ── Persist session ID to localStorage once known ─────────────────
  useEffect(() => {
    if (!sessionId) return;
    try {
      localStorage.setItem(LS_KEY, sessionId);
    } catch {
      // ignore
    }
  }, [sessionId, LS_KEY]);

  // ── Cleanup tour timeouts on unmount ──────────────────────────────
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      tourTimeoutsRef.current.forEach(clearTimeout);
    };
  }, []);

  // ── Demo auto-send: pre-load scenario message and submit immediately ──
  // Fires once per mount when demoScenario is set. Skips the intent + intro
  // steps and goes straight to screening so the prospect sees the engine work.
  // Skipped when guidedTour is true — guided tour handles its own sequencing.
  useEffect(() => {
    if (!demoMode || !demoScenario || autoSentRef.current || guidedTour) return;
    const msg = SCENARIO_MESSAGES[demoScenario];
    if (!msg) return;
    autoSentRef.current = true;

    const delay = setTimeout(async () => {
      setStep("submitting");
      try {
        const data = await fetch("/api/screen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firm_id: firmId,
            channel: "widget",
            message: msg,
            message_type: "text",
            demo: true,
          }),
        }).then(r => r.json()) as ScreenResponse;
        if (!data.session_id) throw new Error("No session");
        setSessionId(data.session_id);
        applyResponse(data, "identity");
      } catch (err) {
        setApiError(String(err instanceof Error ? err.message : err));
        setStep("intro");
      }
    }, 400);

    return () => clearTimeout(delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode, demoScenario, firmId]);

  // Derived state — declared early so guided tour useEffects can reference allAnswered
  const allAnswered = questions.length > 0 && questions.every(q => !!answers[q.id]);

  // ── Guided tour: phantom typing, triggered by user click on intent button ─
  // Fires when the user clicks "I need legal help" in guided-tour mode. The
  // intent step is no longer auto-advanced — the user must explicitly start
  // the intake. After typing completes, the user presses "Continue" (normal
  // intro-step button) to submit and advance to Round 1 questions.
  useEffect(() => {
    if (!guidedTour || !demoScenario) return;
    if (step !== "intro") return;
    if (tourStartedRef.current) return;
    const msg = SCENARIO_MESSAGES[demoScenario];
    if (!msg) return;
    tourStartedRef.current = true;

    const addT = (fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      tourTimeoutsRef.current.push(t);
      return t;
    };

    // Phantom typing: character by character
    let i = 0;
    function typeNext() {
      if (isSkippedRef.current) return;
      i++;
      setSituation(msg.slice(0, i));
      if (i < msg.length) {
        const prevChar = msg[i - 1];
        const charMs = prevChar === "." || prevChar === "!" || prevChar === "?"
          ? 380
          : prevChar === ","
          ? 140
          : 45 + Math.floor(Math.random() * 20);
        const t = setTimeout(typeNext, charMs);
        tourTimeoutsRef.current.push(t);
      }
      // When typing completes, the textarea is filled and the user presses
      // "Continue" themselves. No auto-submit.
    }

    addT(typeNext, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidedTour, demoScenario, step]);

  // ── Guided tour: pause at questions — user clicks to see demo answers ──
  // Replaces the old auto-select + auto-submit effects. The user now clicks
  // "Show how the AI answered" and then "Submit answers" to advance.
  useEffect(() => {
    if (!guidedTour || isSkippedRef.current || step !== "questions" || questions.length === 0) return;

    // Clear any stale tour timeouts from prior phases (e.g., typing)
    tourTimeoutsRef.current.forEach(clearTimeout);
    tourTimeoutsRef.current = [];

    // Pause — show the action button so user can read the questions first
    setTourAction("show-answers");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidedTour, step, questions]);

  // ── Guided tour: auto-advance past round3 step ───────────────────
  // In guided tour mode, skip Round 3 (it requires real answers) and go to result.
  useEffect(() => {
    if (!guidedTour || isSkippedRef.current || step !== "round3") return;
    const t = setTimeout(() => {
      if (isSkippedRef.current) return;
      setStep("result");
      setTimeout(() => setShowLawyerPanel(true), 1200);
    }, 800);
    tourTimeoutsRef.current.push(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidedTour, step]);

  // ── Guided tour: safety net — auto-advance past any identity step ─
  // Catches all paths to identity (collect_identity, finalize fallback, etc.)
  // regardless of how we got there. Submits dummy contact if no pending result.
  useEffect(() => {
    if (!guidedTour || isSkippedRef.current || step !== "identity") return;

    const sid = sessionId;
    const pending = pendingResult;

    const t = setTimeout(() => {
      if (isSkippedRef.current) return;

      if (pending) {
        // Already have a scored result — surface it, user clicks to open panel
        setResult(pending);
        setStep("result");
        return;
      }

      // Submit dummy contact to get the finalized result
      setIdentityCollected(true);
      setStep("submitting");
      fetch("/api/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sid,
          firm_id: firmId,
          channel: "widget",
          demo: true,
          message: "Contact details provided",
          message_type: "contact",
          structured_data: { first_name: "Demo", last_name: "User", phone: "5550000000" },
        }),
      })
        .then(r => r.json())
        .then((data: ScreenResponse) => {
          setResult(data);
          setStep("result");
          // User clicks "See what landed in your pipeline" to open panel
        })
        .catch(() => {
          setStep("result");
        });
    }, 600);

    tourTimeoutsRef.current.push(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidedTour, step]);

  // ── API call helper ───────────────────────────────────────────────
  const callScreen = useCallback(
    async (payload: {
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
          ...(sourceHint ? { source_hint: sourceHint } : {}),
          ...(demoMode ? { demo: true } : {}),
          ...payload,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Error ${res.status}`);
      }
      return res.json();
    },
    [sessionId, firmId, sourceHint]
  );

  function applyResponse(data: ScreenResponse, fallbackStep: Step) {
    if (!sessionId && data.session_id) setSessionId(data.session_id);
    setResponseText(stripDisclaimer(data.response_text ?? ""));

    if (data.finalize && !identityCollected) {
      if (guidedTour && !isSkippedRef.current) {
        // Guided tour: skip identity, go to result — user clicks to open panel
        setResult(data);
        setStep("result");
      } else {
        setPendingResult(data);
        setStep("identity");
      }
    } else if (data.finalize) {
      setResult(data);
      setStep("result");
      // In demo mode, show the lawyer panel 1.2s after the result renders
      if (demoMode) {
        setTimeout(() => setShowLawyerPanel(true), 1200);
      }
    } else if (data.collect_identity) {
      // Guided tour handles identity bypass via its own safety-net useEffect
      setStep("identity");
    } else if (data.next_questions?.length) {
      questionsRoundRef.current++;
      setQuestionRound(questionsRoundRef.current);
      setQuestions(data.next_questions);
      setAnswers({});
      setAnswerLabels({});
      setStep("questions");
    } else if (data.next_question) {
      questionsRoundRef.current++;
      setQuestionRound(questionsRoundRef.current);
      setQuestions([data.next_question]);
      setAnswers({});
      setAnswerLabels({});
      setStep("questions");
    } else {
      setStep(fallbackStep);
    }
  }

  // ── Intent step handlers ─────────────────────────────────────────
  async function handleResume() {
    if (!resumeSessionId) return;
    setApiError(null);
    setStep("submitting");
    try {
      const res = await fetch(`/api/screen/resume?session_id=${resumeSessionId}`);
      if (!res.ok) {
        // Session expired or deleted — clear and start fresh
        try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
        setResumeSessionId(null);
        setStep("intent");
        return;
      }
      const state = await res.json() as {
        session_id: string;
        practice_area: string | null;
        band: string | null;
        questions_answered: string[];
        step_hint: "intro" | "questions" | "identity" | "result";
        situation_summary: string | null;
        cpi: Record<string, unknown>;
      };
      setSessionId(state.session_id);
      // Jump to the furthest step the user had reached
      setStep(state.step_hint === "result" ? "result" : state.step_hint);
    } catch {
      setStep("intro");
      setSessionId(resumeSessionId);
    }
  }

  function handleIntentSelect(choice: "help" | "question" | "human") {
    if (choice === "human") {
      if (firmPhoneTel) {
        window.location.href = firmPhoneTel;
      } else if (firmBookingUrl) {
        window.open(firmBookingUrl, "_blank");
      }
      return;
    }
    // Both "help" and "question" routes proceed to the situation step
    setStep("intro");
  }

  // ── Step 1: Submit initial situation ─────────────────────────────
  async function handleSituationSubmit() {
    if (!situation.trim()) return;
    setApiError(null);
    setStep("submitting");

    // Guided tour: use pre-recorded fixture instead of hitting the API
    if (guidedTour && demoScenario && !isSkippedRef.current) {
      const fixtures = TOUR_FIXTURES[demoScenario];
      const data = fixtures?.[tourFixtureStepRef.current];
      if (data) {
        tourFixtureStepRef.current++;
        setTimeout(() => {
          if (isSkippedRef.current) return;
          setSessionId(data.session_id);
          applyResponse(data, "identity");
        }, 600);
        return;
      }
    }

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
    // Accumulate Q&A trail before clearing answers for next round
    const trailItems = questions
      .filter(q => answerLabels[q.id] || answers[q.id])
      .map(q => ({ question: q.text, answer: answerLabels[q.id] ?? answers[q.id] ?? "" }));
    if (trailItems.length > 0) {
      setIntakeTrail(prev => [...prev, ...trailItems]);
    }

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
        const data = await callScreen(screenPayload);
        if (!sessionId && data.session_id) setSessionId(data.session_id);
        const resultData = pendingResult ?? data;
        // Demo mode: skip OTP, go straight to result
        if (email && sessionId && !demoMode) {
          await sendOtp(sessionId, email);
          setOtpCode("");
          setOtpAttempts(0);
          setResult(resultData);
          setStep("otp");
        } else {
          setResult(resultData);
          setStep("result");
          if (demoMode) setTimeout(() => setShowLawyerPanel(true), 1200);
        }
      } else {
        await callScreen(screenPayload).catch(() => {
          /* non-fatal */
        });
        // Demo mode: skip OTP, go straight to result
        if (email && sessionId && !demoMode) {
          await sendOtp(sessionId, email);
          setOtpCode("");
          setOtpAttempts(0);
          setResult(pendingResult);
          setStep("otp");
        } else {
          setResult(pendingResult);
          setStep("result");
          if (demoMode) setTimeout(() => setShowLawyerPanel(true), 1200);
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
    const data = (await res.json()) as { verified: boolean; band?: string; reason?: string };

    if (data.verified) {
      // Advance to Round 3 if band qualifies, else go to result
      const band = data.band ?? result?.cpi?.band ?? null;
      if (!demoMode && qualifiesForRound3(band)) {
        const practiceArea = result?.practice_area ?? null;
        const questions = getRound3Questions(practiceArea, null, band);
        if (questions.length > 0) {
          setRound3Questions(questions);
          setRound3Answers({});
          // Mark round3 started in db (non-fatal)
          void fetch("/api/screen/round3/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId }),
          }).catch(() => { /* ignore */ });
          setStep("round3");
          return;
        }
      }
      setStep("result");
    } else if (data.reason === "expired") {
      setApiError("This code has expired. Please request a new one.");
    } else {
      setApiError(
        otpAttempts >= 2
          ? "Too many incorrect attempts. Please request a new code."
          : "Incorrect code. Please try again."
      );
    }
  }

  // ── Round 3 handlers ──────────────────────────────────────────────
  function selectRound3Answer(questionId: string, value: string, multi?: boolean) {
    setRound3Answers(prev => {
      if (multi) {
        const existing = (prev[questionId] as string[] | undefined) ?? [];
        const already = existing.includes(value);
        return {
          ...prev,
          [questionId]: already ? existing.filter(v => v !== value) : [...existing, value],
        };
      }
      return { ...prev, [questionId]: value };
    });
  }

  async function handleRound3Submit() {
    if (!sessionId || round3Submitting) return;
    setRound3Submitting(true);
    setApiError(null);
    try {
      await fetch("/api/screen/round3", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, answers: round3Answers }),
      });
    } catch {
      // Non-fatal — proceed to result regardless
    } finally {
      setRound3Submitting(false);
      setStep("result");
      if (demoMode) setTimeout(() => setShowLawyerPanel(true), 1200);
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

  function handleTourAction() {
    if (tourAction === "show-answers") {
      setTourAction(null);
      // Phantom-select options with 1.3s between each, then show submit button
      let delay = 0;
      questions.forEach(q => {
        if (q.options.length > 0) {
          const optIdx = Math.min(1, q.options.length - 1);
          const t = setTimeout(() => {
            if (isSkippedRef.current) return;
            selectAnswer(q.id, q.options[optIdx].value, q.options[optIdx].label);
          }, delay);
          tourTimeoutsRef.current.push(t);
          delay += 1300;
        }
      });
      const t = setTimeout(() => {
        if (isSkippedRef.current) return;
        setTourAction("submit-answers");
      }, delay + 500);
      tourTimeoutsRef.current.push(t);
      return;
    }

    if (tourAction === "submit-answers") {
      setTourAction(null);
      // Accumulate Q&A trail from this round
      const trailItems = questions
        .filter(q => answerLabels[q.id] || answers[q.id])
        .map(q => ({ question: q.text, answer: answerLabels[q.id] ?? answers[q.id] ?? "" }));
      if (trailItems.length > 0) setIntakeTrail(prev => [...prev, ...trailItems]);

      setStep("submitting");
      // Use pre-recorded fixture for instant response
      const fixtures = demoScenario ? TOUR_FIXTURES[demoScenario] : null;
      const nextFixture = fixtures?.[tourFixtureStepRef.current];
      if (nextFixture) {
        tourFixtureStepRef.current++;
        setTimeout(() => {
          if (isSkippedRef.current) return;
          applyResponse(nextFixture, "identity");
        }, 500);
      } else {
        // Fallback to real API if fixtures exhausted
        handleQuestionsSubmit();
      }
    }
  }

  function skipTour() {
    tourTimeoutsRef.current.forEach(clearTimeout);
    tourTimeoutsRef.current = [];
    isSkippedRef.current = true;
    setIsSkipped(true);
    setTourAction(null);

    if (step === "result") return;

    // Use the final fixture (finalize entry) for an instant skip-to-result
    const fixtures = demoScenario ? TOUR_FIXTURES[demoScenario] : null;
    const finalFixture = fixtures?.[fixtures.length - 1];
    if (finalFixture?.finalize) {
      setSessionId(finalFixture.session_id);
      setResult(finalFixture);
      setStep("result");
      setTimeout(() => setShowLawyerPanel(true), 400);
      return;
    }

    // Fallback: show result without data (edge case)
    setStep("result");
    setTimeout(() => setShowLawyerPanel(true), 400);
  }

  function reset() {
    // Clear any in-flight tour timeouts
    tourTimeoutsRef.current.forEach(clearTimeout);
    tourTimeoutsRef.current = [];
    isSkippedRef.current = false;
    tourStartedRef.current = false;
    tourFixtureStepRef.current = 0;
    setIsSkipped(false);
    setTourAction(null);
    setIntakeTrail([]);
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      // ignore
    }
    setStep("intent");
    setSessionId(null);
    setResumeSessionId(null);
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
    setRound3Questions([]);
    setRound3Answers({});
    setRound3Submitting(false);
    questionsRoundRef.current = 0;
    setQuestionRound(1);
  }

  const canSubmitIdentity =
    contact.name.trim().length >= 2 &&
    (contact.email.trim().includes("@") || contact.phone.trim().length >= 7);

  const accentStyle = {
    "--accent": accentColor,
    "--accent-ring": `${accentColor}33`,
  } as React.CSSProperties;

  const stepTitle: Record<Step, string> = {
    intent: `${firmName}`,
    intro: "Tell us about your situation",
    questions: "A few quick questions",
    identity: "How can we reach you?",
    otp: "Verify your email",
    round3: "Case details",
    submitting: "One moment…",
    result: "Case review complete",
    error: "Something went wrong",
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-lg mx-auto" style={accentStyle}>
      <div className="bg-white rounded-2xl shadow-lg border border-black/5 overflow-hidden">

        {/* Header */}
        <div className="px-6 pt-5 pb-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: accentColor }}>
              {firmName}
            </span>
            {step !== "intent" && step !== "result" && step !== "submitting" && (
              guidedTour && !isSkipped ? (
                <button
                  onClick={skipTour}
                  className="text-[11px] font-semibold hover:opacity-70 transition-opacity"
                  style={{ color: "var(--accent)" }}
                >
                  Skip →
                </button>
              ) : (
                <button
                  onClick={reset}
                  className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Start over
                </button>
              )
            )}
          </div>

          {step !== "intent" && (
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{stepTitle[step]}</h2>
          )}

          <ProgressBar step={step} />
        </div>

        {/* Body */}
        <div className="px-6 pb-6">

          {/* ── Intent step ── */}
          {step === "intent" && (
            <div className="space-y-5 pt-1">
              {/* Persona greeting */}
              <div className="flex flex-col items-center gap-3 pt-2 pb-1">
                <Avatar
                  name={assistantName}
                  avatarUrl={assistantAvatar}
                  accentColor={accentColor}
                  size={52}
                />
                <div className="text-center">
                  <p className="text-base font-semibold text-gray-800">
                    Hi, I&apos;m {assistantName}
                  </p>
                  <p className="text-xs text-gray-500 mt-1.5 leading-relaxed max-w-[260px] mx-auto">
                    Let me get a few details from you so your lawyer comes better prepared to speak with you.
                  </p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    Automated assistant, not a lawyer.
                  </p>
                </div>
              </div>

              {/* Welcome-back banner */}
              {resumeSessionId && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-blue-700 leading-relaxed">
                    Welcome back. You have an unfinished intake.
                  </p>
                  <button
                    onClick={handleResume}
                    className="text-xs font-semibold text-blue-700 underline whitespace-nowrap hover:text-blue-900 transition-colors"
                  >
                    Resume
                  </button>
                </div>
              )}

              {/* Intent routing buttons */}
              <div className="space-y-2">
                <button
                  onClick={() => handleIntentSelect("help")}
                  className="w-full py-3 px-4 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
                  style={{ backgroundColor: accentColor }}
                >
                  I need legal help
                </button>
                <button
                  onClick={() => handleIntentSelect("question")}
                  className="w-full py-2.5 px-4 rounded-xl text-sm font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 transition-all"
                >
                  I have a general question
                </button>
                {(firmPhone || firmBookingUrl) && (
                  <button
                    onClick={() => handleIntentSelect("human")}
                    className="w-full py-2.5 px-4 rounded-xl text-sm font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 transition-all"
                  >
                    I&apos;d like to speak with someone
                  </button>
                )}
              </div>

              <Disclaimer privacyUrl={firmPrivacyUrl} />
            </div>
          )}

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
              {guidedTour && !isSkipped && (
                <p className="text-[10px] text-gray-400 flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Guided demo: watch the intake in action
                </p>
              )}
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
              <Disclaimer privacyUrl={firmPrivacyUrl} />
              <EscapeHatch firmPhone={firmPhone} firmPhoneTel={firmPhoneTel} firmBookingUrl={firmBookingUrl} />
            </div>
          )}

          {/* ── Submitting ── */}
          {step === "submitting" && <Spinner />}

          {/* ── Step 2: Branching questions ── */}
          {step === "questions" && (
            <div className="space-y-5">
              {/* Progress label */}
              <p className="text-[11px] text-gray-400 -mt-1">
                {questionRound > 1
                  ? `Round 2 of 2 — ${questions.length} additional question${questions.length !== 1 ? "s" : ""}`
                  : `${questions.length} question${questions.length !== 1 ? "s" : ""} to complete your intake`}
              </p>

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

              {guidedTour && !isSkipped ? (
                tourAction ? (
                  <button
                    onClick={handleTourAction}
                    className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] flex items-center justify-center gap-2"
                    style={{ backgroundColor: accentColor }}
                  >
                    {tourAction === "show-answers" ? "Show how the AI answered" : "Submit answers"}
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </button>
                ) : (
                  <div className="flex items-center justify-center gap-2 py-2 text-[11px] text-gray-400">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Filling in demo answers…
                  </div>
                )
              ) : (
                <button
                  onClick={handleQuestionsSubmit}
                  disabled={!allAnswered}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98]"
                  style={{ backgroundColor: accentColor }}
                >
                  Continue
                </button>
              )}
              <Disclaimer privacyUrl={firmPrivacyUrl} />
              <EscapeHatch firmPhone={firmPhone} firmPhoneTel={firmPhoneTel} firmBookingUrl={firmBookingUrl} />
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
              <Disclaimer privacyUrl={firmPrivacyUrl} />
              <EscapeHatch firmPhone={firmPhone} firmPhoneTel={firmPhoneTel} firmBookingUrl={firmBookingUrl} />
            </div>
          )}

          {/* ── OTP verification ── */}
          {step === "otp" && (
            <div className="space-y-5">
              <p className="text-sm text-gray-600 leading-relaxed">
                We sent a 6-digit code to{" "}
                <span className="font-medium text-gray-800">{contact.email}</span>. Enter it below to
                view your case review.
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

          {/* ── Round 3: Post-capture deep qualification ── */}
          {step === "round3" && (
            <div className="space-y-5">
              {/* Transition card — positioning line */}
              <div
                className="rounded-xl px-4 py-4 space-y-1"
                style={{ backgroundColor: `${accentColor}0f`, borderLeft: `3px solid ${accentColor}` }}
              >
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: accentColor }}>
                  Step 3 of 3
                </p>
                <p className="text-sm font-medium text-gray-800 leading-snug">
                  Rounds 1 and 2 decide whether to take the meeting.
                </p>
                <p className="text-sm text-gray-700 leading-snug">
                  Round 3 decides how your lawyer walks into the meeting prepared.
                </p>
                <p className="text-[11px] text-gray-400 pt-1">
                  Information you share is confidential under Ontario law, even if you do not retain this firm.
                </p>
              </div>

              <p className="text-[11px] text-gray-400 -mt-1">
                {round3Questions.length} question{round3Questions.length !== 1 ? "s" : ""} — your answers go directly to your lawyer before the call
              </p>

              {round3Questions.map(q => (
                <div key={q.id} className="space-y-2">
                  <p className="text-sm font-medium text-gray-800">{q.text}</p>

                  {/* Structured multi-select */}
                  {q.type === "structured_multi" && q.options && (
                    <div className="flex flex-wrap gap-2">
                      {q.options.map(opt => {
                        const selected = Array.isArray(round3Answers[q.id])
                          ? (round3Answers[q.id] as string[]).includes(opt.value)
                          : round3Answers[q.id] === opt.value;
                        return (
                          <button
                            key={opt.value}
                            onClick={() => selectRound3Answer(q.id, opt.value, q.allow_multi_select)}
                            className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all text-left ${
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
                  )}

                  {/* Structured single-select */}
                  {q.type === "structured_single" && q.options && (
                    <div className="flex flex-wrap gap-2">
                      {q.options.map(opt => {
                        const selected = round3Answers[q.id] === opt.value;
                        return (
                          <button
                            key={opt.value}
                            onClick={() => selectRound3Answer(q.id, opt.value, false)}
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
                  )}

                  {/* Free text */}
                  {(q.type === "free_text" || (q.allow_free_text && q.type !== "structured_single")) && (
                    <textarea
                      value={typeof round3Answers[q.id] === "string" ? (round3Answers[q.id] as string) : ""}
                      onChange={e => setRound3Answers(prev => ({ ...prev, [q.id]: e.target.value }))}
                      placeholder={q.free_text_label ?? "Your answer…"}
                      rows={q.type === "free_text" ? 3 : 1}
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-current resize-none transition"
                    />
                  )}
                </div>
              ))}

              {apiError && (
                <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{apiError}</p>
              )}

              <button
                onClick={handleRound3Submit}
                disabled={round3Submitting}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98] flex items-center justify-center gap-2"
                style={{ backgroundColor: accentColor }}
              >
                {round3Submitting ? "Preparing your case file…" : "Complete and book my consultation"}
                {!round3Submitting && (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                )}
              </button>

              <p className="text-[11px] text-gray-400 text-center">
                Your lawyer will review this before your call — skip any question that doesn&apos;t apply.
              </p>
              <Disclaimer privacyUrl={firmPrivacyUrl} />
            </div>
          )}

          {/* ── Result ── */}
          {step === "result" && result && (
            <div className="space-y-4 pt-1">
              {/* Check icon */}
              <div className="flex justify-center">
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: `${accentColor}18` }}
                >
                  <svg
                    className="w-7 h-7"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    style={{ color: accentColor }}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>

              {/* Practice area badge */}
              {result.practice_area && (
                <div className="flex justify-center">
                  <span
                    className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold"
                    style={{ backgroundColor: `${accentColor}15`, color: accentColor }}
                  >
                    {result.practice_area}
                  </span>
                </div>
              )}

              {/* Situation summary */}
              {result.situation_summary && (
                <div className="bg-gray-50 rounded-xl px-4 py-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    Case Summary
                  </p>
                  <p className="text-sm text-gray-700 leading-relaxed">{result.situation_summary}</p>
                </div>
              )}

              {/* CTA — band-differentiated */}
              {result.cta && (() => {
                const band = result.cpi.band ?? "E";
                const style = BAND_CTA_STYLE[band] ?? BAND_CTA_STYLE["E"];
                const isBookingBand = band === "A" || band === "B";
                const isResourceBand = band === "E";

                return (
                  <div className={`rounded-xl border px-4 py-3.5 space-y-3 ${style.border}`}>
                    {/* Message row */}
                    <div className="flex items-start gap-3">
                      <svg
                        className={`w-5 h-5 mt-0.5 flex-shrink-0 ${style.icon}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        {isBookingBand ? (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        ) : isResourceBand ? (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        )}
                      </svg>
                      <p className="text-sm font-medium text-gray-800">{result.cta}</p>
                    </div>

                    {/* Booking button — Band A and B only, after Round 3 */}
                    {isBookingBand && firmBookingUrl && (
                      <a
                        href={firmBookingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
                        style={{ backgroundColor: accentColor }}
                      >
                        Your case memo is ready — book your consultation
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                      </a>
                    )}

                    {/* External resources — Band E only */}
                    {isResourceBand && (
                      <div className="flex flex-col gap-1.5 pt-1">
                        <a href="https://www.legalaid.on.ca" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                          Legal Aid Ontario
                        </a>
                        <a href="https://www.lawhelpontario.org" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                          LawHelpOntario.ca
                        </a>
                        {/* Demo: reframe E-band as a feature, not a dead end */}
                        {demoMode && (
                          <p className="text-[10px] text-gray-400 mt-1 pt-1 border-t border-gray-100">
                            In production, this inquiry is filtered here. 0 minutes of your lawyer&apos;s time.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Demo: see what the lawyer receives */}
              {demoMode && result && (
                <button
                  onClick={() => setShowLawyerPanel(true)}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] flex items-center justify-center gap-2"
                  style={{ backgroundColor: accentColor }}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  See what landed in your pipeline
                </button>
              )}

              {!demoMode && sessionId && (
                <a
                  href={`/demo/result?session=${sessionId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white text-center block transition-all hover:opacity-90 active:scale-[0.98]"
                  style={{ backgroundColor: accentColor }}
                >
                  View your case record →
                </a>
              )}

              <button
                onClick={reset}
                className="w-full py-2.5 rounded-xl text-xs font-medium text-gray-500 border border-gray-200 hover:bg-gray-50 transition-all"
              >
                Start a new inquiry
              </button>

              <Disclaimer privacyUrl={firmPrivacyUrl} />
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

      {/* Demo: Lawyer View Panel — post-finalization overlay */}
      {demoMode && result && (() => {
        const demoContact = guidedTour && demoScenario ? DEMO_CONTACTS[demoScenario] : null;
        return (
          <LawyerViewPanel
            open={showLawyerPanel}
            onClose={() => setShowLawyerPanel(false)}
            band={result.cpi.band}
            cpi={result.cpi}
            situationSummary={result.situation_summary}
            practiceArea={result.practice_area}
            contactName={contact.name.trim() || demoContact?.name || "New Lead"}
            contactEmail={contact.email.trim() || demoContact?.email}
            contactPhone={contact.phone.trim() || demoContact?.phone}
            sessionId={sessionId}
            intakeTrail={intakeTrail.length > 0 ? intakeTrail : undefined}
          />
        );
      })()}
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
