"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  consentLabel,
  deriveRecoveryCounts,
  isSlaOverdue,
  recoveryDispositionLabel,
  recoveryDisplayStatus,
  recoveryExcerpt,
  recoveryStatusLabel,
  type VoiceRecoveryCase,
  type VoiceRecoveryDisplayStatus,
  type VoiceRecoveryResponse,
} from "@/lib/voice-recovery-ui";

type EditorMode = "follow_up" | "resolve" | "promote";
type FilterStatus = "all" | VoiceRecoveryDisplayStatus;

const STATUS_ORDER: VoiceRecoveryDisplayStatus[] = [
  "new",
  "acknowledged",
  "follow_up",
  "resolved",
  "promoted",
];

export default function VoiceRecoveryClient({ firmId }: { firmId: string }) {
  const [payload, setPayload] = useState<VoiceRecoveryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [editor, setEditor] = useState<{ id: string; mode: EditorMode } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ firm_id: firmId, limit: "100" });
      const response = await fetch(`/api/admin/voice-recovery?${params.toString()}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not load voice recovery cases.");
      setPayload(body as VoiceRecoveryResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load voice recovery cases.");
    } finally {
      setLoading(false);
    }
  }, [firmId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const counts = useMemo(
    () => deriveRecoveryCounts(payload?.cases ?? [], payload?.counts),
    [payload],
  );
  const visibleCases = useMemo(() => {
    const cases = payload?.cases ?? [];
    return filter === "all" ? cases : cases.filter((item) => recoveryDisplayStatus(item) === filter);
  }, [filter, payload]);

  async function patchCase(
    item: VoiceRecoveryCase,
    action: "acknowledge" | "assign" | "follow_up" | "resolve",
    extras: Record<string, unknown> = {},
  ) {
    setBusyId(item.id);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/admin/voice-recovery/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extras }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not ${action.replace("_", " ")} this case.`);
      setEditor(null);
      setNotice(actionNotice(action));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The recovery action did not complete.");
    } finally {
      setBusyId(null);
    }
  }

  async function promote(item: VoiceRecoveryCase) {
    setBusyId(item.id);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/admin/voice-recovery/${item.id}/promote`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not promote this caller to Screen.");
      setEditor(null);
      setNotice(`Promoted to Screen${body.lead_id ? ` as ${body.lead_id}` : ""}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The promotion did not complete.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading && !payload) return <RecoveryLoading />;
  if (error && !payload) return <RecoveryError message={error} onRetry={() => void load()} />;

  return (
    <section aria-labelledby="voice-recovery-heading" className="space-y-5">
      <div className="bg-white border border-black/10 px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider font-bold text-gold">Before lawyer triage</p>
            <h2 id="voice-recovery-heading" className="mt-1 text-xl font-display font-bold text-navy">
              Calls that need a human decision
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-black/60">
              These callers have not been qualified as legal leads. Review the evidence, recover the conversation,
              and promote only when the facts support sending the matter to Screen.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="min-h-[40px] border border-black/20 px-3 py-2 text-xs font-bold uppercase tracking-wider text-navy hover:border-navy disabled:cursor-wait disabled:opacity-50"
          >
            {loading ? "Refreshing" : "Refresh"}
          </button>
        </div>

        <div className="mt-5 flex flex-wrap gap-1.5" role="group" aria-label="Filter recovery cases by status">
          <StatusFilter label="All" count={counts.total} active={filter === "all"} onClick={() => setFilter("all")} />
          {STATUS_ORDER.map((status) => (
            <StatusFilter
              key={status}
              label={recoveryStatusLabel(status)}
              count={counts[status]}
              active={filter === status}
              onClick={() => setFilter(status)}
            />
          ))}
        </div>
      </div>

      <div aria-live="polite" aria-atomic="true">
        {notice && <p className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</p>}
        {error && <p role="alert" className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      </div>

      {visibleCases.length === 0 ? (
        <div className="border border-black/10 bg-white px-6 py-10 text-center">
          <p className="text-sm text-black/60">No recovery cases match this status.</p>
        </div>
      ) : (
        <div className="space-y-3" aria-label="Voice recovery cases">
          {visibleCases.map((item) => (
            <VoiceRecoveryCard
              key={item.id}
              item={item}
              busy={busyId === item.id}
              editorMode={editor?.id === item.id ? editor.mode : null}
              onEdit={(mode) => setEditor((current) => current?.id === item.id && current.mode === mode ? null : { id: item.id, mode })}
              onAcknowledge={() => void patchCase(item, "acknowledge")}
              onClaim={() => void patchCase(item, "assign")}
              onFollowUp={(followUpState, note) => void patchCase(item, "follow_up", {
                follow_up_state: followUpState,
                follow_up_note: note,
              })}
              onResolve={(note) => void patchCase(item, "resolve", { follow_up_note: note })}
              onPromote={() => void promote(item)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function StatusFilter({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex min-h-[40px] items-center gap-2 border px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
        active ? "border-navy bg-navy text-white" : "border-black/15 bg-parchment text-black/65 hover:border-navy hover:text-navy"
      }`}
    >
      {label}
      <span className={`font-mono text-[10px] ${active ? "text-white/70" : "text-black/40"}`}>{count}</span>
    </button>
  );
}

export function VoiceRecoveryCard({
  item,
  busy,
  editorMode,
  onEdit,
  onAcknowledge,
  onClaim,
  onFollowUp,
  onResolve,
  onPromote,
}: {
  item: VoiceRecoveryCase;
  busy: boolean;
  editorMode: EditorMode | null;
  onEdit: (mode: EditorMode) => void;
  onAcknowledge: () => void;
  onClaim: () => void;
  onFollowUp: (state: string, note: string) => void;
  onResolve: (note: string) => void;
  onPromote: () => void;
}) {
  const status = recoveryDisplayStatus(item);
  const closed = status === "resolved" || status === "promoted";
  const overdue = isSlaOverdue(item);
  const name = item.caller_name?.trim() || "Unknown caller";
  const nameSource = formatEvidenceSource(item.caller_name_provenance ?? item.name_source);
  const transcriptSource = formatEvidenceSource(item.transcript_source);

  return (
    <article className={`border bg-white ${overdue ? "border-red-300" : "border-black/10"}`} aria-labelledby={`recovery-${item.id}`}>
      <div className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={status} />
            <span className="border border-black/10 bg-parchment-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-navy">
              {recoveryDispositionLabel(item.disposition)}
            </span>
            {item.urgency && (
              <span className={`border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${urgencyClasses(item.urgency)}`}>
                {item.urgency}
              </span>
            )}
          </div>
          <h3 id={`recovery-${item.id}`} className="mt-3 text-xl font-display font-bold text-navy">{name}</h3>
          <p className="mt-0.5 text-xs text-black/50">Name source: {nameSource}</p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-[10px] font-bold uppercase tracking-wider text-black/40">Arrived</p>
          <p className="mt-1 text-xs font-medium text-black/70">{formatDateTime(item.created_at)}</p>
          {item.sla_due_at && (
            <p className={`mt-1 text-xs font-semibold ${overdue ? "text-red-700" : "text-black/55"}`}>
              {overdue ? "SLA overdue" : "SLA due"}: {formatDateTime(item.sla_due_at)}
            </p>
          )}
        </div>
      </div>

      <div className="mx-5 mt-4 grid gap-3 border-y border-black/5 py-4 md:grid-cols-2 xl:grid-cols-4">
        <EvidenceField label="Observed caller ID" value={item.observed_caller_id || "Not available"} />
        <EvidenceField
          label="Spoken callback number"
          value={item.spoken_callback_number || "Not provided"}
          detail={item.spoken_callback_number ? (item.callback_number_verified ? "Verified" : "Not verified") : undefined}
        />
        <EvidenceField
          label="Messaging consent"
          value={`SMS: ${consentLabel(item.sms_consent)}; WhatsApp: ${consentLabel(item.whatsapp_consent)}`}
          detail={item.messaging_consent_provenance ? `Source: ${formatEvidenceSource(item.messaging_consent_provenance)}` : undefined}
        />
        <EvidenceField label="Owner" value={item.owner_name || "Unassigned"} detail={item.acknowledged_at ? `Acknowledged ${formatDateTime(item.acknowledged_at)}` : "Not acknowledged"} />
      </div>

      <div className="mx-5 py-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-black/40">Call evidence</p>
        <blockquote className="mt-2 text-sm leading-relaxed text-black/75">
          {recoveryExcerpt(item)}
        </blockquote>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-black/45">
          <span>Transcript: {transcriptSource}</span>
          <span>Alert: {formatEvidenceSource(item.alert_status)}</span>
          <span>Delivery: {formatEvidenceSource(item.delivery_state)}</span>
          <span>Follow-up: {formatEvidenceSource(item.follow_up_state)}</span>
          {item.last_follow_up_summary && <span>{item.follow_up_count} follow-up {item.follow_up_count === 1 ? "attempt" : "attempts"} recorded</span>}
        </div>
      </div>

      {!closed && (
        <div className="border-t border-black/10 bg-parchment/40 px-5 py-4">
          <div className="flex flex-wrap gap-2" aria-label={`Actions for ${name}`}>
            {status === "new" && <ActionButton label="Acknowledge" onClick={onAcknowledge} disabled={busy} />}
            {!item.owner_name && <ActionButton label="Claim" onClick={onClaim} disabled={busy} />}
            <ActionButton label="Record follow-up" onClick={() => onEdit("follow_up")} disabled={busy} expanded={editorMode === "follow_up"} />
            <ActionButton label="Resolve non-lead" onClick={() => onEdit("resolve")} disabled={busy} expanded={editorMode === "resolve"} />
            <ActionButton label="Promote to Screen" onClick={() => onEdit("promote")} disabled={busy} expanded={editorMode === "promote"} primary />
          </div>
          {busy && <p role="status" className="mt-3 text-xs text-black/55">Saving this recovery decision...</p>}
          {editorMode === "follow_up" && <FollowUpForm disabled={busy} onSubmit={onFollowUp} onCancel={() => onEdit("follow_up")} />}
          {editorMode === "resolve" && <ResolveForm disabled={busy} onSubmit={onResolve} onCancel={() => onEdit("resolve")} />}
          {editorMode === "promote" && <PromoteConfirm disabled={busy} onConfirm={onPromote} onCancel={() => onEdit("promote")} />}
        </div>
      )}
    </article>
  );
}

function EvidenceField({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-black/40">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-navy">{value}</p>
      {detail && <p className="mt-0.5 text-[11px] text-black/50">{detail}</p>}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  expanded,
  primary = false,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  expanded?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={expanded}
      className={`min-h-[40px] border px-3 py-2 text-xs font-bold uppercase tracking-wider disabled:cursor-wait disabled:opacity-50 ${
        primary ? "border-navy bg-navy text-white hover:bg-navy/90" : "border-black/20 bg-white text-navy hover:border-navy"
      }`}
    >
      {label}
    </button>
  );
}

function FollowUpForm({ disabled, onSubmit, onCancel }: { disabled: boolean; onSubmit: (state: string, note: string) => void; onCancel: () => void }) {
  const [state, setState] = useState("attempted");
  const [note, setNote] = useState("");
  return (
    <form className="mt-4 max-w-2xl border border-black/10 bg-white p-4" onSubmit={(event) => { event.preventDefault(); onSubmit(state, note.trim()); }}>
      <h4 className="text-sm font-bold text-navy">Record a follow-up attempt</h4>
      <div className="mt-3 grid gap-3 sm:grid-cols-[180px_1fr]">
        <label className="text-xs font-semibold text-black/65">
          Outcome
          <select value={state} onChange={(event) => setState(event.target.value)} className="mt-1 min-h-[40px] w-full border border-black/20 bg-white px-2 text-sm text-black" disabled={disabled}>
            <option value="attempted">Attempted</option>
            <option value="scheduled">Scheduled</option>
            <option value="completed">Completed</option>
            <option value="not_needed">Not needed</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-black/65">
          Evidence note
          <textarea value={note} onChange={(event) => setNote(event.target.value)} required rows={3} disabled={disabled} className="mt-1 w-full border border-black/20 bg-white px-3 py-2 text-sm text-black" placeholder="Channel, result, and next step" />
        </label>
      </div>
      <FormButtons disabled={disabled} submitLabel="Save follow-up" onCancel={onCancel} />
    </form>
  );
}

function ResolveForm({ disabled, onSubmit, onCancel }: { disabled: boolean; onSubmit: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState("");
  return (
    <form className="mt-4 max-w-2xl border border-black/10 bg-white p-4" onSubmit={(event) => { event.preventDefault(); onSubmit(note.trim()); }}>
      <h4 className="text-sm font-bold text-navy">Resolve as a non-lead</h4>
      <p className="mt-1 text-xs text-black/55">This closes recovery without creating a Screen lead. Record the evidence for the decision.</p>
      <label className="mt-3 block text-xs font-semibold text-black/65">
        Resolution note
        <textarea value={note} onChange={(event) => setNote(event.target.value)} required rows={3} disabled={disabled} className="mt-1 w-full border border-black/20 bg-white px-3 py-2 text-sm text-black" placeholder="Why this caller is not a legal lead" />
      </label>
      <FormButtons disabled={disabled} submitLabel="Resolve non-lead" onCancel={onCancel} />
    </form>
  );
}

function PromoteConfirm({ disabled, onConfirm, onCancel }: { disabled: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div role="group" aria-labelledby="promote-title" aria-describedby="promote-description" className="mt-4 max-w-2xl border border-gold/50 bg-white p-4">
      <h4 id="promote-title" className="text-sm font-bold text-navy">Promote this caller to Screen?</h4>
      <p id="promote-description" className="mt-1 text-xs leading-relaxed text-black/60">
        Screen will process the call evidence and place the resulting matter in lawyer triage. The operator is making the routing decision, not the AI.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onConfirm} disabled={disabled} className="min-h-[40px] border border-navy bg-navy px-3 py-2 text-xs font-bold uppercase tracking-wider text-white disabled:opacity-50">Confirm promotion</button>
        <button type="button" onClick={onCancel} disabled={disabled} className="min-h-[40px] border border-black/20 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wider text-navy disabled:opacity-50">Cancel</button>
      </div>
    </div>
  );
}

function FormButtons({ disabled, submitLabel, onCancel }: { disabled: boolean; submitLabel: string; onCancel: () => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="submit" disabled={disabled} className="min-h-[40px] border border-navy bg-navy px-3 py-2 text-xs font-bold uppercase tracking-wider text-white disabled:opacity-50">{submitLabel}</button>
      <button type="button" onClick={onCancel} disabled={disabled} className="min-h-[40px] border border-black/20 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wider text-navy disabled:opacity-50">Cancel</button>
    </div>
  );
}

function StatusChip({ status }: { status: VoiceRecoveryDisplayStatus }) {
  const classes = {
    new: "border-red-200 bg-red-50 text-red-800",
    acknowledged: "border-amber-200 bg-amber-50 text-amber-800",
    follow_up: "border-blue-200 bg-blue-50 text-blue-800",
    resolved: "border-black/15 bg-parchment-2 text-black/60",
    promoted: "border-emerald-200 bg-emerald-50 text-emerald-800",
  }[status];
  return <span className={`border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${classes}`}>{recoveryStatusLabel(status)}</span>;
}

function RecoveryLoading() {
  return <div role="status" className="border border-black/10 bg-white px-6 py-10 text-center text-sm text-black/60">Loading voice recovery cases...</div>;
}

function RecoveryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="border border-red-200 bg-white px-6 py-6">
      <p className="text-sm text-red-800">{message}</p>
      <button type="button" onClick={onRetry} className="mt-3 min-h-[40px] border border-red-300 px-3 py-2 text-xs font-bold uppercase tracking-wider text-red-800">Try again</button>
    </div>
  );
}

function actionNotice(action: "acknowledge" | "assign" | "follow_up" | "resolve"): string {
  return {
    acknowledge: "Recovery case acknowledged.",
    assign: "Recovery case claimed.",
    follow_up: "Follow-up evidence saved.",
    resolve: "Recovery case resolved as a non-lead.",
  }[action];
}

function formatEvidenceSource(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function urgencyClasses(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === "urgent" || normalized === "critical") return "border-red-300 bg-red-50 text-red-800";
  if (normalized === "high" || normalized === "priority") return "border-amber-300 bg-amber-50 text-amber-800";
  return "border-black/15 bg-white text-black/55";
}
