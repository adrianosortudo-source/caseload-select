/**
 * /demo/portal/leads/[leadId]  -  Public demo of the Dalil-style intelligence dashboard.
 *
 * No auth. Mirrors /portal/[firmId]/leads/[leadId] across all three phases:
 *   Phase 1: Score gauge, engagement signal, pipeline position, risk flags, key facts
 *   Phase 2: GPT intelligence brief (DossierPanel client component)
 *   Phase 3: Source-anchored transcript citations (embedded in DossierPanel)
 */

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getDemoFirmId } from "@/lib/demo-firm";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { getFollowupSteps } from "@/lib/intake-memo";
import DossierPanel, { type ConversationTurn, type Dossier } from "@/components/portal/DossierPanel";

export const dynamic = "force-dynamic";

// ─── Constants (mirrors portal page) ─────────────────────────────────────────

const BAND_COLOR: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800",
  B: "bg-blue-100 text-blue-800",
  C: "bg-yellow-100 text-yellow-800",
  D: "bg-orange-100 text-orange-800",
  E: "bg-red-100 text-red-800",
  X: "bg-amber-100 text-amber-900 border border-amber-300",
};

const BAND_STROKE: Record<string, string> = {
  A: "#059669", B: "#2563eb", C: "#d97706",
  D: "#ea580c", E: "#dc2626", X: "#92400e",
};

const STAGE_LABEL: Record<string, string> = {
  new_lead:                "New Lead",
  contacted:               "Contacted",
  qualified:               "Qualified",
  consultation_scheduled:  "Consult Booked",
  consultation_held:       "Consult Held",
  no_show:                 "No Show",
  proposal_sent:           "Proposal Sent",
  client_won:              "Retained",
  client_lost:             "Lost",
  needs_review:            "Needs Review",
};

const PIPELINE_STAGES = [
  { key: "new_lead",               short: "New"       },
  { key: "contacted",              short: "Contacted" },
  { key: "qualified",              short: "Qualified" },
  { key: "consultation_scheduled", short: "Consult"   },
  { key: "consultation_held",      short: "Held"      },
  { key: "proposal_sent",          short: "Proposal"  },
  { key: "client_won",             short: "Won"       },
];

function getEngagementSignal(
  urgency: string | null,
  stage: string,
  createdAt: string,
): { label: string; detail: string; level: "high" | "medium" | "low" } {
  const daysSince = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
  if (stage === "client_won")  return { label: "Retained", detail: "Successfully converted to client", level: "high" };
  if (stage === "client_lost") return { label: "Lost", detail: "Did not proceed", level: "low" };
  if (stage === "no_show")     return { label: "No-show", detail: "Missed consultation — recovery sequence active", level: "low" };
  const u = (urgency ?? "").toLowerCase();
  const isHigh = u.includes("24h") || u.includes("immediate") || u.includes("emergency") || u.includes("urgent");
  const isMedium = u.includes("week") || u.includes("soon") || u.includes("asap");
  if (isHigh && daysSince <= 1) return { label: "Urgent — respond today", detail: "High-urgency case within 24h window", level: "high" };
  if (isHigh && daysSince > 1)  return { label: "Urgent — overdue", detail: `High-urgency, ${daysSince} day${daysSince !== 1 ? "s" : ""} without response`, level: "low" };
  if (isMedium) return { label: "Active — this week", detail: "Wants resolution within the week", level: "high" };
  if (stage === "consultation_scheduled" || stage === "consultation_held") {
    return { label: "Engaged — consultation", detail: "In consultation phase", level: "high" };
  }
  if (daysSince > 14 && (stage === "new_lead" || stage === "contacted")) {
    return { label: "At risk of going cold", detail: `${daysSince} days since inquiry`, level: "low" };
  }
  if (daysSince > 7) return { label: "Follow up needed", detail: `${daysSince} days in pipeline`, level: "medium" };
  return { label: "Fresh inquiry", detail: `Submitted ${daysSince === 0 ? "today" : `${daysSince}d ago`}`, level: "high" };
}

