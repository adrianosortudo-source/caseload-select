"use client";
import { useState } from "react";
import Link from "next/link";
import { STAGES, type Lead, type Stage, type LawFirm } from "@/lib/types";
import { PRIORITY_BAND_COLORS, type PriorityBand } from "@/lib/scoring";
import { BAND_COLORS } from "@/lib/cpi"; // legacy fallback
import { LEAD_STATES, STATE_STYLES, type LeadState } from "@/lib/state";

function daysSince(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (24 * 3600 * 1000)));
}

// SLA response window per band (hours). A/B/C only — D/E consume no lawyer time.
const BAND_SLA_HOURS: Record<string, number> = { A: 0.5, B: 4, C: 24 };

function slaStatus(createdAt: string, band: string | null): { label: string; overdue: boolean } | null {
  if (!band || !BAND_SLA_HOURS[band]) return null;
  const deadline = new Date(new Date(createdAt).getTime() + BAND_SLA_HOURS[band] * 3600 * 1000);
  const now = new Date();
  const overdue = now > deadline;
  if (overdue) {
    const h = (now.getTime() - deadline.getTime()) / 3600000;
    return { label: h < 1 ? "SLA overdue" : `Overdue ${Math.round(h)}h`, overdue: true };
  }
  const remaining = (deadline.getTime() - now.getTime()) / 3600000;
  const label = remaining < 1
    ? `${Math.round(remaining * 60)}min left`
    : `${remaining.toFixed(0)}h left`;
  return { label, overdue: false };
}

// Conflict check result stored per lead ID (fetched on demand)
type ConflictStatus = { result: string; checked_at: string; override_reason: string | null } | null;

