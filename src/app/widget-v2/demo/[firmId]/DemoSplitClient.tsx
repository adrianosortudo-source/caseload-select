"use client";

/**
 * DemoSplitClient — client-side glue for the split-screen demo.
 *
 * Owns the scoring snapshot + answer log state, passes them down to both
 * the IntakeControllerV2 (which writes via callbacks) and the LiveScoringPanel
 * (which reads).
 */

import { useState } from "react";
import { IntakeControllerV2, type ScoreSnapshot, type AnswerLogEntry } from "@/components/intake-v2/IntakeControllerV2";
import { LiveScoringPanel } from "@/components/intake-v2/LiveScoringPanel";

interface Props {
  firmId: string;
  firmName: string;
}

export function DemoSplitClient({ firmId, firmName }: Props) {
  const [snapshot, setSnapshot] = useState<ScoreSnapshot | null>(null);
  const [log, setLog] = useState<AnswerLogEntry[]>([]);
  const [step, setStep] = useState<string>("kickoff");

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Widget pane — 60% on desktop, full width on mobile */}
      <div className="flex-1 lg:flex-[3] min-h-[60vh] lg:min-h-screen border-b lg:border-b-0 lg:border-r border-[#1E2F58]/10">
        <IntakeControllerV2
          firmId={firmId}
          firmName={firmName}
          onScoreUpdate={setSnapshot}
          onAnswerLogged={entry => setLog(l => [...l, entry])}
          onStepChange={setStep}
        />
      </div>

      {/* Live scoring pane — 40% on desktop, stacked below on mobile */}
      <div className="lg:flex-[2] min-h-[40vh] lg:min-h-screen lg:max-h-screen lg:overflow-hidden">
        <LiveScoringPanel snapshot={snapshot} log={log} step={step} />
      </div>
    </div>
  );
}