const SIGNAL_STYLE: Record<string, string> = {
  high:   "bg-emerald-50 border-emerald-200 text-emerald-800",
  medium: "bg-amber-50 border-amber-200 text-amber-800",
  low:    "bg-red-50 border-red-200 text-red-800",
};
const SIGNAL_DOT: Record<string, string> = {
  high: "bg-emerald-500", medium: "bg-amber-500", low: "bg-red-500",
};

function formatCaseValue(value: number | null): string {
  if (value == null || value <= 0) return "—";
  if (value >= 1_000_000) { const m = value / 1_000_000; return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(2)}M`; }
  if (value >= 1_000)     { const k = value / 1_000;     return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`; }
  return `$${value}`;
}

const ENTITY_LABELS: Record<string, string> = {
  sub_type:         "Sub-type",
  value_tier:       "Value tier",
  timeline:         "Timeline",
  prior_experience: "Prior counsel",
  incident_date:    "Incident date",
  deadline:         "Deadline",
  location:         "Location",
  parties_involved: "Parties",
  employment_type:  "Employment",
  family_status:    "Family status",
};

function ScoreGauge({ score, band }: { score: number | null; band: string | null }) {
  const r = 36; const cx = 50; const cy = 52;
  const C = 2 * Math.PI * r;
  const arcLen = C * 0.75;
  const clampedScore = Math.max(0, Math.min(100, score ?? 0));
  const scoreLen = arcLen * (clampedScore / 100);
  const strokeColor = band ? (BAND_STROKE[band] ?? "#9ca3af") : "#9ca3af";
  const rot = `rotate(-225, ${cx}, ${cy})`;
  return (
    <svg viewBox="0 0 100 100" className="w-28 h-28 flex-shrink-0">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f3f4f6" strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${arcLen} ${C}`} transform={rot} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={strokeColor} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${scoreLen} ${C}`} transform={rot} />
      <text x={cx} y={cy + 2} textAnchor="middle" dominantBaseline="middle"
        fontSize="22" fontWeight="700" fill="#0d1520" fontFamily="inherit">
        {score != null ? score : "—"}
      </text>
      <text x={cx} y={cy + 16} textAnchor="middle"
        fontSize="8.5" fontWeight="600" fill="#9ca3af" fontFamily="inherit">
        {band ? (band === "X" ? "REVIEW" : `BAND ${band}`) : "NO SCORE"}
      </text>
    </svg>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DemoPortalLeadDetailPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const firmId = await getDemoFirmId();
  if (!firmId) redirect("/demo");
  const { leadId } = await params;

  const { data: lead } = await supabase
    .from("leads")
    .select(`
      id, name, email, phone, case_type, description, stage,
      band, priority_band, urgency, created_at, updated_at,
      intake_session_id, law_firm_id,
      priority_index, cpi_score, fit_score, value_score,
      geo_score, contactability_score, legitimacy_score,
      complexity_score, urgency_score, strategic_score, fee_score,
      cpi_missing_fields, cpi_confidence, estimated_value,
      source, referral_source
    `)
    .eq("id", leadId)
    .single();

  if (!lead || lead.law_firm_id !== firmId) notFound();

  // ── Fetch intake session ────────────────────────────────────────────────
  let sessionMemo: { memo_text: string | null; memo_generated_at: string | null } | null = null;
  let aiReasoning: string | null = null;
  let bandXReason: string | null = null;
  let firstMessageAt: string | null = null;
  let finalizedAt: string | null = null;
  let scoringFlags: string[] = [];
  let caseValueObj: { label: string; tier: string; rationale: string } | null = null;
  let situationSummary: string | null = null;
  let entities: Record<string, unknown> = {};
  let contact: Record<string, unknown> = {};
  let conversation: ConversationTurn[] = [];
  let existingDossier: Dossier | null = null;

  if (lead.intake_session_id) {
    const { data: sessionRow } = await supabase
      .from("intake_sessions")
      .select("memo_text, memo_generated_at, scoring, conversation, extracted_entities, situation_summary, contact")
      .eq("id", lead.intake_session_id)
      .single();
    if (sessionRow) {
      sessionMemo = { memo_text: sessionRow.memo_text, memo_generated_at: sessionRow.memo_generated_at };
      const scoring = (sessionRow.scoring as Record<string, unknown> | null) ?? {};
      const r = scoring._reasoning; if (typeof r === "string" && r.trim()) aiReasoning = r.trim();
      const bxr = scoring._band_x_reason; if (typeof bxr === "string" && bxr.trim()) bandXReason = bxr.trim();
      const meta = scoring._meta as Record<string, unknown> | undefined;
      if (meta) {
        if (typeof meta.first_message_at === "string") firstMessageAt = meta.first_message_at;
        if (typeof meta.finalized_at === "string") finalizedAt = meta.finalized_at;
      }
      if (Array.isArray(scoring._flags)) scoringFlags = (scoring._flags as string[]).filter(f => typeof f === "string");
      const cv = scoring._case_value as Record<string, string> | undefined;
      if (cv?.label) caseValueObj = cv as { label: string; tier: string; rationale: string };
      const dossierRaw = scoring._dossier;
      if (dossierRaw && typeof dossierRaw === "object") existingDossier = dossierRaw as Dossier;
      conversation = (sessionRow.conversation as ConversationTurn[] | null) ?? [];
      entities = (sessionRow.extracted_entities as Record<string, unknown> | null) ?? {};
      situationSummary = (sessionRow.situation_summary as string | null) ?? null;
      contact = (sessionRow.contact as Record<string, unknown> | null) ?? {};
    }
  }

  const band = (lead.priority_band ?? lead.band) as string | null;
  const stageLabel = STAGE_LABEL[lead.stage] ?? lead.stage;
  const missingFields = (lead.cpi_missing_fields as string[] | null) ?? [];
  const score = (lead.priority_index ?? lead.cpi_score) as number | null;
  const timeToFinalizeSec = firstMessageAt && finalizedAt
    ? Math.max(0, Math.round((new Date(finalizedAt).getTime() - new Date(firstMessageAt).getTime()) / 1000))
    : null;
  const daysInPipeline = Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86400000);
  const daysInStage    = Math.floor((Date.now() - new Date((lead.updated_at ?? lead.created_at) as string).getTime()) / 86400000);
  const stageIdx       = PIPELINE_STAGES.findIndex(s => s.key === lead.stage);
  const engSignal      = getEngagementSignal(lead.urgency as string | null, lead.stage, lead.created_at);

  const bandXReasonHuman = bandXReason
    ? bandXReason
        .replace(/^low_confidence$/, "The AI was not confident enough to score this lead automatically.")
        .replace(/^json_parse_failure$/, "The screening engine returned an unreadable response.")
        .replace(/^empty_completion$/, "The screening engine returned no response.")
        .replace(/_/g, " ")
    : null;

  const contactEmail = (lead.email as string | null) ?? (contact.email as string | null) ?? null;
  const contactPhone = (lead.phone as string | null) ?? (contact.phone as string | null) ?? null;
  const entityRows = Object.entries(ENTITY_LABELS)
    .map(([key, label]) => ({ label, value: entities[key] as string | null | undefined }))
    .filter(row => row.value && String(row.value).trim().length > 0);
  const riskFlags: Array<{ text: string; type: "missing" | "flag" }> = [
    ...missingFields.map(f => ({ text: f, type: "missing" as const })),
    ...scoringFlags.map(f => ({ text: f.replace(/_/g, " "), type: "flag" as const })),
  ];

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="text-xs text-black/40">
        <Link href="/demo/portal/leads" className="hover:text-black/70">Your Pipeline</Link>
        <span className="mx-1.5">›</span>
        <span className="text-black/60">{lead.name}</span>
      </div>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-black/5 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-navy">{lead.name}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-black/50">
              {lead.case_type && <span className="capitalize">{lead.case_type as string}</span>}
              <span>Added {new Date(lead.created_at).toLocaleDateString("en-CA")}</span>
              {timeToFinalizeSec != null && (
                <span>
                  Intake completed in{" "}
                  {timeToFinalizeSec < 90 ? `${timeToFinalizeSec}s` : `${(timeToFinalizeSec / 60).toFixed(1)} min`}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="badge bg-black/5 text-black/60">{stageLabel}</span>
            {band && (
              <span className={`badge font-bold ${BAND_COLOR[band] ?? "bg-black/5 text-black/40"}`}>
                {band === "X" ? "Needs Review" : `Band ${band}`}
              </span>
            )}
          </div>
        </div>
        {lead.description && (
          <p className="mt-4 text-sm text-black/60 leading-relaxed border-t border-black/5 pt-4">
            {lead.description as string}
          </p>
        )}
      </div>

      {/* Band X callout */}
      {band === "X" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-200 text-amber-900 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4M12 17h.01" />
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold text-amber-900">Pending operator review</div>
              <p className="mt-1 text-[13px] text-amber-900/80 leading-relaxed">
                {bandXReasonHuman ?? "This intake needs a human review before it routes to your pipeline."}{" "}
                A member of the CaseLoad Select team will triage this lead within four hours.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Phase 1: Intelligence grid ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">

        {/* Left column */}
        <div className="space-y-4">

          {/* Score gauge */}
          <div className="bg-white rounded-xl border border-black/5 p-5">
            <div className="text-[10px] font-semibold text-black/35 uppercase tracking-widest mb-4">Score</div>
            <div className="flex items-start gap-5">
              <ScoreGauge score={score} band={band} />
              <div className="flex-1 min-w-0 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] text-black/40 mb-1">Fit score</div>
                    <div className="h-1.5 rounded-full bg-black/5 overflow-hidden">
                      <div className="h-full rounded-full bg-navy/70" style={{ width: `${((lead.fit_score as number ?? 0) / 30) * 100}%` }} />
                    </div>
                    <div className="text-xs text-black/50 mt-1">{lead.fit_score as number ?? 0} / 30</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-black/40 mb-1">Value score</div>
                    <div className="h-1.5 rounded-full bg-black/5 overflow-hidden">
                      <div className="h-full rounded-full bg-navy/70" style={{ width: `${((lead.value_score as number ?? 0) / 65) * 100}%` }} />
                    </div>
                    <div className="text-xs text-black/50 mt-1">{lead.value_score as number ?? 0} / 65</div>
                  </div>
                </div>
                {aiReasoning && band !== "X" && (
                  <p className="text-xs text-black/60 leading-relaxed">{aiReasoning}</p>
                )}
                {!aiReasoning && !band && (
                  <p className="text-xs text-black/30 italic">No score available — manual lead entry.</p>
                )}
              </div>
            </div>
          </div>

          {/* Engagement signal */}
          <div className={`rounded-xl border p-4 ${SIGNAL_STYLE[engSignal.level]}`}>
            <div className="text-[10px] font-semibold uppercase tracking-widest mb-2 opacity-60">Engagement signal</div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${SIGNAL_DOT[engSignal.level]}`} />
              <span className="text-sm font-semibold">{engSignal.label}</span>
            </div>
            <p className="mt-1 text-xs opacity-75">{engSignal.detail}</p>
          </div>

          {/* Pipeline position */}
          <div className="bg-white rounded-xl border border-black/5 p-5">
            <div className="text-[10px] font-semibold text-black/35 uppercase tracking-widest mb-4">Pipeline position</div>
            {stageIdx >= 0 ? (
              <>
                <div className="relative">
                  <div className="flex items-center justify-between mb-1">
                    {PIPELINE_STAGES.map((s, i) => (
                      <div key={s.key} className="flex flex-col items-center gap-1 flex-1">
                        <div className={`w-full h-1.5 rounded-full ${i <= stageIdx ? "bg-navy" : "bg-black/10"}`} />
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    {PIPELINE_STAGES.map((s, i) => (
                      <div key={s.key} className={`flex-1 text-center text-[9px] leading-tight ${
                        i === stageIdx ? "text-navy font-bold" : "text-black/30"
                      }`}>
                        {s.short}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs text-black/50">
                  <span>{daysInPipeline} day{daysInPipeline !== 1 ? "s" : ""} in pipeline</span>
                  {daysInStage > 0 && (
                    <span className={daysInStage > 7 ? "text-amber-600 font-medium" : ""}>
                      {daysInStage}d in this stage{daysInStage > 7 ? " — consider moving" : ""}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="text-xs text-black/40 italic">Stage: {stageLabel} (terminal state)</div>
            )}
          </div>

          {/* Risk flags */}
          {riskFlags.length > 0 && (
            <div className="bg-white rounded-xl border border-black/5 p-5">
              <div className="text-[10px] font-semibold text-black/35 uppercase tracking-widest mb-3">Risk flags</div>
              <div className="flex flex-wrap gap-2">
                {riskFlags.map((flag, i) => (
                  <span key={i} className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${
                    flag.type === "missing"
                      ? "bg-amber-50 border-amber-200 text-amber-800"
                      : "bg-red-50 border-red-200 text-red-800"
                  }`}>
                    {flag.type === "missing" && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 9v4M12 17h.01" />
                        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      </svg>
                    )}
                    {flag.type === "missing" ? `Missing: ${flag.text}` : flag.text}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Key facts */}
          {(situationSummary || entityRows.length > 0) && (
            <div className="bg-white rounded-xl border border-black/5 p-5">
              <div className="text-[10px] font-semibold text-black/35 uppercase tracking-widest mb-3">Key facts</div>
              {situationSummary && <p className="text-sm text-black/70 leading-relaxed mb-3">{situationSummary}</p>}
              {entityRows.length > 0 && (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
                  {entityRows.map(row => (
                    <div key={row.label}>
                      <dt className="text-[10px] text-black/40 uppercase tracking-wide">{row.label}</dt>
                      <dd className="text-xs text-black/70 mt-0.5 capitalize">{String(row.value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-black/5 p-5">
            <div className="text-[10px] font-semibold text-black/35 uppercase tracking-widest mb-4">Case details</div>
            <dl className="space-y-3">
              {lead.case_type && (
                <div>
                  <dt className="text-[10px] text-black/40">Practice area</dt>
                  <dd className="text-xs text-black/75 mt-0.5 capitalize">{lead.case_type as string}</dd>
                </div>
              )}
              {lead.urgency && (
                <div>
                  <dt className="text-[10px] text-black/40">Urgency</dt>
                  <dd className="text-xs text-black/75 mt-0.5 capitalize">{(lead.urgency as string).replace(/_/g, " ")}</dd>
                </div>
              )}
              <div>
                <dt className="text-[10px] text-black/40">Estimated case value</dt>
                <dd className="text-xs text-black/75 mt-0.5 font-semibold">
                  {caseValueObj?.label ?? formatCaseValue(lead.estimated_value as number | null)}
                </dd>
              </div>
              {caseValueObj?.rationale && (
                <div>
                  <dt className="text-[10px] text-black/40">Value rationale</dt>
                  <dd className="text-xs text-black/60 mt-0.5 leading-relaxed">{caseValueObj.rationale}</dd>
                </div>
              )}
              <div>
                <dt className="text-[10px] text-black/40">Stage</dt>
                <dd className="text-xs text-black/75 mt-0.5">{stageLabel}</dd>
              </div>
              <div>
                <dt className="text-[10px] text-black/40">In pipeline</dt>
                <dd className="text-xs text-black/75 mt-0.5">{daysInPipeline} day{daysInPipeline !== 1 ? "s" : ""}</dd>
              </div>
              {(lead.source || lead.referral_source) && (
                <div>
                  <dt className="text-[10px] text-black/40">Source</dt>
                  <dd className="text-xs text-black/75 mt-0.5 capitalize">
                    {((lead.referral_source ?? lead.source) as string).replace(/_/g, " ")}
                  </dd>
                </div>
              )}
              {timeToFinalizeSec != null && (
                <div>
                  <dt className="text-[10px] text-black/40">Intake duration</dt>
                  <dd className="text-xs text-black/75 mt-0.5">
                    {timeToFinalizeSec < 90 ? `${timeToFinalizeSec}s` : `${(timeToFinalizeSec / 60).toFixed(1)} min`}
                  </dd>
                </div>
              )}
              {lead.cpi_confidence && (
                <div>
                  <dt className="text-[10px] text-black/40">Score confidence</dt>
                  <dd className={`text-xs mt-0.5 font-semibold capitalize ${
                    lead.cpi_confidence === "high" ? "text-emerald-700" :
                    lead.cpi_confidence === "medium" ? "text-amber-700" : "text-red-600"
                  }`}>{lead.cpi_confidence as string}</dd>
                </div>
              )}
            </dl>
          </div>

          {(contactEmail || contactPhone) && (
            <div className="bg-white rounded-xl border border-black/5 p-5">
              <div className="text-[10px] font-semibold text-black/35 uppercase tracking-widest mb-3">Contact</div>
              <dl className="space-y-2">
                {contactEmail && (
                  <div>
                    <dt className="text-[10px] text-black/40">Email</dt>
                    <dd className="text-xs text-navy mt-0.5 break-all">{contactEmail}</dd>
                  </div>
                )}
                {contactPhone && (
                  <div>
                    <dt className="text-[10px] text-black/40">Phone</dt>
                    <dd className="text-xs text-black/75 mt-0.5">{contactPhone}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {lead.intake_session_id && (
            <div className="bg-white rounded-xl border border-black/5 p-5">
              <div className="text-[10px] font-semibold text-black/35 uppercase tracking-widest mb-2">Memo</div>
              {sessionMemo?.memo_text ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Ready — scroll down
                </span>
              ) : (
                <span className="text-xs text-black/40">Pending (Band C or below)</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Phase 2 + 3: Dossier ──────────────────────────────────────── */}
      {lead.intake_session_id && (
        <DossierPanel
          leadId={lead.id}
          firmId={firmId}
          apiPath={`/api/demo/leads/${lead.id}/dossier`}
          initialDossier={existingDossier}
          conversation={conversation}
        />
      )}

      {/* Follow-up protocol */}
      {band && band !== "X" && (
        <div className="bg-white rounded-xl border border-black/5 p-5">
          <div className="text-xs font-semibold text-black/40 uppercase tracking-wide mb-3">Follow-up protocol</div>
          <ol className="space-y-2.5">
            {getFollowupSteps(band).map((step, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-navy text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-sm text-black/70 leading-snug">{step}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Case intake memo */}
      {lead.intake_session_id && (
        <div className="bg-white rounded-xl border border-black/5 overflow-hidden">
          <div className="px-5 py-4 border-b border-black/8 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Case Intake Memo</div>
              {sessionMemo?.memo_generated_at && (
                <div className="text-xs text-black/40 mt-0.5">
                  Generated {new Date(sessionMemo.memo_generated_at).toLocaleString("en-CA")}
                </div>
              )}
            </div>
            {sessionMemo?.memo_text ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 flex-shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                Memo ready
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-black/5 text-black/50 border border-black/10 rounded-full px-2 py-0.5 flex-shrink-0">
                Pending
              </span>
            )}
          </div>
          {sessionMemo?.memo_text ? (
            <pre className="px-5 py-4 text-[12px] leading-relaxed text-black/75 font-sans whitespace-pre-wrap">
              {sessionMemo.memo_text}
            </pre>
          ) : (
            <div className="px-5 py-6 text-sm text-black/40">
              Memo generation runs after Round 3 deep qualification. Not every lead qualifies
              for Round 3, so a pending state here is expected for Band C and below.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
