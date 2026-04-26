"use client";

/**
 * LawyerViewPanel  -  post-finalization demo overlay.
 *
 * Shows the prospect exactly what lands in the lawyer's pipeline after
 * intake completes. Rendered only in demo mode (demoMode=true on IntakeWidget).
 *
 * Sections (top to bottom):
 *   1. SLA pill (band-specific, prominent action message)
 *   2. Lead metadata strip (lead ID, arrival time, scoring latency)
 *   3. Case card (contact, PA, band, CPI, full summary, reason)
 *   4. Actions fired (automation log with timestamps)
 *   5. Follow-up protocol (numbered forward-looking steps)
 *   6. Intake trail (questions asked and answers given)
 *   7. CPI breakdown (Fit + Value components, compact numeric grid)
 */

import { useEffect, useMemo, useState } from "react";
import {
  BAND_FOLLOWUP,
  buildDynamicMemo,
  type MemoData,
} from "@/lib/intake-memo";
import { buildScoreRationale } from "@/lib/score-rationale";
import ScoreRationaleBlock from "@/components/ScoreRationaleBlock";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface FullCpi {
  total: number;
  band: "A" | "B" | "C" | "D" | "E" | null;
  fit_score: number;
  value_score: number;
  geo_score: number;
  practice_score: number;
  legitimacy_score: number;
  referral_score: number;
  urgency_score: number;
  complexity_score: number;
  multi_practice_score: number;
  fee_score: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  band: "A" | "B" | "C" | "D" | "E" | null;
  cpi: FullCpi;
  situationSummary: string | null;
  practiceArea: string | null;
  contactName: string;
  contactEmail?: string;
  contactPhone?: string;
  intakeTrail?: Array<{ question: string; answer: string }>;
  sessionId?: string | null;
  caseValue?: { label: string; tier: string; rationale: string } | null;
  /** Demo scenario ID  -  used to render the correct per-scenario case memo. */
  scenarioId?: string | null;
}

// ─────────────────────────────────────────────
// Band metadata
// ─────────────────────────────────────────────

const BAND_META: Record<string, { label: string; bg: string; text: string; ring: string }> = {
  A: { label: "Band A", bg: "bg-emerald-500",  text: "text-white", ring: "ring-emerald-200" },
  B: { label: "Band B", bg: "bg-blue-500",     text: "text-white", ring: "ring-blue-200" },
  C: { label: "Band C", bg: "bg-amber-500",    text: "text-white", ring: "ring-amber-200" },
  D: { label: "Band D", bg: "bg-orange-400",   text: "text-white", ring: "ring-orange-200" },
  E: { label: "Band E", bg: "bg-gray-400",     text: "text-white", ring: "ring-gray-200" },
};

const BAND_BLURB_BORDER: Record<string, string> = {
  A: "border-l-4 border-emerald-400",
  B: "border-l-4 border-blue-400",
  C: "border-l-4 border-amber-400",
  D: "border-l-4 border-orange-300",
  E: "border-l-4 border-gray-300",
};

const BAND_REASON: Record<string, string> = {
  A: "Strong fit across all dimensions. Priority case.",
  B: "Good fit and case value. Recommended intake.",
  C: "Borderline: meets criteria, limited case value.",
  D: "Weak fit or low value. Nurture track only.",
  E: "Outside scope. No attorney time warranted.",
};

