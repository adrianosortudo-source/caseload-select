// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScreenEnginePublicWidget, type ScreenDemoView } from "../ScreenEnginePublicWidget";
import { DemoOperatorPanel } from "../DemoOperatorPanel";

class Observer { observe() {} unobserve() {} disconnect() {} }
const inquiry = "I am having a difficult divorce as my wife will not allow me see my son";
function Harness({ views, description = inquiry, reply = null }: { views: ScreenDemoView[]; description?: string; reply?: string | null }) {
  const [contactUsed, setContactUsed] = useState(false);
  return <ScreenEnginePublicWidget firmId="fictional-family" firmName="Example Law Firm" runtime="demo-live-ai" configuredPracticeAreas={["family"]} layout="contained" initialDescription={description} onDemoStateChange={(view) => views.push(view)} demoContinuation={{ workflow: "meta", contactUsed, onUseSampleContact: () => setContactUsed(true), onResetSession: () => setContactUsed(false), reply, onShowReview: () => {} }} />;
}
function InvoiceHarness({ views, description }: { views: ScreenDemoView[]; description: string }) {
  const [contactUsed, setContactUsed] = useState(false);
  return <ScreenEnginePublicWidget firmId="fictional-business" firmName="Example Law Firm" runtime="demo-live-ai" configuredPracticeAreas={["corporate"]} layout="contained" initialDescription={description} onDemoStateChange={(view) => views.push(view)} demoContinuation={{ workflow: "meta", contactUsed, onUseSampleContact: () => setContactUsed(true), onResetSession: () => setContactUsed(false), reply: null }} />;
}
function send(value?: string) {
  if (value !== undefined) fireEvent.change(screen.getByLabelText("Your fictional message"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Send in demo" }));
}
async function useContact() { fireEvent.click(await screen.findByRole("button", { name: "Use fictional contact" })); }
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", Observer);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mode: "live", extracted: { family_help_sought: "Parenting or decision-making", family_children: "Yes" } }) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Meta family conversation", () => {
  it("opens a blank family composer with a family example", () => {
    render(<Harness views={[]} description="" />);
    expect((screen.getByLabelText("Your fictional message") as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByPlaceholderText("I recently separated and need help agreeing on a parenting schedule. We live in Ontario.")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/commercial lease/)).toBeNull();
  });
  it("explains the minimum opening length rather than silently stalling", () => {
    render(<Harness views={[]} description="" />);
    fireEvent.change(screen.getByLabelText("Your fictional message"), { target: { value: "divorce" } });
    expect(screen.getByText("Please enter at least 10 characters.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send in demo" }) as HTMLButtonElement).disabled).toBe(true);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  it("retains literal family facts when live AI is unavailable", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ mode: "error", extracted: {} }) } as Response);
    const views: ScreenDemoView[] = []; render(<Harness views={views} />); send(); await useContact();
    await waitFor(() => expect(views.at(-1)?.currentQuestion?.id).toBe("family_help_sought"));
    expect(views.at(-1)?.state?.slot_meta.family_children.source).toBe("explicit");
    expect(views.at(-1)?.state?.slot_meta.family_help_sought?.source).not.toBe("explicit");
    expect(views.at(-1)?.extraction.status).toBe("fallback");
  });
  it("reads the exact fictional inquiry, grounds only literal facts, then asks contact before missing facts", async () => {
    const views: ScreenDemoView[] = []; render(<Harness views={views} />); send();
    await useContact();
    await waitFor(() => expect(views.at(-1)?.currentQuestion?.id).toBe("family_existing_order"));
    expect(views.at(-1)?.state?.slot_meta.family_children.source).toBe("explicit");
    expect(views.at(-1)?.state?.slot_meta.family_help_sought.source).toBe("explicit");
    expect(screen.getByText(inquiry)).toBeTruthy();
    expect(screen.queryByText("Review the facts")).toBeNull();
    expect(screen.getByText(/Do you already have a written agreement or court order about this\?/)).toBeTruthy();
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).matter_type).toBe("family_general");
    expect(vi.mocked(fetch).mock.calls.every(([url, init]) => url === "/api/extract" && !String(init?.body).includes("alex.morgan"))).toBe(true);
  });
  it("maps numbered choices and completes every unresolved question without repeating grounded facts", async () => {
    const views: ScreenDemoView[] = []; render(<Harness views={views} />); send(); await useContact();
    const asked: string[] = [];
    for (let turn = 0; turn < 10; turn++) {
      await waitFor(() => expect(views.at(-1)?.stage === "done" || views.at(-1)?.currentQuestion).toBeTruthy());
      if (views.at(-1)?.stage === "done") break;
      const question = views.at(-1)!.currentQuestion!;
      expect(asked).not.toContain(question.id); asked.push(question.id);
      expect(["family_children", "family_help_sought"]).not.toContain(question.id);
      send(question.options?.length ? "1" : "No court date is scheduled.");
      await waitFor(() => expect(views.at(-1)?.stage === "done" || views.at(-1)?.currentQuestion?.id !== question.id).toBe(true));
    }
    const completion = await screen.findByText(/Brief ready\./);
    expect(completion.textContent).toContain(inquiry);
    expect(completion.textContent).toContain("Here is what I understood so far.");
    expect(completion.textContent).toMatch(/no firm is contacted/i);
    expect(asked).toEqual(expect.arrayContaining(["family_existing_order", "family_timing", "family_jurisdiction", "hiring_timeline", "other_counsel", "decision_authority"]));
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(screen.getByText(inquiry)).toBeTruthy();
  });
  it("shows the exact local simulated reply in the existing transcript after completion", async () => {
    const views: ScreenDemoView[] = []; const { rerender } = render(<Harness views={views} />); send(); await useContact();
    for (let turn = 0; turn < 10; turn++) {
      await waitFor(() => expect(views.at(-1)?.stage === "done" || views.at(-1)?.currentQuestion).toBeTruthy());
      if (views.at(-1)?.stage === "done") break;
      const question = views.at(-1)!.currentQuestion!;
      send(question.options?.length ? "1" : "No court date is scheduled.");
      await waitFor(() => expect(views.at(-1)?.stage === "done" || views.at(-1)?.currentQuestion?.id !== question.id).toBe(true));
    }
    const completion = await screen.findByText(/Brief ready\./);
    expect(completion.textContent).toContain(inquiry);
    expect(completion.textContent).toContain("Here is what I understood so far.");
    expect(completion.textContent).toMatch(/no firm is contacted/i);
    const reply = "Thank you for sharing.\nWe can discuss next steps.";
    rerender(<Harness views={views} reply={reply} />);
    const receipt = await screen.findByText((_, element) => element?.textContent === reply && element.tagName === "P");
    expect(receipt.getAttribute("data-ui-copy-exception")).toContain("preserved verbatim");
    expect(screen.getByText("Simulated reply from Example Law Firm")).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
  it("edits the original inquiry by clearing prior answers and re-reading the corrected date", async () => {
    const first = `${inquiry}. A family court date is December 12, 2026.`;
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ mode: "live", extracted: { family_children: "Yes", family_help_sought: "Parenting or decision-making", family_timing: "December 12, 2026" } }) } as Response);
    const views: ScreenDemoView[] = []; render(<Harness views={views} description={first} />); send(); await useContact();
    await waitFor(() => expect(views.at(-1)?.state?.slots.family_timing).toContain("December 12, 2026"));
    fireEvent.click(screen.getByRole("button", { name: "Edit inquiry" }));
    expect((screen.getByLabelText("Your fictional message") as HTMLTextAreaElement).value).toBe(first);
    const corrected = first.replace("December 12", "December 15");
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ mode: "live", extracted: { family_children: "Yes", family_help_sought: "Parenting or decision-making", family_timing: "December 15, 2026" } }) } as Response);
    send(corrected); await useContact();
    await waitFor(() => expect(views.at(-1)?.state?.slots.family_timing).toContain("December 15, 2026"));
    expect(views.at(-1)?.state?.input).toBe(corrected);
    expect(screen.queryByText(first)).toBeNull();
  });
  it("re-reads a corrected invoice opening without retaining the old amount", async () => {
    const first = "A business client has not paid my $10,000 invoice for completed work. I can approve hiring a lawyer.";
    const corrected = first.replace("$10,000", "$30,000");
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ mode: "live", extracted: {} }) } as Response);
    const views: ScreenDemoView[] = []; render(<InvoiceHarness views={views} description={first} />); send(); await useContact();
    await waitFor(() => expect(views.at(-1)?.state?.slots.amount_at_stake).toBe("$5,000–$25,000"));
    expect(views.at(-1)?.state?.slot_meta.decision_authority.source).toBe("explicit");
    fireEvent.click(screen.getByRole("button", { name: "Edit inquiry" }));
    expect((screen.getByLabelText("Your fictional message") as HTMLTextAreaElement).value).toBe(first);
    send(corrected); await useContact();
    await waitFor(() => expect(views.at(-1)?.state?.slots.amount_at_stake).toBe("$25,000–$100,000"));
    expect(views.at(-1)?.state?.input).toBe(corrected);
    expect(screen.queryByText(first)).toBeNull();
    const report = views.at(-1)?.report;
    expect(JSON.stringify(report)).toContain("$25,000–$100,000");
    expect(JSON.stringify(report)).not.toContain("$5,000–$25,000");
  });
  it("uses the original Meta mapper for a natural readiness answer", async () => {
    const rich = `${inquiry}. There is no court order and no written agreement. Our family court date is December 12, 2026. We live in Ontario.`;
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ mode: "live", extracted: { family_children: "Yes", family_help_sought: "Parenting or decision-making", family_existing_order: "Neither", family_timing: "December 12, 2026", family_jurisdiction: "Ontario" } }) } as Response);
    const views: ScreenDemoView[] = []; render(<Harness views={views} description={rich} />); send(); await useContact();
    await waitFor(() => expect(views.at(-1)?.currentQuestion?.id).toBe("hiring_timeline"));
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ mode: "live", extracted: {}, mapped_answer: { slotId: "hiring_timeline", value: "Now (this week)" } }) } as Response);
    send("I would like someone working on this as soon as possible, ideally this week.");
    await waitFor(() => expect(views.at(-1)?.state?.slots.hiring_timeline).toBe("Now (this week)"));
    expect(views.at(-1)?.state?.slot_meta.hiring_timeline.source).toBe("answered");
    expect(views.at(-1)?.currentQuestion?.id).not.toBe("hiring_timeline");
  });
  it("grounds a second explicitly stated fact in a natural answer without repeating it", async () => {
    const views: ScreenDemoView[] = []; render(<Harness views={views} />); send(); await useContact();
    await waitFor(() => expect(views.at(-1)?.currentQuestion?.id).toBe("family_existing_order"));
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ mode: "live", extracted: { family_timing: "No known date" }, mapped_answer: { slotId: "family_existing_order", value: "Court order" } }) } as Response);
    send("There is a court order. No court date is scheduled.");
    await waitFor(() => expect(views.at(-1)?.currentQuestion?.id).toBe("family_jurisdiction"));
    expect(views.at(-1)?.state?.slots.family_timing).toBe("No court date is scheduled");
    expect(views.at(-1)?.state?.slot_meta.family_timing.source).toBe("explicit");
    expect(views.at(-1)?.state?.questionHistory).not.toContain("family_timing");
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !String(init?.body).includes("alex.morgan"))).toBe(true);
  });
  it("retains a partial answer for a later clarification without sending fictional contact", async () => {
    const views: ScreenDemoView[] = []; render(<Harness views={views} />); send(); await useContact();
    await waitFor(() => expect(views.at(-1)?.currentQuestion?.id).toBe("family_existing_order"));
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ mode: "live", extracted: {} }) } as Response);
    send("There is no court order that I know of.");
    await screen.findByText(/That answer did not resolve this question/);
    await waitFor(() => expect((screen.getByLabelText("Your fictional message") as HTMLTextAreaElement).disabled).toBe(false));
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ mode: "live", extracted: { family_existing_order: "Neither" } }) } as Response);
    send("There is no written agreement either.");
    await waitFor(() => expect(views.at(-1)?.state?.slots.family_existing_order).toBe("Neither"));
    const body = JSON.parse(vi.mocked(fetch).mock.calls[2][1]!.body as string);
    expect(body.description).toContain("There is no court order that I know of.");
    expect(body.description).toContain("There is no written agreement either.");
    expect(views.at(-1)?.currentQuestion?.id).not.toBe("family_existing_order");
    expect(views.at(-1)?.state?.input).toBe(inquiry);
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !String(init?.body).includes("alex.morgan"))).toBe(true);
    const view = views.at(-1)!; cleanup(); render(<DemoOperatorPanel view={view} />);
    expect(screen.getByText("Family law", { exact: true })).toBeTruthy();
    expect(screen.queryByText("Fit band", { exact: true })).toBeNull();
  });
});
