"use client";

import { useMemo, useState } from "react";
import { ContinuationWidget, type ContinuationTransport } from "@/components/voice-screen/ContinuationWidget";
import { createVoiceScreenTestSession } from "@/lib/voice-screen-test-session";

type Segment = "widget" | "brief";

/** Test controls are outside the unchanged caller experience. */
export function VoiceScreenTestWorkspace({ initialSegment = "widget" }: { initialSegment?: Segment }) {
  const [session, setSession] = useState(() => createVoiceScreenTestSession());
  const [segment, setSegment] = useState<Segment>(initialSegment);
  const [generation, setGeneration] = useState(0);
  const [snapshot, setSnapshot] = useState(() => session.getSnapshot());
  const transport = useMemo<ContinuationTransport>(() => ({
    async load() { return session.getView(); },
    async save(payload) {
      const view = session.save(payload);
      setSnapshot(session.getSnapshot());
      return view;
    },
  }), [session]);
  function reset() {
    const next = createVoiceScreenTestSession();
    setSession(next);
    setSnapshot(next.getSnapshot());
    setGeneration(value => value + 1);
  }

  return <div className="min-h-screen bg-[#F4F3EF] text-[#1E2F58] [&_p[data-ui-copy]]:[text-wrap:pretty] min-[480px]:[&_h3[data-ui-copy]]:[text-wrap:pretty] max-[360px]:[&_main_section.rounded-xl]:p-3 max-[360px]:[&_[data-ui-component-content=test-engine-assessment]_p]:text-[14px] max-[360px]:[&_[data-ui-component-content=test-engine-assessment]_p]:[text-wrap:wrap] max-[480px]:[&_[data-ui-component-content=test-written-answer]_h3]:text-[14px]" style={{ fontFamily: '"DM Sans Variable", sans-serif' }}>
    <header className="bg-[#172640] text-white px-5 py-4">
      <div className="mx-auto w-full max-w-[1040px] space-y-3" data-ui-component-content="test-controls">
        <p className="text-sm leading-relaxed" data-ui-copy="supporting"><strong>Independent testing.</strong> This is the production caller component and qualification engine, loaded with fictional call facts. Test answers stay in this tab. Refresh or reset to start over.</p>
        <nav className="flex flex-wrap gap-2" aria-label="Journey test segments">
          <button type="button" aria-pressed={segment === "widget"} onClick={() => setSegment("widget")} className="min-h-11 rounded-lg border border-white/35 px-4 py-2 aria-pressed:bg-white aria-pressed:text-[#172640]">Caller widget</button>
          <button type="button" aria-pressed={segment === "brief"} onClick={() => setSegment("brief")} className="min-h-11 rounded-lg border border-white/35 px-4 py-2 aria-pressed:bg-white aria-pressed:text-[#172640]">Lawyer brief</button>
          <button type="button" onClick={reset} className="min-h-11 rounded-lg border border-white/35 px-4 py-2">Reset test</button>
        </nav>
        <details className="text-sm leading-relaxed">
          <summary className="cursor-pointer min-h-8">What this test covers</summary>
          <div className="pt-2 space-y-2" data-ui-component-content="test-boundaries">
            <p data-ui-copy="body">The widget runs the same questions, answer validation, skip, finish, and report-building functions as the caller journey. You can switch to the brief at any point and inspect the call facts alongside new answers.</p>
            <p data-ui-copy="body">No phone call or text message is needed. This page does not test delivery, signed call events, database saving, or real link expiry. Those connections have separate integration tests and setup requirements.</p>
            <a className="inline-block py-2 underline underline-offset-4" href="/test/voice-screen">View the segment testing guide</a>
          </div>
        </details>
      </div>
    </header>
    <div hidden={segment !== "widget"}><ContinuationWidget key={generation} transport={transport} /></div>
    {segment === "brief" && <main data-testid="voice-screen-test-brief" className="mx-auto w-full max-w-[1040px] px-5 py-8 space-y-6">
      <section className="space-y-3" data-ui-component-content="test-brief-heading">
        <p className="text-sm uppercase tracking-wider" data-ui-copy="supporting">Lawyer brief test</p>
        <h1 className="text-[26px] sm:text-3xl font-bold" data-ui-copy="heading">One inquiry, with the answers together.</h1>
        <p className="leading-relaxed" data-ui-copy="body">This brief uses the production report builder. It is available before any written answers and updates as qualification progresses.</p>
        <p className="text-sm" data-ui-copy="supporting">Test status: {snapshot.status}. Written answers: {snapshot.answers.length}.</p>
      </section>
      <section className="rounded-xl border border-[#1E2F58]/15 bg-white p-4 sm:p-5 space-y-3" data-ui-component-content="test-call-facts">
        <h2 className="text-xl font-bold" data-ui-copy="heading">From the call</h2>
        <p data-ui-copy="body">{snapshot.facts.name} · {snapshot.facts.phone}</p>
        <p className="leading-relaxed" data-ui-copy="body">{snapshot.facts.situation}</p>
        <p className="leading-relaxed" data-ui-copy="supporting">{snapshot.facts.deadline}</p>
      </section>
      <section className="rounded-xl border border-[#1E2F58]/15 bg-white p-4 max-[480px]:p-3 sm:p-5 space-y-4" data-ui-component-content="test-written-answers">
        <h2 className="text-xl font-bold" data-ui-copy="heading">From qualification</h2>
        {!snapshot.answers.length && <p className="leading-relaxed" data-ui-copy="body">No written answers yet. The call information is already available for review.</p>}
        {snapshot.answers.map((answer, index) => <div key={index} data-testid="voice-screen-test-answer" className="space-y-1" data-ui-component-content="test-written-answer">
          <h3 className="font-semibold leading-relaxed max-[480px]:text-[12px] max-[480px]:tracking-[-0.02em]" data-ui-copy="heading">{answer.question}</h3>
          <p className="leading-relaxed" data-ui-copy="body">{answer.answer}</p>
        </div>)}
      </section>
      <section className="rounded-xl border border-[#1E2F58]/15 bg-white p-4 sm:p-5 space-y-3" data-ui-component-content="test-engine-assessment">
        <h2 className="text-xl font-bold" data-ui-copy="heading">Engine assessment</h2>
        <p className="leading-relaxed" data-ui-copy="body">{snapshot.report.matter_snapshot}</p>
        <h3 className="font-semibold" data-ui-copy="heading">What to confirm</h3>
        {snapshot.report.what_to_confirm.map((value, index) => <p key={index} className="leading-relaxed" data-ui-copy="body">{value}</p>)}
      </section>
    </main>}
  </div>;
}
