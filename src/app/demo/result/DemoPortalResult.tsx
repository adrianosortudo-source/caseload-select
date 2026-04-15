/**
 * DemoPortalResult — lawyer-facing portal view after intake completes.
 *
 * Shows what lands in the portal 90 seconds after a prospect submits.
 * Server component — all data is passed in from the parent page.
 */

import Link from "next/link";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const NAVY = "#1B3A6B";
const GOLD = "#C4A45A";

const BAND_CONFIG: Record<string, {
  color: string;
  bg: string;
  border: string;
  text: string;
  headline: string;
  sla: string;
  pipelineStage: string;
  nextSteps: string[];
}> = {
  A: {
    color: "#059669",
    bg: "#ecfdf5",
    border: "#6ee7b7",
    text: "#065f46",
    headline: "Priority Lead",
    sla: "Contact within 30 minutes",
    pipelineStage: "Hot Lead",
    nextSteps: [
      "Call client immediately",
      "Book same-day consultation",
      "Send priority confirmation SMS",
    ],
  },
  B: {
    color: "#2563eb",
    bg: "#eff6ff",
    border: "#93c5fd",
    text: "#1e3a8a",
    headline: "Warm Lead",
    sla: "Follow up within 1 hour",
    pipelineStage: "Warm Lead",
    nextSteps: [
      "Schedule consultation within 24 hours",
      "Send follow-up email",
      "Add to hot pipeline",
    ],
  },
  C: {
    color: "#d97706",
    bg: "#fffbeb",
    border: "#fcd34d",
    text: "#92400e",
    headline: "Qualified Lead",
    sla: "Book consultation within 24 hours",
    pipelineStage: "Qualified",
    nextSteps: [
      "Add to consultation nurture sequence",
      "Schedule call within 48 hours",
      "Send information package",
    ],
  },
  D: {
    color: "#ea580c",
    bg: "#fff7ed",
    border: "#fdba74",
    text: "#7c2d12",
    headline: "Nurture Lead",
    sla: "Follow up within 7 days",
    pipelineStage: "Nurture",
    nextSteps: [
      "Send information package",
      "Add to long-term nurture sequence",
      "Schedule 7-day check-in",
    ],
  },
  E: {
    color: "#dc2626",
    bg: "#fef2f2",
    border: "#fca5a5",
    text: "#7f1d1d",
    headline: "Outside Practice Areas",
    sla: "Decline politely",
    pipelineStage: "Declined",
    nextSteps: [
      "Send decline message with resources",
      "Log for referral tracking",
      "Suggest legal aid alternatives",
    ],
  },
};

const SCORE_FIELDS = [
  { key: "geo_score",          label: "Geographic Fit",           max: 10, section: "fit"   },
  { key: "practice_score",     label: "Practice Area Match",      max: 10, section: "fit"   },
  { key: "legitimacy_score",   label: "Case Legitimacy",          max: 10, section: "fit"   },
  { key: "referral_score",     label: "Referral Source",          max: 10, section: "fit"   },
  { key: "urgency_score",      label: "Urgency",                  max: 20, section: "value" },
  { key: "complexity_score",   label: "Case Complexity",          max: 25, section: "value" },
  { key: "multi_practice_score", label: "Multi-Practice Potential", max: 5, section: "value" },
  { key: "fee_score",          label: "Fee Potential",            max: 10, section: "value" },
];

const ENTITY_LABELS: Record<string, string> = {
  urgency:                 "Urgency",
  value_tier:              "Case Value Tier",
  prior_experience:        "Prior Legal Experience",
  emp_termination_type:    "Termination Type",
  emp_tenure:              "Employment Tenure",
  emp_severance_received:  "Severance Offered",
  contestation_level:      "Contestation Level",
  children_involved:       "Children Involved",
  prior_refusal_count:     "Prior Refusals",
  liability_clarity:       "Liability Clarity",
  treatment_status:        "Treatment Status",
  beneficiary_count:       "Beneficiary Count",
  salary_range:            "Salary Range",
  tenure_years:            "Tenure (years)",
};

