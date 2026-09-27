"use client";

import { fictionalExampleModel } from "@/lib/desired-client/example";

/** A complete, static HTML example. Opening it makes no request or PDF. */
export function ExampleBlueprint({ standalone = false }: { standalone?: boolean }) {
  const model = fictionalExampleModel;
  const brief = model.brief;

  return (
    <section id="example-blueprint" className={`dc-example${standalone ? " dc-example--standalone" : ""}`} data-ui-component-content="desired-client-example" aria-labelledby="dc-example-heading">
      <p className="dc-eyebrow" data-ui-copy="supporting">Fictional example</p>
      {standalone ? <h1 id="dc-example-heading" data-ui-copy="heading">Fictional Desired Client Blueprint</h1> : <h2 id="dc-example-heading" data-ui-copy="heading">See what a clearer direction looks like</h2>}
      <p data-ui-copy="body">A firm says it wants more business work. This example turns that broad wish into a client and matter pattern its marketing team can use.</p>
      <p className="dc-example__note" data-ui-copy="supporting">This fictional Blueprint was drafted with the tool&apos;s AI prompt and edited for accuracy and length. Your result depends on your answers and should be reviewed by your firm.</p>
      {standalone ? <p className="dc-example__print-note" data-ui-copy="supporting">The print view condenses this HTML Blueprint. Detailed questions and source answers remain available below on this page.</p> : null}
      {standalone ? <nav className="dc-example__actions" aria-label="Example Blueprint actions"><a className="dc-button dc-button--secondary" href="/tools/desired-client-matter">Back to the tool</a><button type="button" className="dc-button dc-button--secondary" onClick={() => window.print()}>Print this HTML Blueprint</button></nav> : null}

      {!standalone && <div className="dc-example__preview" data-ui-component-content="desired-client-example-preview">
        <div data-ui-component-content="desired-client-example-portrait"><h3 data-ui-copy="heading">Desired client portrait</h3><p data-ui-copy="body">{brief.portrait.text}</p></div>
        <div className="dc-example__direction">
          <div data-ui-component-content="desired-client-example-message"><h3 data-ui-copy="heading">Marketing message</h3><p data-ui-copy="body">{brief.marketing.message.text}</p></div>
          <div data-ui-component-content="desired-client-example-content"><h3 data-ui-copy="heading">Content idea</h3><p data-ui-copy="body">{brief.marketing.content.text}</p></div>
        </div>
      </div>}

      <details className="dc-example__details" data-ui-component-content="desired-client-example-detail" open={standalone}>
        <summary>{standalone ? "Complete example Blueprint" : "Read the full example and supporting detail"}</summary>
        <article className="dc-example__blueprint" aria-label="Complete fictional Desired Client Blueprint">
          <header className="dc-example__blueprint-header"><p className="dc-eyebrow">Fictional example · AI-assisted working draft</p><h3>Desired Client Blueprint</h3></header>
          <section className="dc-example__report-section" data-ui-component-content="desired-client-example-full-portrait" aria-labelledby="dc-example-portrait">
            <h4 id="dc-example-portrait">Desired client portrait</h4>
            <p data-ui-copy="body">{brief.portrait.text}</p>
            <dl className="dc-example__context">
              <div><dt>Client context</dt><dd>{model.context.client}</dd></div>
              <div><dt>Starting point</dt><dd>{model.context.startingPoint}</dd></div>
              <div><dt>Work to attract</dt><dd>{model.context.work}</dd></div>
            </dl>
          </section>
          <div className="dc-example__columns">
            <section className="dc-example__report-section" data-ui-component-content="desired-client-example-full-need" aria-labelledby="dc-example-need"><h4 id="dc-example-need">Client need</h4><p data-ui-copy="body">{brief.client_need.text}</p></section>
            <section className="dc-example__report-section" data-ui-component-content="desired-client-example-full-value" aria-labelledby="dc-example-value"><h4 id="dc-example-value">Firm value</h4><p data-ui-copy="body">{brief.firm_value.text}</p></section>
          </div>
          <section className="dc-example__report-section" aria-labelledby="dc-example-marketing">
            <h4 id="dc-example-marketing">Marketing direction</h4>
            <dl className="dc-example__marketing">
              <div><dt>Message</dt><dd>{brief.marketing.message.text}</dd></div>
              <div><dt>Content idea</dt><dd>{brief.marketing.content.text}</dd></div>
              <div><dt>Next step</dt><dd>{brief.marketing.next_step.text}</dd></div>
            </dl>
          </section>
          <section className="dc-example__report-section" aria-labelledby="dc-example-screen">
            <h4 id="dc-example-screen">Proposed Screen questions</h4>
            <div className="dc-example__checks">{model.screens.rows.map(row => (
              <section key={row.id} aria-label={row.label}>
                <h5>{row.label}</h5><p>{row.ask_summary}</p>
                <ul>{row.questions.map(question => <li key={question.id}>{question.question}{question.desired_condition ? ` Desired condition: ${question.desired_condition}` : ""}</li>)}</ul>
                <p className="dc-example__use"><strong>Use:</strong> {row.use_summary}</p>
              </section>
            ))}</div>
            <p className="dc-example__note">Missing information calls for clarification. These proposed checks do not activate scoring or decide whether to accept a matter.</p>
          </section>
          <section className="dc-example__report-section" aria-labelledby="dc-example-confirm">
            <h4 id="dc-example-confirm">Still to confirm</h4>
            {model.allNotes.length ? <ul>{model.allNotes.map(note => <li key={note}>{note}</li>)}</ul> : <p>No unresolved questions identified. Test this profile against actual client and delivery evidence.</p>}
          </section>
          <section className="dc-example__report-section dc-example__report-section--sources" aria-labelledby="dc-example-sources">
            <h4 id="dc-example-sources">Answers and sources</h4>
            <p>Evidence: {model.evidence.length ? model.evidence.join("; ") : "No client evidence selected"}. Based on information supplied by the fictional firm.</p>
            <div className="dc-example__sources">{model.sourceDetails.map(source => (
              <section key={source.slot} aria-label={source.slot}>
                <h5>{source.slot}</h5><p>{source.statement.text} <span className="dc-kind">{source.statement.kind}</span></p>
                <ul>{source.answers.map(answer => <li key={answer.path}>{answer.question}: {answer.answer ?? "Not supplied"}</li>)}</ul>
              </section>
            ))}</div>
            <h5>All selected answers</h5>
            <ul>{model.allAnswers.map((answer, index) => <li key={`${index}-${answer.question}`}>{answer.question}: {answer.answer}</li>)}</ul>
          </section>
          <p className="dc-example__note">Marketing direction and inquiry checks are proposed for review. A lawyer decides whether to accept an individual matter.</p>
        </article>
      </details>
      {!standalone ? <a className="dc-example__standalone-link" href="/tools/desired-client-matter/example" target="_blank" rel="noopener noreferrer">Open the complete example on its own page</a> : null}
    </section>
  );
}
