"use client";

import { useCallback, useState } from "react";
import { DemoOperatorPanel } from "@/components/intake-v2/DemoOperatorPanel";
import {
  ScreenEnginePublicWidget,
  type ScreenDemoView,
} from "@/components/intake-v2/ScreenEnginePublicWidget";

interface Props {
  firmId: string;
  firmName: string;
  consentCaptureEnabled?: boolean;
}

const SCENARIOS = [
  {
    label: "Unpaid invoice",
    value:
      "I own a Toronto design studio. A client has not paid a $28,000 invoice for completed work. The invoice was due two weeks ago, and I have the signed proposal, invoice, and email thread.",
  },
  {
    label: "Commercial lease",
    value:
      "I am about to sign a five-year commercial lease for my growing business and want a lawyer to review the personal guarantee, renewal terms, and repair obligations before Friday.",
  },
  {
    label: "Employment issue",
    value:
      "I was dismissed from a management role after eight years. I received a severance offer yesterday and have been asked to sign it within one week.",
  },
] as const;

const EMPTY_VIEW: ScreenDemoView = {
  stage: "kickoff",
  state: null,
  currentQuestion: null,
  report: null,
  extraction: { status: "not-requested" },
  runtime: "demo",
};

export function DemoSplitClient({ firmId, firmName, consentCaptureEnabled = true }: Props) {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [runKey, setRunKey] = useState(0);
  const [view, setView] = useState<ScreenDemoView>(EMPTY_VIEW);
  const receiveView = useCallback((next: ScreenDemoView) => setView(next), []);

  function restart(nextScenarioIndex = scenarioIndex) {
    setScenarioIndex(nextScenarioIndex);
    setView(EMPTY_VIEW);
    setRunKey((key) => key + 1);
  }

  return (
    <div className="min-h-screen bg-[#E9E5DC]" style={{ fontFamily: "DM Sans, sans-serif" }}>
      <header className="border-b border-[#1E2F58]/10 bg-white px-5 py-4 sm:px-7" data-ui-component-content="demo-presenter-toolbar">
        <div className="flex flex-col gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#917A55]">
              CaseLoad Select presentation
            </p>
            <h1 className="mt-1 w-full text-xl font-extrabold text-[#1E2F58]" data-ui-copy="heading" style={{ fontFamily: "Manrope, sans-serif" }}>
              See the client intake and firm review side by side.
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {SCENARIOS.map((scenario, index) => (
              <button
                key={scenario.label}
                type="button"
                onClick={() => restart(index)}
                aria-pressed={scenarioIndex === index}
                className={[
                  "rounded-full border px-4 py-2 text-xs font-semibold transition",
                  scenarioIndex === index
                    ? "border-[#1E2F58] bg-[#1E2F58] text-white"
                    : "border-[#1E2F58]/15 bg-white text-[#1E2F58] hover:border-[#1E2F58]/40",
                ].join(" ")}
              >
                {scenario.label}
              </button>
            ))}
            <button type="button" onClick={() => restart()} className="rounded-full border border-[#B49B72]/40 bg-[#F7F2E9] px-4 py-2 text-xs font-semibold text-[#725E3D] hover:border-[#B49B72]">
              Restart demo
            </button>
          </div>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-105px)] grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
        <section className="min-w-0 border-b border-[#1E2F58]/10 bg-[var(--cls-bg,#F4F3EF)] lg:border-b-0 lg:border-r" aria-label="Prospective client intake">
          <ScreenEnginePublicWidget
            key={`${scenarioIndex}-${runKey}`}
            firmId={firmId}
            firmName={firmName}
            runtime="demo"
            initialDescription={SCENARIOS[scenarioIndex].value}
            onDemoStateChange={receiveView}
            consentCaptureEnabled={consentCaptureEnabled}
          />
        </section>

        <aside className="min-h-[620px] min-w-0 lg:max-h-[calc(100vh-105px)]" aria-label="Lawyer intake view">
          <DemoOperatorPanel view={view} />
        </aside>
      </div>
    </div>
  );
}
