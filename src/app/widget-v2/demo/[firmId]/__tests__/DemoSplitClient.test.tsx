// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DemoSplitClient } from "../DemoSplitClient";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DemoSplitClient", () => {
  it("renders the DRG intake beside a synchronized lawyer view", async () => {
    render(<DemoSplitClient firmId="fictional-firm" firmName="Hartwell Law" />);

    expect(screen.getByRole("region", { name: "Prospective client intake" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Lawyer intake view" })).toBeTruthy();
    expect(screen.getByText("Tell us how a lawyer can help you today.")).toBeTruthy();
    expect(screen.getByText("Intake brief, updated live")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Continue matter review" }));
    await waitFor(() => expect(screen.getByText("Review in progress")).toBeTruthy());
    expect(fetch).not.toHaveBeenCalled();
  });

  it("restarts both panels when a presenter selects another fictional scenario", async () => {
    render(<DemoSplitClient firmId="fictional-firm" firmName="Hartwell Law" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue matter review" }));
    await waitFor(() => expect(screen.getByText("Review in progress")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Commercial lease" }));

    expect(screen.getByText("Waiting to begin")).toBeTruthy();
    expect(screen.getByDisplayValue(/five-year commercial lease/i)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});
