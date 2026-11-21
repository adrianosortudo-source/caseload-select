"use client";

import { useEffect, useState } from "react";
import type { VoiceRecoveryResponse } from "@/lib/voice-recovery-ui";

export default function VoiceRecoveryTabCount({ firmId, inverted }: { firmId: string; inverted: boolean }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ firm_id: firmId, limit: "1" });
    fetch(`/api/admin/voice-recovery?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("count unavailable");
        return response.json() as Promise<VoiceRecoveryResponse>;
      })
      .then((payload) => {
        if (cancelled) return;
        const counts = payload.counts;
        const actionable = counts.new !== undefined
          ? counts.new + counts.acknowledged + (counts.follow_up ?? 0)
          : counts.open + counts.acknowledged;
        setCount(actionable);
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [firmId]);

  return (
    <span
      className={`font-mono text-[10px] ${inverted ? "text-white/70" : "text-black/40"}`}
      aria-label={count === null ? "Recovery count unavailable" : `${count} recovery cases need attention`}
    >
      {count ?? "?"}
    </span>
  );
}
