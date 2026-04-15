/**
 * DemoPortalResult — lawyer-facing portal view after intake completes.
 *
 * Shows what lands in the portal 90 seconds after a prospect submits:
 * - Automation sequence log (what fired and when)
 * - GHL-style pipeline card (where the lead landed in CRM)
 * - CPI score breakdown (10 scoring dimensions)
 * - Extracted case data + AI situation summary
 * - Recommended next actions
 */

import Link from "next/link";
import AutomationLog, { type AutomationEvent } from "./AutomationLog";

// ─────────────────────────────────────────────
// Brand constants
// ─────────────────────────────────────────────

const NAVY = "#1B3A6B";
const GOLD = "#C4A45A";

// ─────────────────────────────────────────────
// Band configuration
// ─────────────────────────────────────────────

const BAND_CFG: Record<string, {
  color: string; bg: string; border: string; text: string;
  headline: string; sla: string; slaMin: number;
  stage: string; stageColor: string;
  sequenceName: string;
  nextSteps: string[];
  pipelineStages: { label: string; active?: boolean; final?: boolean }[];
}> = {
  A: {
    color: "#059669", bg: "#ecfdf5", border: "#6ee7b7", text: "#065f46",
    headline: "Priority Lead", sla: "Contact within 30 minutes", slaMin: 30,
    stage: "Hot Lead", stageColor: "#059669",
    sequenceName: "Band A Priority Protocol — 3-touch same-day follow-up",
    nextSteps: ["Call client immediately", "Book same-day consultation", "Send priority confirmation SMS"],
    pipelineStages: [
      { label: "New" }, { label: "Screened" }, { label: "Hot Lead", active: true },
      { label: "Consultation" }, { label: "Retained", final: true },
    ],
  },
  B: {
    color: "#2563eb", bg: "#eff6ff", border: "#93c5fd", text: "#1e3a8a",
    headline: "Warm Lead", sla: "Follow up within 1 hour", slaMin: 60,
    stage: "Warm Lead", stageColor: "#2563eb",
    sequenceName: "Band B Consultation Sequence — 5-step 48-hour nurture",
    nextSteps: ["Schedule consultation within 24 hours", "Send follow-up email", "Add to hot pipeline"],
    pipelineStages: [
      { label: "New" }, { label: "Screened" }, { label: "Warm Lead", active: true },
      { label: "Consultation" }, { label: "Retained", final: true },
    ],
  },
  C: {
    color: "#d97706", bg: "#fffbeb", border: "#fcd34d", text: "#92400e",
    headline: "Qualified Lead", sla: "Book consultation within 24 hours", slaMin: 1440,
    stage: "Qualified", stageColor: "#d97706",
    sequenceName: "Band C Consultation Nurture — 5-step 7-day sequence",
    nextSteps: ["Schedule consultation call within 48 hours", "Send information package", "Add to consultation nurture"],
    pipelineStages: [
      { label: "New" }, { label: "Screened" }, { label: "Qualified", active: true },
      { label: "Consultation" }, { label: "Retained", final: true },
    ],
  },
  D: {
    color: "#ea580c", bg: "#fff7ed", border: "#fdba74", text: "#7c2d12",
    headline: "Nurture Lead", sla: "Follow up within 7 days", slaMin: 10080,
    stage: "Nurture", stageColor: "#ea580c",
    sequenceName: "Band D Long-term Nurture — 30-day educational drip (8 messages)",
    nextSteps: ["Send information package", "Add to 30-day nurture sequence", "Schedule 7-day check-in"],
    pipelineStages: [
      { label: "New" }, { label: "Screened" }, { label: "Nurture", active: true },
      { label: "Long-term" }, { label: "Re-engage", final: true },
    ],
  },
  E: {
    color: "#dc2626", bg: "#fef2f2", border: "#fca5a5", text: "#7f1d1d",
    headline: "Outside Practice Areas", sla: "Decline politely", slaMin: 0,
    stage: "Declined", stageColor: "#dc2626",
    sequenceName: "Band E Decline Protocol — 1-message close + referral log",
    nextSteps: ["Send decline message with resources", "Log for referral tracking", "Suggest legal aid alternatives"],
    pipelineStages: [
      { label: "New" }, { label: "Screened" }, { label: "Declined", active: true, final: true },
    ],
  },
};

// ─────────────────────────────────────────────
// Score field definitions
// ─────────────────────────────────────────────

