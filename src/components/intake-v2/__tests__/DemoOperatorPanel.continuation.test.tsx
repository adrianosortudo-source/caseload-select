// @vitest-environment jsdom
import { useRef, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DemoOperatorPanel } from "../DemoOperatorPanel";
import type { ScreenDemoView } from "../ScreenEnginePublicWidget";

afterEach(cleanup);
const view: ScreenDemoView = { stage: "done", state: null, currentQuestion: null, report: null, runtime: "demo", extraction: { status: "not-requested" } };

it("keeps the simulated contact and reply behind completion, then shows exact escaped text only once", () => {
  const shown = vi.fn();
  function Harness({ complete }: { complete: boolean }) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState("");
    const [reply, setReply] = useState<string | null>(null);
    const submitted = useRef(false);
    return <DemoOperatorPanel view={{ ...view, stage: complete ? "done" : "questions" }} continuation={{
      contactUsed: true, replyOpen: open, onOpenReply: () => setOpen(true), draft,
      onDraftChange: setDraft, reply, onShowReply: () => { if (!submitted.current && draft.trim()) { submitted.current = true; setReply(draft); shown(); } },
    }} />;
  }
  const { rerender } = render(<Harness complete={false} />);
  expect(screen.queryByRole("button", { name: "Preview a reply" })).toBeNull();
  rerender(<Harness complete />);
  expect(screen.getByText("alex.morgan@example.com")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Preview a reply" }));
  const button = screen.getByRole("button", { name: "Show reply in demo" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Simulated lawyer reply"), { target: { value: "   \n " } });
  expect(button.disabled).toBe(true);
  const message = "Hello <script>not executable</script>\n" + "x".repeat(1500);
  fireEvent.change(screen.getByLabelText("Simulated lawyer reply"), { target: { value: message } });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(shown).toHaveBeenCalledTimes(1);
  expect(Array.from(document.querySelectorAll("[role=status] p")).some((node) => node.textContent === message)).toBe(true);
  expect(document.querySelector("script")).toBeNull();
  expect(button.disabled).toBe(true);
});