const CHANNEL_LABELS: Record<string, string> = {
  widget:   "Website Widget",
  whatsapp: "WhatsApp",
  chat:     "SMS",
  email:    "Email",
  phone:    "Phone",
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function toTitleCase(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function formatEntityValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

// ─────────────────────────────────────────────
// CPI Gauge (SVG)
// ─────────────────────────────────────────────

function CpiGauge({ score, band }: { score: number; band: string }) {
  const r = 50;
  const cx = 60;
  const cy = 60;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const dashOffset = circumference * (1 - pct);
  const cfg = BAND_CONFIG[band] ?? BAND_CONFIG.E;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 120 120" className="w-36 h-36">
        {/* Track */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="10"
        />
        {/* Progress */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={cfg.color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        {/* Score */}
        <text
          x={cx} y={cy - 4}
          textAnchor="middle"
          fill="#111827"
          fontSize="26"
          fontWeight="700"
          fontFamily="system-ui, sans-serif"
        >
          {score}
        </text>
        <text
          x={cx} y={cy + 13}
          textAnchor="middle"
          fill="#9ca3af"
          fontSize="10"
          fontFamily="system-ui, sans-serif"
        >
          / 100
        </text>
      </svg>
      <span
        className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold mt-1"
        style={{ backgroundColor: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
      >
        Band {band}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────
// Score bar row
// ─────────────────────────────────────────────

function ScoreBar({ label, score, max, color }: {
  label: string; score: number; max: number; color: string;
}) {
  const pct = Math.min(100, (score / max) * 100);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-600">{label}</span>
        <span className="text-xs font-semibold text-gray-800">{score}<span className="text-gray-400 font-normal">/{max}</span></span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function DemoPortalResult({ session }: { session: Record<string, any> }) {
  const scoring = (session.scoring ?? {}) as Record<string, number> & {
    band?: string;
    _confirmed?: Record<string, unknown>;
  };

  const entities = (session.extracted_entities ?? {}) as Record<string, unknown>;
  const band = (session.band ?? scoring.band ?? "E") as string;
  const total = Math.round(scoring.total ?? 0);
  const practiceArea = session.practice_area as string | null;
  const situationSummary = session.situation_summary as string | null;
  const flags = (session.flags ?? []) as string[];
  const channel = (session.channel ?? "widget") as string;
  const createdAt = session.created_at as string;
  const cfg = BAND_CONFIG[band] ?? BAND_CONFIG.E;

  // Contact fields
  const firstName = (entities.first_name ?? "") as string;
  const lastName  = (entities.last_name  ?? "") as string;
  const fullName  = [firstName, lastName].filter(Boolean).join(" ") || "Anonymous";
  const email     = (entities.email ?? null) as string | null;
  const phone     = (entities.phone ?? null) as string | null;

  // Case data: everything in extracted_entities except contact fields and situation_summary
  const skipKeys = new Set(["first_name", "last_name", "email", "phone", "situation_summary"]);
  const caseData = Object.entries(entities)
    .filter(([k, v]) => !skipKeys.has(k) && v !== null && v !== undefined && v !== "")
    .map(([k, v]) => ({
      label: ENTITY_LABELS[k] ?? toTitleCase(k),
      value: formatEntityValue(v),
    }));

  // Fit and value sub-scores
  const fitFields   = SCORE_FIELDS.filter(f => f.section === "fit");
  const valueFields = SCORE_FIELDS.filter(f => f.section === "value");
  const fitTotal    = Math.round(scoring.fit_score   ?? fitFields.reduce((s, f) => s + (scoring[f.key] ?? 0), 0));
  const valueTotal  = Math.round(scoring.value_score ?? valueFields.reduce((s, f) => s + (scoring[f.key] ?? 0), 0));

  const receivedAt = createdAt
    ? new Date(createdAt).toLocaleString("en-CA", {
        month: "short", day: "numeric", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: true,
      })
    : "—";

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F4F3EF" }}>

      {/* ── Portal header ── */}
      <header className="sticky top-0 z-30 border-b border-white/10 shadow-sm" style={{ backgroundColor: NAVY }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Logo */}
            <div className="w-7 h-7 rounded flex items-center justify-center text-white font-bold text-xs"
              style={{ backgroundColor: GOLD }}>
              H
            </div>
            <span className="text-white text-sm font-semibold hidden sm:block">Hartwell Law PC</span>
            <span className="text-white/30 hidden sm:block text-sm">|</span>
            <span className="text-white/70 text-xs hidden sm:block">CaseLoad Screen</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs px-2.5 py-1 rounded-full font-semibold"
              style={{ backgroundColor: `${GOLD}33`, color: GOLD }}>
              Demo View
            </span>
            <Link href="/demo"
              className="text-white/60 hover:text-white text-xs transition hidden sm:block">
              ← Back to Demo
            </Link>
          </div>
        </div>
      </header>

      {/* ── Demo notice ── */}
      <div className="text-center py-2.5 px-4 text-xs text-white/90"
        style={{ backgroundColor: "#0D1520" }}>
        This is what appears in the lawyer&apos;s portal within 90 seconds of intake completing.
        <Link href="/demo" className="ml-3 underline opacity-70 hover:opacity-100 transition">
          ← Run intake again
        </Link>
      </div>

      {/* ── Priority banner ── */}
      <div className="border-b" style={{ backgroundColor: cfg.bg, borderColor: cfg.border }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center justify-center w-10 h-10 rounded-xl text-lg font-black shrink-0"
              style={{ backgroundColor: cfg.color, color: "white" }}
            >
              {band}
            </span>
            <div>
              <div className="font-bold text-sm" style={{ color: cfg.text }}>{cfg.headline}</div>
              <div className="text-xs" style={{ color: cfg.color }}>{cfg.sla}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs" style={{ color: cfg.text }}>
            <span className="font-medium">Pipeline stage:</span>
            <span className="px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: cfg.color + "22", color: cfg.color }}>
              {cfg.pipelineStage}
            </span>
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="grid lg:grid-cols-5 gap-5">

          {/* ── Left column (2 cards) ── */}
          <div className="lg:col-span-2 flex flex-col gap-5">

            {/* Lead info card */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-black/5">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">Lead</span>
              </div>
              <div className="p-5 space-y-4">
                {/* Avatar + name */}
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0"
                    style={{ backgroundColor: NAVY }}>
                    {(firstName[0] ?? "?").toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900 text-sm leading-tight">{fullName}</div>
                    {practiceArea && (
                      <span className="inline-flex mt-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize"
                        style={{ backgroundColor: `${NAVY}15`, color: NAVY }}>
                        {practiceArea}
                      </span>
                    )}
                  </div>
                </div>

                {/* Contact details */}
                <div className="space-y-2 text-xs">
                  {email && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                      </svg>
                      <span className="truncate">{email}</span>
                    </div>
                  )}
                  {phone && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
                      </svg>
                      {phone}
                    </div>
                  )}
                </div>

                {/* Meta row */}
                <div className="pt-2 border-t border-black/5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400">
                  <span>
                    <span className="font-medium text-gray-500">Source:</span>{" "}
                    {CHANNEL_LABELS[channel] ?? channel}
                  </span>
                  <span>
                    <span className="font-medium text-gray-500">Received:</span>{" "}
                    {receivedAt}
                  </span>
                </div>

                {/* Flags */}
                {flags.length > 0 && (
                  <div className="pt-2 border-t border-black/5">
                    <div className="text-[11px] font-semibold text-amber-600 mb-1.5">⚠ Flags</div>
                    <div className="flex flex-wrap gap-1.5">
                      {flags.map(flag => (
                        <span key={flag}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                          {flag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* CPI score card */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-black/5">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">Case Priority Index</span>
              </div>
              <div className="p-5">
                <CpiGauge score={total} band={band} />
                <div className="mt-4 grid grid-cols-2 gap-3 text-center">
                  <div className="bg-gray-50 rounded-xl p-3">
                    <div className="text-lg font-bold text-gray-800">{fitTotal}</div>
                    <div className="text-[10px] text-gray-400 font-medium">Fit Score <span className="text-gray-300">/40</span></div>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3">
                    <div className="text-lg font-bold text-gray-800">{valueTotal}</div>
                    <div className="text-[10px] text-gray-400 font-medium">Value Score <span className="text-gray-300">/60</span></div>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* ── Right column ── */}
          <div className="lg:col-span-3 flex flex-col gap-5">

            {/* Score breakdown card */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-black/5">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">Score Breakdown</span>
              </div>
              <div className="p-5">
                <div className="grid sm:grid-cols-2 gap-6">
                  {/* Fit */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold text-gray-700">Fit Score</span>
                      <span className="text-xs font-bold text-gray-800">{fitTotal}<span className="text-gray-400 font-normal">/40</span></span>
                    </div>
                    <div className="space-y-3">
                      {fitFields.map(f => (
                        <ScoreBar
                          key={f.key}
                          label={f.label}
                          score={Math.round(scoring[f.key] ?? 0)}
                          max={f.max}
                          color={NAVY}
                        />
                      ))}
                    </div>
                  </div>
                  {/* Value */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold text-gray-700">Value Score</span>
                      <span className="text-xs font-bold text-gray-800">{valueTotal}<span className="text-gray-400 font-normal">/60</span></span>
                    </div>
                    <div className="space-y-3">
                      {valueFields.map(f => (
                        <ScoreBar
                          key={f.key}
                          label={f.label}
                          score={Math.round(scoring[f.key] ?? 0)}
                          max={f.max}
                          color={cfg.color}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Situation summary card */}
            {situationSummary && (
              <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-black/5">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">AI Case Summary</span>
                </div>
                <div className="p-5">
                  <div className="flex gap-3">
                    <div className="w-0.5 rounded-full shrink-0 self-stretch" style={{ backgroundColor: cfg.color }} />
                    <p className="text-sm text-gray-700 leading-relaxed">{situationSummary}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Extracted case data */}
            {caseData.length > 0 && (
              <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-black/5">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                    Extracted Data Points
                    <span className="ml-2 text-gray-300 font-normal normal-case">{caseData.length} collected</span>
                  </span>
                </div>
                <div className="p-5">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {caseData.map(({ label, value }) => (
                      <div key={label} className="bg-gray-50 rounded-xl p-3">
                        <div className="text-[10px] text-gray-400 font-medium mb-0.5">{label}</div>
                        <div className="text-xs font-semibold text-gray-800 capitalize truncate">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Recommended next action */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-black/5">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">Recommended Actions</span>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex items-start gap-3 p-3 rounded-xl"
                  style={{ backgroundColor: cfg.bg, border: `1px solid ${cfg.border}` }}>
                  <span className="text-lg mt-0.5">
                    {band === "A" ? "🔥" : band === "B" ? "⚡" : band === "C" ? "📅" : band === "D" ? "📬" : "📋"}
                  </span>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: cfg.text }}>{cfg.sla}</div>
                    <div className="text-xs mt-0.5" style={{ color: cfg.color }}>Band {band} protocol active</div>
                  </div>
                </div>

                <div className="space-y-2">
                  {cfg.nextSteps.map((step, i) => (
                    <div key={step} className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 text-white"
                        style={{ backgroundColor: cfg.color }}>
                        {i + 1}
                      </span>
                      <span className="text-sm text-gray-700">{step}</span>
                    </div>
                  ))}
                </div>

                {/* Mock action buttons */}
                <div className="flex flex-wrap gap-2 pt-2">
                  <div
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-white cursor-default select-none"
                    style={{ backgroundColor: cfg.color }}
                    title="Action buttons are active in the live portal"
                  >
                    {band === "A" || band === "B" ? "Book Consultation" : band === "C" ? "Start Nurture Sequence" : "Send Follow-up"}
                  </div>
                  <div
                    className="px-4 py-2 rounded-xl text-xs font-semibold cursor-default select-none border"
                    style={{ borderColor: cfg.color, color: cfg.color }}
                    title="Action buttons are active in the live portal"
                  >
                    Add to Pipeline
                  </div>
                  <div
                    className="px-4 py-2 rounded-xl text-xs font-semibold cursor-default select-none border border-gray-200 text-gray-500"
                    title="Action buttons are active in the live portal"
                  >
                    Export Record
                  </div>
                </div>
                <p className="text-[11px] text-gray-400">
                  Action buttons trigger GHL automations in the live portal.
                </p>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="py-6 mt-4 border-t border-black/5">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-400">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded flex items-center justify-center text-white font-bold text-[9px]"
              style={{ backgroundColor: GOLD }}>
              CL
            </div>
            <span>
              Powered by <span style={{ color: NAVY }} className="font-semibold">CaseLoad Select</span>
            </span>
          </div>
          <p className="text-center">
            This is a demonstration. Hartwell Law PC is a fictional firm created for sales demo purposes.
          </p>
          <Link href="/demo" className="hover:text-gray-600 transition">
            ← Back to Demo
          </Link>
        </div>
      </footer>

    </div>
  );
}
