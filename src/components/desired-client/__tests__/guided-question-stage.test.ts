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
