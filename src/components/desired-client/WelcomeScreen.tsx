"use client";

import { WELCOME_COPY } from "@/lib/desired-client/copy";

export interface WelcomeScreenProps {
  onStart: () => void;
  aiAvailable?: boolean | null;
}

export function WelcomeScreen({ onStart, aiAvailable = null }: WelcomeScreenProps) {
  return (
    <section
      className="dc-welcome"
      data-ui-component-content="desired-client-welcome"
      aria-labelledby="dc-welcome-heading"
    >
      <h1 id="dc-welcome-heading" className="dc-welcome__heading" data-ui-copy="heading">
        {WELCOME_COPY.heading}
      </h1>
      <p className="dc-welcome__description" data-ui-copy="body">
        {WELCOME_COPY.description}
      </p>
      <div className="dc-welcome__positioning" data-ui-component-content="desired-client-welcome-positioning">
        <p data-ui-copy="body">{WELCOME_COPY.definition}</p>
        {WELCOME_COPY.ambition.map((paragraph) => <p key={paragraph} data-ui-copy="body">{paragraph}</p>)}
      </div>
      {aiAvailable === false
        ? <p className="dc-welcome__availability" role="status" data-ui-copy="supporting">AI-assisted drafting and follow-up questions are currently unavailable. You can still complete the exercise and create a structured Desired Client Blueprint from your answers.</p>
        : <p className="dc-welcome__supporting" data-ui-copy="supporting">{WELCOME_COPY.aiDisclosure}</p>}
      <div className="dc-welcome__guide" data-ui-component-content="desired-client-welcome-guide">
        <p data-ui-copy="body"><strong>Time:</strong> {WELCOME_COPY.time}</p>
        <p data-ui-copy="body"><strong>How it works:</strong> {WELCOME_COPY.process}</p>
        <p data-ui-copy="body"><strong>What to have in mind:</strong> {WELCOME_COPY.preparation}</p>
        <p data-ui-copy="body"><strong>What you will get:</strong> {WELCOME_COPY.outcome}</p>
      </div>
      <p className="dc-welcome__supporting" data-ui-copy="supporting">
        {WELCOME_COPY.supporting}
      </p>
      <p className="dc-welcome__privacy" data-ui-copy="supporting">
        {WELCOME_COPY.privacy}
      </p>
      <div className="dc-welcome__actions" data-ui-component-content="desired-client-mode-actions">
        <button
          type="button"
          className="dc-button dc-button--primary"
          data-ui-copy="supporting"
          onClick={onStart}
        >
          {WELCOME_COPY.startButton}
        </button>
      </div>
      <p className="dc-welcome__draft-notice" data-ui-copy="supporting">
        {WELCOME_COPY.draftNotice}
      </p>
    </section>
  );
}
