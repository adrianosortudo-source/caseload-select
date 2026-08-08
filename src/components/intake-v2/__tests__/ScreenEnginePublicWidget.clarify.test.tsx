// @vitest-environment jsdom
/**
 * DR-112. Render-level coverage for the clarify menu that the pure-
 * function tests (screen-engine-public-widget-pt.test.ts,
 * clarify-step-doctrine.test.ts) can't reach on their own: does the menu
 * actually render, does a chip tap route out of clarify without spending
 * a free-text round, and does the DR-071 two-round fallback still fire.
 *
 * No dev server, no real Gemini call: global fetch is mocked to reject,
 * so llmExtract always resolves { mode: 'error' } and the widget runs on
 * the regex + heuristic classification alone — deterministic, no
 * network, no flakiness from a live model call.
 *
 * Classification-drift guard: every kickoff/free-text input below reuses
 * the exact string already pinned unclassifiable by
 * clarify-step-doctrine.test.ts ("I would like to learn more about how
 * you can help me") rather than inventing new prose, so this test can't
 * silently start failing because some future regex pattern happens to
 * match a throwaway test sentence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScreenEnginePublicWidget } from "../ScreenEnginePublicWidget";

const UNCLASSIFIABLE = "I would like to learn more about how you can help me";
const META_REQUEST = "i want to speak to a lawyer";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  // Shell.tsx's resize-report effect only constructs a ResizeObserver
  // when embedded in an iframe (early-returns otherwise), which a
  // top-level jsdom render never is — but stub it anyway as cheap
  // insurance against any other code path touching it.
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("network disabled in test")),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWidget() {
  return render(<ScreenEnginePublicWidget firmId="test-firm" firmName="Test Firm" />);
}

async function submitKickoff(text: string) {
  const textarea = screen.getByRole("textbox", {
    name: "Tell us how a lawyer can help you today.",
  });
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Continue matter review" }));
}

async function submitOtherFreeText(text: string) {
  fireEvent.click(screen.getByText(/Something else/i));
  const textarea = await screen.findByPlaceholderText(
    "Describe what happened in your situation...",
  );
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

describe("ScreenEnginePublicWidget clarify menu render (DR-112)", () => {
  it("shows the acknowledgment menu for a contact-request opener, and a chip tap routes out of clarify", async () => {
    renderWidget();
    await submitKickoff(META_REQUEST);

    await waitFor(() =>
      expect(screen.queryByText("We can get that arranged.")).not.toBeNull(),
    );
    expect(screen.queryByText("Business and contracts")).not.toBeNull();
    expect(screen.queryByText("Real estate")).not.toBeNull();
    expect(screen.queryByText("Employment")).not.toBeNull();
    expect(screen.queryByText("Wills and estates")).not.toBeNull();

    fireEvent.click(screen.getByText("Employment"));

    // Routed directly into the employment lane's routing question — never
    // back through clarify — proves applyClarifyChoice actually fired
    // and exited the clarify branch.
    await waitFor(() =>
      expect(screen.queryByText("What best describes the situation?")).not.toBeNull(),
    );
    expect(screen.queryByText("We can get that arranged.")).toBeNull();
  });

  it("shows the default (non-acknowledgment) menu for a vague, non-meta opener", async () => {
    renderWidget();
    await submitKickoff(UNCLASSIFIABLE);

    await waitFor(() => expect(screen.queryByText("A few more details?")).not.toBeNull());
    expect(screen.queryByText("We can get that arranged.")).toBeNull();
    expect(screen.queryByText("Business and contracts")).not.toBeNull();
  });

  it("a chip tap does not consume a clarify round — round-1 copy still shows round-1, not round-2", async () => {
    // If applyClarifyChoice (or the widget's chip handler) incorrectly
    // called setClarifyAttempts, this exact render would already be
    // sitting at round 2 by the time the free-text path below runs.
    // Asserting round-1 copy (not round-2) here is the observable proof
    // the chip path never touches the counter — the engine-level
    // equivalent is pinned in clarify-step-doctrine.test.ts's "does not
    // mutate clarify-round accounting fields" test; this is the render-
    // level counterpart.
    renderWidget();
    await submitKickoff(META_REQUEST);
    await waitFor(() =>
      expect(screen.queryByText("We can get that arranged.")).not.toBeNull(),
    );

    await submitOtherFreeText(UNCLASSIFIABLE);

    await waitFor(() => expect(screen.queryByText("Even a topic works.")).not.toBeNull());
  });

  it("two failed free-text rounds fall back to contact capture (DR-071, unchanged)", async () => {
    renderWidget();
    await submitKickoff(UNCLASSIFIABLE);
    await waitFor(() => expect(screen.queryByText("A few more details?")).not.toBeNull());

    await submitOtherFreeText(UNCLASSIFIABLE);
    await waitFor(() => expect(screen.queryByText("Even a topic works.")).not.toBeNull());

    // Second free-text submission is an unconditional fallback in
    // submitClarify (early-returns before re-running the engine), so
    // there is no classification-drift risk on this call either.
    await submitOtherFreeText(UNCLASSIFIABLE);

    await waitFor(() =>
      expect(screen.queryByText("We can still get this to the team.")).not.toBeNull(),
    );
  });
});
