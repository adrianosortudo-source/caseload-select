"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SELF_REPORT_CATEGORIES: { value: string; label: string }[] = [
  { value: "referral", label: "Referral" },
  { value: "search", label: "Search" },
  { value: "social", label: "Social media" },
  { value: "ai_tool", label: "AI tool (e.g. ChatGPT)" },
  { value: "event", label: "Event" },
  { value: "existing_client", label: "Existing client" },
  { value: "other", label: "Other" },
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 6,
  fontSize: 13,
};

/**
 * Records one self-reported or operator-observed offline-referral
 * evidence row for a lead. Never edits an existing row -- each submit is
 * a new append-only insert. Does not create marketing consent and is
 * entirely optional; there is no requirement to fill this out to
 * process a lead.
 */
export default function ContentAttributionEvidenceForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<"self_reported" | "offline_referral">("self_reported");
  const [category, setCategory] = useState("referral");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) {
      setError("Describe what was said or observed.");
      return;
    }
    setState("saving");
    setError(null);
    try {
      const res = await fetch(`/api/admin/content-performance/leads/${leadId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attribution_state: kind,
          self_report_category: kind === "self_reported" ? category : undefined,
          evidence_note: note,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setState("error");
        setError(json.error ?? "Could not record evidence.");
        return;
      }
      setNote("");
      setState("idle");
      router.refresh();
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={kind === "self_reported"}
            onChange={() => setKind("self_reported")}
          />
          Self-reported by the prospect
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={kind === "offline_referral"}
            onChange={() => setKind("offline_referral")}
          />
          Operator-observed offline referral
        </label>
      </div>

      {kind === "self_reported" && (
        <div>
          <label className="block text-xs text-black/50 mb-1">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
            {SELF_REPORT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="block text-xs text-black/50 mb-1">
          {kind === "self_reported" ? "What did they say (verbatim if possible)?" : "What was observed?"}
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          style={inputStyle}
          placeholder={
            kind === "self_reported"
              ? "e.g. \"I found you through the article on commercial leases.\""
              : "e.g. \"Existing client Jane Doe mentioned she referred this prospect at pickup.\""
          }
        />
      </div>

      {error && <div className="text-xs text-rose-600">{error}</div>}

      <button
        type="submit"
        disabled={state === "saving"}
        className="text-xs font-semibold text-navy bg-black/5 hover:bg-black/10 rounded px-3 py-1.5 disabled:opacity-50"
      >
        {state === "saving" ? "Saving..." : "Record evidence"}
      </button>
    </form>
  );
}
