// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  SCREEN_WIDGET_EXECUTION_POLICY,
  ScreenEnginePublicWidget,
  type ScreenDemoView,
} from "../ScreenEnginePublicWidget";

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

    const confirm = screen.queryByRole("button", { name: "Confirm details and continue" });
    if (confirm) fireEvent.click(confirm);
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

  it("allows live extraction in the live-AI demo but reports a truthful fallback and blocks every intake side effect", async () => {
    const onDemoStateChange = vi.fn<(view: ScreenDemoView) => void>();
    const onSubmitResult = vi.fn();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ mode: "disabled", reason: "No extraction provider is configured." }),
    } as Response);

    render(
      <ScreenEnginePublicWidget
        firmId="fictional-firm"
        firmName="Hartwell Law"
        runtime="demo-live-ai"
        layout="contained"
        consentCaptureEnabled
        initialDescription={FICTIONAL_SITUATION}
        onSubmitResult={onSubmitResult}
        onDemoStateChange={onDemoStateChange}
      />,
    );

    expect(document.querySelector('[data-shell-layout="contained"]')).toBeTruthy();
    expect(screen.queryByRole("button", { name: /record/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Continue matter review" }));

    await waitFor(() => {
      const latest = onDemoStateChange.mock.calls.at(-1)?.[0];
      expect(latest?.extraction).toEqual({
        status: "fallback",
        reason: "No extraction provider is configured.",
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/extract");
    expect(onSubmitResult).not.toHaveBeenCalled();
    expect(SCREEN_WIDGET_EXECUTION_POLICY["demo-live-ai"]).toMatchObject({
      allowsExtraction: true,
      allowsPersistence: false,
      allowsVoice: false,
      allowsConsent: false,
    });
  });
});


it("reviews AI facts once, preserves missing questions, and supports correcting the opening", async () => {
  const views: ScreenDemoView[] = [];
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ mode: "live", extracted: { amount_at_stake: "$5,000–$25,000" } }) } as Response);
  render(<ScreenEnginePublicWidget firmId="fictional" firmName="Fictional firm" runtime="demo-live-ai" layout="contained" initialDescription="A client owes us $18,450 for completed work. I can approve hiring a lawyer." onDemoStateChange={(view) => views.push(view)} />);
  fireEvent.click(screen.getByRole("button", { name: "Continue matter review" }));
  await screen.findByRole("heading", { name: "Check the captured facts" });
  expect(views.at(-1)?.state?.slot_meta.amount_at_stake.source).toBe("llm_inferred");
  expect(views.at(-1)?.currentQuestion).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit my description" }));
  expect(screen.getByDisplayValue(/18,450/)).toBeTruthy();
  expect(views.at(-1)?.extraction.status).toBe("not-requested");
  fireEvent.click(screen.getByRole("button", { name: "Continue matter review" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm details and continue" }));
  await waitFor(() => expect(views.at(-1)?.state?.slot_meta.amount_at_stake.source).toBe("answered"));
  expect(views.at(-1)?.state?.slot_meta.decision_authority.source).toBe("answered");
  expect(views.at(-1)?.currentQuestion?.id).not.toBe("amount_at_stake");
  expect(views.at(-1)?.currentQuestion?.id).not.toBe("decision_authority");
  expect(views.at(-1)?.currentQuestion).not.toBeNull();
  expect(vi.mocked(fetch).mock.calls.every(([url]) => url === "/api/extract")).toBe(true);
});


it("corrects an AI proposal individually, updates the report, and never submits contact data", async () => {
  const views: ScreenDemoView[] = [];
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ mode: "live", extracted: { amount_at_stake: "$5,000–$25,000" } }) } as Response);
  render(<ScreenEnginePublicWidget firmId="fictional" firmName="Fictional firm" runtime="demo-live-ai" layout="contained" initialDescription="A client owes us $18,450 for completed work. I can approve hiring a lawyer." onDemoStateChange={(view) => views.push(view)} />);
  fireEvent.click(screen.getByRole("button", { name: "Continue matter review" }));
  await screen.findByRole("heading", { name: "Check the captured facts" });
  fireEvent.click(screen.getByRole("button", { name: "Edit amount involved" }));
  const select = screen.getByLabelText("Correct amount involved");
  const correctedValue = Array.from((select as HTMLSelectElement).options).find((option) => option.value && option.value !== "$5,000–$25,000")!.value;
  fireEvent.change(select, { target: { value: correctedValue } });
  expect(views.at(-1)?.state?.slots.amount_at_stake).toBe("$5,000–$25,000");
  fireEvent.click(screen.getByRole("button", { name: "Done editing" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm details and continue" }));
  await waitFor(() => expect(views.at(-1)?.state?.slots.amount_at_stake).toBe(correctedValue));
  const latest = views.at(-1)!;
  expect(latest.state?.slot_meta.amount_at_stake.evidence).toMatch(/corrected/);
  expect(latest.state?.questionHistory).toEqual([]);
  expect(latest.currentQuestion?.id).not.toBe("amount_at_stake");
  expect(latest.report).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Review captured facts" }));
  expect(screen.getByRole("heading", { name: "Check the captured facts" })).toBeTruthy();
  expect(screen.getByText(correctedValue, { selector: "dd" })).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.every(([url]) => url === "/api/extract")).toBe(true);
  expect(document.querySelector('input[name="client_email"]')).toBeNull();
});

it("does not report provider success for an extraction that required no AI call", async () => {
  const views: ScreenDemoView[] = [];
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ mode: "live", reason: "no_applicable_slots", extracted: {} }) } as Response);
  render(<ScreenEnginePublicWidget firmId="fictional" firmName="Fictional firm" runtime="demo-live-ai" initialDescription="A fictional inquiry that has no matching slot pack." onDemoStateChange={(view) => views.push(view)} />);
  fireEvent.click(screen.getByRole("button", { name: "Continue matter review" }));
  await waitFor(() => expect(views.at(-1)?.extraction.status).toBe("not-needed"));
});
