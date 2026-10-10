"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { WELCOME_COPY } from "@/lib/desired-client/copy";
import { PREVIEW_TOPICS } from "./preview-topics";
import "./landing.css";

export interface WelcomeScreenProps {
  onStart: () => void;
  aiAvailable?: boolean | null;
  hasDraft?: boolean;
  resume?: ReactNode;
}

const topicLabels = ["Matter", "Goals", "Value", "Choice", "Context", "Proof"];
const topicDescriptions = [
  "The client, the legal mandate and the scope of work you want more of.",
  "What the client wants to achieve and how they want to work with you.",
  "The credible case for fees, margin, lawyer time and repeatable value.",
  "The expertise, service and proof that make your firm a credible choice.",
  "What prompts the need for advice and how the client finds your firm.",
  "What you know, what you are estimating and what still needs to be tested.",
];
const topicHeadings = ["Client and matter", "Client goals and service", "Why the firm wants the work", "Why clients choose the firm", "Context and discovery", "Evidence and open questions"];

export function WelcomeScreen({ onStart, aiAvailable = null, hasDraft = false, resume }: WelcomeScreenProps) {
  const [selected, setSelected] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const previewRef = useRef<HTMLDivElement>(null);
  const topic = PREVIEW_TOPICS[selected];
  const action = hasDraft ? "Continue my profile" : "Build my profile";
  const navigateTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % 6;
    else if (event.key === "ArrowLeft") next = (index + 5) % 6;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 5;
    else return;
    event.preventDefault();
    setSelected(next);
    tabRefs.current[next]?.focus();
  };
  return (
    <div className="dc-landing">
      <div className="hero-band"><section className="container hero" aria-labelledby="dc-welcome-heading">
        <div className="hero-copy" data-ui-component-content="desired-client-hero-copy">
          <p className="eyebrow">Your practice. With intention.</p>
          <h1 id="dc-welcome-heading" data-ui-copy="heading">Define the work you <span className="terminal-word">want<span className="terminal-square" aria-hidden="true" /></span></h1>
          <p className="hero-intro" data-ui-copy="body">Turn your firm’s experience and ambitions into a clear six-part Desired Client profile.</p>
          <div className="hero-actions">
            <button type="button" className="button button-primary" onClick={onStart}>{action}</button>
            <a className="button button-secondary" href="#dc-profile-preview" onClick={() => previewRef.current?.focus({ preventScroll: true })}>Explore the example</a>
          </div>
          <p className="hero-meta" data-ui-copy="supporting">Six focused topics. One considered profile.</p>
          {resume}
        </div>
        <div className="product-area" id="dc-profile-preview" ref={previewRef} tabIndex={-1} aria-label="Illustrative schematic Desired Client profile">
          <div className="product-frame">
            <div className="app-header"><div><div className="app-title">Your Desired Client</div><div className="app-subtitle">A profile for your firm</div></div><span className="example-tag">Schematic example</span></div>
            <div className="preview-tabs" role="tablist" aria-label="Explore the six profile topics">
              {topicLabels.map((label, index) => <button type="button" className="preview-tab" key={label} id={`dc-example-tab-${index}`} role="tab" aria-selected={index === selected} aria-controls="dc-example-panel" tabIndex={index === selected ? 0 : -1} ref={element => { tabRefs.current[index] = element; }} onClick={() => setSelected(index)} onKeyDown={event => navigateTab(event, index)} aria-label={index > 3 ? PREVIEW_TOPICS[index].topic : undefined}>{label}</button>)}
            </div>
            <div className="profile-body" id="dc-example-panel" role="tabpanel" aria-labelledby={`dc-example-tab-${selected}`} tabIndex={0}>
              <div className="profile-kicker"><span>{selected + 1} / 6</span><div>{topic.topic}</div></div>
              <div data-ui-component-content="desired-client-example-intro"><h2 className="profile-title" data-ui-copy="heading">{topic.title}</h2><p className="profile-intro" data-ui-copy="body">{topic.intro}</p></div>
              <div className="chips">{topic.chips.map(chip => <span className="chip" key={chip}>{chip}</span>)}</div>
              <div className="detail-grid">{topic.details.map(([label, text]) => <div key={label} data-ui-component-content="desired-client-example-detail"><h3 className="detail-label">{label}</h3><p className="detail-text" data-ui-copy="body">{text}</p></div>)}</div>
              <div className="profile-note" data-ui-component-content="desired-client-example-note"><p className="note-title">{topic.noteTitle}</p><p className="note-text" data-ui-copy="body">{topic.note}</p></div>
            </div>
            <div className="app-footer"><span>Schematic only · assumptions to test</span><span>Topic {selected + 1} of 6</span></div>
          </div>
          <p className="preview-caption">Explore the six tabs to see what a profile can contain</p>
        </div>
      </section>
      </div>
      <section className="container definition-wrap" aria-labelledby="dc-definition-title">
        <div className="definition"><div className="definition-top"><h2 className="eyebrow" id="dc-definition-title">What is a Desired Client?</h2><div data-ui-component-content="desired-client-approved-definition"><p className="definition-copy" data-ui-copy="body">{WELCOME_COPY.definition}</p></div></div>
          <div className="pillars">{["Fees", "Margin", "Return on lawyer time", "Repeatable value"].map(pillar => <div className="pillar" key={pillar}>{pillar}</div>)}</div>
          <div className="definition-aside"><div data-ui-component-content="desired-client-fees-note"><p data-ui-copy="body">Higher fees do not automatically mean higher margin. Look at the whole commercial picture.</p></div><div data-ui-component-content="desired-client-ambition-note"><p data-ui-copy="body">Keep the ambition. Capacity gaps identify what must change, rather than automatically lowering the goal.</p></div></div>
        </div>
      </section>
      <section className="container topics-section" aria-labelledby="dc-topics-title">
        <div className="section-heading"><div data-ui-component-content="desired-client-topics-heading"><p className="eyebrow">The shape of your profile</p><h2 id="dc-topics-title" data-ui-copy="heading">A profile in six parts.</h2></div><div data-ui-component-content="desired-client-topics-description"><p data-ui-copy="body">Connect the work you want with the reasons it makes sense for your firm.</p></div></div>
        <div className="topic-grid">{topicHeadings.map((heading, index) => <article className="topic-card" key={heading} data-ui-component-content="desired-client-topic-card"><div className="topic-number">{index + 1}</div><h3 data-ui-copy="heading">{heading}</h3><p data-ui-copy="body">{topicDescriptions[index]}</p></article>)}</div>
      </section>
      <section className="container process-section" aria-labelledby="dc-process-title">
        <div className="process-title" data-ui-component-content="desired-client-process-title"><p className="eyebrow">From thought to profile</p><h2 id="dc-process-title" data-ui-copy="heading">A guided process.</h2></div>
        <div className="steps">{[
          ["Answer", "Work through six topics using your firm’s experience and ambitions."],
          ["Generate", "Bring your answers together in an AI-assisted draft profile."],
          ["Review and refine", "Check the reasoning, challenge assumptions and make the profile your own."],
        ].map(([heading, text], index) => <div className="step" key={heading} data-ui-component-content="desired-client-process-step"><div className="step-head"><span className="number">{index + 1}</span><h3>{heading}</h3></div><p data-ui-copy="body">{text}</p></div>)}</div>
      </section>
      <div className="closing-band"><section className="container closing" aria-labelledby="dc-closing-title">
        <div data-ui-component-content="desired-client-closing-copy"><h2 id="dc-closing-title" data-ui-copy="heading">Be deliberate about what comes next.</h2><p data-ui-copy="body">Use hypothetical or anonymised examples. Do not enter confidential client information.</p></div><button type="button" className="button button-primary" onClick={onStart}>{action}</button>
      </section>
      </div>
      <footer className="site-footer"><div className="container footer-inner"><div className="footer-brand">CaseLoad Select</div><div className="footer-copy" data-ui-component-content="desired-client-footer-copy">
        <p data-ui-copy="supporting">{WELCOME_COPY.draftNotice}</p><p data-ui-copy="supporting">{WELCOME_COPY.privacy}</p>
        {aiAvailable === false ? <p className="dc-availability" role="status" data-ui-copy="supporting">AI-assisted drafting and follow-up questions are currently unavailable. You can still complete the exercise and create a structured Desired Client Blueprint from your answers.</p> : <p data-ui-copy="supporting">{WELCOME_COPY.aiDisclosure} AI generation uses external processing.</p>}
        <details className="dc-details"><summary>About the exercise</summary><div data-ui-component-content="desired-client-exercise-details"><p data-ui-copy="body">{WELCOME_COPY.description}</p><p data-ui-copy="body">{WELCOME_COPY.time}</p><p data-ui-copy="body">{WELCOME_COPY.process}</p><p data-ui-copy="body">{WELCOME_COPY.preparation}</p><p data-ui-copy="body">{WELCOME_COPY.outcome}</p><p data-ui-copy="supporting">{WELCOME_COPY.supporting}</p></div></details>
      </div></div></footer>
    </div>
  );
}
