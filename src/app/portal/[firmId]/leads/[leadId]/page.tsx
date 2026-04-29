/**
 * /portal/[firmId]/leads/[leadId]
 *
 * Firm-facing lead detail. Read-only. Shows the case intake memo, follow-up
 * protocol by CPI band, intake description, and a minimal status strip.
 *
 * Deliberately omits operator-only fields (raw CPI component breakdown, AI
 * rationale, internal scoring weights) to match the existing portal contract.
 * The memo itself is the lawyer-facing deliverable and is intended for this
 * surface.
 *
 * Auth: enforced here (parity with the pipeline table page). Firm must own
 * both the portal session AND the lead's law_firm_id.
 */

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getPortalSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { getFollowupSteps } from "@/lib/intake-memo";
import { buildScoreRationale, type RationaleBand } from "@/lib/score-rationale";
import ScoreRationaleBlock from "@/components/ScoreRationaleBlock";

export const dynamic = "force-dynamic";

const BAND_COLOR: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800",
  B: "bg-blue-100 text-blue-800",
  C: "bg-yellow-100 text-yellow-800",
  D: "bg-orange-100 text-orange-800",
  E: "bg-red-100 text-red-800",
  // KB-23 Lesson 02: Band X = Needs Review. Distinct amber treatment so the
  // firm can spot pending operator triage at a glance.
  X: "bg-amber-100 text-amber-900 border border-amber-300",
};

const STAGE_LABEL: Record<string, string> = {
  new_lead: "New Lead",
  contacted: "Contacted",
  qualified: "Qualified",
  consultation_scheduled: "Consult Booked",
  consultation_held: "Consult Held",
  no_show: "No Show",
  proposal_sent: "Proposal Sent",
  client_won: "Retained",
  client_lost: "Lost",
  needs_review: "Needs Review",
};

