// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ScreenDemoWorkspace, demoExtractionLabel } from "../ScreenDemoWorkspace";
import type { ScreenDemoView } from "../ScreenEnginePublicWidget";
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => { const {priority: _priority, ...rest} = props; return <img {...rest} alt={String(rest.alt)} />; } }));
class ResizeObserverMock { observe() {} unobserve() {} disconnect() {} }
beforeEach(() => { vi.stubGlobal("ResizeObserver", ResizeObserverMock); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("current SCREEN workspace", () => {
  it("preserves a running intake when switching panes and restarts explicitly without network in guided mode", () => {
    render(<ScreenDemoWorkspace />);
    expect(document.querySelectorAll("main").length).toBe(1);
    expect(screen.getByRole("button", {name: "Live AI"}).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", {name: "Guided sample"}));
    expect(screen.getByText("Guided sample. AI is not being called.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "Continue matter review"}));
    fireEvent.click(screen.getByRole("button", {name: "Confirm details and continue"}));
    fireEvent.click(screen.getByRole("button", {name: "Guided sample"}));
    expect(screen.queryByRole("button", {name: "Continue matter review"})).toBeNull();
    const intakeBefore = document.querySelector('[aria-label="Prospective client intake"] [data-shell-layout]');
    fireEvent.click(screen.getByRole("button", {name: "Lawyer brief"}));
    expect(document.querySelector('[aria-label="Prospective client intake"]')?.hasAttribute("hidden")).toBe(true);
    fireEvent.click(screen.getByRole("button", {name: "Intake"}));
    expect(document.querySelector('[aria-label="Prospective client intake"] [data-shell-layout]')).toBe(intakeBefore);
    expect(screen.queryByRole("button", {name: "Continue matter review"})).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "Restart demo"}));
    expect(screen.getByRole("button", {name: "Continue matter review"})).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps live success, no-call outcomes, guided mode and provider failure distinct", () => {
    const view: ScreenDemoView = {stage:"kickoff",state:null,currentQuestion:null,report:null,runtime:"demo-live-ai",extraction:{status:"not-requested"}};
    expect(demoExtractionLabel({...view,extraction:{status:"live"}})).toContain("Live AI read the description");
    expect(demoExtractionLabel({...view,extraction:{status:"fallback"}})).toContain("AI is unavailable");
    expect(demoExtractionLabel({...view,extraction:{status:"not-needed"}})).toContain("was not needed");
    expect(demoExtractionLabel({...view,runtime:"demo"})).toContain("AI is not being called");
  });
});
