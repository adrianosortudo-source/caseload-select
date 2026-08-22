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
});