// Band-specific SLA pill: the most prominent signal in the panel
const BAND_SLA: Record<string, { label: string; sub: string; bg: string; text: string; accent: string; zero: boolean; deadlineHours: number | null }> = {
  A: { label: "Respond within 30 minutes", sub: "Priority case. Senior lawyer escalation on breach.", bg: "bg-emerald-50", text: "text-emerald-900", accent: "text-emerald-600", zero: false, deadlineHours: 0.5  },
  B: { label: "Respond within 4 hours",    sub: "Warm lead. Partner alert on breach.",                bg: "bg-blue-50",    text: "text-blue-900",    accent: "text-blue-600",    zero: false, deadlineHours: 4    },
  C: { label: "Respond within 24 hours",   sub: "Qualified lead. Standard intake queue.",             bg: "bg-amber-50",   text: "text-amber-900",   accent: "text-amber-600",   zero: false, deadlineHours: 24   },
  D: { label: "0 minutes of your lawyer's time", sub: "6-month automated nurture. No manual touch.",  bg: "bg-gray-100",   text: "text-gray-700",    accent: "text-gray-500",    zero: true,  deadlineHours: null },
  E: { label: "0 minutes of your lawyer's time", sub: "Outside scope. Filtered out. No CRM entry.",   bg: "bg-gray-100",   text: "text-gray-700",    accent: "text-gray-500",    zero: true,  deadlineHours: null },
};

// Demo-only percentile context for CPI score
const BAND_PERCENTILE: Record<string, string> = {
  A: "Top 12% of inquiries this month",
  B: "Top 28% of inquiries this month",
  C: "Median-band inquiry",
  D: "Bottom 35% of inquiries",
  E: "Outside firm scope",
};

// Case value tier badge colours
const VALUE_TIER_BADGE: Record<string, { bg: string; text: string }> = {
  high:    { bg: "bg-emerald-100", text: "text-emerald-700" },
  medium:  { bg: "bg-blue-100",    text: "text-blue-700" },
  low:     { bg: "bg-amber-100",   text: "text-amber-700" },
  minimal: { bg: "bg-gray-100",    text: "text-gray-500" },
};

// Maps short API IDs to human-readable labels for display
const PA_DISPLAY_NAMES: Record<string, string> = {
  pi: "Personal Injury",
  emp: "Employment Law",
  fam: "Family Law",
  crim: "Criminal Law",
  real: "Real Estate",
  llt: "Landlord / Tenant",
  imm: "Immigration",
  corp: "Corporate Law",
  wills: "Wills & Estates",
  sc: "Small Claims",
  small_claims: "Small Claims",
};

// Per-band automation log (what fired in the background after intake completed)
const BAND_ACTION_LOG: Record<string, Array<{ text: string }>> = {
  A: [
    { text: "Lead created, assigned to intake queue" },
    { text: "Case memo prepared for lawyer review" },
    { text: "Retainer agreement pre-drafted, awaiting lawyer release after consultation" },
    { text: "Partner alert scheduled: 30-minute response window" },
  ],
  B: [
    { text: "Lead created, assigned to intake queue" },
    { text: "Case memo prepared for lawyer review" },
    { text: "Retainer agreement pre-drafted, awaiting lawyer release after consultation" },
    { text: "Partner alert scheduled: 4-hour response window" },
  ],
  C: [
    { text: "Lead created, assigned to intake queue" },
    { text: "3-month qualification nurture started" },
    { text: "Lawyer notified: no immediate time commitment" },
  ],
  D: [
    { text: "Lead logged. Nurture track only  -  no pipeline entry." },
    { text: "6-month educational drip started" },
  ],
  E: [
    { text: "Inquiry filtered. No CRM entry created." },
    { text: "Client directed to external resources" },
  ],
};


// ─────────────────────────────────────────────
// Per-scenario case intake memos (demo only)
// ─────────────────────────────────────────────

