"use client";

import { WELCOME_COPY } from "@/lib/desired-client/copy";
import { ExampleBlueprint } from "./ExampleBlueprint";

export interface WelcomeScreenProps {
  onStart: () => void;
}

export function WelcomeScreen({ onStart }: WelcomeScreenProps) {
  return (
    <section className="dc-welcome" data-ui-component-content="desired-client-welcome" aria-labelledby="dc-welcome-heading">
      <p className="dc-eyebrow" data-ui-copy="supporting">{WELCOME_COPY.eyebrow}</p>
      <h1 id="dc-welcome-heading" className="dc-welcome__heading" data-ui-copy="heading">{WELCOME_COPY.heading}</h1>
      <p className="dc-welcome__description" data-ui-copy="body">{WELCOME_COPY.description}</p>
      <p className="dc-welcome__promise" data-ui-copy="body">{WELCOME_COPY.promise}</p>
      <div className="dc-welcome__actions" data-ui-component-content="desired-client-mode-actions">
        <button type="button" className="dc-button dc-button--primary" onClick={onStart}>{WELCOME_COPY.startButton}</button>
        <a className="dc-button dc-button--secondary" href="#example-blueprint">{WELCOME_COPY.exampleButton}</a>
      </div>
      <p className="dc-welcome__supporting" data-ui-copy="supporting"><strong>About 10 minutes for a first draft.</strong> {WELCOME_COPY.supporting}</p>
      <p className="dc-welcome__supporting" data-ui-copy="supporting">{WELCOME_COPY.aiDisclosure}</p>

      <ExampleBlueprint />

      <section className="dc-welcome__section" data-ui-component-content="desired-client-welcome-outcome" aria-labelledby="dc-welcome-outcome-heading">
        <h2 id="dc-welcome-outcome-heading" data-ui-copy="heading">{WELCOME_COPY.outcomeHeading}</h2>
        <ul>{WELCOME_COPY.outcomes.map(item => <li key={item} data-ui-component-content="desired-client-outcome-item"><p data-ui-copy="body">{item}</p></li>)}</ul>
      </section>
      <section className="dc-welcome__section" data-ui-component-content="desired-client-welcome-process" aria-labelledby="dc-welcome-process-heading">
        <h2 id="dc-welcome-process-heading" data-ui-copy="heading">{WELCOME_COPY.processHeading}</h2>
        <ol>{WELCOME_COPY.process.map(item => <li key={item} data-ui-component-content="desired-client-process-item"><p data-ui-copy="body">{item}</p></li>)}</ol>
        <p data-ui-copy="body">{WELCOME_COPY.preparation}</p>
        <p data-ui-copy="supporting">{WELCOME_COPY.time}</p>
      </section>
      <div className="dc-welcome__close" data-ui-component-content="desired-client-welcome-close">
        <button type="button" className="dc-button dc-button--primary" onClick={onStart}>{WELCOME_COPY.startButton}</button>
      </div>
      <p className="dc-welcome__privacy" data-ui-copy="supporting">{WELCOME_COPY.privacy}</p>
      <p className="dc-welcome__draft-notice" data-ui-copy="supporting">{WELCOME_COPY.draftNotice}</p>
    </section>
  );
}
