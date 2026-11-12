// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { PublicScreenSandboxFrame } from "../PublicScreenSandboxFrame";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, "parent", { configurable: true, value: window });
});

describe("PublicScreenSandboxFrame", () => {
  it("forwards settings and relays only trusted child heights, including shrinkage", () => {
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://www.caseloadselect.ca/tools/screen-demo.html");
    const postMessage = vi.fn();
    Object.defineProperty(window, "parent", { configurable: true, value: { postMessage } });
    render(<PublicScreenSandboxFrame query="embed=1&channel=sms" />);
    const frame = screen.getByTitle("SCREEN Intake Demo: practice-area and channel demonstration") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe("/screen-demo-app/index.html?embed=1&channel=sms");
    const send = (height: unknown, origin = window.location.origin, source: MessageEventSource | null = frame.contentWindow) => {
      act(() => window.dispatchEvent(new MessageEvent("message", { origin, source, data: { type: "caseload-widget-resize", height } })));
    };
    send(1400.1);
    expect(frame.style.height).toBe("1401px");
    expect(postMessage).toHaveBeenLastCalledWith({ type: "caseload-widget-resize", height: 1401 }, "https://www.caseloadselect.ca");
    send(1400.1);
    expect(postMessage).toHaveBeenCalledTimes(1);
    send(900);
    expect(frame.style.height).toBe("900px");
    expect(postMessage).toHaveBeenCalledTimes(2);
    for (const height of [NaN, Infinity, -1, 99, 20001, "1200", null]) send(height);
    send(1200, "https://attacker.example");
    send(1200, window.location.origin, window);
    expect(frame.style.height).toBe("900px");
    expect(postMessage).toHaveBeenCalledTimes(2);
  });

  it("resizes locally without sending to an untrusted parent", () => {
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://attacker.example/");
    const postMessage = vi.fn();
    Object.defineProperty(window, "parent", { configurable: true, value: { postMessage } });
    render(<PublicScreenSandboxFrame />);
    const frame = screen.getByTitle("SCREEN Intake Demo: practice-area and channel demonstration") as HTMLIFrameElement;
    act(() => window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      source: frame.contentWindow,
      data: { type: "caseload-widget-resize", height: 1100 },
    })));
    expect(frame.style.height).toBe("1100px");
    expect(postMessage).not.toHaveBeenCalled();
  });
});
