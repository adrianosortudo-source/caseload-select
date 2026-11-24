// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ScreenParityPreview from "../ScreenParityPreview";
import { ScreenEnginePublicWidget } from "../ScreenEnginePublicWidget";
import { initialiseState } from "@/lib/screen-engine/extractor";
import { extractPreviewInquiry } from "@/lib/screen-preview-boundary";

vi.mock("../ScreenParityMessaging", () => ({ default: () => null }));
const opening = "I need legal help with my business.";
class Observer { observe() {} unobserve() {} disconnect() {} }
const requests: { url: string; body: Record<string, unknown> }[] = [];
beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal("ResizeObserver", Observer);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) });
    return { ok: true, json: async () => ({ mode: "live", extracted: {}, tokens: { prompt: 12, completion: 2 } }) };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function submitOpening() {
  // Flush the fetch response and question-change effects before the visitor's next tap.
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Continue matter review" })); });
}

describe("private SCREEN preview transport", () => {
  it.each([true, false])("runs the normal web intake and captures only its final payload, comparison=%s", async comparison => {
    render(<ScreenParityPreview practiceArea="corporate" channel="website" comparison={comparison} externalReport={false}>
      {comparison ? <ScreenEnginePublicWidget firmId="fictional-screen-preview" firmName="Example Law Firm" /> : undefined}
    </ScreenParityPreview>);
    fireEvent.change(screen.getByRole("textbox", { name: "Tell us how a lawyer can help you today." }), { target: { value: opening } });
    await submitOpening();
    fireEvent.click(await screen.findByRole("button", { name: /Something else/i }));
    const written = "I have an offer that I want reviewed.";
    fireEvent.change(await screen.findByPlaceholderText("Describe what happened in your situation..."), { target: { value: written } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const date = await screen.findByRole("textbox", { name: "Is there a date the lawyer should take into account?" });
    fireEvent.change(date, { target: { value: "Next Tuesday." } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Continue" })); });
    for (let i=0; i<8; i++) {
      const skip = screen.queryByRole("button", { name: "Skip this question" });
      if (!skip) break;
      fireEvent.click(skip);
    }
    const share = screen.queryByRole("button", { name: /Share my contact details/i });
    if (share) fireEvent.click(share);
    const submit = await screen.findByRole("button", { name: "Complete fictional enquiry" });
    expect(document.querySelector("#parity-submission")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Full name" }), { target: { value: "Alex Example" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "alex@example.test" } });
    fireEvent.click(submit);
    await waitFor(() => expect(document.querySelector("#parity-brief")).toBeTruthy());
    const brief = JSON.parse(document.querySelector("#parity-submission")!.textContent!);
    expect(brief.contact).toMatchObject({ name:"Alex Example", email:"alex@example.test" });
    expect(brief.brief_html).toContain(written);
    expect(brief.brief_html).toContain("Next Tuesday.");
    expect((document.querySelector("#parity-brief") as HTMLIFrameElement).srcdoc).toContain(brief.brief_html.slice(0, 30));
    expect(Object.values(brief.slot_answers.written_answers)).toContain(written);
    expect(requests.map(r => r.url)).toEqual(["/api/extract", "/api/extract", "/api/extract"]);
    expect(requests[2].body.reply).toBe("Next Tuesday.");
    expect(JSON.stringify(requests)).not.toContain("alex@example.test");
  });

  it.each(["opening", "follow-up"])("keeps the visitor's %s and retries the identical extraction", async failure => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      bodies.push(init.body);
      const mode = bodies.length === (failure === "opening" ? 1 : 2) ? "error" : "live";
      return { ok: true, json: async () => ({ mode, extracted: {} }) };
    }));
    render(<ScreenParityPreview practiceArea="corporate" channel="website" comparison={false} externalReport={false} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Tell us how a lawyer can help you today." }), {target:{value:opening}});
    await submitOpening();
    const written = "I have an offer that I want reviewed.";
    if (failure === "follow-up") {
      fireEvent.click(await screen.findByRole("button", {name:/Something else/i}));
      fireEvent.change(await screen.findByPlaceholderText("Describe what happened in your situation..."), {target:{value:written}});
      await act(async () => { fireEvent.click(screen.getByRole("button", {name:"Continue"})); });
    }
    const retry = await screen.findByRole("button", {name:"Try again"});
    expect(screen.getByText(failure === "opening" ? opening : written)).toBeTruthy();
    expect(document.querySelector("#parity-submission")).toBeNull();
    await act(async () => { fireEvent.click(retry); });
    expect(bodies.at(-1)).toBe(bodies.at(-2));
    if (failure === "opening") await screen.findByRole("button", {name:/Something else/i});
    else await screen.findByRole("textbox", {name:"Is there a date the lawyer should take into account?"});
  });

  it.each([false, true])("preserves the operational request on the reference only: comparison=%s", async comparison => {
    render(<ScreenParityPreview practiceArea="corporate" channel="website" comparison={comparison} externalReport={false}>
      {comparison ? <ScreenEnginePublicWidget firmId="fictional-screen-preview" firmName="Example Law Firm" /> : undefined}
    </ScreenParityPreview>);
    fireEvent.change(screen.getByRole("textbox", {name:"Tell us how a lawyer can help you today."}), {target:{value:opening+" My fictional email is fixture@example.test."}});
    await submitOpening();
    await screen.findByRole("button", {name:/Something else/i});
    expect(String(requests[0].body.description).includes("fixture@example.test")).toBe(comparison);
  });

  it("strips structured contact values from the model request and preserves answers in local state", async () => {
    const state = initialiseState("A client owes my business money. Email Alex Example at alex@example.test.");
    Object.assign(state.slots, { client_email:"alex@example.test", client_name:"Alex Example",
      client_phone:"416-555-0109", business_help:"Alex Example is owed for an invoice" });
    await extractPreviewInquiry(state.input, state, {pendingSlotId:"deadline", reply:"Call Alex Example at 416-555-0109"});
    const body = JSON.stringify(requests[0].body);
    for (const value of ["client_email", "client_phone", "client_name", "Alex Example", "alex@example.test", "416-555-0109"]) expect(body).not.toContain(value);
    expect(state.slots.client_name).toBe("Alex Example");
  });
});
