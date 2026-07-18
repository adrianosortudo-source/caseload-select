"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Triggers deterministic normalization of this lead's already-captured
 * UTM/referrer fields into an evidence row. Per-lead, operator-
 * triggered -- never an automated bulk sweep. Idempotent.
 */
export default function ContentAttributionSyncButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setState("loading");
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/content-performance/leads/${leadId}/sync`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setState("error");
        setMessage(json.error ?? "Could not sync observed evidence.");
        return;
      }
      setState("idle");
      setMessage(json.evidence ? "Observed evidence recorded." : "No new observed evidence found.");
      router.refresh();
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Network error.");
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={state === "loading"}
        className="text-xs font-semibold text-navy/70 hover:text-navy disabled:opacity-50"
      >
        {state === "loading" ? "Checking..." : "Sync observed evidence from intake"}
      </button>
      {message && <div className="text-xs text-black/50 mt-1">{message}</div>}
    </div>
  );
}
