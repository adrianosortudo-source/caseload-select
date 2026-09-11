import type { Metadata } from "next";
export const metadata: Metadata = { title: "Journey segment testing | CaseLoad Select", robots: { index: false, follow: false } };
export default function Page() {
  return <main className="min-h-screen bg-[#F4F3EF] px-5 py-10 text-[#1E2F58] [&_[data-ui-copy]]:[text-wrap:pretty]">
    <div className="mx-auto w-full max-w-[960px] space-y-6">
      <header className="space-y-3" data-ui-component-content="segment-guide-heading">
        <h1 className="text-3xl font-bold" data-ui-copy="heading">Test each part of the journey.</h1>
        <p className="text-lg leading-relaxed" data-ui-copy="body">Open the caller widget or lawyer brief directly. Each starts with fictional call facts and uses the production qualification functions.</p>
      </header>
      <section className="rounded-xl bg-white border border-[#1E2F58]/15 p-6 space-y-3" data-ui-component-content="widget-test-entry">
        <h2 className="text-xl font-bold" data-ui-copy="heading">Caller widget and qualification</h2>
        <p className="leading-relaxed" data-ui-copy="body">Answer the remaining questions, skip, finish early, and reset. No call, SMS, or integration setup is required.</p>
        <a href="/test/voice-screen/widget" className="inline-block rounded-full bg-[#1E2F58] text-white px-6 py-3">Open the caller widget</a>
      </section>
      <section className="rounded-xl bg-white border border-[#1E2F58]/15 p-6 space-y-3" data-ui-component-content="brief-test-entry">
        <h2 className="text-xl font-bold" data-ui-copy="heading">Combined lawyer brief</h2>
        <p className="leading-relaxed" data-ui-copy="body">Inspect the report from sample call facts immediately. Switch to qualification and back to see each new answer included.</p>
        <a href="/test/voice-screen/brief" className="inline-block rounded-full bg-[#1E2F58] text-white px-6 py-3">Open the lawyer brief</a>
      </section>
      <section className="space-y-3" data-ui-component-content="integration-tests">
        <h2 className="text-xl font-bold" data-ui-copy="heading">Integration tests are separate.</h2>
        <p className="leading-relaxed" data-ui-copy="body">Call ingestion, SMS delivery, secure link access, and database saving each need their own connection tests. A working widget does not establish that a text was delivered or a call event was received.</p>
        <p className="leading-relaxed" data-ui-copy="body">Interactive tests for those connections are still to be added. The direct widget and brief tests remain available while connection setup is incomplete.</p>
      </section>
    </div>
  </main>;
}
