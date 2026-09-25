"use client";

import { WELCOME_COPY } from "@/lib/desired-client/copy";

export interface WelcomeScreenProps {
  onChooseMode: (mode: "ai" | "structured") => void;
}

export function WelcomeScreen({ onChooseMode }: WelcomeScreenProps) {
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
      <p className="dc-welcome__supporting" data-ui-copy="supporting">
        {WELCOME_COPY.supporting}
      </p>
      <p className="dc-welcome__privacy" data-ui-copy="supporting">
        {WELCOME_COPY.privacy}
      </p>
      <p className="dc-welcome__ai-disclosure" data-ui-copy="supporting">
        {WELCOME_COPY.aiDisclosure}
      </p>
      <div className="dc-welcome__actions" data-ui-component-content="desired-client-mode-actions">
        <button
          type="button"
          className="dc-button dc-button--primary"
          data-ui-copy="supporting"
          onClick={() => onChooseMode("ai")}
        >
          {WELCOME_COPY.aiButton}
        </button>
        <button
          type="button"
          className="dc-button dc-button--secondary"
          data-ui-copy="supporting"
          onClick={() => onChooseMode("structured")}
        >
          {WELCOME_COPY.structuredButton}
        </button>
      </div>
      <p className="dc-welcome__draft-notice" data-ui-copy="supporting">
        {WELCOME_COPY.draftNotice}
      </p>
    </section>
  );
}