const SCORE_FIELDS = [
  { key: "geo_score",            label: "Geographic Fit",           max: 10, section: "fit"   },
  { key: "practice_score",       label: "Practice Area Match",      max: 10, section: "fit"   },
  { key: "legitimacy_score",     label: "Case Legitimacy",          max: 10, section: "fit"   },
  { key: "referral_score",       label: "Referral Source",          max: 10, section: "fit"   },
  { key: "urgency_score",        label: "Urgency",                  max: 20, section: "value" },
  { key: "complexity_score",     label: "Case Complexity",          max: 25, section: "value" },
  { key: "multi_practice_score", label: "Multi-Practice Potential", max: 5,  section: "value" },
  { key: "fee_score",            label: "Fee Potential",            max: 10, section: "value" },
];

const ENTITY_LABELS: Record<string, string> = {
  urgency:                "Urgency",
  value_tier:             "Case Value Tier",
  prior_experience:       "Prior Legal Experience",
  emp_termination_type:   "Termination Type",
  emp_tenure:             "Employment Tenure",
  emp_severance_received: "Severance Offered",
  contestation_level:     "Contestation Level",
  children_involved:      "Children Involved",
  prior_refusal_count:    "Prior Refusals",
  liability_clarity:      "Liability Clarity",
  treatment_status:       "Treatment Status",
  beneficiary_count:      "Beneficiary Count",
  salary_range:           "Salary Range",
  tenure_years:           "Tenure (years)",
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
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function fmtTime(base: string, offsetMs: number): string {
  const d = new Date(new Date(base).getTime() + offsetMs);
  return d.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function slaDisplay(createdAt: string, slaMin: number): { label: string; pct: number; color: string } {
  if (slaMin === 0) return { label: "No SLA", pct: 100, color: "#6b7280" };
  const elapsed = (Date.now() - new Date(createdAt).getTime()) / 60000;
  const remaining = Math.max(0, slaMin - elapsed);
  const pct = Math.min(100, (remaining / slaMin) * 100);

  let label: string;
  if (remaining <= 0) {
    label = "SLA window closed";
  } else if (remaining < 60) {
    label = `${Math.round(remaining)} min remaining`;
  } else if (remaining < 1440) {
    const h = Math.floor(remaining / 60);
    const m = Math.round(remaining % 60);
    label = `${h}h ${m}m remaining`;
  } else {
    const d = Math.floor(remaining / 1440);
    label = `${d} day${d !== 1 ? "s" : ""} remaining`;
  }

  const color = pct > 60 ? "#059669" : pct > 25 ? "#d97706" : "#dc2626";
  return { label, pct, color };
}

// ─────────────────────────────────────────────
// Automation events builder
// ─────────────────────────────────────────────

function buildEvents(params: {
  band: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  practiceArea: string | null;
  cpiScore: number;
  channel: string;
  createdAt: string;
}): AutomationEvent[] {
  const { band, firstName, lastName, email, phone, practiceArea, cpiScore, channel, createdAt } = params;
  const t = (ms: number) => fmtTime(createdAt, ms);
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || "Client";
  const pa = practiceArea ?? "General Law";
  const paSlug = pa.toLowerCase().replace(/\s+/g, "-");
  const ch = channel === "chat" ? "sms" : channel;
  const contact = email ?? phone ?? "anonymous";

  const smsCopy: Record<string, string> = {
    A: `Your matter has been reviewed and flagged as priority. A lawyer from Hartwell Law will call you within 30 minutes.`,
    B: `We've reviewed your inquiry. A lawyer will follow up within the hour to discuss your options.`,
    C: `We've reviewed your matter and will be in touch within 24 hours to schedule a consultation.`,
    D: `We've received your inquiry and will follow up within the week with relevant information.`,
    E: `This matter falls outside our current practice areas. We've emailed you resources that may help.`,
  };

  const alertCopy: Record<string, string> = {
    A: `🔥 PRIORITY — ${fullName} · ${pa} · CPI ${cpiScore} · respond within 30 min`,
    B: `⚡ WARM — ${fullName} · ${pa} · CPI ${cpiScore} · follow up within 1 hour`,
    C: `📅 QUALIFIED — ${fullName} · ${pa} · CPI ${cpiScore} · schedule consultation`,
    D: `📬 NURTURE — ${fullName} · ${pa} · CPI ${cpiScore} · 7-day sequence started`,
    E: `📋 DECLINED — ${fullName} · ${pa} · Band E · decline message sent`,
  };

  const events: AutomationEvent[] = [
    {
      time: t(0), icon: "crm",
      text: "Lead registered in CRM",
      sub: `${fullName} · ${contact} · ${CHANNEL_LABELS[ch] ?? ch}`,
    },
    {
      time: t(700), icon: "check",
      text: "Tags applied",
      sub: `band:${band} · practice:${paSlug} · channel:${ch} · intake-v3${email ? " · verified" : ""}`,
    },
  ];

  if (band === "A" || band === "B") {
    events.push(
      {
        time: t(1200), icon: "check",
        text: `Pipeline stage set → ${band === "A" ? "Hot Lead" : "Warm Lead"}`,
        sub: "Hartwell Law intake pipeline updated",
      },
      {
        time: t(1800), icon: "check",
        text: `${band === "A" ? "Band A Priority Protocol activated" : "Band B consultation sequence activated"}`,
        sub: band === "A"
          ? "3-touch same-day follow-up — call + SMS + booking link"
          : "5-step 48-hour consultation nurture — email + SMS",
      },
      {
        time: t(2400), icon: "sms",
        text: `SMS dispatched → ${firstName || "client"}`,
        sub: `"${smsCopy[band]} — Hartwell Law PC"`,
      },
      {
        time: t(3000), icon: "alert",
        text: "Lawyer notification sent",
        sub: alertCopy[band],
      },
      {
        time: t(3300), icon: "clock",
        text: `${band === "A" ? "30-minute" : "1-hour"} SLA timer started`,
        sub: `Response window active — breach triggers ${band === "A" ? "senior lawyer escalation" : "partner alert"}`,
      },
    );
    if (email) {
      events.push({
        time: t(3800), icon: "mail",
        text: "Consultation booking link emailed",
        sub: `Calendar invite with available slots sent to ${email}`,
      });
    }
  } else if (band === "C") {
    events.push(
      {
        time: t(1200), icon: "check",
        text: "Pipeline stage set → Qualified",
        sub: "Hartwell Law intake pipeline updated",
      },
      {
        time: t(1800), icon: "check",
        text: "Band C consultation nurture activated",
        sub: "5-step 7-day sequence — consultation-focused",
      },
      {
        time: t(2400), icon: "sms",
        text: `SMS dispatched → ${firstName || "client"}`,
        sub: `"${smsCopy.C} — Hartwell Law PC"`,
      },
      {
        time: t(2900), icon: "alert",
        text: "Lawyer notification sent",
        sub: alertCopy.C,
      },
      {
        time: t(3200), icon: "clock",
        text: "24-hour SLA timer started",
        sub: "Consultation scheduling window active",
      },
    );
    if (email) {
      events.push({
        time: t(3700), icon: "mail",
        text: "Welcome email sent",
        sub: `${pa} information package delivered to ${email}`,
      });
    }
  } else if (band === "D") {
    events.push(
      {
        time: t(1200), icon: "check",
        text: "Pipeline stage set → Nurture",
        sub: "Hartwell Law intake pipeline updated",
      },
      {
        time: t(1800), icon: "check",
        text: "Band D long-term nurture activated",
        sub: "30-day educational drip — 8 messages over 4 weeks",
      },
      {
        time: t(2400), icon: "alert",
        text: "Lawyer notification sent",
        sub: alertCopy.D,
      },
      {
        time: t(2900), icon: "clock",
        text: "7-day follow-up task created",
        sub: "Reminder queued for assigned lawyer",
      },
    );
    if (email) {
      events.push({
        time: t(3400), icon: "mail",
        text: "Information package emailed",
        sub: `${pa} resources and next steps sent to ${email}`,
      });
    }
  } else {
    // Band E
    events.push(
      {
        time: t(1200), icon: "check",
        text: "Pipeline stage set → Declined",
        sub: "Outside practice areas — Band E protocol triggered",
      },
      {
        time: t(1800), icon: "sms",
        text: `SMS dispatched → ${firstName || "client"}`,
        sub: `"${smsCopy.E} — Hartwell Law PC"`,
      },
    );
    if (email) {
      events.push({
        time: t(2200), icon: "mail",
        text: "Resources email sent",
        sub: `Alternative legal resources and referral links sent to ${email}`,
      });
    }
    events.push(
      {
        time: t(2600), icon: "crm",
        text: "Referral log entry created",
        sub: `${pa} · logged for referral partner network`,
      },
      {
        time: t(3000), icon: "alert",
        text: "Lawyer notification sent",
        sub: alertCopy.E,
      },
    );
  }

  return events;
}

// ─────────────────────────────────────────────
// CPI gauge SVG
// ─────────────────────────────────────────────

function CpiGauge({ score, band }: { score: number; band: string }) {
  const cfg = BAND_CFG[band] ?? BAND_CFG.E;
  const r = 50;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(100, Math.max(0, score)) / 100);
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 120 120" className="w-32 h-32">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#e5e7eb" strokeWidth="10" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={cfg.color} strokeWidth="10"
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
          transform="rotate(-90 60 60)" />
        <text x="60" y="57" textAnchor="middle" fill="#111827" fontSize="26"
          fontWeight="700" fontFamily="system-ui,sans-serif">{score}</text>
        <text x="60" y="71" textAnchor="middle" fill="#9ca3af" fontSize="10"
          fontFamily="system-ui,sans-serif">/ 100</text>
      </svg>
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold mt-1"
        style={{ backgroundColor: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
        Band {band}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────
// Score bar
// ─────────────────────────────────────────────

function ScoreBar({ label, score, max, color }: {
  label: string; score: number; max: number; color: string;
}) {
  const pct = Math.min(100, (score / max) * 100);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-600">{label}</span>
        <span className="text-xs font-semibold text-gray-800">
          {score}<span className="text-gray-400 font-normal">/{max}</span>
        </span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Pipeline stages strip
// ─────────────────────────────────────────────

function PipelineStrip({ stages }: {
  stages: { label: string; active?: boolean; final?: boolean }[];
}) {
  return (
    <div className="flex items-center gap-0 w-full overflow-x-auto">
      {stages.map((s, i) => (
        <div key={s.label} className="flex items-center shrink-0">
          <div className={`px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${
            s.active
              ? "text-white"
              : "text-gray-400 bg-gray-50"
          }`}
            style={s.active ? { backgroundColor: BAND_CFG[stages.find(x=>x.active)?.label ?? ""] ? "#111" : "#111" } : {}}>
            {s.active
              ? <span className="text-white font-bold">{s.label}</span>
              : s.label
            }
          </div>
          {i < stages.length - 1 && (
            <svg className="w-3 h-3 text-gray-300 mx-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function DemoPortalResult({ session }: { session: Record<string, any> }) {
  const scoring  = (session.scoring   ?? {}) as Record<string, number> & { band?: string };
  const entities = (session.extracted_entities ?? {}) as Record<string, unknown>;
  const band     = (session.band ?? scoring.band ?? "E") as string;
  const total    = Math.round(scoring.total ?? 0);
  const cfg      = BAND_CFG[band] ?? BAND_CFG.E;

  const practiceArea     = (session.practice_area    ?? null) as string | null;
  const situationSummary = (session.situation_summary ?? null) as string | null;
  const flags            = (session.flags ?? [])   as string[];
  const channel          = (session.channel ?? "widget") as string;
  const createdAt        = (session.created_at ?? new Date().toISOString()) as string;

  // Contact
  const firstName = String(entities.first_name ?? "");
  const lastName  = String(entities.last_name  ?? "");
  const fullName  = [firstName, lastName].filter(Boolean).join(" ") || "Anonymous";
  const email     = (entities.email ?? null) as string | null;
  const phone     = (entities.phone ?? null) as string | null;

  // Case data chips (strip contact + summary keys)
  const skipKeys = new Set(["first_name", "last_name", "email", "phone", "situation_summary"]);
  const caseData = Object.entries(entities)
    .filter(([k, v]) => !skipKeys.has(k) && v !== null && v !== undefined && v !== "")
    .map(([k, v]) => ({ label: ENTITY_LABELS[k] ?? toTitleCase(k), value: formatEntityValue(v) }));

  // Scores
  const fitFields   = SCORE_FIELDS.filter(f => f.section === "fit");
  const valueFields = SCORE_FIELDS.filter(f => f.section === "value");
  const fitTotal    = Math.round(scoring.fit_score   ?? fitFields.reduce((s, f) => s + (scoring[f.key] ?? 0), 0));
  const valueTotal  = Math.round(scoring.value_score ?? valueFields.reduce((s, f) => s + (scoring[f.key] ?? 0), 0));

  // SLA
  const sla = slaDisplay(createdAt, cfg.slaMin);

  // Received at
  const receivedAt = new Date(createdAt).toLocaleString("en-CA", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });

  // Tags
  const chSlug = channel === "chat" ? "sms" : channel;
  const tags = [
    `band:${band}`,
    practiceArea ? `practice:${practiceArea.toLowerCase().replace(/\s+/g, "-")}` : null,
    `channel:${chSlug}`,
    "intake-v3",
    email ? "verified" : null,
  ].filter(Boolean) as string[];

  // Automation events
  const automationEvents = buildEvents({
    band, firstName, lastName, email, phone,
    practiceArea, cpiScore: total, channel, createdAt,
  });

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F4F3EF" }}>

      {/* ── Portal header ── */}
      <header className="sticky top-0 z-30 border-b border-white/10 shadow-sm" style={{ backgroundColor: NAVY }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded flex items-center justify-center text-white font-bold text-xs"
              style={{ backgroundColor: GOLD }}>H</div>
            <span className="text-white text-sm font-semibold hidden sm:block">Hartwell Law PC</span>
            <span className="text-white/30 hidden sm:block text-sm">|</span>
            <span className="text-white/70 text-xs hidden sm:block">CaseLoad Screen</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs px-2.5 py-1 rounded-full font-semibold"
              style={{ backgroundColor: `${GOLD}33`, color: GOLD }}>Demo View</span>
            <Link href="/demo" className="text-white/60 hover:text-white text-xs transition hidden sm:block">
              ← Back to Demo
            </Link>
          </div>
        </div>
      </header>

      {/* ── Demo notice ── */}
      <div className="text-center py-2.5 px-4 text-xs text-white/90" style={{ backgroundColor: "#0D1520" }}>
        This is what appears in the lawyer&apos;s portal within 90 seconds of intake completing.
        <Link href="/demo" className="ml-3 underline opacity-70 hover:opacity-100 transition">
          ← Run intake again
        </Link>
      </div>

      {/* ── Priority banner ── */}
      <div className="border-b" style={{ backgroundColor: cfg.bg, borderColor: cfg.border }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl text-lg font-black shrink-0 text-white"
              style={{ backgroundColor: cfg.color }}>
              {band}
            </span>
            <div>
              <div className="font-bold text-sm" style={{ color: cfg.text }}>{cfg.headline}</div>
              <div className="text-xs font-medium" style={{ color: cfg.color }}>{cfg.sla}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs" style={{ color: cfg.text }}>
            <span className="font-medium">Pipeline stage:</span>
            <span className="px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: cfg.color + "22", color: cfg.color }}>
              {cfg.stage}
            </span>
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* ── Row 1: Automation log + Pipeline card ── */}
        <div className="grid lg:grid-cols-5 gap-5">

          {/* Automation log */}
          <div className="lg:col-span-3 bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-black/5 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                  Automation Sequence
                </span>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Fired automatically at intake completion
                </p>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200">
                Live
              </span>
            </div>
            <div className="px-5 py-4">
              <AutomationLog events={automationEvents} />
            </div>
          </div>

          {/* GHL-style pipeline card */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden flex flex-col">

            {/* Card header — GHL-style grey bar */}
            <div className="px-4 py-2.5 border-b border-black/5 flex items-center justify-between"
              style={{ backgroundColor: "#F8F8F8" }}>
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">GoHighLevel</div>
                <div className="text-xs font-semibold text-gray-700">Hartwell Law — Intake Pipeline</div>
              </div>
              <svg className="w-5 h-5 text-gray-300" viewBox="0 0 40 40" fill="currentColor">
                <path d="M20 0C8.95 0 0 8.95 0 20s8.95 20 20 20 20-8.95 20-20S31.05 0 20 0zm0 6c3.87 0 7 3.13 7 7s-3.13 7-7 7-7-3.13-7-7 3.13-7 7-7zm0 28c-4.67 0-8.82-2.12-11.6-5.44C10.4 26.11 15 24 20 24s9.6 2.11 11.6 5.56C29.82 32.88 25.67 34 20 34z"/>
              </svg>
            </div>

            {/* Pipeline stage strip */}
            <div className="px-4 py-3 border-b border-black/5 bg-gray-50">
              <div className="text-[10px] text-gray-400 font-medium mb-2">Pipeline Stage</div>
              <div className="flex items-center gap-1 flex-wrap">
                {cfg.pipelineStages.map((s, i) => (
                  <div key={s.label} className="flex items-center">
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                        s.active ? "text-white" : "text-gray-400 bg-white border border-gray-200"
                      }`}
                      style={s.active ? { backgroundColor: cfg.color } : {}}
                    >
                      {s.label}
                    </span>
                    {i < cfg.pipelineStages.length - 1 && (
                      <svg className="w-2.5 h-2.5 text-gray-300 mx-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                      </svg>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Lead card body */}
            <div className="p-4 flex-1 space-y-3">
              {/* Name + band */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
                    style={{ backgroundColor: NAVY }}>
                    {(firstName[0] ?? "?").toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900 text-sm leading-tight">{fullName}</div>
                    {practiceArea && (
                      <div className="text-[11px] text-gray-500 mt-0.5 capitalize">{practiceArea}</div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-xs font-black px-2 py-0.5 rounded-md text-white"
                    style={{ backgroundColor: cfg.color }}>
                    {band}
                  </span>
                  <span className="text-[11px] font-bold text-gray-700">{total}<span className="text-gray-400 font-normal text-[10px]"> CPI</span></span>
                </div>
              </div>

              {/* Contact */}
              <div className="space-y-1 text-xs text-gray-500">
                {email && <div className="flex items-center gap-1.5"><span className="w-3 text-gray-300">@</span>{email}</div>}
                {phone && <div className="flex items-center gap-1.5"><span className="w-3 text-gray-300">📞</span>{phone}</div>}
                <div className="flex items-center gap-1.5">
                  <span className="w-3 text-gray-300">↗</span>
                  {CHANNEL_LABELS[chSlug] ?? chSlug} · {receivedAt}
                </div>
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-1">
                {tags.map(tag => (
                  <span key={tag}
                    className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium"
                    style={{ backgroundColor: `${NAVY}10`, color: NAVY }}>
                    {tag}
                  </span>
                ))}
              </div>

              {/* Sequence active */}
              <div className="rounded-lg px-3 py-2 text-[11px]"
                style={{ backgroundColor: cfg.bg, color: cfg.text }}>
                <span className="font-semibold">Sequence active:</span>{" "}
                {cfg.sequenceName}
              </div>

              {/* SLA */}
              {cfg.slaMin > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1 text-[11px]">
                    <span className="text-gray-500 font-medium">SLA</span>
                    <span className="font-semibold" style={{ color: sla.color }}>{sla.label}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${sla.pct}%`, backgroundColor: sla.color }} />
                  </div>
                </div>
              )}
            </div>

            {/* Mock action buttons */}
            <div className="px-4 pb-4 flex gap-2">
              <div className="flex-1 py-2 rounded-lg text-[11px] font-semibold text-white text-center cursor-default"
                style={{ backgroundColor: cfg.color }}
                title="Opens contact record in GoHighLevel">
                Open Contact
              </div>
              <div className="flex-1 py-2 rounded-lg text-[11px] font-semibold text-center cursor-default border"
                style={{ borderColor: cfg.color, color: cfg.color }}
                title="Triggers booking sequence">
                Book Consult
              </div>
            </div>
          </div>
        </div>

        {/* ── Row 2: CPI + Score breakdown ── */}
        <div className="grid lg:grid-cols-5 gap-5">

          {/* CPI + lead info */}
          <div className="lg:col-span-2 flex flex-col gap-5">

            {/* Lead info */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-black/5">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">Lead</span>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0"
                    style={{ backgroundColor: NAVY }}>
                    {(firstName[0] ?? "?").toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900 text-sm">{fullName}</div>
                    {practiceArea && (
                      <span className="inline-flex mt-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize"
                        style={{ backgroundColor: `${NAVY}15`, color: NAVY }}>
                        {practiceArea}
                      </span>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5 text-xs text-gray-600">
                  {email && <div>{email}</div>}
                  {phone && <div>{phone}</div>}
                </div>
                <div className="pt-2 border-t border-black/5 text-[11px] text-gray-400 space-y-0.5">
                  <div><span className="font-medium text-gray-500">Source:</span> {CHANNEL_LABELS[chSlug] ?? chSlug}</div>
                  <div><span className="font-medium text-gray-500">Received:</span> {receivedAt}</div>
                </div>
                {flags.length > 0 && (
                  <div className="pt-2 border-t border-black/5">
                    <div className="text-[11px] font-semibold text-amber-600 mb-1.5">⚠ Flags</div>
                    <div className="flex flex-wrap gap-1.5">
                      {flags.map(f => (
                        <span key={f}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* CPI gauge */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-black/5">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">Case Priority Index</span>
              </div>
              <div className="p-5">
                <CpiGauge score={total} band={band} />
                <div className="mt-4 grid grid-cols-2 gap-3 text-center">
                  <div className="bg-gray-50 rounded-xl p-3">
                    <div className="text-lg font-bold text-gray-800">{fitTotal}</div>
                    <div className="text-[10px] text-gray-400">Fit <span className="text-gray-300">/40</span></div>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3">
                    <div className="text-lg font-bold text-gray-800">{valueTotal}</div>
                    <div className="text-[10px] text-gray-400">Value <span className="text-gray-300">/60</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Score breakdown + case data + summary + next actions */}
          <div className="lg:col-span-3 flex flex-col gap-5">

            {/* Score breakdown */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-black/5">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">Score Breakdown</span>
              </div>
              <div className="p-5 grid sm:grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-gray-700">Fit Score</span>
                    <span className="text-xs font-bold text-gray-800">{fitTotal}<span className="text-gray-400 font-normal">/40</span></span>
                  </div>
                  <div className="space-y-3">
                    {fitFields.map(f => (
                      <ScoreBar key={f.key} label={f.label}
                        score={Math.round(scoring[f.key] ?? 0)} max={f.max} color={NAVY} />
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-gray-700">Value Score</span>
                    <span className="text-xs font-bold text-gray-800">{valueTotal}<span className="text-gray-400 font-normal">/60</span></span>
                  </div>
                  <div className="space-y-3">
                    {valueFields.map(f => (
                      <ScoreBar key={f.key} label={f.label}
                        score={Math.round(scoring[f.key] ?? 0)} max={f.max} color={cfg.color} />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Situation summary */}
            {situationSummary && (
              <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-black/5">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">AI Case Summary</span>
                </div>
                <div className="p-5 flex gap-3">
                  <div className="w-0.5 rounded-full shrink-0 self-stretch" style={{ backgroundColor: cfg.color }} />
                  <p className="text-sm text-gray-700 leading-relaxed">{situationSummary}</p>
                </div>
              </div>
            )}

            {/* Extracted data points */}
            {caseData.length > 0 && (
              <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-black/5">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                    Extracted Data Points
                    <span className="ml-2 text-gray-300 font-normal normal-case">{caseData.length} collected</span>
                  </span>
                </div>
                <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {caseData.map(({ label, value }) => (
                    <div key={label} className="bg-gray-50 rounded-xl p-3">
                      <div className="text-[10px] text-gray-400 font-medium mb-0.5">{label}</div>
                      <div className="text-xs font-semibold text-gray-800 capitalize truncate">{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommended next actions */}
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
                <div className="space-y-2.5">
                  {cfg.nextSteps.map((step, i) => (
                    <div key={step} className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 text-white"
                        style={{ backgroundColor: cfg.color }}>{i + 1}</span>
                      <span className="text-sm text-gray-700">{step}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <div className="px-4 py-2 rounded-xl text-xs font-semibold text-white cursor-default"
                    style={{ backgroundColor: cfg.color }}
                    title="Active in live portal">
                    {band === "A" || band === "B" ? "Book Consultation" : band === "C" ? "Start Nurture" : "Send Follow-up"}
                  </div>
                  <div className="px-4 py-2 rounded-xl text-xs font-semibold cursor-default border"
                    style={{ borderColor: cfg.color, color: cfg.color }}
                    title="Active in live portal">
                    Add to Pipeline
                  </div>
                  <div className="px-4 py-2 rounded-xl text-xs font-semibold cursor-default border border-gray-200 text-gray-500"
                    title="Active in live portal">
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
              style={{ backgroundColor: GOLD }}>CL</div>
            <span>Powered by <span style={{ color: NAVY }} className="font-semibold">CaseLoad Select</span></span>
          </div>
          <p>Hartwell Law PC is a fictional firm created for demo purposes.</p>
          <Link href="/demo" className="hover:text-gray-600 transition">← Back to Demo</Link>
        </div>
      </footer>

    </div>
  );
}