export default async function PortalLeadDetailPage({
  params,
}: {
  params: Promise<{ firmId: string; leadId: string }>;
}) {
  const session = await getPortalSession();
  const { firmId, leadId } = await params;

  if (!session || session.firm_id !== firmId) {
    redirect("/portal/login");
  }

  const { data: lead } = await supabase
    .from("leads")
    .select("id, name, case_type, description, stage, band, priority_band, urgency, created_at, intake_session_id, law_firm_id, priority_index, cpi_score, fit_score, value_score, geo_score, contactability_score, legitimacy_score, complexity_score, urgency_score, strategic_score, fee_score, cpi_missing_fields")
    .eq("id", leadId)
    .single();

  if (!lead || lead.law_firm_id !== firmId) notFound();

  // Fetch intake session memo + scoring metadata if this lead came from a
  // widget intake. The scoring jsonb carries the engine's reasoning string
  // (KB-23 Lesson 01), the Band X fallback reason if it fired (Lesson 02),
  // and the speed-to-lead timestamps (Lesson 03), all of which we surface
  // operator-side on this page.
  let sessionMemo: { memo_text: string | null; memo_generated_at: string | null } | null = null;
  let aiReasoning: string | null = null;
  let bandXReason: string | null = null;
  let firstMessageAt: string | null = null;
  let finalizedAt: string | null = null;
  if (lead.intake_session_id) {
    const { data: sessionRow } = await supabase
      .from("intake_sessions")
      .select("memo_text, memo_generated_at, scoring")
      .eq("id", lead.intake_session_id)
      .single();
    if (sessionRow) {
      sessionMemo = { memo_text: sessionRow.memo_text, memo_generated_at: sessionRow.memo_generated_at };
      const scoring = (sessionRow.scoring as Record<string, unknown> | null) ?? null;
      if (scoring) {
        const r = scoring._reasoning;
        if (typeof r === "string" && r.trim().length > 0) aiReasoning = r.trim();
        const bxr = scoring._band_x_reason;
        if (typeof bxr === "string" && bxr.trim().length > 0) bandXReason = bxr.trim();
        const meta = scoring._meta as Record<string, unknown> | undefined;
        if (meta) {
          if (typeof meta.first_message_at === "string") firstMessageAt = meta.first_message_at;
          if (typeof meta.finalized_at === "string") finalizedAt = meta.finalized_at;
        }
      }
    }
  }

  // Format human-readable Band X reason. The internal codes are snake_case
  // so render them as plain English for the firm's view.
  const bandXReasonHuman = bandXReason
    ? bandXReason
        .replace(/^low_confidence$/, "The AI was not confident enough to score this lead automatically.")
        .replace(/^json_parse_failure$/, "The screening engine returned an unreadable response.")
        .replace(/^empty_completion$/, "The screening engine returned no response.")
        .replace(/_/g, " ")
    : null;

  // Time-to-finalize for the operator audit. Only meaningful when both
  // timestamps exist  -  pre-KB23 sessions have neither.
  const timeToFinalizeSec =
    firstMessageAt && finalizedAt
      ? Math.max(0, Math.round((new Date(finalizedAt).getTime() - new Date(firstMessageAt).getTime()) / 1000))
      : null;

  const band = (lead.priority_band ?? lead.band) as string | null;
  const stageLabel = STAGE_LABEL[lead.stage] ?? lead.stage;

  // Structured "why this band" rationale. Compact mode hides the raw
  // sub-score breakdown (strengths/weaknesses with numeric values) since
  // portal surfaces deliberately omit operator-only scoring internals  -
  // firms see the band verdict and call questions, not component scores.
  const missingFields = (lead.cpi_missing_fields as string[] | null) ?? [];
  const rationale = band
    ? buildScoreRationale({
        band: band as RationaleBand,
        total: (lead.priority_index ?? lead.cpi_score ?? 0) as number,
        fit: { value: (lead.fit_score ?? 0) as number, max: 30 },
        val: { value: (lead.value_score ?? 0) as number, max: 65 },
        components: [
          { label: "Geographic fit",    value: (lead.geo_score            ?? 0) as number, max: 10 },
          { label: "Contactability",    value: (lead.contactability_score ?? 0) as number, max: 10 },
          { label: "Inquiry legitimacy", value: (lead.legitimacy_score    ?? 0) as number, max: 10 },
          { label: "Case complexity",   value: (lead.complexity_score     ?? 0) as number, max: 25 },
          { label: "Urgency",           value: (lead.urgency_score        ?? 0) as number, max: 20 },
          { label: "Strategic value",   value: (lead.strategic_score      ?? 0) as number, max: 10 },
          { label: "Fee capacity",      value: (lead.fee_score            ?? 0) as number, max: 10 },
        ],
        missingFields,
      })
    : null;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="text-xs text-black/40">
        <Link href={`/portal/${firmId}/leads`} className="hover:text-black/70">
          Your Pipeline
        </Link>
        <span className="mx-1.5">›</span>
        <span className="text-black/60">{lead.name}</span>
      </div>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-black/5 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-navy">{lead.name}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-black/50">
              {lead.case_type && (
                <span className="capitalize">{lead.case_type}</span>
              )}
              <span>Added {new Date(lead.created_at).toLocaleDateString("en-CA")}</span>
              {timeToFinalizeSec != null && (
                <span title="Time from first message to finalize">
                  Intake completed in{" "}
                  {timeToFinalizeSec < 90
                    ? `${timeToFinalizeSec} seconds`
                    : `${(timeToFinalizeSec / 60).toFixed(1)} minutes`}
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
            {lead.description}
          </p>
        )}
      </div>

      {/* Band X callout  -  surfaced before everything else when the engine
         routed this session to manual triage. Tells the firm exactly what
         happened and what to expect next. */}
      {band === "X" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-200 text-amber-900 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4M12 17h.01" />
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-amber-900">Pending operator review</div>
              <p className="mt-1.5 text-[13px] text-amber-900/80 leading-relaxed">
                {bandXReasonHuman ?? "This intake needs a human review before it routes to your pipeline."} A member of the CaseLoad Select team will triage this lead within four hours and assign the correct band manually.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* AI reasoning card  -  the operator-side audit string. KB-23 Lesson
         01: every band ships with 2-4 sentences explaining why, referencing
         the prospect's actual stated facts. Not shown for Band X (where the
         band X callout above already explains the situation). */}
      {aiReasoning && band !== "X" && (
        <div className="bg-white rounded-xl border border-black/5 p-5">
          <div className="text-xs font-semibold text-black/40 uppercase tracking-wide mb-2.5">
            Why this band
          </div>
          <p className="text-sm text-black/75 leading-relaxed">{aiReasoning}</p>
        </div>
      )}

      {/* Band rationale  -  compact mode hides raw sub-score values,
         keeps the plain-English band verdict and first-call questions */}
      {rationale && <ScoreRationaleBlock rationale={rationale} compact />}

      {/* Follow-up protocol */}
      {band && (
        <div className="bg-white rounded-xl border border-black/5 p-5">
          <div className="text-xs font-semibold text-black/40 uppercase tracking-wide mb-3">
            Follow-up protocol
          </div>
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

      {/* Case Intake Memo */}
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
              Memo generation runs after Round 3 deep qualification. Not every
              lead qualifies for Round 3, so a pending state here is expected
              for Band C and below.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
