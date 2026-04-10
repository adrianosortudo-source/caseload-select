"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────

interface ChannelEmail    { subject: string; body: string; active: boolean }
interface ChannelSms      { body: string; active: boolean }
interface ChannelWhatsapp { template_name: string; body: string; active: boolean }
interface ChannelInternal { note: string; active: boolean }

interface Channels {
  email:    ChannelEmail;
  sms:      ChannelSms;
  whatsapp: ChannelWhatsapp;
  internal: ChannelInternal;
}

interface Step {
  id: string;
  step_number: number;
  delay_hours: number;
  channels: Channels;
  is_active: boolean;
}

interface Sequence {
  id: string;
  name: string;
  trigger_event: string;
  description: string | null;
  is_active: boolean;
  sequence_steps: Step[];
}

// ── Constants ─────────────────────────────────────────────────────────────

const TRIGGER_OPTIONS = [
  { value: "new_lead",         label: "New Lead" },
  { value: "no_engagement",    label: "No Engagement" },
  { value: "client_won",       label: "Client Won" },
  { value: "no_show",          label: "No Show" },
  { value: "stalled_retainer", label: "Stalled Retainer" },
];

const VARIABLES = ["{name}", "{case_type}", "{firm_name}"];
const SAMPLE    = { name: "Maria Santos", case_type: "immigration", firm_name: "Sakuraba Law" };

type ChannelTab = "email" | "sms" | "whatsapp" | "internal";

const CHANNEL_TABS: { key: ChannelTab; label: string; live: boolean }[] = [
  { key: "email",    label: "Email",    live: true  },
  { key: "sms",      label: "SMS",      live: false },
  { key: "whatsapp", label: "WhatsApp", live: false },
  { key: "internal", label: "Internal", live: false },
];

// ── Helpers ───────────────────────────────────────────────────────────────

function applyVars(text: string) {
  return text
    .replace(/\{name\}/g,       SAMPLE.name)
    .replace(/\{case_type\}/g,  SAMPLE.case_type)
    .replace(/\{firm_name\}/g,  SAMPLE.firm_name);
}

function delayLabel(hours: number) {
  if (hours === 0) return "Immediately";
  if (hours < 24)  return `+${hours}h`;
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  return h > 0 ? `+${d}d ${h}h` : `+${d}d`;
}

function emptyChannels(): Channels {
  return {
    email:    { subject: "New step", body: "Hi {name},", active: true },
    sms:      { body: "", active: false },
    whatsapp: { template_name: "", body: "", active: false },
    internal: { note: "", active: false },
  };
}

// ── Main editor ───────────────────────────────────────────────────────────