const DEMO_MEMOS: Record<string, MemoData> = {
  pi_strong: {
    jurisdictionTimeline: "Ontario. Incident date: approx. 3 weeks ago. Days elapsed: ~21. Within standard 2-year Ontario limitation period.",
    evidenceHeading: "Evidence Manifest",
    evidenceItems: [
      { checked: true,  text: "Police attended  -  report number held by client" },
      { checked: true,  text: "Ambulance attended, transported to hospital" },
      { checked: true,  text: "Emergency room records (held by hospital)" },
      { checked: true,  text: "Insurer contacted client in writing" },
      { checked: false, text: "Full collision report not yet requested from OPP" },
      { checked: false, text: "Opposing insurer correspondence  -  status unknown" },
    ],
    adverseParties: "Other driver identified. No opposing counsel at time of intake. Conflict check pending.",
    gaps: [
      "Full collision report from OPP not yet requested",
      "Physiotherapy and specialist records not yet confirmed",
      "Employment income loss documentation not obtained",
      "Whether client has given any statements to insurers",
    ],
  },

  slip_fall: {
    jurisdictionTimeline: "Ontario. Incident date: approx. 2 weeks ago. Days elapsed: ~14. Within standard 2-year limitation period. Grocery store (private property): written notice to property owner recommended immediately.",
    evidenceHeading: "Evidence Manifest",
    evidenceItems: [
      { checked: true,  text: "Incident reported to store manager at time of fall" },
      { checked: true,  text: "Emergency room treatment  -  same day" },
      { checked: false, text: "Written incident report from store  -  not yet requested" },
      { checked: false, text: "Security camera footage  -  urgent: risk of overwrite" },
      { checked: false, text: "Witness contact information  -  not obtained" },
      { checked: false, text: "Photographs of hazard  -  to be confirmed with client" },
    ],
    adverseParties: "Property owner (grocery store chain). No counsel identified at time of intake. Conflict check pending.",
    gaps: [
      "Security footage preservation letter must be sent immediately",
      "Written incident report from store not in client's possession",
      "ER medical records not yet requested",
      "Ongoing treatment plan not confirmed  -  physiotherapy or specialist referral unknown",
    ],
  },

  emp_dismissal: {
    jurisdictionTimeline: "Ontario (Employment Standards Act + common law notice). Termination date: last Friday. Days elapsed: ~7. ESA complaint limitation: 6 months from termination. Common law: 2 years.",
    evidenceHeading: "Employment Record",
    evidenceItems: [
      { checked: true,  text: "4 years tenure" },
      { checked: true,  text: "Severance offered: 2 weeks (statutory minimum)" },
      { checked: true,  text: "Stated reason: restructuring (no performance basis cited)" },
      { checked: false, text: "Written employment contract  -  status unconfirmed" },
      { checked: false, text: "Signed separation agreement  -  not yet reviewed" },
      { checked: false, text: "Termination letter  -  to be reviewed" },
    ],
    adverseParties: "Former employer. No counsel identified at time of intake. Conflict check pending.",
    gaps: [
      "Written employment contract must be reviewed before any legal theory can be confirmed",
      "Whether client signed any release or agreement at time of termination",
      "Non-competition or non-solicitation clause status",
      "Any progressive discipline history prior to termination",
      "Mitigation: current employment search status",
    ],
  },

  emp_wage: {
    jurisdictionTimeline: "Ontario (Employment Standards Act, s.22 overtime). Alleged overtime period: past 8 months. Current employment: ongoing. ESA complaint: 2-year limitation. Ministry of Labour complaint recommended within 6 months.",
    evidenceHeading: "Employment Record",
    evidenceItems: [
      { checked: true,  text: "Full-time employee" },
      { checked: true,  text: "Consistent schedule: ~55 hours/week" },
      { checked: true,  text: "Ontario ESA overtime threshold: 44 hours/week" },
      { checked: true,  text: "Client holds detailed records of hours worked" },
      { checked: false, text: "Pay stubs for the relevant period  -  status unknown" },
      { checked: false, text: "Written employment contract confirming classification  -  not yet reviewed" },
    ],
    adverseParties: "Current employer (employment ongoing). No counsel identified. Conflict check pending.",
    gaps: [
      "Whether client's role is subject to an ESA overtime exemption (certain managers, IT professionals)",
      "Exact hourly or annual rate to compute outstanding entitlement",
      "Whether overtime concern has been raised internally and what the response was",
      "Risk profile: ESA complaint vs civil action given ongoing employment",
    ],
  },

  imm_spousal: {
    jurisdictionTimeline: "Federal (IRCC). Marriage date: within 1 to 3 months. Current status: study permit (approved). Urgency: permit expiry proximity and upcoming marriage. Inland processing: ~12 months. Outland: 12 to 24 months.",
    evidenceHeading: "Status Snapshot",
    evidenceItems: [
      { checked: true,  text: "Current permit: study permit  -  valid" },
      { checked: true,  text: "Sponsor: Canadian citizen" },
      { checked: true,  text: "No prior refused applications" },
      { checked: false, text: "Study permit expiry date  -  exact date not confirmed" },
      { checked: false, text: "Cohabitation start date and history  -  not yet reviewed" },
      { checked: false, text: "Relationship documentation inventory  -  not yet assessed" },
    ],
    adverseParties: "None. No opposing counsel at time of intake.",
    pathwayAssessment: "Inland sponsorship preferred if study permit has sufficient remaining validity and client maintains status throughout processing. Outland required if permit expires before IRCC completes inland review. Both pathways require IMM forms package, relationship evidence, police clearances, and medical exam.",
    gaps: [
      "Exact permit expiry date  -  critical for inland vs outland decision",
      "Relationship length and cohabitation history (genuineness of relationship evidence)",
      "Sponsor's prior sponsorship undertakings (if any)",
      "Any criminality or inadmissibility flags from either party",
      "Whether civil or religious ceremony, and registration in Canada",
    ],
  },
};

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

