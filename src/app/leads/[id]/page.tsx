/**
 * /leads/[id]
 *
 * Lead detail page. Shows full scoring breakdown, conflict check status,
 * email sequence history, and quick stage actions.
 *
 * Server component  -  all data loaded at request time.
 * Interactive actions (stage change, conflict check) handled by LeadActions.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { PRIORITY_BAND_COLORS, type PriorityBand } from "@/lib/scoring";
import { BAND_COLORS } from "@/lib/cpi";
import { STAGES } from "@/lib/types";
import { getLatestConflictCheck } from "@/lib/conflict-check";
import { getFollowupSteps } from "@/lib/intake-memo";
import { buildScoreRationale } from "@/lib/score-rationale";
import { buildScoreRationaleInput } from "@/lib/score-components";
import ScoreRationaleBlock from "@/components/ScoreRationaleBlock";
import LeadActions from "./LeadActions";

export const dynamic = "force-dynamic";

// ─── SLA configuration (mirrors demo LawyerViewPanel) ────────────────────────

const BAND_SLA_CONFIG: Record<string, {
  label: string; sub: string; deadlineHours: number | null;
  bg: string; text: string; accent: string; zero: boolean;
}> = {
  A: { label: "Respond within 30 minutes", sub: "Priority case. Senior lawyer escalation on breach.", deadlineHours: 0.5,  bg: "bg-emerald-50", text: "text-emerald-900", accent: "text-emerald-600", zero: false },
  B: { label: "Respond within 4 hours",    sub: "Warm lead. Partner alert on breach.",               deadlineHours: 4,    bg: "bg-blue-50",    text: "text-blue-900",   accent: "text-blue-600",   zero: false },
  C: { label: "Respond within 24 hours",   sub: "Qualified lead. Standard intake queue.",            deadlineHours: 24,   bg: "bg-amber-50",   text: "text-amber-900",  accent: "text-amber-600",  zero: false },
  D: { label: "0 minutes of lawyer time",  sub: "6-month automated nurture. No manual touch.",      deadlineHours: null, bg: "bg-gray-100",   text: "text-gray-700",   accent: "text-gray-500",   zero: true  },
  E: { label: "0 minutes of lawyer time",  sub: "Outside scope. Filtered out.",                     deadlineHours: null, bg: "bg-gray-100",   text: "text-gray-700",   accent: "text-gray-500",   zero: true  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ScoreBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = Math.round((Math.max(0, value) / max) * 100);
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-black/60">{label}</span>
        <span className="font-medium text-black/70">{value}<span className="text-black/30">/{max}</span></span>
      </div>
      <div className="h-1.5 rounded-full bg-black/8 overflow-hidden">
        <div
          className="h-full rounded-full bg-gold transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function conflictBadge(result: string | null) {
  if (!result) return <span className="badge bg-black/5 text-black/40">Not checked</span>;
  if (result === "clear") return <span className="badge bg-emerald-50 text-emerald-700">Clear</span>;
  if (result === "potential_conflict") return <span className="badge bg-amber-50 text-amber-700">Potential conflict</span>;
  return <span className="badge bg-rose-50 text-rose-700">Confirmed conflict</span>;
}

function seqStatusBadge(status: string) {
  if (status === "sent") return <span className="badge bg-emerald-50 text-emerald-700">Sent</span>;
  if (status === "scheduled") return <span className="badge bg-sky-50 text-sky-700">Scheduled</span>;
  if (status === "skipped") return <span className="badge bg-black/5 text-black/40">Skipped</span>;
  return <span className="badge bg-black/5 text-black/50 capitalize">{status}</span>;
}

function delayLabel(hours: number): string {
  if (hours === 0) return "Immediately";
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.round(days / 30)}mo`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [leadRes, firmRes, seqRes, conflictCheck, retainerRes, reviewRes, conflictChecksRes] = await Promise.all([
    supabase.from("leads").select("*").eq("id", id).single(),
    supabase.from("law_firm_clients").select("id, name").order("name"),
    // Fetch scheduled/sent/skipped sequences with step + template name
    supabase
      .from("email_sequences")
      .select(`
        id, step_number, status, scheduled_at, sent_at,
        sequence_steps!inner(
          delay_hours, channels,
          sequence_templates!inner(name, trigger_event)
        )
      `)
      .eq("lead_id", id)
      .order("scheduled_at", { ascending: true }),
    getLatestConflictCheck(id),
    // Retainer agreements matched by lead_id (preferred) or will filter by email below
    supabase
      .from("retainer_agreements")
      .select("id, status, contact_name, generated_at, sent_at, viewed_at, signed_at, voided_at, created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: false }),
    // Review requests for this lead
    supabase
      .from("review_requests")
      .select("id, status, created_at, sent_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: false }),
    // All conflict checks for this lead (for timeline)
    supabase
      .from("conflict_checks")
      .select("id, result, checked_at, checked_via")
      .eq("lead_id", id)
      .order("checked_at", { ascending: false }),
  ]);

  if (leadRes.error || !leadRes.data) notFound();
  const lead = leadRes.data;
  const firms = firmRes.data ?? [];

  // Fetch the intake session memo (if this lead came from a widget intake)
  let sessionMemo: { memo_text: string | null; memo_generated_at: string | null } | null = null;
  const intakeSessionId = lead.intake_session_id as string | null;
  if (intakeSessionId) {
    const { data: sessionRow } = await supabase
      .from("intake_sessions")
      .select("memo_text, memo_generated_at")
      .eq("id", intakeSessionId)
      .single();
    if (sessionRow) sessionMemo = sessionRow;
  }

  const band = (lead.priority_band ?? lead.band) as PriorityBand | null;
  const bc = band
    ? (PRIORITY_BAND_COLORS[band] ?? BAND_COLORS[band as keyof typeof BAND_COLORS])
    : null;
  const pi = lead.priority_index ?? lead.cpi_score ?? 0;
  const firmName = firms.find((f) => f.id === lead.law_firm_id)?.name ?? " - ";

  // SLA pill: deadline computed from intake arrival time + band hours
  const slaCfg = band ? (BAND_SLA_CONFIG[band] ?? null) : null;
  let deadlineStr: string | null = null;
  let slaOverdue = false;
  if (slaCfg?.deadlineHours) {
    const deadline = new Date(new Date(lead.created_at).getTime() + slaCfg.deadlineHours * 3600 * 1000);
    const now = new Date();
    slaOverdue = now > deadline;
    if (slaOverdue) {
      const hoursOver = (now.getTime() - deadline.getTime()) / 3600000;
      deadlineStr = hoursOver < 1 ? "Overdue" : `Overdue by ${Math.round(hoursOver)}h`;
    } else {
      const h = deadline.getHours();
      const m = deadline.getMinutes();
      const h12 = h % 12 === 0 ? 12 : h % 12;
      const ampm = h < 12 ? "am" : "pm";
      const mm = m.toString().padStart(2, "0");
      const prefix = slaCfg.deadlineHours < 1
        ? `${Math.round(slaCfg.deadlineHours * 60)}min deadline`
        : `${slaCfg.deadlineHours}h deadline`;
      deadlineStr = `${prefix}: ${h12}:${mm}${ampm}`;
    }
  }

  // Pre-call checklist: missing fields the lawyer should confirm before consultation
  const missingFields = (lead.cpi_missing_fields as string[] | null) ?? [];

  // Structured "why this band" rationale. buildScoreRationaleInput() reads
  // leads.scoring_model to select the correct engine layout (v2.1_form: 7
  // factors, fit max 30, val max 65; gpt_cpi_v1: 8 factors, fit max 40, val
  // max 60) and pulls sub-scores from the appropriate columns / JSONB. This
  // replaces the previous hardcoded form-engine shape so GPT-path leads render
  // correctly instead of showing all-zero bars.
  const rationaleInput = buildScoreRationaleInput(lead, { aiAngle: null });
  const rationale = rationaleInput ? buildScoreRationale(rationaleInput) : null;

  // Group sequences by template
  type SeqRow = {
    id: string;
    step_number: number;
    status: string;
    scheduled_at: string | null;
    sent_at: string | null;
    sequence_steps: {
      delay_hours: number;
      channels: Record<string, unknown>;
      sequence_templates: { name: string; trigger_event: string };
    };
  };

  const sequences = (seqRes.data ?? []) as unknown as SeqRow[];

  const seqByTemplate: Record<string, { name: string; trigger_event: string; rows: SeqRow[] }> = {};
  for (const row of sequences) {
    const tmpl = row.sequence_steps?.sequence_templates;
    if (!tmpl) continue;
    const key = tmpl.trigger_event;
    if (!seqByTemplate[key]) seqByTemplate[key] = { name: tmpl.name, trigger_event: key, rows: [] };
    seqByTemplate[key].rows.push(row);
  }

  const stageLabel = STAGES.find((s) => s.key === lead.stage)?.label ?? lead.stage;

  // ── Activities timeline ────────────────────────────────────────────────────
  type ActivityEvent = {
    ts: Date;
    label: string;
    sub?: string;
    color: string;
  };

  const events: ActivityEvent[] = [];

  // Lead created
  events.push({ ts: new Date(lead.created_at), label: "Lead created", color: "bg-black/20" });

  // Conflict checks
  for (const cc of conflictChecksRes.data ?? []) {
    const resultLabel =
      cc.result === "clear" ? "Clear"
      : cc.result === "potential_conflict" ? "Potential conflict"
      : "Confirmed conflict";
    const color =
      cc.result === "clear" ? "bg-emerald-400"
      : cc.result === "potential_conflict" ? "bg-amber-400"
      : "bg-rose-400";
    events.push({
      ts: new Date(cc.checked_at),
      label: `Conflict check: ${resultLabel}`,
      sub: `via ${cc.checked_via}`,
      color,
    });
  }

  // Retainer agreements
  for (const ra of retainerRes.data ?? []) {
    if (ra.generated_at) events.push({ ts: new Date(ra.generated_at), label: "Retainer generated", color: "bg-sky-400" });
    if (ra.sent_at)      events.push({ ts: new Date(ra.sent_at),      label: "Retainer sent",      color: "bg-blue-400" });
    if (ra.viewed_at)    events.push({ ts: new Date(ra.viewed_at),    label: "Retainer viewed",    color: "bg-amber-400" });
    if (ra.signed_at)    events.push({ ts: new Date(ra.signed_at),    label: "Retainer signed",    color: "bg-emerald-400" });
    if (ra.voided_at)    events.push({ ts: new Date(ra.voided_at),    label: "Retainer voided",    color: "bg-rose-400" });
  }

  // Review requests
  for (const rr of reviewRes.data ?? []) {
    events.push({ ts: new Date(rr.created_at), label: "Review request created", sub: rr.status, color: "bg-purple-400" });
    if (rr.sent_at) events.push({ ts: new Date(rr.sent_at), label: "Review request sent", color: "bg-purple-400" });
  }

  // Email sequences (sent only)
  for (const row of sequences) {
    if (row.status === "sent" && row.sent_at) {
      const tmpl = row.sequence_steps?.sequence_templates;
      const emailCh = (row.sequence_steps?.channels as Record<string, unknown>)?.email as Record<string, unknown> | undefined;
      const subject = emailCh?.subject as string | undefined;
      events.push({
        ts: new Date(row.sent_at),
        label: `Email sent: ${subject ?? `Step ${row.step_number}`}`,
        sub: tmpl?.name,
        color: "bg-gold",
      });
    }
  }

  // Sort descending (newest first)
  events.sort((a, b) => b.ts.getTime() - a.ts.getTime());

  return (
    <div>
      {/* Breadcrumb */}
      <div className="px-8 pt-6 text-xs text-black/40">
        <Link href="/pipeline" className="hover:text-black/70">Pipeline</Link>
        <span className="mx-1.5">›</span>
        <span className="text-black/60">{lead.name}</span>
      </div>

      <div className="p-8 space-y-6 max-w-5xl">

        {/* ── SLA pill ─────────────────────────────────────────────────── */}
        {slaCfg && (
          <div className={`rounded-xl px-4 py-3 ${slaCfg.bg}`}>
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center bg-white ${slaCfg.accent} flex-shrink-0`}>
                {slaCfg.zero ? (
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
                <p className={`text-sm font-bold ${slaCfg.text}`}>{slaCfg.label}</p>
                {deadlineStr && (
                  <p className={`text-[11px] font-semibold mt-0.5 ${slaOverdue ? "text-rose-600" : `${slaCfg.text} opacity-60`}`}>
                    {deadlineStr}
                  </p>
                )}
                <p className={`text-[11px] ${slaCfg.accent} mt-0.5`}>{slaCfg.sub}</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Header card ──────────────────────────────────────────────── */}
        <div className="card p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-semibold">{lead.name}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-black/60">
                {lead.email && <span>{lead.email}</span>}
                {lead.phone && <span>{lead.phone}</span>}
                <span>{firmName}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="badge bg-black/8 text-black/60">{stageLabel}</span>
              {bc && (
                <span className={`badge ${bc.bg} ${bc.text}`}>
                  {band} · {pi}
                </span>
              )}
              {lead.cpi_confidence && (
                <span className="badge bg-black/5 text-black/50 capitalize">
                  {lead.cpi_confidence} confidence
                </span>
              )}
            </div>
          </div>

          {/* Description */}
          {lead.description && (
            <p className="mt-4 text-sm text-black/60 leading-relaxed border-t border-black/5 pt-4">
              {lead.description}
            </p>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-4 text-xs text-black/40 border-t border-black/5 pt-4">
            <span>Case: <span className="text-black/60 capitalize">{lead.case_type ?? " - "}</span></span>
            <span>Value: <span className="text-black/60">${Number(lead.estimated_value ?? 0).toLocaleString()}</span></span>
            <span>Source: <span className="text-black/60 capitalize">{lead.source ?? " - "}</span></span>
            <span>City: <span className="text-black/60">{lead.city ?? " - "}</span></span>
            <span>Urgency: <span className="text-black/60 capitalize">{lead.urgency ?? " - "}</span></span>
            <span>Added: <span className="text-black/60">{new Date(lead.created_at).toLocaleDateString("en-CA")}</span></span>
          </div>
        </div>

        {/* ── Band rationale ─────────────────────────────────────────────
           Explains WHY this band: fit/value trade-off in words, strongest
           and weakest sub-scores, and (when confidence is not high) the
           first-call questions that would move the score. Mirrors the demo
           overlay and the firm portal, sourced from lib/score-rationale.ts. */}
        {rationale && <ScoreRationaleBlock rationale={rationale} />}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── Score breakdown ────────────────────────────────────────── */}
          <div className="card p-5">
            <div className="text-xs font-semibold text-black/40 uppercase tracking-wide mb-4">Score Breakdown</div>
            <div className="space-y-5">
              <div>
                <div className="text-xs font-semibold text-black/50 mb-2">Fit <span className="font-normal text-black/30">(max 30)</span></div>
                <div className="space-y-2.5 pl-2">
                  <ScoreBar value={lead.geo_score ?? 0} max={10} label="Geographic" />
                  <ScoreBar value={lead.contactability_score ?? 0} max={10} label="Contactability" />
                  <ScoreBar value={lead.legitimacy_score ?? 0} max={10} label="Legitimacy" />
                </div>
                <div className="mt-2 pl-2 flex justify-between text-xs">
                  <span className="text-black/40">Fit total</span>
                  <span className="font-semibold">{lead.fit_score ?? 0}<span className="text-black/30">/30</span></span>
                </div>
              </div>

              <div className="border-t border-black/5 pt-4">
                <div className="text-xs font-semibold text-black/50 mb-2">Value <span className="font-normal text-black/30">(max 70)</span></div>
                <div className="space-y-2.5 pl-2">
                  <ScoreBar value={lead.complexity_score ?? 0} max={25} label="Complexity" />
                  <ScoreBar value={lead.urgency_score ?? 0} max={20} label="Urgency" />
                  <ScoreBar value={lead.strategic_score ?? 0} max={15} label="Strategic" />
                  <ScoreBar value={lead.fee_score ?? 0} max={10} label="Fee" />
                </div>
                <div className="mt-2 pl-2 flex justify-between text-xs">
                  <span className="text-black/40">Value total</span>
                  <span className="font-semibold">{lead.value_score ?? 0}<span className="text-black/30">/70</span></span>
                </div>
              </div>

              <div className="border-t border-black/5 pt-3 flex justify-between items-center">
                <span className="text-sm font-semibold text-black/70">Priority Index</span>
                <span className="text-2xl font-bold">{pi}</span>
              </div>
            </div>
          </div>

          {/* ── Conflict check + actions ───────────────────────────────── */}
          <div className="space-y-4">
            <div className="card p-5">
              <div className="text-xs font-semibold text-black/40 uppercase tracking-wide mb-3">Conflict Check</div>
              <div className="flex items-center justify-between mb-3">
                {conflictBadge(conflictCheck?.result ?? null)}
                {conflictCheck && (
                  <span className="text-xs text-black/30">
                    {new Date(conflictCheck.checked_at).toLocaleDateString("en-CA")} via {conflictCheck.checked_via}
                  </span>
                )}
              </div>

              {/* Matches */}
              {conflictCheck?.matches && conflictCheck.matches.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {conflictCheck.matches.map((m, i) => (
                    <div key={i} className="text-xs bg-amber-50 border border-amber-100 rounded px-3 py-2 text-amber-800">
                      <span className="font-medium capitalize">{m.match_type}</span> match: {m.matched_name}
                      {m.matter_type && <span className="text-amber-600"> · {m.matter_type}</span>}
                    </div>
                  ))}
                </div>
              )}

              {conflictCheck?.override_reason && (
                <div className="text-xs text-black/50 bg-black/[0.02] rounded px-3 py-2 mb-3">
                  Override: {conflictCheck.override_reason}
                </div>
              )}

              {!conflictCheck && (
                <p className="text-xs text-black/40 mb-3">
                  No check run yet. Run a check before moving to Consultation Scheduled.
                </p>
              )}
            </div>

            {/* Stage + actions */}
            <div className="card p-5">
              <div className="text-xs font-semibold text-black/40 uppercase tracking-wide mb-3">Actions</div>
              <LeadActions
                leadId={id}
                currentStage={lead.stage}
                conflictResult={conflictCheck?.result ?? null}
                conflictCheckId={conflictCheck?.id ?? null}
                firms={firms}
                currentFirmId={lead.law_firm_id ?? null}
              />
            </div>
          </div>
        </div>

        {/* ── Pre-call checklist ───────────────────────────────────────── */}
        {missingFields.length > 0 && (
          <div className="card p-5">
            <div className="text-xs font-semibold text-black/40 uppercase tracking-wide mb-3">
              Pre-call: confirm with client
            </div>
            <div className="space-y-2">
              {missingFields.map((field, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <span className="w-4 h-4 rounded-full border-2 border-black/20 flex items-center justify-center flex-shrink-0">
                    <span className="w-1 h-1 rounded-full bg-black/20" />
                  </span>
                  <span className="text-sm text-black/60">{field}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Follow-up protocol ──────────────────────────────────────────
           Numbered next-step playbook by CPI band. Mirrors the demo overlay
           and the firm portal, sourced from lib/intake-memo.ts. */}
        {band && (
          <div className="card p-5">
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

        {/* ── Case Intake Memo ────────────────────────────────────────────
           AI-generated memo persisted to intake_sessions.memo_text after
           Round 3 (src/lib/memo.ts). Plain text with ALL-CAPS section
           headers; rendered with whitespace-pre-wrap. Shows a pending
           state if the session exists but the memo has not been generated
           yet (Band C and below never trigger Round 3). */}
        {intakeSessionId && (
          <div className="card overflow-hidden">
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

        {/* ── Email sequences ───────────────────────────────────────────── */}
        {Object.keys(seqByTemplate).length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-black/8">
              <div className="text-sm font-semibold">Email Sequences</div>
              <div className="text-xs text-black/40 mt-0.5">{sequences.length} step(s) across {Object.keys(seqByTemplate).length} sequence(s)</div>
            </div>
            <div className="divide-y divide-black/5">
              {Object.values(seqByTemplate).map((tmpl) => (
                <div key={tmpl.trigger_event} className="px-5 py-4">
                  <div className="text-xs font-semibold text-black/60 mb-3">{tmpl.name}</div>
                  <div className="space-y-2">
                    {tmpl.rows.map((row) => {
                      const emailCh = (row.sequence_steps?.channels as Record<string, unknown>)?.email as Record<string, unknown> | undefined;
                      const subject = emailCh?.subject as string | undefined;
                      return (
                        <div key={row.id} className="flex items-center gap-3 text-xs">
                          <div className="w-6 text-center text-black/30 shrink-0">#{row.step_number}</div>
                          {seqStatusBadge(row.status)}
                          <div className="flex-1 truncate text-black/60">{subject ?? " - "}</div>
                          <div className="text-black/30 shrink-0">
                            {row.status === "sent" && row.sent_at
                              ? `Sent ${new Date(row.sent_at).toLocaleDateString("en-CA")}`
                              : row.scheduled_at
                              ? `Due ${new Date(row.scheduled_at).toLocaleDateString("en-CA")}`
                              : `+${delayLabel(row.sequence_steps?.delay_hours ?? 0)}`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {sequences.length === 0 && (
          <div className="card p-6 text-center text-black/40 text-sm">
            No email sequences scheduled for this lead yet.
          </div>
        )}

        {/* ── Activity log ──────────────────────────────────────────────── */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-black/8">
            <div className="text-sm font-semibold">Activity Log</div>
            <div className="text-xs text-black/40 mt-0.5">{events.length} event{events.length !== 1 ? "s" : ""}</div>
          </div>
          {events.length === 0 ? (
            <div className="p-6 text-center text-black/40 text-sm">No activity recorded yet.</div>
          ) : (
            <div className="px-5 py-4 space-y-0">
              {events.map((ev, i) => (
                <div key={i} className="flex gap-3 pb-4 relative">
                  {/* Vertical connector */}
                  {i < events.length - 1 && (
                    <div className="absolute left-[7px] top-4 bottom-0 w-px bg-black/8" />
                  )}
                  {/* Dot */}
                  <div className={`mt-0.5 w-3.5 h-3.5 rounded-full shrink-0 ${ev.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm text-black/70">{ev.label}</span>
                      <span className="text-xs text-black/30 shrink-0">
                        {ev.ts.toLocaleDateString("en-CA")}
                      </span>
                    </div>
                    {ev.sub && (
                      <div className="text-xs text-black/40 mt-0.5 truncate">{ev.sub}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
