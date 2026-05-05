"use client";

import { useEffect, useState } from "react";
import { snapshot, baselineHoursFromSubmit, type TimerSnapshot } from "@/lib/decision-timer";

interface Props {
  deadlineIso: string;
  submittedAtIso: string;
  variant?: "row" | "header";
}

/**
 * Live-updating countdown to the lawyer's decision deadline. Re-snapshots on
 * a 30-second interval (the displayed precision is minutes; sub-minute ticks
 * would just churn the DOM). The colour treatment is driven by `urgency` —
 * the tier breakpoints live in lib/decision-timer so the same logic can be
 * tested in isolation.
 */
export default function DecisionTimer({ deadlineIso, submittedAtIso, variant = "row" }: Props) {
  const baseline = baselineHoursFromSubmit(submittedAtIso, deadlineIso);
  const [snap, setSnap] = useState<TimerSnapshot>(() => snapshot(deadlineIso, new Date(), baseline));

  useEffect(() => {
    const tick = () => setSnap(snapshot(deadlineIso, new Date(), baseline));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [deadlineIso, baseline]);

  const colour =
    snap.urgency === "expired"  ? "text-red-700"
    : snap.urgency === "critical" ? "text-red-700"
    : snap.urgency === "warning"  ? "text-amber-700"
                                  : "text-navy";

  if (variant === "header") {
    return (
      <div className="flex items-baseline gap-2">
        <span className={`font-mono text-lg font-bold ${colour}`}>{snap.remainingLabel}</span>
        <span className="text-xs uppercase tracking-wider text-black/50">decision window</span>
      </div>
    );
  }

  return (
    <span className={`font-mono text-sm font-semibold tabular-nums ${colour}`}>
      {snap.remainingLabel}
    </span>
  );
}
