// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ChannelIntakeHistoryView } from "@/lib/channel-intake-history";
import IntakeTranscriptPanel from "../IntakeTranscriptPanel";

afterEach(cleanup);

const RECORDED_HISTORY: ChannelIntakeHistoryView = {
  version: 1,
  provenance: "recorded",
  truncated: false,
  notice: null,
  rawTranscript: null,
  events: [
    {
      id: "question-1",
      sequence: 1,
      direction: "outbound",
      body: "When does the severance offer expire?\n1. In the next few days\n2. More than a week",
      occurredAt: "2026-09-14T18:00:00.000Z",
      status: "sent",
      kind: "discovery_question",
      slotIds: ["severance_deadline"],
      replyToEventId: null,
      normalizedAnswers: [],
      options: [
        { number: 1, value: "next_few_days", label: "In the next few days" },
        { number: 2, value: "more_time", label: "More than a week" },
      ],
    },
    {
      id: "answer-1",
      sequence: 2,
      direction: "inbound",
      body: "1",
      occurredAt: "2026-09-14T18:01:00.000Z",
      status: "received",
      kind: "answer",
      slotIds: ["severance_deadline"],
      replyToEventId: "question-1",
      normalizedAnswers: [{ slotId: "severance_deadline", value: "In the next few days" }],
    },
  ],
};

describe("IntakeTranscriptPanel", () => {
  it("shows the exact recorded question text, raw answer, and recorded meaning without duplicating option cards", () => {
    render(<IntakeTranscriptPanel history={RECORDED_HISTORY} />);

    expect(screen.getByRole("heading", { name: "Intake transcript" })).toBeTruthy();
    expect(screen.getByText(/When does the severance offer expire[\s\S]*1\. In the next few days/)).toBeTruthy();
    expect(document.querySelectorAll("ol ol li")).toHaveLength(0);
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText(/Recorded meaning:/).parentElement?.textContent).toContain(
      "In the next few days",
    );
  });

  it("renders current question-bank options for an explicitly reconstructed legacy question", () => {
    render(
      <IntakeTranscriptPanel
        history={{
          ...RECORDED_HISTORY,
          provenance: "reconstructed",
          notice: "Historical question wording is reconstructed from the current question bank.",
          rawTranscript: null,
          events: [{ ...RECORDED_HISTORY.events[0], body: "When does the severance offer expire?" }],
        }}
      />,
    );

    expect(screen.getByText("In the next few days")).toBeTruthy();
    expect(screen.getByText("More than a week")).toBeTruthy();
    expect(document.querySelectorAll("ol ol li")).toHaveLength(2);
  });

  it("labels reconstructed rows honestly and renders a saved select value as its display label", () => {
    render(
      <IntakeTranscriptPanel
        history={{
          ...RECORDED_HISTORY,
          provenance: "reconstructed",
          notice: "Historical question wording is reconstructed from the current question bank.",
          rawTranscript: "1",
          events: [
            { ...RECORDED_HISTORY.events[0], body: "When does the severance offer expire?" },
            {
              ...RECORDED_HISTORY.events[1],
              body: "next_few_days",
              normalizedAnswers: [
                { slotId: "severance_deadline", value: "next_few_days" },
              ],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Reconstructed question")).toBeTruthy();
    expect(screen.getByText("Saved answer")).toBeTruthy();
    expect(screen.getAllByText("In the next few days").length).toBeGreaterThan(0);
    expect(screen.queryByText("next_few_days")).toBeNull();
  });

  it("labels reconstructed history and keeps unstructured raw text separate", () => {
    render(
      <IntakeTranscriptPanel
        history={{
          ...RECORDED_HISTORY,
          provenance: "reconstructed",
          notice: "Historical question wording is reconstructed from the current question bank.",
          rawTranscript: "Opening statement\n\n1\n\n3",
        }}
      />,
    );

    expect(screen.getByText(/Historical question wording is reconstructed/i)).toBeTruthy();
    expect(screen.getByText("Original saved inbound text")).toBeTruthy();
    expect(screen.getByText(/not paired to questions by position/i)).toBeTruthy();
  });

  it("states when no intake exchange record is available", () => {
    render(
      <IntakeTranscriptPanel
        history={{
          version: 1,
          events: [],
          truncated: false,
          provenance: "unavailable",
          notice: "No intake exchange record is available for this lead.",
          rawTranscript: null,
        }}
      />,
    );

    expect(screen.getByText("No intake exchange record is available for this lead.")).toBeTruthy();
  });
});