// Compact numeric row for the CPI breakdown. No bars: label on the left,
// value "N/M" on the right. Dim the row when the component is a perfect score.
function ScoreCell({ label, value, max }: { label: string; value: number; max: number }) {
  const full = value >= max;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-gray-100 last:border-b-0">
      <span className="text-[11px] text-gray-600">{label}</span>
      <span className="text-[11px] font-mono tabular-nums">
        <span className={full ? "font-semibold text-[#1E2F58]" : "font-semibold text-gray-800"}>{value}</span>
        <span className="text-gray-400">/{max}</span>
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function LawyerViewPanel({
  open,
  onClose,
  band,
  cpi,
  situationSummary,
  practiceArea,
  contactName,
  contactEmail,
  contactPhone,
  intakeTrail,
  sessionId,
  caseValue,
  scenarioId,
}: Props) {
  const b = band ?? "E";
  const meta = BAND_META[b] ?? BAND_META["E"];
  const sla = BAND_SLA[b] ?? BAND_SLA["E"];
  const actionLog = BAND_ACTION_LOG[b] ?? BAND_ACTION_LOG["E"];
  const blurbBorder = BAND_BLURB_BORDER[b] ?? BAND_BLURB_BORDER["E"];

  // Deadline timestamp for the SLA pill (computed once on mount)
  const deadlineStr = useMemo(() => {
    if (!sla.deadlineHours) return null;
    const deadline = new Date(Date.now() + sla.deadlineHours * 60 * 60 * 1000);
    const h = deadline.getHours();
    const m = deadline.getMinutes();
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const ampm = h < 12 ? "am" : "pm";
    const mm = m.toString().padStart(2, "0");
    const prefix = sla.deadlineHours < 1
      ? `${Math.round(sla.deadlineHours * 60)}min deadline`
      : `${sla.deadlineHours}h deadline`;
    return `${prefix}: ${h12}:${mm}${ampm}`;
  }, [sla.deadlineHours]);
  const bandReason = BAND_REASON[b] ?? BAND_REASON["E"];
  const percentile = BAND_PERCENTILE[b] ?? BAND_PERCENTILE["E"];

  // Case memo: demo scenario fixture when available, otherwise built
  // dynamically from the real intake data. Guarantees every A/B/C case
  // produces a memo even for custom-typed (non-demo-chip) intakes.
  const memo = useMemo(() => {
    if (scenarioId && DEMO_MEMOS[scenarioId]) return DEMO_MEMOS[scenarioId];
    return buildDynamicMemo({ situationSummary, practiceArea, intakeTrail });
  }, [scenarioId, situationSummary, practiceArea, intakeTrail]);
  const followupSteps = BAND_FOLLOWUP[b] ?? BAND_FOLLOWUP["E"];

  // Structured "why this band" rationale. Pure function of the CPI shape.
  // Demo has no missing-field or AI-angle data, so only the deterministic
  // band line + strengths/weaknesses layer renders here.
  const rationale = useMemo(() => buildScoreRationale({
    band,
    total: cpi.total,
    fit: { value: cpi.fit_score, max: 40 },
    val: { value: cpi.value_score, max: 60 },
    components: [
      { label: "Geographic fit",   value: cpi.geo_score,            max: 10 },
      { label: "Practice match",   value: cpi.practice_score,       max: 10 },
      { label: "Inquiry legitimacy", value: cpi.legitimacy_score,   max: 10 },
      { label: "Referral signal",  value: cpi.referral_score,       max: 10 },
      { label: "Urgency",          value: cpi.urgency_score,        max: 20 },
      { label: "Case complexity",  value: cpi.complexity_score,     max: 25 },
      { label: "Multi-practice",   value: cpi.multi_practice_score, max: 5  },
      { label: "Fee tier",         value: cpi.fee_score,            max: 10 },
    ],
  }), [band, cpi]);

  // Resolve short API IDs ("pi") to full labels ("Personal Injury")
  const displayPracticeArea = practiceArea
    ? (PA_DISPLAY_NAMES[practiceArea] ?? PA_DISPLAY_NAMES[practiceArea.toLowerCase()] ?? practiceArea)
    : null;

  // Stable per-session lead ID derived from sessionId (or random if none)
  const leadId = useMemo(() => {
    const seed = sessionId ?? Math.random().toString(36).slice(2);
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    const n = (Math.abs(h) % 9000) + 1000;
    return `LEAD-${n}`;
  }, [sessionId]);

  // Elapsed-time counter. Starts at 2s when panel opens, ticks every second.
  const [elapsed, setElapsed] = useState(2);
  useEffect(() => {
    if (!open) return;
    setElapsed(2);
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [open]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  const elapsedText = elapsed < 60
    ? `${elapsed}s ago`
    : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s ago`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative z-10 w-full sm:max-w-[540px] bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <p className="text-xs font-semibold text-[#1E2F58] uppercase tracking-widest mb-0.5">
              CaseLoad Select
            </p>
            <h2 className="text-base font-bold text-gray-900">
              Lead scored. Routed to pipeline.
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* 1. SLA pill  -  most prominent signal */}
          <div className={`rounded-xl px-4 py-3 ${sla.bg}`}>
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center bg-white ${sla.accent} flex-shrink-0`}>
                {sla.zero ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
              <div className="min-w-0">
                <p className={`text-sm font-bold ${sla.text}`}>{sla.label}</p>
                {deadlineStr && (
                  <p className={`text-[11px] font-semibold ${sla.text} opacity-60 mt-0.5`}>{deadlineStr}</p>
                )}
                <p className={`text-[11px] ${sla.accent} mt-0.5`}>{sla.sub}</p>
              </div>
            </div>
          </div>

          {/* 2. Lead metadata strip */}
          <div className="flex items-center gap-2 text-[11px] text-gray-500 font-mono">
            <span className="font-semibold text-gray-700">{leadId}</span>
            <span className="text-gray-300">·</span>
            <span>Arrived {elapsedText}</span>
          </div>

          {/* 3. Case card: contact, PA, band, CPI, full summary, reason */}
          <div className={`rounded-xl px-4 py-3 bg-[#F4F3EF] ${blurbBorder}`}>
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900 truncate">{contactName}</p>
                {(contactEmail || contactPhone) && (
                  <p className="text-[11px] text-gray-600 mt-0.5 truncate">
                    {contactEmail}
                    {contactEmail && contactPhone && " · "}
                    {contactPhone}
                  </p>
                )}
                {displayPracticeArea && (
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <span className="text-xs font-medium text-gray-700">{displayPracticeArea}</span>
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${meta.bg} ${meta.text}`}>
                  {meta.label}
                </span>
                <span className="text-xl font-extrabold text-gray-900 leading-none">
                  {cpi.total}<span className="text-xs text-gray-400 font-normal">/100</span>
                </span>
                <span className="text-[10px] text-gray-500">Fit {cpi.fit_score} · Val {cpi.value_score}</span>
              </div>
            </div>
            {situationSummary && (
              <p className="text-sm text-gray-700 leading-relaxed mt-2">{situationSummary}</p>
            )}
            {caseValue && (() => {
              const tierKey = caseValue.tier.toLowerCase();
              const badge = VALUE_TIER_BADGE[tierKey] ?? VALUE_TIER_BADGE["minimal"];
              return (
                <div className="mt-2.5 pt-2 border-t border-gray-200/60">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                      Estimated case value
                    </span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>
                      {caseValue.tier}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-gray-900">{caseValue.label}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{caseValue.rationale}</p>
                </div>
              );
            })()}
            <div className="flex items-center justify-between gap-2 mt-2.5 pt-2 border-t border-gray-200/60">
              <p className="text-[11px] text-gray-500 leading-tight">{bandReason}</p>
              <span className="text-[10px] text-gray-400 whitespace-nowrap font-medium">{percentile}</span>
            </div>
          </div>

          {/* 3b. Structured band rationale: expands the one-line tagline into
             why this band, strongest/weakest factors, and (when available)
             first-call questions and AI angle. Shared across demo, admin,
             and portal surfaces via <ScoreRationaleBlock>. */}
          <ScoreRationaleBlock rationale={rationale} />

          {/* 4. Actions fired: dark log format, no timestamps */}
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2.5">
              Actions fired (automation log)
            </p>
            <div className="bg-[#1E2F58] rounded-lg px-3.5 py-3 space-y-1.5 font-mono">
              {actionLog.map(entry => (
                <div key={entry.text} className="flex items-start gap-2 text-[11px] leading-relaxed">
                  <span className="text-[#C4B49A] flex-shrink-0 mt-0.5">&#x2713;</span>
                  <span className="text-[#F4F3EF]/90">{entry.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 4b. Follow-up protocol: numbered next steps, band-specific */}
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2.5">
              Follow-up protocol
            </p>
            <ol className="space-y-2">
              {followupSteps.map((step, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-[#1E2F58] text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-sm text-gray-700 leading-snug">{step}</p>
                </li>
              ))}
            </ol>
          </div>

          {/* 5. Pre-call checklist: unchecked evidence items from the memo */}
          {(() => {
            const uncheckedGaps = memo.evidenceItems.filter(item => !item.checked);
            if (uncheckedGaps.length === 0) return null;
            return (
              <div>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2.5">
                  Pre-call: confirm with client
                </p>
                <ul className="space-y-2">
                  {uncheckedGaps.map((item, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full border-2 border-gray-300 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                      </span>
                      <p className="text-sm text-gray-500">{item.text}</p>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          {/* 5b. Case Intake Memo  -  renders for every Band A/B/C case */}
          {(b === "A" || b === "B" || b === "C") && (() => {
            return (
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                    Case Intake Memo
                  </p>
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                    Memo ready
                  </span>
                </div>
                <div className="bg-[#F4F3EF] rounded-xl border border-black/5 px-4 py-3.5 space-y-3 text-[11px]">
                  <div>
                    <p className="text-[10px] font-bold text-[#1E2F58] uppercase tracking-wider mb-0.5">Rounds 1 and 2 decide whether to take the meeting.</p>
                    <p className="text-[10px] text-gray-500">Round 3 decides how the lawyer walks in prepared.</p>
                  </div>
                  <div className="border-t border-black/8 pt-3 space-y-2.5">
                    <div>
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">Jurisdiction and Timeline</p>
                      <p className="text-[11px] text-gray-700">{memo.jurisdictionTimeline}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">{memo.evidenceHeading}</p>
                      <div className="space-y-0.5">
                        {memo.evidenceItems.map((item, i) => (
                          <p key={i} className="text-[11px] text-gray-700 leading-relaxed">
                            {item.checked ? "- [x]" : "- [ ]"} {item.text}
                          </p>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">Adverse Parties</p>
                      <p className="text-[11px] text-gray-700">{memo.adverseParties}</p>
                    </div>
                    {memo.pathwayAssessment && (
                      <div>
                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">Pathway Assessment</p>
                        <p className="text-[11px] text-gray-700">{memo.pathwayAssessment}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">Gaps for Lawyer to Probe</p>
                      <div className="space-y-0.5">
                        {memo.gaps.map((gap, i) => (
                          <p key={i} className="text-[11px] text-gray-700 leading-relaxed">- {gap}</p>
                        ))}
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-400 border-t border-black/8 pt-2">
                      Prepared by CaseLoad Screen. Client-reported information only. Confidential  -  LSO Rule 3.3.
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* 6. Intake trail: evidence behind the score */}
          {intakeTrail && intakeTrail.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
                Intake questions answered
              </p>
              <div className="space-y-1.5">
                {intakeTrail.map((item, i) => (
                  <div key={i} className="flex flex-col gap-0.5 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide leading-snug">
                      {item.question}
                    </p>
                    <p className="text-xs font-semibold text-gray-700">{item.answer}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 7. CPI breakdown: compact two-column numeric grid, no bars */}
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">
              CPI breakdown
            </p>
            <p className="text-[10px] text-gray-400 mb-2.5">
              Band reflects intake message analysis plus Rounds 1 and 2. Round 3 completes the case memo but does not change the band.
            </p>
            <div className="grid grid-cols-2 gap-x-5">
              <div>
                <div className="flex items-baseline justify-between pb-1.5 mb-1 border-b border-gray-200">
                  <span className="text-[10px] font-bold text-gray-700 uppercase tracking-wider">Fit</span>
                  <span className="text-[11px] font-mono tabular-nums font-bold text-[#1E2F58]">
                    {cpi.fit_score}<span className="text-gray-400 font-normal">/40</span>
                  </span>
                </div>
                <ScoreCell label="Geographic"     value={cpi.geo_score}        max={10} />
                <ScoreCell label="Practice match" value={cpi.practice_score}   max={10} />
                <ScoreCell label="Legitimacy"     value={cpi.legitimacy_score} max={10} />
                <ScoreCell label="Referral"       value={cpi.referral_score}   max={10} />
              </div>
              <div>
                <div className="flex items-baseline justify-between pb-1.5 mb-1 border-b border-gray-200">
                  <span className="text-[10px] font-bold text-gray-700 uppercase tracking-wider">Value</span>
                  <span className="text-[11px] font-mono tabular-nums font-bold text-[#1E2F58]">
                    {cpi.value_score}<span className="text-gray-400 font-normal">/60</span>
                  </span>
                </div>
                <ScoreCell label="Urgency"        value={cpi.urgency_score}        max={20} />
                <ScoreCell label="Complexity"     value={cpi.complexity_score}     max={25} />
                <ScoreCell label="Multi-practice" value={cpi.multi_practice_score} max={5} />
                <ScoreCell label="Fee tier"       value={cpi.fee_score}            max={10} />
              </div>
            </div>
          </div>

          {/* Demo disclaimer */}
          <p className="text-[10px] text-gray-400 text-center pb-1">
            Demo only. No data was saved or sent to any CRM.
          </p>

        </div>

        {/* Close button footer */}
        <div className="px-5 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-[#1E2F58] hover:opacity-90 transition-all active:scale-[0.98]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
