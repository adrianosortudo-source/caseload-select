"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  firmId: string;
  leadId: string;
  band: "A" | "B" | "C" | "D" | null;
  initialStatus: "triaging" | "taken" | "passed" | "declined" | "referred";
}

type Mode = "idle" | "submitting" | "pass-modal" | "refer-modal" | "error";

const TAKE_LABEL: Record<string, string> = {
  A: "Take · Call same day",
  B: "Take · Send booking link",
  C: "Take · Engage cadence",
  D: "Take anyway",
};

export default function TriageActionBar({ firmId, leadId, band, initialStatus }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (status !== "triaging") {
    return (
      <div
        className="fixed inset-x-0 bottom-0 bg-white border-t border-black/10 px-4 py-3 z-30"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0) + 0.75rem)" }}
      >
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <p className="text-sm text-black/60 truncate">
            {status === "taken" && "Lead taken. Cadence engaged."}
            {status === "passed" && "Lead passed. Decline-with-grace fired."}
            {status === "referred" && "Lead referred. Awaiting downstream cadence."}
            {status === "declined" && "Lead declined."}
          </p>
          <a
            href={`/portal/${firmId}/triage`}
            className="text-xs uppercase tracking-wider font-semibold text-navy hover:underline shrink-0"
          >
            Back to queue →
          </a>
        </div>
      </div>
    );
  }

  const isBandD = band === "D";

  async function onTake() {
    setMode("submitting");
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/triage/${leadId}/take`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Take failed.");
        setMode("error");
        return;
      }
      setStatus("taken");
      setMode("idle");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setMode("error");
    }
  }

  async function onPassConfirm(note: string) {
    setMode("submitting");
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/triage/${leadId}/pass`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim().length > 0 ? note.trim() : undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Pass failed.");
        setMode("error");
        return;
      }
      setStatus("passed");
      setMode("idle");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setMode("error");
    }
  }

  async function onReferConfirm(referredTo: string, note: string) {
    setMode("submitting");
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/triage/${leadId}/refer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referredTo: referredTo.trim().length > 0 ? referredTo.trim() : undefined,
          note: note.trim().length > 0 ? note.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Refer failed.");
        setMode("error");
        return;
      }
      setStatus("referred");
      setMode("idle");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setMode("error");
    }
  }

  // Button row layout differs by band:
  //   A/B/C: Pass (outline) + Take (navy primary)
  //   D:     Pass (outline) + Take anyway (outline secondary) + Refer (navy primary)
  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 bg-white border-t border-black/10 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.04)] z-30"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0) + 0.75rem)" }}
      >
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="text-xs text-black/50 uppercase tracking-wider truncate min-w-0">
            {error && mode === "error" ? <span className="text-red-700">{error}</span> : "Decision required"}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setMode("pass-modal")}
              disabled={mode === "submitting"}
              className="bg-white border border-black/20 text-black/80 px-4 py-2.5 sm:py-2 text-sm font-semibold uppercase tracking-wider hover:border-navy hover:text-navy disabled:opacity-50 min-h-[44px] sm:min-h-0"
            >
              Pass
            </button>
            <button
              type="button"
              onClick={onTake}
              disabled={mode === "submitting"}
              className={
                isBandD
                  ? "bg-white border border-black/20 text-black/80 px-4 py-2.5 sm:py-2 text-sm font-semibold uppercase tracking-wider hover:border-navy hover:text-navy disabled:opacity-50 min-h-[44px] sm:min-h-0"
                  : "bg-navy text-white px-5 py-2.5 sm:py-2 text-sm font-semibold uppercase tracking-wider hover:bg-navy-deep disabled:opacity-50 min-h-[44px] sm:min-h-0"
              }
            >
              {mode === "submitting" ? (
                "Working…"
              ) : band ? (
                <>
                  <span className="sm:hidden">Take</span>
                  <span className="hidden sm:inline">{TAKE_LABEL[band]}</span>
                </>
              ) : (
                "Take"
              )}
            </button>
            {isBandD && (
              <button
                type="button"
                onClick={() => setMode("refer-modal")}
                disabled={mode === "submitting"}
                className="bg-navy text-white px-5 py-2.5 sm:py-2 text-sm font-semibold uppercase tracking-wider hover:bg-navy-deep disabled:opacity-50 min-h-[44px] sm:min-h-0"
              >
                Refer
              </button>
            )}
          </div>
        </div>
      </div>

      {mode === "pass-modal" && (
        <PassModal
          onCancel={() => setMode("idle")}
          onConfirm={onPassConfirm}
        />
      )}

      {mode === "refer-modal" && (
        <ReferModal
          onCancel={() => setMode("idle")}
          onConfirm={onReferConfirm}
        />
      )}
    </>
  );
}

