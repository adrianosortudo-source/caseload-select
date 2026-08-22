// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

describe("ScreenDemoWidget", () => {
  it("frames the interaction as fictional and advances without a network request", async () => {
    render(<ScreenDemoWidget />);

    expect(
      screen.getByText("Try the Screen with a fictional situation."),
    ).toBeTruthy();
    expect(
      screen.getByText(/Nothing is submitted, stored, or sent/i),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Run fictional Screen" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Run fictional Screen" }),
      ).toBeNull(),
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByText(/contact details/i)).toBeNull();
  });

  it("continues reporting embedded height after the question shell becomes the lawyer report", async () => {
    const originalParent = window.parent;
    const postMessage = vi.fn();
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: { postMessage },
    });
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.textContent?.includes("What the lawyer receives")
          ? 1371
          : 461;
      });

    try {
      render(<ScreenDemoWidget />);
      fireEvent.click(
        screen.getByRole("button", { name: "Run fictional Screen" }),
      );

      for (let question = 0; question < 8; question += 1) {
        if (
          screen.queryByRole("button", {
            name: "See what the lawyer receives",
          })
        ) {
          break;
        }

        const main = document.querySelector("main");
        const previousQuestion = main?.querySelector("h2")?.textContent;
        const option = main?.querySelector<HTMLButtonElement>("button");
        expect(option).toBeTruthy();
        fireEvent.click(option!);
        await waitFor(() =>
          expect(document.querySelector("main h2")?.textContent).not.toBe(
            previousQuestion,
          ),
        );
      }

      fireEvent.click(
        await screen.findByRole("button", {
          name: "See what the lawyer receives",
        }),
      );
      await screen.findByRole("heading", {
        name: "What the lawyer receives",
      });

      await waitFor(() =>
        expect(postMessage).toHaveBeenCalledWith(
          { type: "caseload-widget-resize", height: 1371 },
          "*",
        ),
      );
    } finally {
      scrollHeight.mockRestore();
      Object.defineProperty(window, "parent", {
        configurable: true,
        value: originalParent,
      });
    }
  });
});
