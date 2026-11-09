// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScreenEnginePublicWidget, type ScreenDemoView } from "../ScreenEnginePublicWidget";
import { DemoOperatorPanel } from "../DemoOperatorPanel";

class Observer { observe() {} unobserve() {} disconnect() {} }
const inquiry = "Fictional test. I need help with my divorce. My former partner is keeping me away from our children.";
function Harness({ views, description = inquiry }: { views: ScreenDemoView[]; description?: string }) {
  const [contactUsed, setContactUsed] = useState(false);
  return <ScreenEnginePublicWidget firmId="fictional-family" firmName="Example Law Firm" runtime="demo-live-ai" configuredPracticeAreas={["family"]} layout="contained" initialDescription={description} onDemoStateChange={(view) => views.push(view)} demoContinuation={{ workflow: "meta", contactUsed, onUseSampleContact: () => setContactUsed(true), reply: null }} />;
}
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", Observer);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mode: "live", extracted: { family_help_sought: "Parenting or decision-making", family_children: "Yes" } }) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Meta family demo free-text regression", () => {
  it("reads a typed parenting inquiry, captures contact, then asks unresolved questions", async () => {
    const views: ScreenDemoView[] = []; render(<Harness views={views} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue matter review" }));
    await screen.findByRole("heading", { name: "Review the facts" });
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).matter_type).toBe("family_general");
    await waitFor(() => expect(views.at(-1)?.extraction.status).toBe("live"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm details and continue" }));
    await screen.findByRole("button", { name: "Use sample contact" });
    expect(screen.queryByRole("heading", { name: "Demo complete" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use sample contact" }));
    await waitFor(() => expect(views.at(-1)?.currentQuestion?.id).toBe("family_existing_order"));
    expect(views.at(-1)?.state?.slot_meta.family_children.source).toBe("answered");
    expect(views.at(-1)?.state?.slots.family_help_sought).toBe("Parenting or decision-making");
    expect(vi.mocked(fetch).mock.calls.every(([url]) => url === "/api/extract")).toBe(true);
  });

  it("completes discovery after early sample contact without asking confirmed facts again", async () => {
    const views: ScreenDemoView[] = []; render(<Harness views={views} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue matter review" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm details and continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use sample contact" }));
    const asked: string[] = [];
    for (let turn = 0; turn < 10; turn++) {
      const finish = screen.queryByRole("button", { name: "Finish demonstration" });
      if (finish) { fireEvent.click(finish); break; }
      const question = views.at(-1)?.currentQuestion;
      expect(question).toBeTruthy();
      expect(asked).not.toContain(question!.id); asked.push(question!.id);
      expect(question!.id).not.toBe("family_children");
      expect(question!.id).not.toBe("family_help_sought");
      if (question!.options?.length) fireEvent.click(screen.getByRole("button", { name: question!.options[0].label }));
      else {
        fireEvent.change(screen.getByRole("textbox"), { target: { value: "No court date or deadline is currently scheduled." } });
        fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      }
      await waitFor(() => expect(views.at(-1)?.currentQuestion?.id).not.toBe(question!.id));
    }
    await screen.findByRole("heading", { name: "Demo complete" });
    expect(views.at(-1)?.stage).toBe("done");
    expect(asked).toEqual(expect.arrayContaining(["family_existing_order", "family_timing", "family_jurisdiction", "hiring_timeline", "other_counsel", "decision_authority"]));
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("retains an exact court date from free text and allows correction before follow-ups", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ mode: "live", extracted: { family_help_sought: "Parenting or decision-making", family_children: "Yes", family_timing: "A case conference is scheduled for December 12, 2026." } }) } as Response);
    const views: ScreenDemoView[] = []; render(<Harness views={views} description={`${inquiry} A case conference is scheduled for December 12, 2026.`} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue matter review" }));
    await screen.findByText("A case conference is scheduled for December 12, 2026.");
    fireEvent.click(screen.getByRole("button", { name: "Edit court date or deadline" }));
    fireEvent.change(screen.getByLabelText("Correct court date or deadline"), { target: { value: "December 15, 2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Done editing" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm details and continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use sample contact" }));
    await waitFor(() => expect(views.at(-1)?.state?.slots.family_timing).toBe("December 15, 2026"));
    expect(views.at(-1)?.state?.slot_meta.family_timing.source).toBe("answered");
    expect(views.at(-1)?.currentQuestion?.id).not.toBe("family_timing");
  });

  it("maps a natural readiness reply through the original Meta answer mapper", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ mode: "live", extracted: { family_help_sought: "Parenting or decision-making", family_children: "Yes", family_existing_order: "Neither", family_timing: "No court date is scheduled.", family_jurisdiction: "Ontario" } }) } as Response);
    const views: ScreenDemoView[] = []; render(<Harness views={views} description={`${inquiry} There is no court order and no written agreement. No court date is scheduled. We live in Ontario.`} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue matter review" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm details and continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use sample contact" }));
    await waitFor(() => expect(views.at(-1)?.currentQuestion?.id).toBe("hiring_timeline"));
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ mode: "live", extracted: {}, mapped_answer: { slotId: "hiring_timeline", value: "Now (this week)" } }) } as Response);
    fireEvent.click(screen.getByRole("button", { name: /Something else/i }));
    fireEvent.change(screen.getByPlaceholderText("Describe what happened in your situation..."), { target: { value: "I would like to get someone working on this as soon as possible, ideally this week." } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(views.at(-1)?.state?.slots.hiring_timeline).toBe("Now (this week)"));
    expect(views.at(-1)?.state?.slot_meta.hiring_timeline.source).toBe("answered");
    expect(views.at(-1)?.currentQuestion?.id).not.toBe("hiring_timeline");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("keeps a partial answer available when the person clarifies it on the next turn", async () => {
    const views: ScreenDemoView[] = []; render(<Harness views={views} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue matter review" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm details and continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use sample contact" }));
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ mode: "live", extracted: {} }) } as Response);
    fireEvent.click(screen.getByRole("button", { name: /Something else/i }));
    fireEvent.change(screen.getByPlaceholderText("Describe what happened in your situation..."), { target: { value: "There is no court order that I know of." } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText(/That answer did not resolve this question/);
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ mode: "live", extracted: { family_existing_order: "Neither" } }) } as Response);
    fireEvent.click(screen.getByRole("button", { name: /Something else/i }));
    fireEvent.change(screen.getByPlaceholderText("Describe what happened in your situation..."), { target: { value: "There is no written agreement either." } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Review the facts" });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[2][1]!.body as string);
    expect(body.description).toContain("There is no court order that I know of.");
    expect(body.description).toContain("There is no written agreement either.");
    fireEvent.click(screen.getByRole("button", { name: "Confirm details and continue" }));
    await waitFor(() => expect(views.at(-1)?.state?.slots.family_existing_order).toBe("Neither"));
    expect(views.at(-1)?.currentQuestion?.id).not.toBe("family_existing_order");
    expect(views.at(-1)?.state?.input).toBe(inquiry);
  });

  it("uses the actual asked question when reading a natural follow-up answer", async () => {
    const views: ScreenDemoView[] = []; render(<Harness views={views} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue matter review" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm details and continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use sample contact" }));
    await screen.findByRole("heading", { name: "Is there an existing agreement or court order?" });
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ mode: "live", extracted: { family_existing_order: "Court order" } }) } as Response);
    fireEvent.click(screen.getByRole("button", { name: /Something else/i }));
    fireEvent.change(screen.getByPlaceholderText("Describe what happened in your situation..."), { target: { value: "A judge made an order about the children in 2024, and that is the document I have." } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Review the facts" });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    const body = JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string);
    expect(body.description).toContain("Is there an existing agreement or court order?");
    expect(body.description).toContain("A judge made an order");
    expect(body.description).toContain("Question: Is there an existing agreement or court order?");
    fireEvent.click(screen.getByRole("button", { name: "Confirm details and continue" }));
    await waitFor(() => expect(views.at(-1)?.state?.slots.family_existing_order).toBe("Court order"));
    expect(views.at(-1)?.state?.slot_meta.family_existing_order.source).toBe("answered");
    expect(views.at(-1)?.currentQuestion?.id).not.toBe("family_existing_order");
    expect(views.at(-1)?.state?.slots.family_children).toBe("Yes");
    expect(vi.mocked(fetch).mock.calls.every(([url, init]) => url === "/api/extract" && !String(init?.body).includes("alex.morgan"))).toBe(true);
    const view = views.at(-1)!; cleanup(); render(<DemoOperatorPanel view={view} />);
    expect(screen.getByText("Family law", { exact: true })).toBeTruthy();
    expect(screen.queryByText("Fit band", { exact: true })).toBeNull();
    expect(screen.queryByText(/Bardal|Tax structuring|commercial matter/)).toBeNull();
  });
});
