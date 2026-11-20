// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FIT_SIGNAL_OPTIONS } from "@/lib/desired-client/catalog";
import { emptyAnswers } from "@/lib/desired-client/brief";
import type { DesiredClientAnswers } from "@/lib/desired-client/types";
import { GuidedQuestionStage } from "../GuidedQuestionStage";

afterEach(cleanup);

function FitSignalStage() {
  const [answers, setAnswers] = useState<DesiredClientAnswers>(() => {
    const initial = emptyAnswers();
    initial.delivery.fit_signals = FIT_SIGNAL_OPTIONS.slice(0, 3).map(({ id }) => id);
    return initial;
  });

  return createElement(GuidedQuestionStage, {
    stage: 5,
    answers,
    onEdit: (edit) => setAnswers(edit),
    onBack: () => undefined,
    onNext: () => undefined,
    onCompare: () => undefined,
    error: false,
  });
}

function PaymentContextStage() {
  const [answers, setAnswers] = useState<DesiredClientAnswers>(() => {
    const initial = emptyAnswers();
    initial.value.payment = "predictable";
    return initial;
  });

  return createElement(GuidedQuestionStage, {
    stage: 3,
    answers,
    onEdit: (edit) => setAnswers(edit),
    onBack: () => undefined,
    onNext: () => undefined,
    onCompare: () => undefined,
    error: false,
  });
}

describe("GuidedQuestionStage write-in choice limits", () => {
  it("keeps a custom fit signal and explains how it shares the three-choice limit", () => {
    render(createElement(FitSignalStage));

    const writtenAnswer = "The owner can explain the source of funds";
    const writeIn = screen.getByLabelText("Another fit signal (optional)") as HTMLInputElement;
    fireEvent.change(writeIn, { target: { value: writtenAnswer } });

    expect(screen.getByRole("alert").textContent).toContain("Your written answer counts as one of 3 choices.");
    expect(screen.getByRole("alert").textContent).toContain("Keep 2 or fewer listed choices");

    fireEvent.click(screen.getByRole("checkbox", { name: FIT_SIGNAL_OPTIONS[0].label }));

    expect((screen.getByLabelText("Another fit signal (optional)") as HTMLInputElement).value).toBe(writtenAnswer);
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: FIT_SIGNAL_OPTIONS[3].label }));

    expect(screen.getByRole("alert").textContent).toContain("including your written answer");
    expect((screen.getByLabelText("Another fit signal (optional)") as HTMLInputElement).value).toBe(writtenAnswer);
  });
});

describe("GuidedQuestionStage optional payment context", () => {
  it("keeps the note and its optional source control inside the payment question", () => {
    render(createElement(PaymentContextStage));

    expect(screen.getByRole("radio", { name: "Usually predictable" })).toBeTruthy();
    const note = screen.getByLabelText("Add payment context (optional)") as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: "In the last ten matters, clients usually paid on schedule.\nThe firm observed this." } });
    expect((screen.getByLabelText("Add payment context (optional)") as HTMLTextAreaElement).value).toBe("In the last ten matters, clients usually paid on schedule.\nThe firm observed this.");
    expect(screen.getByRole("radio", { name: "The firm has observed this" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "The firm is testing a hypothesis" })).toBeTruthy();
  });
});

describe("GuidedQuestionStage questionnaire", () => {
  it("shows the practice questions without an AI follow-up control or notice", () => {
    const answers = emptyAnswers();
    answers.interview.ai_clarification_consent = true;
    render(createElement(GuidedQuestionStage, {
      stage: 1, answers, onEdit: () => undefined, onBack: () => undefined,
      onNext: () => undefined, onCompare: () => undefined, error: false,
    }));
    expect(screen.getByRole("group", { name: "What do you want this profile to help your firm do?" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /AI follow-up/i })).toBeNull();
    expect(screen.queryByText(/AI follow-ups?/i)).toBeNull();
  });
});
