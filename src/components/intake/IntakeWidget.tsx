"use client";

/**
 * IntakeWidget  -  6-step client intake component for CaseLoad Screen.
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

interface FollowUpQuestion {
  id: string;
  text: string;
  description?: string;
  options?: Array<{ label: string; value: string }>;
  allow_free_text?: boolean;
}

interface Question {
  id: string;
  text: string;
  options: Array<{
    label: string;
    value: string;
    followUp?: FollowUpQuestion;
  }>;
  allow_free_text: boolean;
  /** One-sentence context shown as grey subtext beneath the question label. */
  description?: string;
  /** "structured" (default) = option buttons / input; "info" = contextual block, no answer required; "date" = date picker; "file" = file upload (R3-only). */
  type?: "structured" | "info" | "date" | "file";
  /** Hide this question reactively when a sibling's current answer matches. Key: sibling question ID. Value: values that suppress this question. */
  excludeWhen?: Record<string, string[]>;
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
  case_value?: { label: string; tier: string; rationale: string } | null;
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

type SubmittingStage = "initial" | "questions" | "identity" | "otp" | "resume" | "round3";

const PROCESSING_MESSAGES: Record<SubmittingStage, string[]> = {
  initial: [
    "Reading your situation…",
    "Preparing your questions…",
  ],
  questions: [
    "Reviewing your answers…",
    "Loading your next questions…",
  ],
  identity: [
    "Saving your details…",
    "Finalizing your intake…",
  ],
  otp: [
    "Verifying your code…",
    "Confirming your identity…",
  ],
  resume: [
    "Picking up where you left off…",
    "Restoring your session…",
  ],
  round3: [
    "Building your case file…",
    "Preparing your evidence checklist…",
    "Finalizing your submission…",
  ],
};

function Spinner({ stage = "initial" }: { stage?: SubmittingStage }) {
  const messages = PROCESSING_MESSAGES[stage] ?? PROCESSING_MESSAGES.initial;
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
    const t = setInterval(
      () => setIdx(i => (i + 1) % messages.length),
      1400,
    );
    return () => clearInterval(t);
  }, [messages]);
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      <div
        className="w-10 h-10 border-2 border-gray-200 border-t-current rounded-full animate-spin"
        style={{ borderTopColor: "var(--accent)" }}
      />
      <p className="text-sm text-gray-500 transition-all duration-300">{messages[idx]}</p>
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
   * Demo mode  -  skips OTP, suppresses GHL delivery, shows LawyerViewPanel
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
   * Guided tour mode  -  when true, the widget plays through the scenario with
   * phantom typing and auto-advancing, simulating a real user session.
   * Used by the DemoLandingPage scenario chips. Requires demoScenario to be set.
   */
  guidedTour?: boolean;
}

