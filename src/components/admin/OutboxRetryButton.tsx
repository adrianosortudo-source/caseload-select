"use client";

/**
 * Operator retry button for the webhook_outbox row. POSTs to
 * /api/admin/webhook-outbox/[id]/retry, which now accepts the operator
 * session cookie alongside the existing CRON_SECRET bearer.
 *
 * On success, refreshes the page so the row's new state lands.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

type State = "idle" | "firing" | "ok" | "err";

export default function OutboxRetryButton({ outboxId }: { outboxId: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function onClick() {
    if (state === "firing") return;
    setState("firing");
    setErrMsg(null);
    try {
      const res = await fetch(`/api/admin/webhook-outbox/${outboxId}/retry`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrMsg((body as { error?: string }).error ?? `HTTP ${res.status}`);
        setState("err");
        return;
      }
      setState("ok");
      // Brief visual pause so the lawyer sees the OK, then refresh data.
      setTimeout(() => router.refresh(), 600);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setState("err");
    }
  }

  if (state === "firing") {
    return (
      <span className="text-[10px] uppercase tracking-wider text-black/40">Firing…</span>
    );
  }
  if (state === "ok") {
    return (
      <span className="text-[10px] uppercase tracking-wider text-emerald-700">Sent</span>
    );
  }
  if (state === "err") {
    return (
      <button
        onClick={onClick}
        title={errMsg ?? "Retry"}
        className="text-[10px] uppercase tracking-wider px-2 py-0.5 border border-red-300 text-red-700 hover:bg-red-50"
      >
        Retry · failed
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className="text-[10px] uppercase tracking-wider font-semibold px-2 py-1 border border-navy/30 text-navy hover:bg-navy hover:text-white transition-colors"
    >
      Retry
    </button>
  );
}