export default function SequenceEditor({ sequence: initial }: { sequence: Sequence }) {
  const router   = useRouter();
  const [seq, setSeq]       = useState(initial);
  const [steps, setSteps]   = useState<Step[]>(
    (initial.sequence_steps ?? []).map((s) => ({
      ...s,
      channels: s.channels ?? emptyChannels(),
    }))
  );
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [editTab, setEditTab]         = useState<ChannelTab>("email");
  const [previewId, setPreviewId]     = useState<string | null>(null);
  const [headerDirty, setHeaderDirty] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [dragId, setDragId]           = useState<string | null>(null);
  const [dragOverId, setDragOverId]   = useState<string | null>(null);
  const [flash, setFlash]             = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 2500);
  }

  function mutateStep(id: string, fn: (s: Step) => Step) {
    setSteps((prev) => prev.map((s) => s.id === id ? fn(s) : s));
  }

  // ── Header ───────────────────────────────────────────────────────────────
  async function saveHeader() {
    setSaving(true);
    await fetch(`/api/sequences/${seq.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: seq.name, trigger_event: seq.trigger_event, description: seq.description }),
    });
    setSaving(false);
    setHeaderDirty(false);
    showFlash("Sequence saved.");
  }

  // ── Step ─────────────────────────────────────────────────────────────────
  async function saveStep(step: Step) {
    setSaving(true);
    await fetch(`/api/sequences/${seq.id}/steps/${step.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channels: step.channels, delay_hours: step.delay_hours, is_active: step.is_active }),
    });
    setSaving(false);
    setEditingId(null);
    showFlash(`Step ${step.step_number} saved.`);
  }

  async function toggleStep(stepId: string, isActive: boolean) {
    mutateStep(stepId, (s) => ({ ...s, is_active: isActive }));
    await fetch(`/api/sequences/${seq.id}/steps/${stepId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ is_active: isActive }),
    });
  }

  async function addStep() {
    const res  = await fetch(`/api/sequences/${seq.id}/steps`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const json = await res.json();
    if (json.step) {
      setSteps((prev) => [...prev, { ...json.step, channels: json.step.channels ?? emptyChannels() }]);
      setEditingId(json.step.id);
      setEditTab("email");
    }
  }

  async function deleteStep(stepId: string) {
    if (!confirm("Delete this step?")) return;
    await fetch(`/api/sequences/${seq.id}/steps/${stepId}`, { method: "DELETE" });
    setSteps((prev) => prev.filter((s) => s.id !== stepId));
    showFlash("Step deleted.");
  }

  // ── Reorder ───────────────────────────────────────────────────────────────
  async function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const from = steps.findIndex((s) => s.id === dragId);
    const to   = steps.findIndex((s) => s.id === targetId);
    const next = [...steps];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const renumbered = next.map((s, i) => ({ ...s, step_number: i + 1 }));
    setSteps(renumbered);
    setDragId(null);
    setDragOverId(null);
    await fetch(`/api/sequences/${seq.id}/steps`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ step_ids: renumbered.map((s) => s.id) }),
    });
    showFlash("Order saved.");
  }

  // ── Insert variable at cursor (email body) ────────────────────────────────
  function insertVar(variable: string, stepId: string) {
    const ta = bodyRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    mutateStep(stepId, (s) => ({
      ...s,
      channels: {
        ...s.channels,
        email: {
          ...s.channels.email,
          body: s.channels.email.body.slice(0, start) + variable + s.channels.email.body.slice(end),
        },
      },
    }));
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + variable.length, start + variable.length);
    }, 0);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen">
      {flash && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {flash}
        </div>
      )}

      {/* ── Sequence header ──────────────────────────────────────────────── */}
      <div className="border-b border-black/10 bg-white px-8 py-5">
        <div className="flex items-center gap-2 text-xs text-black/40 mb-3">
          <Link href="/sequences" className="hover:underline">Sequences</Link>
          <span>/</span>
          <span className="text-black/70">{seq.name}</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 grid grid-cols-3 gap-3">
            <div>
              <label className="label">Sequence name</label>
              <input
                className="input"
                value={seq.name}
                onChange={(e) => { setSeq((p) => ({ ...p, name: e.target.value })); setHeaderDirty(true); }}
              />
            </div>
            <div>
              <label className="label">Trigger event</label>
              <select
                className="input"
                value={seq.trigger_event}
                onChange={(e) => { setSeq((p) => ({ ...p, trigger_event: e.target.value })); setHeaderDirty(true); }}
              >
                {TRIGGER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Description</label>
              <input
                className="input"
                value={seq.description ?? ""}
                onChange={(e) => { setSeq((p) => ({ ...p, description: e.target.value })); setHeaderDirty(true); }}
                placeholder="Optional"
              />
            </div>
          </div>
          {headerDirty && (
            <button className="btn-gold mt-5 shrink-0" onClick={saveHeader} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>

      {/* ── Steps ────────────────────────────────────────────────────────── */}
      <div className="p-8 space-y-3 max-w-4xl">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-medium text-black/70">
            {steps.length} step{steps.length !== 1 ? "s" : ""} · drag to reorder
          </div>
          <button className="btn-gold text-xs py-1.5 px-4" onClick={addStep}>+ Add step</button>
        </div>

        {steps.map((step) => {
          const isEditing   = editingId === step.id;
          const isPreviewing = previewId === step.id;
          const emailSubject = step.channels?.email?.subject ?? "";
          const emailBody    = step.channels?.email?.body ?? "";

          return (
            <div
              key={step.id}
              draggable={!isEditing}
              onDragStart={() => setDragId(step.id)}
              onDragOver={(e) => { e.preventDefault(); setDragOverId(step.id); }}
              onDragLeave={() => setDragOverId(null)}
              onDrop={() => handleDrop(step.id)}
              className={`card transition-all ${dragOverId === step.id ? "ring-2 ring-gold/60 scale-[1.01]" : ""} ${!step.is_active ? "opacity-50" : ""}`}
            >
              {/* Collapsed row */}
              <div className="flex items-center gap-3 p-4">
                <div className="cursor-grab text-black/20 select-none text-lg leading-none">⠿</div>
                <div className="w-7 h-7 rounded-full bg-navy text-white text-xs font-medium flex items-center justify-center shrink-0">
                  {step.step_number}
                </div>
                <span className="text-xs font-mono bg-black/5 rounded px-2 py-0.5 shrink-0">
                  {delayLabel(step.delay_hours)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{emailSubject || "—"}</div>
                  {!isEditing && (
                    <div className="text-xs text-black/40 truncate mt-0.5">
                      {emailBody.slice(0, 100)}{emailBody.length > 100 ? "…" : ""}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleStep(step.id, !step.is_active)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${step.is_active ? "bg-emerald-500" : "bg-black/20"}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${step.is_active ? "translate-x-4" : "translate-x-1"}`} />
                  </button>
                  <button
                    onClick={() => setPreviewId(isPreviewing ? null : step.id)}
                    className="text-xs text-black/40 hover:text-black/70 px-2 py-1 rounded hover:bg-black/5"
                  >
                    {isPreviewing ? "Hide" : "Preview"}
                  </button>
                  <button
                    onClick={() => { setEditingId(isEditing ? null : step.id); setEditTab("email"); }}
                    className="text-xs font-medium text-navy hover:underline px-2 py-1"
                  >
                    {isEditing ? "Collapse" : "Edit"}
                  </button>
                  <button onClick={() => deleteStep(step.id)} className="text-xs text-rose-400 hover:text-rose-600 px-1">✕</button>
                </div>
              </div>

              {/* Email preview (collapsed) */}
              {isPreviewing && !isEditing && (
                <div className="border-t border-black/5 mx-4 mb-4 pt-3">
                  <div className="text-xs text-black/40 mb-1">Email preview — sample data</div>
                  <div className="bg-black/3 rounded-lg p-4 text-sm">
                    <div className="font-medium mb-2">{applyVars(emailSubject)}</div>
                    <div className="text-black/70 whitespace-pre-wrap">{applyVars(emailBody)}</div>
                  </div>
                </div>
              )}

              {/* Step editor */}
              {isEditing && (
                <div className="border-t border-black/10 bg-black/1">
                  {/* Delay row */}
                  <div className="px-4 pt-4 pb-2">
                    <div className="flex items-center gap-3 w-40">
                      <div className="flex-1">
                        <label className="label">Delay (hours)</label>
                        <input
                          className="input"
                          type="number"
                          min="0"
                          value={step.delay_hours}
                          onChange={(e) => mutateStep(step.id, (s) => ({ ...s, delay_hours: Number(e.target.value) }))}
                        />
                      </div>
                      <div className="mt-5 text-xs text-black/40 shrink-0">{delayLabel(step.delay_hours)}</div>
                    </div>
                  </div>

                  {/* Channel tabs */}
                  <div className="px-4 pb-1">
                    <div className="flex gap-1 border-b border-black/10">
                      {CHANNEL_TABS.map((tab) => (
                        <button
                          key={tab.key}
                          onClick={() => setEditTab(tab.key)}
                          className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                            editTab === tab.key
                              ? "border-navy text-navy"
                              : "border-transparent text-black/40 hover:text-black/70"
                          }`}
                        >
                          {tab.label}
                          {!tab.live && (
                            <span className="text-[10px] bg-black/8 text-black/40 rounded px-1 py-0.5 leading-none">
                              Soon
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Tab: Email (live) */}
                  {editTab === "email" && (
                    <div className="px-4 py-3 space-y-3">
                      <div>
                        <label className="label">Subject line</label>
                        <input
                          className="input"
                          value={step.channels.email.subject}
                          onChange={(e) =>
                            mutateStep(step.id, (s) => ({
                              ...s, channels: { ...s.channels, email: { ...s.channels.email, subject: e.target.value } }
                            }))
                          }
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="label mb-0">Body</span>
                          <span className="text-[11px] text-black/40">Insert variable:</span>
                          {VARIABLES.map((v) => (
                            <button
                              key={v}
                              type="button"
                              onClick={() => insertVar(v, step.id)}
                              className="text-[11px] font-mono bg-sky-50 text-sky-700 border border-sky-200 rounded px-1.5 py-0.5 hover:bg-sky-100"
                            >
                              {v}
                            </button>
                          ))}
                        </div>
                        <textarea
                          ref={bodyRef}
                          className="input min-h-36 font-mono text-sm"
                          value={step.channels.email.body}
                          onChange={(e) =>
                            mutateStep(step.id, (s) => ({
                              ...s, channels: { ...s.channels, email: { ...s.channels.email, body: e.target.value } }
                            }))
                          }
                        />
                      </div>
                      {/* Live preview */}
                      <div className="bg-black/3 rounded-lg p-4 text-sm">
                        <div className="text-xs text-black/40 mb-1">Live preview</div>
                        <div className="font-medium mb-1">{applyVars(step.channels.email.subject)}</div>
                        <div className="text-black/70 whitespace-pre-wrap">{applyVars(step.channels.email.body)}</div>
                      </div>
                    </div>
                  )}

                  {/* Tab: SMS (coming soon) */}
                  {editTab === "sms" && (
                    <div className="px-4 py-3 space-y-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-black/50">SMS Channel</span>
                        <span className="text-[11px] bg-amber-100 text-amber-700 rounded px-2 py-0.5">Coming Soon — Phase 3</span>
                      </div>
                      <div>
                        <label className="label">Message body</label>
                        <div className="relative">
                          <textarea
                            className="input min-h-24 opacity-50"
                            disabled
                            value={step.channels.sms?.body ?? ""}
                            placeholder="SMS body (max 160 chars)…"
                            maxLength={160}
                          />
                          <div className="absolute bottom-2 right-3 text-[11px] text-black/30">
                            {(step.channels.sms?.body ?? "").length}/160
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Tab: WhatsApp (coming soon) */}
                  {editTab === "whatsapp" && (
                    <div className="px-4 py-3 space-y-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-black/50">WhatsApp Channel</span>
                        <span className="text-[11px] bg-amber-100 text-amber-700 rounded px-2 py-0.5">Coming Soon — Phase 3</span>
                      </div>
                      <div>
                        <label className="label">Template name</label>
                        <input
                          className="input opacity-50"
                          disabled
                          value={step.channels.whatsapp?.template_name ?? ""}
                          placeholder="e.g. follow_up_v1"
                        />
                      </div>
                      <div>
                        <label className="label">Message body</label>
                        <textarea
                          className="input min-h-24 opacity-50"
                          disabled
                          value={step.channels.whatsapp?.body ?? ""}
                          placeholder="WhatsApp message body…"
                        />
                      </div>
                    </div>
                  )}

                  {/* Tab: Internal (coming soon) */}
                  {editTab === "internal" && (
                    <div className="px-4 py-3 space-y-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-black/50">Internal Note</span>
                        <span className="text-[11px] bg-amber-100 text-amber-700 rounded px-2 py-0.5">Coming Soon — Phase 3</span>
                      </div>
                      <div>
                        <label className="label">Note</label>
                        <textarea
                          className="input min-h-24 opacity-50"
                          disabled
                          value={step.channels.internal?.note ?? ""}
                          placeholder="Internal task or note for this step…"
                        />
                      </div>
                    </div>
                  )}

                  {/* Save / Cancel */}
                  <div className="flex gap-2 justify-end px-4 py-3 border-t border-black/5">
                    <button
                      className="text-sm text-black/50 hover:text-black/80 px-3 py-1.5 rounded hover:bg-black/5"
                      onClick={() => { setSteps(initial.sequence_steps.map((s) => ({ ...s, channels: s.channels ?? emptyChannels() }))); setEditingId(null); }}
                    >
                      Cancel
                    </button>
                    <button className="btn-gold text-xs py-1.5 px-4" disabled={saving} onClick={() => saveStep(step)}>
                      {saving ? "Saving…" : "Save step"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {steps.length === 0 && (
          <div className="card p-10 text-center text-black/40">
            No steps yet. Click "+ Add step" to create one.
          </div>
        )}
      </div>
    </div>
  );
}
