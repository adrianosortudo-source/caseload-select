"use client";
import { useState } from "react";
import { STAGES, type Lead, type Stage, type LawFirm } from "@/lib/types";
import { BAND_COLORS } from "@/lib/cpi";
import { LEAD_STATES, STATE_STYLES, type LeadState } from "@/lib/state";

function daysSince(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (24 * 3600 * 1000)));
}

export default function Board({ leads: initial, firms }: { leads: Lead[]; firms: LawFirm[] }) {
  const [leads, setLeads] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const firmById = Object.fromEntries(firms.map((f) => [f.id, f.name]));

  async function moveStage(leadId: string, stage: Stage) {
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, stage, updated_at: new Date().toISOString() } : l))
    );
    const res = await fetch(`/api/leads/${leadId}/stage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    if (!res.ok) alert("Failed to update stage");
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
                const band = l.band ?? null;
                const bc = band ? BAND_COLORS[band] : null;
                const ls = l.lead_state ?? "problem_aware";
                const ss = STATE_STYLES[ls];
                return (
                  <div
                    key={l.id}
                    draggable
                    onDragStart={() => setDragId(l.id)}
                    className="card p-3 cursor-grab active:cursor-grabbing"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-sm">{l.name}</div>
                      {bc ? (
                        <span className={`badge ${bc.bg} ${bc.text}`} title={bc.label}>
                          {band} · {l.cpi_score ?? 0}
                        </span>
                      ) : (
                        <span className="badge bg-black/5">—</span>
                      )}
                    </div>
                    <div className="text-xs text-black/60 mt-1">
                      {l.law_firm_id ? firmById[l.law_firm_id] ?? "—" : "No firm"}
                    </div>
                    <div className="flex items-center justify-between mt-2 text-xs">
                      <span className="capitalize text-black/60">{l.case_type ?? "—"}</span>
                      <span className="font-medium">
                        ${Number(l.estimated_value ?? 0).toLocaleString()}
                      </span>
                    </div>
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
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center justify-between mt-2 text-[11px] text-black/50">
                      <span>Fit {l.fit_score ?? 0}/40 · Val {l.value_score ?? 0}/60</span>
                      <span>{daysSince(l.updated_at)}d</span>
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