export default function Board({ leads: initial, firms }: { leads: Lead[]; firms: LawFirm[] }) {
  const [leads, setLeads] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [conflictMap, setConflictMap] = useState<Record<string, ConflictStatus>>({});
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const firmById = Object.fromEntries(firms.map((f) => [f.id, f.name]));

  async function moveStage(leadId: string, stage: Stage) {
    // Optimistic update
    const prev = leads;
    setLeads((l) => l.map((x) => (x.id === leadId ? { ...x, stage, updated_at: new Date().toISOString() } : x)));

    const res = await fetch(`/api/leads/${leadId}/stage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stage }),
    });

    if (!res.ok) {
      // Roll back optimistic update
      setLeads(prev);
      const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
      if (body.error === "conflict_gate") {
        alert(`Conflict gate: ${body.message}`);
      } else {
        alert("Failed to update stage.");
      }
    }
  }

  async function runConflictCheck(leadId: string) {
    setCheckingId(leadId);
    try {
      const res = await fetch(`/api/leads/${leadId}/conflict-check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json() as { result: string; checked_via: string; message: string };
      setConflictMap((m) => ({
        ...m,
        [leadId]: { result: data.result, checked_at: new Date().toISOString(), override_reason: null },
      }));
      alert(data.message);
    } catch {
      alert("Conflict check failed. Try again.");
    } finally {
      setCheckingId(null);
    }
  }

  async function setState(leadId: string, lead_state: LeadState) {
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, lead_state, updated_at: new Date().toISOString() } : l))
    );
    const res = await fetch(`/api/leads/${leadId}/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lead_state }),
    });
    if (!res.ok) alert("Failed to update state");
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {STAGES.map((col) => {
        const items = leads.filter((l) => l.stage === col.key);
        return (
          <div
            key={col.key}
            className="w-72 shrink-0"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragId) moveStage(dragId, col.key);
              setDragId(null);
            }}
          >
            <div className="flex items-center justify-between px-1 mb-2">
              <div className="text-sm font-medium">{col.label}</div>
              <div className="text-xs text-black/50">{items.length}</div>
            </div>
            <div className="space-y-2 min-h-20">
              {items.map((l) => {
                // Prefer priority_band (Phase 2), fall back to legacy band
                const band = (l.priority_band ?? l.band) as PriorityBand | null;
                const bc = band
                  ? (PRIORITY_BAND_COLORS[band] ?? BAND_COLORS[band as keyof typeof BAND_COLORS])
                  : null;
                const pi = l.priority_index ?? l.cpi_score ?? 0;
                const ls = l.lead_state ?? "problem_aware";
                const ss = STATE_STYLES[ls];
                const sla = l.stage === "new_lead" ? slaStatus(l.created_at, band) : null;
                return (
                  <div
                    key={l.id}
                    draggable
                    onDragStart={() => setDragId(l.id)}
                    className="card p-3 cursor-grab active:cursor-grabbing"
                  >
                    {/* Name + band badge */}
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/leads/${l.id}`}
                        onClick={(e) => e.stopPropagation()}
                        onDragStart={(e) => e.stopPropagation()}
                        className="font-medium text-sm hover:text-navy hover:underline"
                      >
                        {l.name}
                      </Link>
                      {bc ? (
                        <span className={`badge ${bc.bg} ${bc.text}`} title={bc.label}>
                          {band} · {pi}
                        </span>
                      ) : (
                        <span className="badge bg-black/5"> - </span>
                      )}
                    </div>

                    {/* Firm */}
                    <div className="text-xs text-black/60 mt-1">
                      {l.law_firm_id ? firmById[l.law_firm_id] ?? " - " : "No firm"}
                    </div>

                    {/* SLA deadline  -  new_lead cards, A/B/C bands only */}
                    {sla && (
                      <div className={`text-[11px] font-medium mt-1.5 ${sla.overdue ? "text-rose-600" : "text-black/40"}`}>
                        {sla.overdue ? "⚠ " : "⏱ "}{sla.label}
                      </div>
                    )}

                    {/* Case type + value */}
                    <div className="flex items-center justify-between mt-2 text-xs">
                      <span className="capitalize text-black/60">{l.case_type ?? " - "}</span>
                      <span className="font-medium">
                        ${Number(l.estimated_value ?? 0).toLocaleString()}
                      </span>
                    </div>

                    {/* State badge + select */}
                    <div className="flex items-center justify-between mt-2 gap-2">
                      <span
                        className={`badge ${ss.bg} ${ss.text} truncate`}
                        title="Current lead state"
                      >
                        {ss.label}
                      </span>
                      <select
                        value={ls}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onDragStart={(e) => e.stopPropagation()}
                        onChange={(e) => setState(l.id, e.target.value as LeadState)}
                        className="text-[11px] bg-transparent border border-black/10 rounded px-1 py-0.5"
                      >
                        {LEAD_STATES.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Score breakdown: Fit / Val / PI */}
                    <div className="grid grid-cols-3 mt-2 text-[11px] text-black/50 text-center border-t border-black/5 pt-2">
                      <span title="Fit score (max 30)">
                        <span className="text-black/30">Fit </span>{l.fit_score ?? 0}<span className="text-black/20">/30</span>
                      </span>
                      <span title="Value score (max 70)">
                        <span className="text-black/30">Val </span>{l.value_score ?? 0}<span className="text-black/20">/70</span>
                      </span>
                      <span title="Priority index (max 100)">
                        <span className="text-black/30">PI </span><span className="font-medium text-black/70">{pi}</span>
                      </span>
                    </div>

                    {/* Conflict check  -  shown on qualified cards (gate before consultation) */}
                    {l.stage === "qualified" && (
                      <div className="mt-2 pt-2 border-t border-black/5 flex items-center justify-between gap-2">
                        {conflictMap[l.id] ? (
                          <span
                            className={`text-[11px] font-medium ${
                              conflictMap[l.id]!.result === "clear"
                                ? "text-emerald-600"
                                : conflictMap[l.id]!.result === "potential_conflict"
                                ? "text-amber-600"
                                : "text-rose-600"
                            }`}
                          >
                            {conflictMap[l.id]!.result === "clear"
                              ? "✓ No conflict"
                              : conflictMap[l.id]!.result === "potential_conflict"
                              ? "! Potential conflict"
                              : "✗ Confirmed conflict"}
                          </span>
                        ) : (
                          <span className="text-[11px] text-black/30">Conflict check pending</span>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); runConflictCheck(l.id); }}
                          onDragStart={(e) => e.stopPropagation()}
                          disabled={checkingId === l.id}
                          className="text-[11px] px-2 py-0.5 rounded border border-black/15 text-black/50 hover:bg-black/5 disabled:opacity-40 shrink-0"
                        >
                          {checkingId === l.id ? "Checking..." : "Run check"}
                        </button>
                      </div>
                    )}

                    {/* Days since last update */}
                    <div className="text-right text-[11px] text-black/30 mt-1">
                      {daysSince(l.updated_at)}d ago
                    </div>
                  </div>
                );
              })}
              {items.length === 0 && (
                <div className="text-xs text-black/30 text-center py-6 border border-dashed border-black/10 rounded-lg">
                  Drop here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
