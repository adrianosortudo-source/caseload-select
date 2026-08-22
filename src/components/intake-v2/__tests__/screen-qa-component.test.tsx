// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScreenDemoWidget } from "../ScreenDemoWidget";

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

describe("Screen QA component contract", () => {
  it("shows the shared 5–7 target and reaches a fictional report within eight answers", async () => {
    render(<ScreenDemoWidget />);

    expect(screen.getByText(/usually asks 5–7 short follow-up questions/i)).toBeTruthy();
    expect(screen.getByText(/never more than 8/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Run fictional Screen" }));

    for (let answer = 0; answer < 8; answer += 1) {
      const reportButton = screen.queryByRole("button", {
        name: "See what the lawyer receives",
      });
      if (reportButton) break;

      const option = document.querySelector<HTMLElement>("main button");
      expect(option, `missing answer control at step ${answer + 1}`).toBeTruthy();
      fireEvent.click(option!);
      await waitFor(() => expect(document.querySelector("main h2")).toBeTruthy());
    }

    fireEvent.click(
      await screen.findByRole("button", { name: "See what the lawyer receives" }),
    );
    expect(await screen.findByRole("heading", { name: "What the lawyer receives" })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});
