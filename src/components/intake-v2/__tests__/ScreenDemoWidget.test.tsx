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

  it.each([
    ["I was asked to sign something by Friday.", "What document have you been asked to sign or review?", "It is an offer letter."],
    ["I have a draft offer that I want reviewed.", "Is there a date the lawyer should take into account?", "Next Tuesday."],
  ])("uses a written reply to choose the next question and includes both answers in the visible brief: %s", async (reply, followUp, detail) => {
    render(<ScreenDemoWidget />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "I need legal help with my business." } });
    fireEvent.click(screen.getByRole("button", { name: "Run fictional Screen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Something else" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: reply } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const detailInput = await screen.findByRole("textbox", { name: followUp });
    fireEvent.change(detailInput, { target: { value: detail } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    for (let turn = 0; turn < 12; turn += 1) {
      const skip = screen.queryByRole("button", { name: "Skip this question" });
      if (!skip) break;
      fireEvent.click(skip);
    }
    fireEvent.click(await screen.findByRole("button", { name: "See what the lawyer receives" }));
    expect(screen.getByRole("heading", { name: "What the lawyer receives" })).toBeTruthy();
    expect(screen.getAllByText(reply, { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(detail, { exact: false }).length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
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
        if (main?.querySelector("textarea")) {
          fireEvent.click(screen.getByRole("button", { name: "Skip this question" }));
        } else {
          fireEvent.click(main!.querySelector<HTMLButtonElement>("button")!);
        }
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
