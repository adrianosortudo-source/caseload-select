// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GeneCurrentScreenMockup } from "../GeneCurrentScreenMockup";

vi.mock("next/image", () => ({ default: ({ unoptimized: _u, ...props }: Record<string, unknown>) => <img {...props} /> }));
vi.mock("../GeneCurrentScreenMockup.module.css", () => ({ default: new Proxy({}, { get: (_target, key) => String(key) }) }));
class Observer { observe() {} disconnect() {} }
beforeEach(() => vi.stubGlobal("ResizeObserver", Observer));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function ready() {
  render(<GeneCurrentScreenMockup />);
  const frame = screen.getByTitle("Gene family-law SCREEN demonstration") as HTMLIFrameElement;
  const doc = document.implementation.createHTMLDocument("Canonical SCREEN");
  doc.body.innerHTML = '<div id="public-demo-content"><textarea id="case-input"></textarea><button id="reset-btn">Reset</button></div>';
  Object.defineProperty(frame, "contentDocument", { configurable: true, value: doc });
  fireEvent.load(frame);
  const link = doc.getElementById("gene-screen-presentation")!;
  act(() => link.dispatchEvent(new Event("load")));
  return { frame, doc };
}
describe("Gene uses the current canonical SCREEN", () => {
  it("opens the canonical package in family-only configuration without an operator library", () => {
    render(<GeneCurrentScreenMockup />);
    const frame = screen.getByTitle("Gene family-law SCREEN demonstration") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe("/screen-demo-app/index.html?embed=1&profile=gene&practice_area=family");
    expect(screen.queryByLabelText("Prospect")).toBeNull();
    expect(screen.getByText(/no lead and contacts no law firm/)).toBeTruthy();
  });
  it("preserves the same widget and its answer while switching between all three views", () => {
    const { frame, doc } = ready();
    const input = doc.getElementById("case-input") as HTMLTextAreaElement;
    input.value = "An answer already supplied";
    for (const name of ["Lawyer brief", "Side by side", "Website preview"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(screen.getByTitle("Gene family-law SCREEN demonstration")).toBe(frame);
      expect(input.value).toBe("An answer already supplied");
    }
    expect(doc.body.dataset.geneView).toBe("website");
    expect(doc.getElementById("gene-screen-presentation")?.getAttribute("href")).toBe("/prospect-demos/gene-colman/current-screen-frame.css");
  });
  it("accepts natural height growth and shrinkage only from its exact same-origin widget", () => {
    const { frame } = ready();
    const send = (height: unknown, origin = window.location.origin, source: MessageEventSource | null = frame.contentWindow) => act(() => window.dispatchEvent(new MessageEvent("message", { origin, source, data: { type: "caseload-widget-resize", height } })));
    send(1800.1); expect(frame.style.height).toBe("1801px");
    send(420); expect(frame.style.height).toBe("420px");
    for (const height of [NaN, Infinity, 99, 20001, "1000", null]) send(height);
    send(1000, "https://untrusted.example"); send(1000, window.location.origin, window);
    expect(frame.style.height).toBe("420px");
  });
  it("uses the canonical reset without replacing the iframe or the saved screenshot", () => {
    const { frame, doc } = ready();
    const reset = vi.fn(); doc.getElementById("reset-btn")!.addEventListener("click", reset);
    fireEvent.click(screen.getByRole("button", { name: "Lawyer brief" }));
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(doc.body.dataset.geneView).toBe("website");
    expect(screen.getByTitle("Gene family-law SCREEN demonstration")).toBe(frame);
  });
});