interface PassModalProps {
  onCancel: () => void;
  onConfirm: (note: string) => void | Promise<void>;
}

function PassModal({ onCancel, onConfirm }: PassModalProps) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);
    await onConfirm(note);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-end md:items-center justify-center p-4">
      <div className="bg-white max-w-lg w-full border border-black/10 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-black/8">
          <h2 className="text-lg font-bold text-navy">Pass on this lead</h2>
          <p className="mt-1 text-sm text-black/60">
            Decline-with-grace fires immediately. Optionally override the templated copy below.
          </p>
        </div>
        <div className="px-6 py-4 space-y-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wider font-semibold text-black/60">
              Custom decline note (optional)
            </span>
            <textarea
              rows={5}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Leave empty to use the firm's templated decline copy."
              maxLength={4000}
              className="mt-1 w-full bg-parchment border border-black/15 px-3 py-2 text-sm focus:outline-none focus:border-navy resize-y"
            />
            <span className="mt-1 block text-xs text-black/40">
              When set, this overrides the per-firm and per-practice-area templates for this lead only.
            </span>
          </label>
        </div>
        <div className="px-6 py-3 bg-parchment-2 border-t border-black/8 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="text-sm font-semibold uppercase tracking-wider text-black/60 hover:text-navy px-3 py-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="bg-navy text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-navy-deep disabled:opacity-50"
          >
            {submitting ? "Sending decline…" : "Confirm pass"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ReferModalProps {
  onCancel: () => void;
  onConfirm: (referredTo: string, note: string) => void | Promise<void>;
}

function ReferModal({ onCancel, onConfirm }: ReferModalProps) {
  const [referredTo, setReferredTo] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);
    await onConfirm(referredTo, note);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-end md:items-center justify-center p-4">
      <div className="bg-white max-w-lg w-full border border-black/10 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-black/8">
          <h2 className="text-lg font-bold text-navy">Refer this lead</h2>
          <p className="mt-1 text-sm text-black/60">
            The lead lands in your history as referred. The firm's GHL workflow decides what cadence (if any) runs for the contact.
          </p>
        </div>
        <div className="px-6 py-4 space-y-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wider font-semibold text-black/60">
              Refer to (optional)
            </span>
            <input
              type="text"
              value={referredTo}
              onChange={(e) => setReferredTo(e.target.value)}
              placeholder="Colleague name, firm, or email"
              maxLength={4000}
              className="mt-1 w-full bg-parchment border border-black/15 px-3 py-2 text-sm focus:outline-none focus:border-navy"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider font-semibold text-black/60">
              Note (optional)
            </span>
            <textarea
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Internal note — why this lead is being referred, what context to pass along."
              maxLength={4000}
              className="mt-1 w-full bg-parchment border border-black/15 px-3 py-2 text-sm focus:outline-none focus:border-navy resize-y"
            />
          </label>
        </div>
        <div className="px-6 py-3 bg-parchment-2 border-t border-black/8 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="text-sm font-semibold uppercase tracking-wider text-black/60 hover:text-navy px-3 py-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="bg-navy text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-navy-deep disabled:opacity-50"
          >
            {submitting ? "Marking as referred…" : "Confirm refer"}
          </button>
        </div>
      </div>
    </div>
  );
}
