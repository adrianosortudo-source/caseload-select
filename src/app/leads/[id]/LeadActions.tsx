"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { STAGES, type Stage } from "@/lib/types";

interface Firm { id: string; name: string }

interface Props {
  leadId: string;
  currentStage: string;
  conflictResult: string | null;
  conflictCheckId: string | null;
  firms: Firm[];
  currentFirmId: string | null;
}

export default function LeadActions({
  leadId,
  currentStage,
  conflictResult,
  firms,
  currentFirmId,
}: Props) {
  const router = useRouter();
  const [stage, setStage] = useState(currentStage);
  const [overrideReason, setOverrideReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [conflictStatus, setConflictStatus] = useState(conflictResult);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function changeStage(newStage: Stage) {
    setBusy("stage");
    setMessage(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/stage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage: newStage }),
      });
      const data = await res.json() as { error?: string; message?: string };
      if (!res.ok) {
        if (data.error === "conflict_gate") {
          setMessage({ type: "err", text: `Conflict gate: ${data.message}` });
        } else {
          setMessage({ type: "err", text: data.message ?? "Stage update failed." });
        }
      } else {
        setStage(newStage);
        setMessage({ type: "ok", text: `Stage updated to ${STAGES.find((s) => s.key === newStage)?.label ?? newStage}.` });
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function runConflictCheck() {
    setBusy("check");
    setMessage(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/conflict-check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json() as { result?: string; message?: string };
      if (res.ok && data.result) {
        setConflictStatus(data.result);
        setMessage({ type: data.result === "clear" ? "ok" : "err", text: data.message ?? data.result });
        router.refresh();
      } else {
        setMessage({ type: "err", text: "Conflict check failed." });
      }
    } finally {
      setBusy(null);
    }
  }

  async function submitOverride() {
    if (!overrideReason.trim()) return;
    setBusy("override");
    setMessage(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/conflict-check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ override_reason: overrideReason.trim() }),
      });
      const data = await res.json() as { message?: string };
      if (res.ok) {
        setConflictStatus("clear");
        setOverrideReason("");
        setMessage({ type: "ok", text: data.message ?? "Override applied." });
        router.refresh();
      } else {
        setMessage({ type: "err", text: data.message ?? "Override failed." });
      }
    } finally {
      setBusy(null);
    }
  }

  const stageLabel = STAGES.find((s) => s.key === stage)?.label ?? stage;

  return (
    <div className="space-y-4">
      {/* Stage selector */}
      <div>
        <div className="text-xs text-black/50 mb-1.5">Current stage: <span className="font-medium text-black/70">{stageLabel}</span></div>
        <div className="flex flex-wrap gap-1.5">
          {STAGES.filter((s) => s.key !== stage).map((s) => (
            <button
              key={s.key}
              onClick={() => changeStage(s.key)}
              disabled={busy === "stage"}
              className="text-xs px-3 py-1.5 rounded border border-black/15 text-black/60 hover:bg-black/5 disabled:opacity-40"
            >
              → {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Conflict check */}
      <div className="border-t border-black/5 pt-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-black/50">Conflict check</div>
          <button
            onClick={runConflictCheck}
            disabled={busy === "check"}
            className="text-xs px-3 py-1 rounded border border-black/15 text-black/50 hover:bg-black/5 disabled:opacity-40"
          >
            {busy === "check" ? "Checking..." : conflictStatus ? "Re-run check" : "Run check"}
          </button>
        </div>

        {/* Override form  -  shown only for potential_conflict */}
        {conflictStatus === "potential_conflict" && (
          <div className="mt-2 space-y-2">
            <input
              className="input text-xs"
              placeholder="Override reason (required to proceed)"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
            />
            <button
              onClick={submitOverride}
              disabled={!overrideReason.trim() || busy === "override"}
              className="btn-gold text-xs py-1.5 w-full"
            >
              {busy === "override" ? "Saving..." : "Apply override"}
            </button>
          </div>
        )}
      </div>

      {/* Firm assignment (display only) */}
      {currentFirmId && (
        <div className="border-t border-black/5 pt-3 text-xs text-black/40">
          Firm: <span className="text-black/60">{firms.find((f) => f.id === currentFirmId)?.name ?? currentFirmId}</span>
        </div>
      )}

      {/* Feedback message */}
      {message && (
        <div
          className={`text-xs rounded px-3 py-2 mt-1 ${
            message.type === "ok"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-rose-50 text-rose-700"
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
