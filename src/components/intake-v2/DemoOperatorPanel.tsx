"use client";

import type { ScreenDemoView } from "./ScreenEnginePublicWidget";

interface Props {
  view: ScreenDemoView;
  contained?: boolean;
}

const STAGE_LABELS: Record<ScreenDemoView["stage"], string> = {
  kickoff: "Waiting to begin",
  questions: "Review in progress",
  contact: "Contact details",
  done: "Brief ready",
};

function formatLabel(value: string): string {
  return value
    .replace(/^other:/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatAnswer(value: string): string {
  return value.replace(/^other:/, "");
}

function percentage(value: number): number {
  const normalized = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

function Axis({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-white/65">{label}</span>
        <span className="font-semibold tabular-nums text-white">{value}/10</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-[#D4C3A7] transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${Math.max(0, Math.min(100, value * 10))}%` }}
        />
      </div>
    </div>
  );
}

export function DemoOperatorPanel({ view, contained = false }: Props) {
  const { state, report } = view;
  const knownAnswers = state
    ? Object.entries(state.slots)
        .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
        .filter(([key]) => !key.startsWith("client_"))
        .filter(([key]) => {
          const source = state.slot_meta[key]?.source;
          return source === "explicit" || source === "answered";
        })
        .slice(0, 8)
    : [];

  return (
    <div className={`flex min-h-full flex-col bg-[#101A2A] text-white ${contained ? "min-w-0 [overflow-wrap:anywhere] [text-wrap:pretty]" : ""}`}>
      <header className="border-b border-white/10 px-6 py-5" data-ui-component-content="demo-operator-header">
        <div className="space-y-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#D4C3A7]">
              Lawyer view
            </p>
            <h2 className="mt-1 w-full text-xl font-bold text-white" data-ui-copy="heading" style={{ fontFamily: "Manrope, sans-serif" }}>
              Intake brief, updated live
            </h2>
          </div>
          <span className="inline-flex rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1 text-[11px] font-semibold text-emerald-200">
            {STAGE_LABELS[view.stage]}
          </span>
        </div>
      </header>

      <div className={`flex flex-1 flex-col gap-5 py-6 ${contained ? "min-w-0 px-4 sm:px-6" : "overflow-y-auto px-6"}`}>
        <p className="sr-only" aria-live="polite">
          {state
            ? `${STAGE_LABELS[view.stage]}. ${view.currentQuestion?.question ?? "The firm review brief is ready."}`
            : STAGE_LABELS[view.stage]}
        </p>
        {!state ? (
          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5" data-ui-component-content="demo-empty-brief">
            <p className="w-full text-base leading-relaxed text-white/75" data-ui-copy="body">
              Client answers and the firm’s review brief will appear here as the intake progresses.
            </p>
          </section>
        ) : (
          <>
            <section className={contained ? "grid grid-cols-2 gap-3" : "grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4"}>
              <Metric label="Matter type" value={formatLabel(state.matter_type)} />
              <Metric label="Fit band" value={state.band ?? "Pending"} />
              <Metric label="Intake complete" value={`${percentage(state.coreCompleteness)}%`} />
              <Metric label="Confidence" value={`${percentage(state.confidence)}%`} />
            </section>

            {view.currentQuestion && (
              <section className="rounded-2xl border border-[#D4C3A7]/25 bg-[#D4C3A7]/10 p-5" data-ui-component-content="demo-current-question">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#D4C3A7]">
                  Current question
                </p>
                <p className="mt-2 w-full text-sm leading-relaxed text-white" data-ui-copy="body">
                  {view.currentQuestion.question}
                </p>
              </section>
            )}

            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5" data-ui-component-content="demo-known-answers">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Client-confirmed information
              </p>
              {knownAnswers.length > 0 ? (
                <dl className="mt-4 space-y-3">
                  {knownAnswers.map(([key, value]) => (
                    <div key={key} className="border-l-2 border-emerald-300/50 pl-3" data-ui-component-content="demo-known-answer">
                      <dt className="text-[11px] text-white/45">{formatLabel(key)}</dt>
                      <dd className="mt-0.5 w-full text-sm leading-relaxed text-white/90" data-ui-copy="supporting">
                        {formatAnswer(String(value))}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-3 w-full text-sm text-white/55" data-ui-copy="supporting">
                  The opening has been classified. The first confirmed answer will appear here.
                </p>
              )}
            </section>

            {report && (
              <>
                <section className="rounded-2xl border border-emerald-300/25 bg-emerald-300/[0.07] p-5" data-ui-component-content="demo-lawyer-brief">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-200">
                    Lawyer brief
                  </p>
                  <h3 className="mt-2 w-full text-lg font-bold leading-snug text-white" data-ui-copy="heading" style={{ fontFamily: "Manrope, sans-serif" }}>
                    {report.matter_snapshot}
                  </h3>
                  <p className="mt-3 w-full text-sm leading-relaxed text-white/70" data-ui-copy="body">
                    {report.lawyer_time_priority}
                  </p>
                  <p className="mt-2 w-full text-sm leading-relaxed text-white/70" data-ui-copy="body">
                    The lawyer makes the final engagement decision.
                  </p>
                </section>

                <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5" data-ui-component-content="demo-review-signals">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                    Initial review signals
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <Axis label="Value" value={report.four_axis.value} />
                    <Axis label="Complexity" value={report.four_axis.complexity} />
                    <Axis label="Urgency" value={report.four_axis.urgency} />
                    <Axis label="Readiness" value={report.four_axis.readiness} />
                  </div>
                </section>

                <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5" data-ui-component-content="demo-brief-next-steps">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                    What to confirm
                  </p>
                  <ul className="mt-3 space-y-2 text-sm leading-relaxed text-white/70">
                    {report.what_to_confirm.slice(0, 4).map((item) => (
                      <li key={item} className="w-full" data-ui-copy="supporting">• {item}</li>
                    ))}
                  </ul>
                </section>
              </>
            )}
          </>
        )}
      </div>

      <footer className="border-t border-white/10 px-6 py-3" data-ui-component-content="demo-operator-footer">
        <p className="w-full text-xs text-white/45" data-ui-copy="supporting">
          Fictional demonstration. No lead, message, or follow-up is created.
        </p>
      </footer>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.05] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-white" title={value}>{value}</p>
    </div>
  );
}
