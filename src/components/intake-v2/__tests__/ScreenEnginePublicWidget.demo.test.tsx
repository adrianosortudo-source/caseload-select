// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScreenEnginePublicWidget, type ScreenDemoView } from "../ScreenEnginePublicWidget";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const FICTIONAL_SITUATION =
  "I own a Toronto studio and a client has not paid a $28,000 invoice for completed work.";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ScreenEnginePublicWidget demo runtime", () => {
  it("keeps the DRG-facing kickoff and advances using only the in-browser engine", async () => {
    const views: ScreenDemoView[] = [];
    render(
      <ScreenEnginePublicWidget
        firmId="fictional-firm"
        firmName="Hartwell Law"
        runtime="demo"
        initialDescription={FICTIONAL_SITUATION}
        onDemoStateChange={(view) => views.push(view)}
      />,
    );

    expect(screen.getByText("Tell us how a lawyer can help you today.")).toBeTruthy();
    expect(screen.getByDisplayValue(FICTIONAL_SITUATION)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /record/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Continue matter review" }));

    await waitFor(() => expect(views.some((view) => view.state !== null)).toBe(true));
    expect(views.at(-1)?.stage).toBe("questions");
    expect(views.at(-1)?.state?.input).toBe(FICTIONAL_SITUATION);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("commits answers to the same state exposed to the lawyer view without network calls", async () => {
    const onDemoStateChange = vi.fn<(view: ScreenDemoView) => void>();
    render(
      <ScreenEnginePublicWidget
        firmId="fictional-firm"
        firmName="Hartwell Law"
        runtime="demo"
        initialDescription={FICTIONAL_SITUATION}
        onDemoStateChange={onDemoStateChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue matter review" }));

    await waitFor(() => {
      const latest = onDemoStateChange.mock.calls.at(-1)?.[0];
      expect(latest?.currentQuestion).toBeTruthy();
    });

    const questionBefore = onDemoStateChange.mock.calls.at(-1)?.[0].currentQuestion;
    expect(questionBefore?.options?.[0]).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: questionBefore!.options![0].label }),
    );

    await waitFor(() => {
      const latest = onDemoStateChange.mock.calls.at(-1)?.[0];
      expect(latest?.state?.questionHistory.length).toBeGreaterThan(0);
      expect(latest?.currentQuestion?.id).not.toBe(questionBefore?.id);
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
