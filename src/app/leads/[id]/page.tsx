/**
 * /leads/[id]
 *
 * Lead detail page. Shows full scoring breakdown, conflict check status,
 * email sequence history, and quick stage actions.
 *
 * Server component — all data loaded at request time.
 * Interactive actions (stage change, conflict check) handled by LeadActions.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { PRIORITY_BAND_COLORS, type PriorityBand } from "@/lib/scoring";
import { BAND_COLORS } from "@/lib/cpi";
import { STAGES } from "@/lib/types";
import { getLatestConflictCheck } from "@/lib/conflict-check";
import LeadActions from "./LeadActions";

export const dynamic = "force-dynamic";

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

  const band = (lead.priority_band ?? lead.band) as PriorityBand | null;
  const bc = band
    ? (PRIORITY_BAND_COLORS[band] ?? BAND_COLORS[band as keyof typeof BAND_COLORS])
    : null;
  const pi = lead.priority_index ?? lead.cpi_score ?? 0;
  const firmName = firms.find((f) => f.id === lead.law_firm_id)?.name ?? "—";

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

          {/* CPI explanation */}
          {lead.cpi_explanation && (
            <div className="mt-4 text-sm text-black/60 bg-black/[0.02] rounded-lg px-4 py-3 border border-black/5">
              {lead.cpi_explanation}
            </div>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-4 text-xs text-black/40 border-t border-black/5 pt-4">
            <span>Case: <span className="text-black/60 capitalize">{lead.case_type ?? "—"}</span></span>
            <span>Value: <span className="text-black/60">${Number(lead.estimated_value ?? 0).toLocaleString()}</span></span>
            <span>Source: <span className="text-black/60 capitalize">{lead.source ?? "—"}</span></span>
            <span>City: <span className="text-black/60">{lead.city ?? "—"}</span></span>
            <span>Urgency: <span className="text-black/60 capitalize">{lead.urgency ?? "—"}</span></span>
            <span>Added: <span className="text-black/60">{new Date(lead.created_at).toLocaleDateString("en-CA")}</span></span>
          </div>
        </div>

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
                          <div className="flex-1 truncate text-black/60">{subject ?? "—"}</div>
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