// Pre-loaded scenario messages (mirrors DEMO_SCENARIOS in demo-scenarios.ts)
const SCENARIO_MESSAGES: Record<string, string> = {
  pi_strong:
    "I was rear-ended on the 401 about three weeks ago. The other driver hit me from behind at highway speed. I've been seeing a doctor since.",
  slip_fall:
    "I slipped at a grocery store two weeks ago and hurt my knee badly. There was a spill on the floor and no warning sign. I went to the ER that same day.",
  emp_dismissal:
    "My employer terminated me last Friday. I was there for 4 years. They gave me 2 weeks severance and said it was restructuring.",
  emp_wage:
    "My employer hasn't paid me overtime for the past 8 months even though I work 55-hour weeks. I have records of all my hours.",
  imm_spousal:
    "I am marrying a Canadian citizen next month and we want to apply for spousal sponsorship so I can stay in Canada.",
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
  slip_fall: {
    name: "Marcus Torres",
    email: "m.torres@hotmail.com",
    phone: "+1 (647) 555-8820",
  },
  emp_dismissal: {
    name: "Daniel Chen",
    email: "d.chen@outlook.com",
    phone: "+1 (647) 555-0192",
  },
  emp_wage: {
    name: "Priya Sharma",
    email: "priya.sharma@gmail.com",
    phone: "+1 (416) 555-4471",
  },
  imm_spousal: {
    name: "Carlos Melo",
    email: "carlos.melo@gmail.com",
    phone: "+1 (905) 555-7738",
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
        { id: "timing", text: "When did the accident happen?", allow_free_text: false,
          description: "This affects the limitation period and the urgency of your claim.",
          options: [
            { label: "Within the past week", value: "within_week" },
            { label: "Within the past month", value: "within_month" },
            { label: "1 to 6 months ago", value: "1_6_months" },
            { label: "Over 6 months ago", value: "over_6_months" },
          ]},
        { id: "treatment", text: "Are you currently receiving medical treatment?", allow_free_text: false, options: [
            { label: "Yes, ongoing treatment", value: "yes_ongoing",
              followUp: { id: "treatment_type", text: "What type of treatment are you receiving?",
                options: [
                  { label: "Physiotherapy", value: "physio" },
                  { label: "Specialist or surgeon", value: "specialist" },
                  { label: "Chiropractic or massage", value: "chiro" },
                  { label: "Multiple providers", value: "multiple" },
                ],
              },
            },
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
        { id: "incident_date", text: "What was the date of the accident?", type: "date" as const,
          allow_free_text: false, options: [],
          description: "Exact date helps confirm the limitation period for your claim." },
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
        { id: "pre_existing", text: "Any pre-existing conditions affecting the same area of the body?", allow_free_text: false,
          description: "Prior injuries to the same body part change how damages are calculated.",
          options: [
            { label: "No prior injuries to that area", value: "none" },
            { label: "Yes, with documented recovery", value: "recovered" },
            { label: "Yes, still being treated", value: "ongoing" },
          ]},
        { id: "medical_report", text: "Has a medical-legal report been ordered or completed?", allow_free_text: false, options: [
          { label: "Yes, already completed", value: "completed" },
          { label: "Ordered but not yet received", value: "ordered" },
          { label: "Not yet discussed", value: "none" },
        ]},
      ],
      cpi: EMPTY_TOUR_CPI, response_text: "Thank you. A few more questions and the assessment will be complete.",
      finalize: false, collect_identity: false, situation_summary: null, cta: null,
      flags: [], value_tier: null, prior_experience: null,
    },
    // Finalize  -  Band A
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
      case_value: { label: "$85,000 – $240,000", tier: "high", rationale: "Highway collision with documented injuries, significant income loss, and clear liability." },
    },
  ],

  slip_fall: [
    // Round 1 questions  -  pi_slip_fall bank (NOT MVA questions)
    {
      session_id: "demo-sf", practice_area: "Personal Injury",
      practice_area_confidence: "high", next_question: null,
      next_questions: [
        { id: "sf_timing", text: "When did the incident happen?", allow_free_text: false,
          description: "Slip and fall claims in Ontario have strict notice deadlines. Timing is critical.",
          options: [
            { label: "Within the past week", value: "within_week" },
            { label: "Within the past month", value: "within_month" },
            { label: "1 to 6 months ago", value: "1_6_months" },
            { label: "Over 6 months ago", value: "over_6_months" },
          ]},
        { id: "sf_reported", text: "Was the incident reported to the property owner or store manager at the time?", allow_free_text: false, options: [
          { label: "Yes, reported immediately", value: "yes" },
          { label: "Reported later", value: "later" },
          { label: "Not reported", value: "no" },
        ]},
        { id: "sf_treatment", text: "Have you received medical treatment for your injuries?", allow_free_text: false, options: [
          { label: "Yes, same day or next day", value: "yes_immediate",
            followUp: { id: "sf_treatment_type", text: "Where did you receive treatment?",
              options: [
                { label: "Emergency room", value: "er" },
                { label: "Walk-in clinic", value: "clinic" },
                { label: "Family doctor", value: "family_doctor" },
                { label: "Multiple providers", value: "multiple" },
              ],
            },
          },
          { label: "Sought treatment later", value: "yes_delayed" },
          { label: "Not yet", value: "no" },
        ]},
      ],
      cpi: EMPTY_TOUR_CPI, response_text: "I'm sorry to hear about your injury. A few more questions will help assess your claim.",
      finalize: false, collect_identity: false, situation_summary: null, cta: null,
      flags: [], value_tier: null, prior_experience: null,
    },
    // Round 2 questions
    {
      session_id: "demo-sf", practice_area: "Personal Injury",
      practice_area_confidence: "high", next_question: null,
      next_questions: [
        { id: "sf_incident_date", text: "What was the date of the slip and fall?", type: "date" as const,
          allow_free_text: false, options: [],
          description: "Exact date is required for municipal notice obligations." },
        { id: "sf_hazard", text: "Was there any warning sign or barrier near the hazard?", allow_free_text: false, options: [
          { label: "No sign or barrier at all", value: "none" },
          { label: "Sign was present but inadequate", value: "inadequate" },
          { label: "Sign was there, I didn't see it", value: "did_not_see" },
        ]},
        { id: "sf_witness", text: "Were there any witnesses to the incident?", allow_free_text: false, options: [
          { label: "Yes, at least one witness", value: "yes" },
          { label: "Possibly, but I didn't get contact info", value: "possible" },
          { label: "No witnesses", value: "no" },
        ]},
        { id: "sf_photos", text: "Were photographs taken of the hazard at the time?", allow_free_text: false,
          description: "Photos of the exact conditions are often decisive in slip and fall claims.",
          options: [
            { label: "Yes, I have photos", value: "yes" },
            { label: "Someone else has photos", value: "third_party" },
            { label: "No photos exist", value: "no" },
          ]},
        { id: "sf_property", text: "Where did the incident happen?", allow_free_text: false, options: [
          { label: "Private business or commercial property", value: "commercial" },
          { label: "Residential or condo property", value: "residential" },
          { label: "Municipal property (sidewalk, park)", value: "municipal" },
        ]},
      ],
      cpi: EMPTY_TOUR_CPI, response_text: "Almost done. A few more questions to complete the picture.",
      finalize: false, collect_identity: false, situation_summary: null, cta: null,
      flags: [], value_tier: null, prior_experience: null,
    },
    // Finalize  -  Band B
    {
      session_id: "demo-sf", practice_area: "Personal Injury",
      practice_area_confidence: "high", next_question: null, next_questions: null,
      cpi: { total: 76, band: "B", fit_score: 30, value_score: 46, band_locked: true,
        geo_score: 10, practice_score: 9, legitimacy_score: 8, referral_score: 3,
        urgency_score: 16, complexity_score: 19, multi_practice_score: 2, fee_score: 9 },
      response_text: "Your case has solid liability indicators: no warning sign, prompt ER treatment, and the incident was reported. Damages will determine the final value.",
      finalize: true, collect_identity: false,
      situation_summary: "Client slipped on an unmarked spill at a grocery store two weeks ago and sustained a knee injury requiring emergency treatment. No warning sign was present at the time of the incident. Incident was reported to the store. Liability grounds are sound; recoverable damages hinge on medical progression and income impact.",
      cta: "Your case has been rated Band B. A lawyer will review and be in touch within 4 hours.",
      flags: ["no_warning_sign", "er_treatment", "incident_reported"],
      value_tier: "medium", prior_experience: null,
      case_value: { label: "$35,000 – $120,000", tier: "medium", rationale: "Slip and fall with documented ER visit, no warning sign, and reported incident. Value depends on extent of knee injury and income impact." },
    },
  ],

  emp_dismissal: [
    // Round 1 questions  -  emp_dismissal bank
    {
      session_id: "demo-emp", practice_area: "Employment Law",
      practice_area_confidence: "high", next_question: null,
      next_questions: [
        { id: "cause", text: "Were you given a written reason for the termination?", allow_free_text: false,
          description: "The stated reason affects which legal theories apply and how strong your claim is.",
          options: [
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
    // Round 2 questions
    {
      session_id: "demo-emp", practice_area: "Employment Law",
      practice_area_confidence: "high", next_question: null,
      next_questions: [
        { id: "signed_docs", text: "Were you asked to sign anything at termination  -  a release or separation agreement?", allow_free_text: false,
          description: "Signing a release without legal advice can limit your options significantly.",
          options: [
            { label: "Yes, I signed something", value: "signed" },
            { label: "I was asked but declined", value: "declined" },
            { label: "Nothing was presented", value: "nothing" },
          ]},
        { id: "role", text: "What was your role at the company?", allow_free_text: false, options: [
          { label: "Individual contributor or specialist", value: "individual" },
          { label: "Manager or team lead", value: "manager" },
          { label: "Director or executive", value: "executive" },
        ]},
        { id: "income_now", text: "What is your current income situation since the termination?", allow_free_text: false, options: [
          { label: "Currently without income", value: "no_income" },
          { label: "Receiving Employment Insurance", value: "ei" },
          { label: "Started new employment", value: "new_job" },
        ]},
        { id: "written_notice", text: "Did you receive any written communication about the termination?", allow_free_text: false,
          description: "A written termination letter or email materially affects how the claim is framed.",
          options: [
            { label: "Yes, a written letter or email", value: "written" },
            { label: "Verbal notice only", value: "verbal" },
            { label: "I have not received anything in writing", value: "none" },
          ]},
        { id: "protected_ground", text: "Do you believe the termination relates to a protected ground (for example age, gender, disability, leave, or complaint made)?", allow_free_text: false, options: [
          { label: "Yes, I believe so", value: "yes" },
          { label: "I am not sure", value: "unsure" },
          { label: "No, I don't think so", value: "no" },
        ]},
      ],
      cpi: EMPTY_TOUR_CPI, response_text: "Almost there. A few more details to complete the picture.",
      finalize: false, collect_identity: false, situation_summary: null, cta: null,
      flags: [], value_tier: null, prior_experience: null,
    },
    // Finalize  -  Band C
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
      case_value: { label: "$25,000 – $60,000", tier: "medium", rationale: "Four years tenure with statutory minimum severance; common law notice period likely underserved." },
    },
  ],

  emp_wage: [
    // Round 1 questions  -  emp_wage bank (employment status gap)
    {
      session_id: "demo-ew", practice_area: "Employment Law",
      practice_area_confidence: "high", next_question: null,
      next_questions: [
        { id: "ew_status", text: "What is your current employment relationship with this employer?", allow_free_text: false,
          description: "Employment status affects which overtime rules apply and what remedies are available.",
          options: [
          { label: "Full-time employee", value: "full_time" },
          { label: "Part-time employee", value: "part_time" },
          { label: "Contract or temp worker", value: "contract" },
          { label: "I'm not sure how I'm classified", value: "unsure" },
        ]},
        { id: "ew_duration", text: "How long has the unpaid overtime been occurring?", allow_free_text: false, options: [
          { label: "Less than 3 months", value: "under_3mo" },
          { label: "3 to 12 months", value: "3_12_months" },
          { label: "Over 12 months", value: "over_12mo" },
        ]},
        { id: "ew_records", text: "Do you have records of the hours worked?", allow_free_text: false, options: [
          { label: "Yes, detailed records", value: "yes_detailed" },
          { label: "Partial records", value: "partial" },
          { label: "No records", value: "no" },
        ]},
      ],
      cpi: EMPTY_TOUR_CPI, response_text: "Unpaid overtime is a serious matter. Let me gather a few more details.",
      finalize: false, collect_identity: false, situation_summary: null, cta: null,
      flags: [], value_tier: null, prior_experience: null,
    },
    // Round 2 questions
    {
      session_id: "demo-ew", practice_area: "Employment Law",
      practice_area_confidence: "high", next_question: null,
      next_questions: [
        { id: "ew_rate", text: "What is your approximate hourly rate or annual salary?", allow_free_text: false,
          description: "This determines the total value of your overtime claim.",
          options: [
            { label: "Under $20/hour (or under $40,000/year)", value: "low" },
            { label: "$20 to $40/hour (or $40,000 to $80,000/year)", value: "mid" },
            { label: "Over $40/hour (or over $80,000/year)", value: "high" },
          ]},
        { id: "ew_raised", text: "Have you raised the overtime issue with your employer or HR?", allow_free_text: false, options: [
          { label: "Yes, in writing", value: "yes_written" },
          { label: "Yes, verbally only", value: "yes_verbal" },
          { label: "No, I have not raised it", value: "no" },
        ]},
        { id: "ew_others", text: "Are there other employees in your workplace in the same situation?", allow_free_text: false, options: [
          { label: "Yes, I know of others", value: "yes" },
          { label: "Possibly", value: "possibly" },
          { label: "No  -  this appears to be my situation alone", value: "no" },
        ]},
        { id: "ew_role_type", text: "Which best describes the kind of work you do?", allow_free_text: false,
          description: "Some roles are exempt from standard overtime rules under the ESA.",
          options: [
            { label: "Hourly, non-supervisory work", value: "hourly" },
            { label: "Supervisory or managerial duties", value: "supervisor" },
            { label: "Professional (IT, engineering, etc.)", value: "professional" },
          ]},
        { id: "ew_employer_response", text: "When you raised the issue, how did the employer respond?", allow_free_text: false, options: [
          { label: "Promised to fix it but nothing happened", value: "promised" },
          { label: "Refused outright", value: "refused" },
          { label: "I haven't raised it yet", value: "not_raised" },
        ]},
      ],
      cpi: EMPTY_TOUR_CPI, response_text: "A few more details and we will have everything needed to assess your claim.",
      finalize: false, collect_identity: false, situation_summary: null, cta: null,
      flags: [], value_tier: null, prior_experience: null,
    },
    // Finalize  -  Band B
    {
      session_id: "demo-ew", practice_area: "Employment Law",
      practice_area_confidence: "high", next_question: null, next_questions: null,
      cpi: { total: 78, band: "B", fit_score: 31, value_score: 47, band_locked: true,
        geo_score: 9, practice_score: 10, legitimacy_score: 8, referral_score: 4,
        urgency_score: 14, complexity_score: 20, multi_practice_score: 2, fee_score: 11 },
      response_text: "Eight months of documented unpaid overtime is a strong Employment Standards Act claim with clear evidence of hours worked.",
      finalize: true, collect_identity: false,
      situation_summary: "Client has worked 55-hour weeks for 8 months without overtime pay. Detailed records of hours worked are available. As a full-time employee, standard Ontario overtime rules apply. The combination of duration, documentation, and consistent employer conduct strengthens the claim substantially.",
      cta: "Your case has been rated Band B. A lawyer will review and be in touch within 4 hours.",
      flags: ["documented_hours", "esa_violation", "extended_duration"],
      value_tier: "medium_high", prior_experience: null,
      case_value: { label: "$18,000 – $55,000", tier: "medium", rationale: "Eight months of unpaid overtime at 55-hour weeks with documented records. Value depends on hourly rate and whether employer is subject to ESA overtime exemptions." },
    },
  ],

  imm_spousal: [
    // Round 1 questions  -  imm_spousal bank (current immigration status gap)
    {
      session_id: "demo-imm", practice_area: "Immigration Law",
      practice_area_confidence: "high", next_question: null,
      next_questions: [
        { id: "imm_status", text: "What is your current immigration status in Canada?", allow_free_text: false,
          description: "Your current status determines which sponsorship pathway applies and how urgently you need to act.",
          options: [
          { label: "Visitor or tourist visa", value: "visitor" },
          { label: "Study permit", value: "study_permit" },
          { label: "Work permit", value: "work_permit" },
          { label: "No current status (overstayed)", value: "no_status" },
          { label: "Permanent resident", value: "pr" },
        ]},
        { id: "imm_timeline", text: "When is the marriage taking place?", allow_free_text: false, options: [
          { label: "Within the next month", value: "within_month" },
          { label: "1 to 3 months", value: "1_3_months" },
          { label: "3 to 6 months", value: "3_6_months" },
          { label: "More than 6 months away", value: "over_6_months" },
        ]},
        { id: "imm_prior", text: "Have you had any prior immigration applications in Canada?", allow_free_text: false, options: [
          { label: "No prior applications", value: "none" },
          { label: "Yes, approved", value: "approved" },
          { label: "Yes, refused", value: "refused" },
        ]},
      ],
      cpi: EMPTY_TOUR_CPI, response_text: "Congratulations on your upcoming marriage. Let me ask a few questions to assess your sponsorship options.",
      finalize: false, collect_identity: false, situation_summary: null, cta: null,
      flags: [], value_tier: null, prior_experience: null,
    },
    // Round 2 questions
    {
      session_id: "demo-imm", practice_area: "Immigration Law",
      practice_area_confidence: "high", next_question: null,
      next_questions: [
        { id: "imm_relationship", text: "How long have you and your partner been together?", allow_free_text: false,
          description: "IRCC assesses the genuineness of the relationship. Length and documentation both matter.",
          options: [
            { label: "Less than 1 year", value: "under_1yr" },
            { label: "1 to 2 years", value: "1_2_yrs" },
            { label: "More than 2 years", value: "over_2yrs" },
          ]},
        { id: "imm_cohabiting", text: "Are you currently living with your partner?", allow_free_text: false, options: [
          { label: "Yes, living together", value: "yes" },
          { label: "No, living separately", value: "no" },
          { label: "Partly  -  some time together, some apart", value: "partial" },
        ]},
        { id: "imm_sponsor_status", text: "Is your partner (the sponsor) a Canadian citizen or permanent resident?", allow_free_text: false, options: [
          { label: "Canadian citizen", value: "citizen" },
          { label: "Permanent resident", value: "pr" },
          { label: "I'm not certain", value: "unsure" },
        ]},
        { id: "imm_status_expiry", text: "When does your current status in Canada expire?", allow_free_text: false,
          description: "Expiry timing drives whether an inland or outland application is safer.",
          options: [
            { label: "Within 3 months", value: "under_3mo" },
            { label: "3 to 12 months", value: "3_12mo" },
            { label: "Over 12 months or permanent", value: "over_12mo" },
          ]},
        { id: "imm_dependants", text: "Are there any children or other dependants to include in the application?", allow_free_text: false, options: [
          { label: "Yes, children under 22", value: "children" },
          { label: "Yes, other dependants", value: "other" },
          { label: "No dependants", value: "none" },
        ]},
      ],
      cpi: EMPTY_TOUR_CPI, response_text: "Thank you. A few more details to help us map the right pathway for you.",
      finalize: false, collect_identity: false, situation_summary: null, cta: null,
      flags: [], value_tier: null, prior_experience: null,
    },
    // Finalize  -  Band B
    {
      session_id: "demo-imm", practice_area: "Immigration Law",
      practice_area_confidence: "high", next_question: null, next_questions: null,
      cpi: { total: 75, band: "B", fit_score: 32, value_score: 43, band_locked: true,
        geo_score: 10, practice_score: 10, legitimacy_score: 8, referral_score: 4,
        urgency_score: 15, complexity_score: 12, multi_practice_score: 2, fee_score: 14 },
      response_text: "Spousal sponsorship is a clear immigration pathway in your situation. The timeline is tight and early preparation will be important.",
      finalize: true, collect_identity: false,
      situation_summary: "Client is marrying a Canadian citizen next month and seeks spousal sponsorship to remain in Canada. Currently on a work permit with no prior refused applications. The upcoming marriage triggers urgency given permit expiry timelines. Inland or outland application should be assessed based on status expiry.",
      cta: "Your case has been rated Band B. A lawyer will review and be in touch within 4 hours.",
      flags: ["upcoming_marriage", "status_expiry_risk", "strong_sponsorship_basis"],
      value_tier: "medium", prior_experience: null,
      case_value: { label: "Fixed fee: $3,500 – $6,000", tier: "medium", rationale: "Spousal sponsorship with Canadian citizen sponsor. No prior refusals. Complexity depends on inland vs outland pathway and document completeness." },
    },
  ],

  small_claims: [
    // Round 1  -  one question
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
    // Finalize  -  Band E
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

// Round 3 questions shown in the guided demo — scenario-specific deep qualification.
// These match the question banks in round3.ts but are pre-selected per scenario
// so each demo shows the correct practice-area questions without subtype inference.
const TOUR_ROUND3_FIXTURES: Record<string, Round3Question[]> = {
  pi_strong: [
    {
      id: "pi_mva_q1", category: "jurisdiction_limitations",
      text: "When did the accident happen? Please give the date as precisely as you can.",
      type: "free_text", memo_label: "Incident date / Limitations status",
    },
    {
      id: "pi_mva_q2", category: "fact_pattern",
      text: "In your own words, describe how the collision happened. Who was involved, how many vehicles, and what was each vehicle doing at the moment of impact?",
      type: "free_text", memo_label: "Collision description / Fault indicators",
    },
    {
      id: "pi_mva_q3", category: "evidence_inventory",
      text: "Did police attend the scene? Do you have the collision report number? Did an ambulance attend, and were you transported to hospital?",
      type: "structured_multi",
      options: [
        { label: "Police attended  -  I have the report number", value: "police_report_number" },
        { label: "Police attended  -  I haven't requested the report yet", value: "police_no_request" },
        { label: "Ambulance attended  -  I was taken to hospital", value: "ambulance_transported" },
        { label: "No ambulance", value: "no_ambulance" },
      ],
      allow_multi_select: true, allow_free_text: true,
      free_text_label: "Report number (if known)",
      memo_label: "Evidence held: Police / EMS",
    },
    {
      id: "pi_mva_q4", category: "evidence_inventory",
      text: "What medical treatment have you received since the accident?",
      type: "structured_multi",
      options: [
        { label: "Emergency room / hospital", value: "emergency_room" },
        { label: "Family doctor", value: "family_doctor" },
        { label: "Orthopaedic specialist", value: "orthopaedic" },
        { label: "Physiotherapy", value: "physiotherapy" },
        { label: "Psychologist / counsellor", value: "psychologist" },
        { label: "No treatment received yet", value: "no_treatment" },
      ],
      allow_multi_select: true, allow_free_text: true,
      free_text_label: "Any other treatment not listed",
      memo_label: "Medical treatment received / Records held",
    },
    {
      id: "pi_mva_q6", category: "fact_pattern_depth",
      text: "Has the accident affected your ability to work? If yes, are you employed, self-employed, or a student? Have you lost income, and do you have documentation of that loss?",
      type: "free_text", memo_label: "Employment impact / Income loss documentation",
    },
    {
      id: "pi_mva_q7", category: "conflict_and_parties",
      text: "Please give me the full legal name of the other driver, if you know it. Do you know if they have retained a lawyer?",
      type: "free_text", memo_label: "Adverse parties / Opposing counsel",
    },
    {
      id: "pi_mva_q8", category: "expectations_alignment",
      text: "Have you spoken with any other lawyer about this accident? What outcome are you hoping for, and is there a specific timeline driving your decision to reach out now?",
      type: "free_text", memo_label: "Prior counsel / Client expectations and urgency",
    },
  ],

  slip_fall: [
    {
      id: "pi_mva_q1", category: "jurisdiction_limitations",
      text: "What is the exact date of the incident? Please give it as precisely as you can.",
      type: "free_text", memo_label: "Incident date / Limitations and notice obligations",
    },
    {
      id: "pi_mva_q2", category: "fact_pattern",
      text: "Describe in your own words exactly what happened  -  where you were, what you were doing, and how the fall occurred.",
      type: "free_text", memo_label: "Fact pattern / Liability basis",
    },
    {
      id: "pi_mva_q3", category: "evidence_inventory",
      text: "What evidence exists from the scene or immediately after the incident?",
      type: "structured_multi",
      options: [
        { label: "Photographs of the hazard taken at the scene", value: "photos_scene" },
        { label: "Photographs of my injuries", value: "photos_injuries" },
        { label: "Written incident report obtained from store", value: "incident_report" },
        { label: "Names or contact info of witnesses", value: "witness_info" },
        { label: "Security camera footage preserved or requested", value: "cctv" },
      ],
      allow_multi_select: true, allow_free_text: true,
      free_text_label: "Anything else",
      memo_label: "Scene evidence held",
    },
    {
      id: "pi_mva_q4", category: "evidence_inventory",
      text: "What medical treatment have you received since the fall?",
      type: "structured_multi",
      options: [
        { label: "Emergency room  -  same day", value: "er_same_day" },
        { label: "Family doctor", value: "family_doctor" },
        { label: "Orthopaedic specialist", value: "orthopaedic" },
        { label: "Physiotherapy", value: "physiotherapy" },
        { label: "No formal treatment yet", value: "no_treatment" },
      ],
      allow_multi_select: true, allow_free_text: true,
      free_text_label: "Any other treatment",
      memo_label: "Medical treatment received",
    },
    {
      id: "pi_mva_q6", category: "fact_pattern_depth",
      text: "Has the injury affected your ability to work or your daily life? Have you lost income as a result?",
      type: "free_text", memo_label: "Functional impact / Income loss",
    },
    {
      id: "pi_mva_q8", category: "expectations_alignment",
      text: "Have you spoken with any other lawyer about this matter? What outcome are you hoping for, and is there a specific timeline or urgency driving your decision to reach out now?",
      type: "free_text", memo_label: "Prior counsel / Client expectations",
    },
  ],

  emp_dismissal: [
    {
      id: "emp_dis_q1", category: "jurisdiction_limitations",
      text: "When did your employment start, and when were you terminated? Please give dates as precisely as you can.",
      type: "free_text", memo_label: "Employment tenure / Limitations analysis",
    },
    {
      id: "emp_dis_q2", category: "fact_pattern",
      text: "What was your job title and a brief description of your main responsibilities? Were you in a management or supervisory role?",
      type: "free_text", memo_label: "Role and seniority / Character of employment",
    },
    {
      id: "emp_dis_q3", category: "evidence_inventory",
      text: "Which of the following documents do you currently have?",
      type: "structured_multi",
      options: [
        { label: "Written employment contract or offer letter", value: "employment_contract" },
        { label: "Termination letter or written notice", value: "termination_letter" },
        { label: "Severance or separation agreement (signed or unsigned)", value: "separation_agreement" },
        { label: "Performance reviews or written evaluations", value: "performance_reviews" },
        { label: "Relevant emails or internal communications", value: "internal_emails" },
        { label: "Pay stubs for the relevant period", value: "paystubs" },
      ],
      allow_multi_select: true,
      memo_label: "Documents held",
    },
    {
      id: "emp_dis_q4", category: "fact_pattern_depth",
      text: "Were there any HR complaints, grievances, or workplace disputes before your termination? Did you raise any concerns with your employer?",
      type: "free_text", memo_label: "Pre-termination complaints / Reprisal indicators",
    },
    {
      id: "emp_dis_q6", category: "fact_pattern_depth",
      text: "What is your current income situation since the termination? Are you working, receiving EI, or currently without income?",
      type: "free_text", memo_label: "Mitigation / Current income status",
    },
    {
      id: "emp_dis_q7", category: "expectations_alignment",
      text: "Have you consulted any other lawyer about this matter? What outcome are you hoping for, and is there a specific deadline driving your decision to reach out now?",
      type: "free_text", memo_label: "Prior counsel / Client expectations and urgency",
    },
  ],

  emp_wage: [
    {
      id: "emp_wage_q1", category: "jurisdiction_limitations",
      text: "When did the unpaid overtime begin? Please give the start date as precisely as you can, and confirm whether you are still employed at this company.",
      type: "free_text", memo_label: "Claim period / Current employment status",
    },
    {
      id: "emp_wage_q2", category: "fact_pattern",
      text: "What is your hourly or annual salary? Approximately how many hours per week were you working during the period of unpaid overtime?",
      type: "free_text", memo_label: "Compensation details / Overtime calculation basis",
    },
    {
      id: "emp_wage_q3", category: "evidence_inventory",
      text: "Which of the following do you currently have?",
      type: "structured_multi",
      options: [
        { label: "Written employment contract or offer letter", value: "employment_contract" },
        { label: "Timesheets, schedules, or personal hours records", value: "hours_records" },
        { label: "Pay stubs or direct deposit records for the period", value: "paystubs" },
        { label: "Emails or messages about hours or workload", value: "communications" },
        { label: "Any written response from your employer about overtime", value: "employer_response" },
      ],
      allow_multi_select: true,
      memo_label: "Documents and evidence held",
    },
    {
      id: "emp_wage_q4", category: "fact_pattern_depth",
      text: "Have you raised the overtime issue with your employer, HR, or a manager? If yes, what was the response, and was anything communicated in writing?",
      type: "free_text", memo_label: "Internal complaint history / Employer response",
    },
    {
      id: "emp_wage_q5", category: "conflict_and_parties",
      text: "Are there other employees in your workplace who have experienced the same unpaid overtime situation?",
      type: "structured_single",
      options: [
        { label: "Yes, I know of others in the same situation", value: "yes_others" },
        { label: "Possibly  -  I haven't discussed it with colleagues", value: "possibly" },
        { label: "No  -  this appears to be my situation alone", value: "no" },
      ],
      memo_label: "Class action potential / Other affected employees",
    },
    {
      id: "emp_wage_q6", category: "expectations_alignment",
      text: "Have you consulted any other lawyer about this? What outcome are you hoping for, and is there any deadline or urgency driving your decision to act now?",
      type: "free_text", memo_label: "Prior counsel / Client expectations and urgency",
    },
  ],

  imm_spousal: [
    {
      id: "imm_sp_q1", category: "jurisdiction_limitations",
      text: "What type of permit or status do you currently hold, and when does it expire? Please give the exact expiry date if you have it available.",
      type: "free_text", memo_label: "Current status / Expiry date / Pathway urgency",
    },
    {
      id: "imm_sp_q2", category: "fact_pattern",
      text: "When did you and your partner meet? How long have you been together, and are you currently living together?",
      type: "free_text", memo_label: "Relationship timeline / Cohabitation history",
    },
    {
      id: "imm_sp_q3", category: "evidence_inventory",
      text: "Which of the following relationship documents do you currently have?",
      type: "structured_multi",
      options: [
        { label: "Photographs together (at different times and locations)", value: "photos" },
        { label: "Joint lease or mortgage documents", value: "joint_lease" },
        { label: "Shared utility or bank accounts", value: "shared_accounts" },
        { label: "Travel records together (flights, hotel, etc.)", value: "travel_records" },
        { label: "Communications (messages, emails, call records)", value: "communications" },
        { label: "Statutory declarations from friends or family", value: "statutory_declarations" },
      ],
      allow_multi_select: true,
      memo_label: "Relationship evidence inventory",
    },
    {
      id: "imm_sp_q4", category: "fact_pattern_depth",
      text: "Tell me about the sponsor. Are they a Canadian citizen or permanent resident? How long have they lived in Canada? Have they sponsored anyone before?",
      type: "free_text", memo_label: "Sponsor eligibility / Prior undertakings",
    },
    {
      id: "imm_sp_q5", category: "fact_pattern_depth",
      text: "Have you ever been refused a visa or immigration application in Canada or any other country? Have you ever had an enforcement action in any country?",
      type: "structured_single",
      options: [
        { label: "No refusals or enforcement history", value: "none" },
        { label: "One refusal  -  no enforcement history", value: "one_refusal" },
        { label: "Multiple refusals", value: "multiple_refusals" },
        { label: "I have had an enforcement action", value: "enforcement" },
        { label: "I prefer to discuss this with the lawyer directly", value: "prefer_not" },
      ],
      memo_label: "Immigration history / Refusals / Enforcement",
    },
    {
      id: "imm_sp_q7", category: "evidence_inventory",
      text: "Do you have a valid passport, and when does it expire? Are there any criminality or health issues that could affect your admissibility?",
      type: "free_text", memo_label: "Passport validity / Admissibility flags",
    },
    {
      id: "imm_sp_q8", category: "expectations_alignment",
      text: "Have you consulted any other immigration lawyer or consultant about this? What is your most important priority right now  -  speed, cost, or certainty  -  and is there a hard deadline we need to plan around?",
      type: "free_text", memo_label: "Prior counsel / Client priorities and timeline",
    },
  ],

  // small_claims: Band E, no Round 3
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
  const [submittingStage, setSubmittingStage] = useState<SubmittingStage>("initial");
  const goSubmitting = (stage: SubmittingStage) => {
    setSubmittingStage(stage);
    setStep("submitting");
  };

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
  const [fileUploadState, setFileUploadState] = useState<Record<string, { status: "idle" | "uploading" | "done" | "error"; filename?: string; error?: string }>>({});

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
      // localStorage unavailable (private mode, etc.)  -  ignore silently
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
      // ignore  -  not critical
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
  // Skipped when guidedTour is true  -  guided tour handles its own sequencing.
  useEffect(() => {
    if (!demoMode || !demoScenario || autoSentRef.current || guidedTour) return;
    const msg = SCENARIO_MESSAGES[demoScenario];
    if (!msg) return;
    autoSentRef.current = true;

    const delay = setTimeout(async () => {
      goSubmitting("initial");
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

  // Derived state  -  declared early so guided tour useEffects can reference allAnswered
  const allAnswered = questions.length > 0 && questions.filter(q => q.type !== "info").every(q => {
    if (!answers[q.id]) return false;
    // If the selected option has a follow-up, that follow-up must also be answered.
    const selectedOpt = q.options.find(o => o.value === answers[q.id]);
    if (selectedOpt?.followUp && !answers[selectedOpt.followUp.id]) return false;
    return true;
  });

  // ── Guided tour: phantom typing, triggered by user click on intent button ─
  // Fires when the user clicks "I need legal help" in guided-tour mode. The
  // intent step is no longer auto-advanced  -  the user must explicitly start
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

  // ── Guided tour: pause at questions  -  user clicks to see demo answers ──
  // Replaces the old auto-select + auto-submit effects. The user now clicks
  // "Show how the AI answered" and then "Submit answers" to advance.
  useEffect(() => {
    if (!guidedTour || isSkippedRef.current || step !== "questions" || questions.length === 0) return;

    // Clear any stale tour timeouts from prior phases (e.g., typing)
    tourTimeoutsRef.current.forEach(clearTimeout);
    tourTimeoutsRef.current = [];

    // Pause  -  show the action button so user can read the questions first
    setTourAction("show-answers");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidedTour, step, questions]);

  // Round 3 is shown to the viewer in guided tour mode (not auto-skipped).
  // handleRound3Submit and skipTour() both handle exit from this step.

  // ── Guided tour: safety net  -  auto-advance past any identity step ─
  // Catches all paths to identity (collect_identity, finalize fallback, etc.)
  // regardless of how we got there. Submits dummy contact if no pending result.
  useEffect(() => {
    if (!guidedTour || isSkippedRef.current || step !== "identity") return;

    const sid = sessionId;
    const pending = pendingResult;

    // After the identity step has been visible, advance to Round 3 when the
    // scenario has fixtures for it, otherwise land on result.
    const advanceFromIdentity = (data: ScreenResponse | null) => {
      const r3qs = demoScenario ? (TOUR_ROUND3_FIXTURES[demoScenario] ?? []) : [];
      if (r3qs.length > 0) {
        if (data) setPendingResult(data);
        setRound3Questions(r3qs);
        setRound3Answers({});
        setStep("round3");
        return;
      }
      if (data) setResult(data);
      setStep("result");
    };

    const t = setTimeout(() => {
      if (isSkippedRef.current) return;

      if (pending) {
        // Already have a scored result  -  surface it, user clicks to open panel
        advanceFromIdentity(pending);
        return;
      }

      // Submit dummy contact to get the finalized result
      setIdentityCollected(true);
      goSubmitting("identity");
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
          advanceFromIdentity(data);
        })
        .catch(() => {
          advanceFromIdentity(null);
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
      // Always surface the details step first. Round 3 fires AFTER identity
      // (via the guided-tour safety net below, or via OTP verify in production).
      setPendingResult(data);
      setStep("identity");
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
    goSubmitting("resume");
    try {
      const res = await fetch(`/api/screen/resume?session_id=${resumeSessionId}`);
      if (!res.ok) {
        // Session expired or deleted  -  clear and start fresh
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
      // "questions" means PA was detected but no answers confirmed yet  - 
      // restore the situation text and drop back to intro so the user can re-submit.
      if (state.step_hint === "questions") {
        if (state.situation_summary) setSituation(state.situation_summary);
        setStep("intro");
        return;
      }
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
    goSubmitting("initial");

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
    goSubmitting("questions");

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
    goSubmitting("identity");
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
        try {
          // Server generates filtered, context-aware questions using confirmed
          // R1/R2 answers — avoids contradictions like asking about treatment
          // plans when the client already said they had no injuries
          const r3Res = await fetch("/api/screen/round3/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId }),
          });
          const r3Data = (await r3Res.json()) as { ok: boolean; questions?: Round3Question[] };
          const questions = r3Data.questions ?? [];
          if (questions.length > 0) {
            setRound3Questions(questions);
            setRound3Answers({});
            setStep("round3");
            return;
          }
        } catch {
          // Non-fatal: fall back to static bank client-side
          const practiceArea = result?.practice_area ?? null;
          const subType = (result as Record<string, unknown> | null)?.practice_sub_type as string | null ?? null;
          const questions = getRound3Questions(practiceArea, subType, band);
          if (questions.length > 0) {
            setRound3Questions(questions);
            setRound3Answers({});
            setStep("round3");
            return;
          }
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
    if (round3Submitting) return;
    setRound3Submitting(true);
    setApiError(null);
    try {
      // In guided tour mode skip the real API call — no live session exists.
      if (!guidedTour && sessionId) {
        await fetch("/api/screen/round3", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, answers: round3Answers }),
        });
      }
    } catch {
      // Non-fatal  -  proceed to result regardless
    } finally {
      setRound3Submitting(false);
      // In guided tour, pendingResult holds the finalize fixture. Resolve it now.
      if (guidedTour && pendingResult) {
        setResult(pendingResult);
      }
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
    setAnswers(prev => {
      // When a parent question answer changes, clear any stale follow-up answer
      // from the previously selected option so allAnswered stays accurate.
      const updated = { ...prev, [questionId]: value };
      const parentQ = questions.find(q => q.id === questionId);
      if (parentQ) {
        // Clear follow-up IDs for options that are NOT the newly selected value
        parentQ.options.forEach(opt => {
          if (opt.value !== value && opt.followUp) {
            delete updated[opt.followUp.id];
          }
        });
      }
      return updated;
    });
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

      goSubmitting("questions");
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

  // ── Date bucket helper ────────────────────────────────────────────
  // Maps an ISO date string (YYYY-MM-DD) to a human-readable relative label
  // shown beneath the date picker so clients can confirm the selection.
  function dateBucket(iso: string): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const now = new Date();
    const diffDays = Math.round((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return "In the future";
    if (diffDays === 0) return "Today";
    if (diffDays <= 7) return "Within the last week";
    if (diffDays <= 30) return "Within the last month";
    if (diffDays <= 90) return "1–3 months ago";
    if (diffDays <= 180) return "3–6 months ago";
    if (diffDays <= 365) return "6–12 months ago";
    if (diffDays <= 730) return "1–2 years ago";
    return "More than 2 years ago";
  }

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
          {step === "submitting" && <Spinner stage={submittingStage} />}

          {/* ── Step 2: Branching questions ── */}
          {step === "questions" && (
            <div className="space-y-5">
              {/* Progress label */}
              <p className="text-[11px] text-gray-400 -mt-1">
                {questionRound > 1
                  ? `Round ${questionRound}  -  ${questions.length} additional question${questions.length !== 1 ? "s" : ""}`
                  : `${questions.length} question${questions.length !== 1 ? "s" : ""} to complete your intake`}
              </p>

              {responseText && (
                <p className="text-sm text-gray-600 bg-gray-50 rounded-xl px-4 py-3 leading-relaxed">
                  {responseText}
                </p>
              )}

              {questions.filter(q => {
                if (!q.excludeWhen) return true;
                return !Object.entries(q.excludeWhen).some(
                  ([depId, blocked]) => typeof answers[depId] === "string" && blocked.includes(answers[depId] as string)
                );
              }).map(q => (
                <div key={q.id}>
                  {q.type === "info" ? (
                    /* Info block  -  contextual text, no answer required */
                    <div className="flex gap-2.5 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                      <svg className="w-4 h-4 mt-0.5 shrink-0 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 110 20A10 10 0 0112 2z" />
                      </svg>
                      <p className="text-xs text-blue-700 leading-relaxed">{q.text}</p>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-gray-800 mb-1.5">{q.text}</p>
                      {q.description && (
                        <p className="text-xs text-gray-500 mb-2.5 leading-relaxed">{q.description}</p>
                      )}
                      {q.type === "date" ? (
                        <div className="space-y-1.5">
                          <input
                            type="date"
                            value={answers[q.id] ?? ""}
                            onChange={e => selectAnswer(q.id, e.target.value, e.target.value)}
                            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-current transition"
                          />
                          {answers[q.id] && (
                            <p className="text-[11px] text-gray-400 pl-1">{dateBucket(answers[q.id] as string)}</p>
                          )}
                        </div>
                      ) : q.options && q.options.length > 0 ? (
                        <>
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
                          {/* Inline follow-up  -  shown when the selected option has a sub-question */}
                          {(() => {
                            const selOpt = q.options.find(o => o.value === answers[q.id]);
                            if (!selOpt?.followUp) return null;
                            const fu = selOpt.followUp;
                            return (
                              <div className="mt-3 pl-3 border-l-2 border-gray-200 space-y-2">
                                <p className="text-xs font-medium text-gray-700">{fu.text}</p>
                                {fu.description && (
                                  <p className="text-xs text-gray-500 leading-relaxed">{fu.description}</p>
                                )}
                                {fu.options && fu.options.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {fu.options.map(fo => {
                                      const fuSelected = answers[fu.id] === fo.value;
                                      return (
                                        <button
                                          key={fo.value}
                                          onClick={() => selectAnswer(fu.id, fo.value, fo.label)}
                                          className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                                            fuSelected
                                              ? "border-current text-white"
                                              : "border-gray-200 text-gray-600 bg-gray-50 hover:border-gray-300 hover:bg-gray-100"
                                          }`}
                                          style={fuSelected ? { backgroundColor: accentColor, borderColor: accentColor } : {}}
                                        >
                                          {fo.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <input
                                    type="text"
                                    value={answers[fu.id] ?? ""}
                                    onChange={e => selectAnswer(fu.id, e.target.value, e.target.value)}
                                    placeholder="Your answer…"
                                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:border-current transition"
                                  />
                                )}
                              </div>
                            );
                          })()}
                        </>
                      ) : (
                        <input
                          type="text"
                          value={answers[q.id] ?? ""}
                          onChange={e => selectAnswer(q.id, e.target.value, e.target.value)}
                          placeholder="Your answer…"
                          className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-current transition"
                        />
                      )}
                    </>
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
              {/* Transition card  -  positioning line */}
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
                {round3Questions.length} question{round3Questions.length !== 1 ? "s" : ""}  -  your answers go directly to your lawyer before the call
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

                  {/* File upload */}
                  {q.type === "file" && (() => {
                    const fs = fileUploadState[q.id] ?? { status: "idle" };
                    const isDone = fs.status === "done";
                    const isUploading = fs.status === "uploading";
                    return (
                      <div className="space-y-2">
                        {isDone ? (
                          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5">
                            <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            <span className="text-xs text-emerald-700 font-medium truncate">{fs.filename}</span>
                            <button
                              onClick={() => {
                                setFileUploadState(prev => ({ ...prev, [q.id]: { status: "idle" } }));
                                setRound3Answers(prev => { const next = { ...prev }; delete next[q.id]; return next; });
                              }}
                              className="ml-auto text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                            >
                              Remove
                            </button>
                          </div>
                        ) : (
                          <label
                            className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-all ${
                              isUploading
                                ? "border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed"
                                : "border-dashed border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100"
                            }`}
                          >
                            <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                            </svg>
                            <span className="text-xs text-gray-500">
                              {isUploading ? "Uploading…" : "Choose file (PDF or image, max 10 MB)"}
                            </span>
                            <input
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png,.webp,.txt"
                              disabled={isUploading}
                              className="sr-only"
                              onChange={async e => {
                                const picked = e.target.files?.[0];
                                if (!picked || !sessionId) return;
                                setFileUploadState(prev => ({ ...prev, [q.id]: { status: "uploading" } }));
                                try {
                                  const fd = new FormData();
                                  fd.append("session_id", sessionId);
                                  fd.append("file", picked);
                                  const res = await fetch("/api/screen/upload", { method: "POST", body: fd });
                                  if (!res.ok) {
                                    const body = await res.json() as { error?: string };
                                    throw new Error(body.error ?? "Upload failed");
                                  }
                                  const data = await res.json() as { url: string; filename: string };
                                  setRound3Answers(prev => ({ ...prev, [q.id]: data.url }));
                                  setFileUploadState(prev => ({ ...prev, [q.id]: { status: "done", filename: data.filename } }));
                                } catch (err) {
                                  const msg = err instanceof Error ? err.message : "Upload failed";
                                  setFileUploadState(prev => ({ ...prev, [q.id]: { status: "error", error: msg } }));
                                }
                              }}
                            />
                          </label>
                        )}
                        {fs.status === "error" && (
                          <p className="text-xs text-red-500">{fs.error}</p>
                        )}
                      </div>
                    );
                  })()}
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
                Your lawyer will review this before your call  -  skip any question that doesn&apos;t apply.
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

              {/* CTA  -  band-differentiated */}
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

                    {/* Booking button  -  Band A and B only, after Round 3 */}
                    {isBookingBand && firmBookingUrl && (
                      <a
                        href={firmBookingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
                        style={{ backgroundColor: accentColor }}
                      >
                        Your case memo is ready  -  book your consultation
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                      </a>
                    )}

                    {/* External resources  -  Band E only */}
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

      {/* Demo: Lawyer View Panel  -  post-finalization overlay */}
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
            caseValue={result.case_value ?? null}
            scenarioId={demoScenario ?? null}
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
