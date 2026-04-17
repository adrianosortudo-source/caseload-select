"use client";

/**
 * LawyerViewPanel — post-finalization demo overlay.
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
const BAND_SLA: Record<string, { label: string; sub: string; bg: string; text: string; accent: string; zero: boolean }> = {
  A: { label: "Respond within 30 minutes", sub: "Priority routing. Senior lawyer escalation on breach.", bg: "bg-emerald-50", text: "text-emerald-900", accent: "text-emerald-600", zero: false },
  B: { label: "Respond within 1 hour",     sub: "Warm lead. Partner alert on breach.",                  bg: "bg-blue-50",    text: "text-blue-900",    accent: "text-blue-600",    zero: false },
  C: { label: "Consultation within 24 hours", sub: "Qualified lead. Standard queue.",                   bg: "bg-amber-50",   text: "text-amber-900",   accent: "text-amber-600",   zero: false },
  D: { label: "0 minutes of your lawyer's time", sub: "6-month automated nurture. No manual touch.",    bg: "bg-gray-100",   text: "text-gray-700",    accent: "text-gray-500",    zero: true  },
  E: { label: "0 minutes of your lawyer's time", sub: "Outside scope. Filtered out. No CRM entry.",     bg: "bg-gray-100",   text: "text-gray-700",    accent: "text-gray-500",    zero: true  },
};

// Demo-only percentile context for CPI score
const BAND_PERCENTILE: Record<string, string> = {
  A: "Top 12% of inquiries this month",
  B: "Top 28% of inquiries this month",
  C: "Median-band inquiry",
  D: "Bottom 35% of inquiries",
  E: "Outside firm scope",
};

// Per-practice-area case value context
const PA_CONTEXT: Record<string, string> = {
  pi: "avg case value $45k to $180k",
  emp: "avg case value $15k to $85k",
  fam: "avg retainer $8k to $40k",
  crim: "avg retainer $5k to $25k",
  real: "avg case value $3k to $15k",
  llt: "avg case value $2k to $8k",
  imm: "avg retainer $3k to $10k",
  corp: "avg retainer $10k to $40k",
  wills: "avg retainer $2k to $6k",
  sc: "small claims (no retainer)",
  small_claims: "small claims (no retainer)",
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

// Per-band automation log (fake relative timestamps for demo realism)
const BAND_ACTION_LOG: Record<string, Array<{ t: string; text: string }>> = {
  A: [
    { t: "+0.0s", text: "Lead created in CRM" },
    { t: "+0.2s", text: "Tags applied (band:A, priority)" },
    { t: "+0.4s", text: "Pipeline stage set to New Lead" },
    { t: "+0.8s", text: "Retainer agreement queued via DocuSeal" },
    { t: "+1.1s", text: "30-minute SLA timer started" },
  ],
  B: [
    { t: "+0.0s", text: "Lead created in CRM" },
    { t: "+0.2s", text: "Tags applied (band:B, warm)" },
    { t: "+0.4s", text: "Pipeline stage set to New Lead" },
    { t: "+0.8s", text: "Retainer agreement queued via DocuSeal" },
    { t: "+1.1s", text: "1-hour SLA timer started" },
  ],
  C: [
    { t: "+0.0s", text: "Lead created in CRM" },
    { t: "+0.2s", text: "Tags applied (band:C, qualified)" },
    { t: "+0.4s", text: "Pipeline stage set to New Lead" },
    { t: "+0.7s", text: "3-month nurture sequence started" },
  ],
  D: [
    { t: "+0.0s", text: "Lead logged (nurture-only, not routed to pipeline)" },
    { t: "+0.3s", text: "6-month educational drip started" },
    { t: "+0.5s", text: "Zero lawyer notification sent" },
  ],
  E: [
    { t: "+0.0s", text: "Inquiry filtered. No CRM entry created." },
    { t: "+0.2s", text: "Client redirected to external resources" },
    { t: "+0.3s", text: "Zero lawyer notification sent" },
  ],
};

const BAND_NEXT_STEPS: Record<string, string[]> = {
  A: [
    "Personal call from lawyer within 24 hours.",
    "Retainer agreement drafted and sent via DocuSeal.",
    "Case routed to priority litigation queue.",
    "Consultation booking link delivered to client.",
  ],
  B: [
    "Lawyer follow-up within 48 hours.",
    "Retainer agreement sent via DocuSeal.",
    "Case added to standard intake queue.",
  ],
  C: [
    "Lead enrolled in 3-month nurture sequence.",
    "Lawyer notified; no immediate time commitment.",
    "Automated follow-up in 7 days.",
  ],
  D: [
    "Enrolled in 6-month low-priority nurture track.",
    "Educational resources delivered to client.",
    "Zero attorney time consumed.",
  ],
  E: [
    "Client redirected to appropriate external resource.",
    "No CRM entry created.",
    "Zero attorney time consumed.",
  ],
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
}: Props) {
  const b = band ?? "E";
  const meta = BAND_META[b] ?? BAND_META["E"];
  const sla = BAND_SLA[b] ?? BAND_SLA["E"];
  const actionLog = BAND_ACTION_LOG[b] ?? BAND_ACTION_LOG["E"];
  const nextSteps = BAND_NEXT_STEPS[b] ?? BAND_NEXT_STEPS["E"];
  const blurbBorder = BAND_BLURB_BORDER[b] ?? BAND_BLURB_BORDER["E"];
  const bandReason = BAND_REASON[b] ?? BAND_REASON["E"];
  const percentile = BAND_PERCENTILE[b] ?? BAND_PERCENTILE["E"];

  // Resolve short API IDs ("pi") to full labels ("Personal Injury")
  const displayPracticeArea = practiceArea
    ? (PA_DISPLAY_NAMES[practiceArea] ?? PA_DISPLAY_NAMES[practiceArea.toLowerCase()] ?? practiceArea)
    : null;

  const paContext = practiceArea
    ? (PA_CONTEXT[practiceArea] ?? PA_CONTEXT[practiceArea.toLowerCase()] ?? null)
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

          {/* 1. SLA pill — most prominent signal */}
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
                <p className={`text-[11px] ${sla.accent} mt-0.5`}>{sla.sub}</p>
              </div>
            </div>
          </div>

          {/* 2. Lead metadata strip */}
          <div className="flex items-center gap-2 text-[11px] text-gray-500 font-mono">
            <span className="font-semibold text-gray-700">{leadId}</span>
            <span className="text-gray-300">·</span>
            <span className="flex-1">Arrived {elapsedText}</span>
            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">scored in 2.3s</span>
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
                    {paContext && (
                      <span className="text-[10px] text-gray-400">· {paContext}</span>
                    )}
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
            <div className="flex items-center justify-between gap-2 mt-2.5 pt-2 border-t border-gray-200/60">
              <p className="text-[11px] text-gray-500 leading-tight">{bandReason}</p>
              <span className="text-[10px] text-gray-400 whitespace-nowrap font-medium">{percentile}</span>
            </div>
          </div>

          {/* 4. Actions fired: dark log format with timestamps (past tense) */}
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2.5">
              Actions fired (automation log)
            </p>
            <div className="bg-gray-950 rounded-lg px-3 py-2.5 space-y-1 font-mono">
              {actionLog.map(entry => (
                <div key={entry.text} className="flex items-start gap-3 text-[11px] leading-relaxed">
                  <span className="text-emerald-400 flex-shrink-0 w-12">{entry.t}</span>
                  <span className="text-gray-300">{entry.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 5. Follow-up protocol: numbered forward-looking steps */}
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2.5">
              Follow-up protocol (next steps)
            </p>
            <ol className="space-y-2">
              {nextSteps.map((s, i) => (
                <li key={s} className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-[#1E2F58] text-white flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-sm text-gray-700">{s}</p>
                </li>
              ))}
            </ol>
          </div>

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
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2.5">
              CPI breakdown
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
