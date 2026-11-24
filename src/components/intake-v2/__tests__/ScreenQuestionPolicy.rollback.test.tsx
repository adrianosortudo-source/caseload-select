// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/extract/route";
import type { EngineState } from "@/lib/screen-engine/types";
import { ScreenEnginePublicWidget } from "../ScreenEnginePublicWidget";
import ScreenParityPreview from "../ScreenParityPreview";

const { extract } = vi.hoisted(() => ({ extract: vi.fn() }));
vi.mock("@/lib/screen-llm-server", () => ({ llmExtractServer: extract }));
vi.mock("@/lib/llm-option-map", () => ({ llmMapOptionReply: async () => ({ mode: "live" }) }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ ok: true, active: true, remaining: 29, reset: Date.now() + 60_000, limit: 30 }),
  ipFromRequest: () => "192.0.2.41",
  rateLimitHeaders: () => ({}),
}));
vi.mock("../ScreenParityMessaging", () => ({ default: () => null }));

const opening = "I need legal help with my business.";
const reply = "Please review our supplier agreement before we sign it.";
const requests: { body: Record<string, unknown>; returnedPolicy: unknown }[] = [];
class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function extraction(state: EngineState) {
  return {
    extracted: {}, mode: "live", tokens: { prompt: 20, completion: 10 },
    ...(state.question_policy ? {
      interpretation: {
        matter: "corporate_general",
        answers_question: true,
        superseded_quote: null,
        replacement_goal: null,
        current_excerpts: [],
        unsupported_slots: [],
        covered_questions: [],
        next_slot: null,
        next_question: null,
        question_review: {
          requests: [],
          priority_quote: null,
          preferred_request_quote: null,
          custom_basis_quote: null,
          questions: [],
        },
      },
    } : {}),
  };
}

beforeEach(() => {
  requests.length = 0;
  extract.mockReset();
  extract.mockImplementation(async (_text, state) => extraction(state));
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("SCREEN_PARITY_QUESTION_POLICY", "grounded_v1");
  vi.stubGlobal("ResizeObserver", Observer);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("/api/extract");
    const body = JSON.parse(String(init.body));
    const response = await POST(new Request("https://screen.example.test/api/extract", {
      body: JSON.stringify(body), method: "POST", headers: { "content-type": "application/json" },
    }));
    expect(response.ok).toBe(true);
    requests.push({ body, returnedPolicy: (await response.clone().json()).question_policy });
    return response;
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function entry(comparison: boolean, capability = true) {
  return <ScreenParityPreview practiceArea="corporate" channel="website" comparison={comparison}
    externalReport={false} canRequestQuestionPolicy={capability}>
    {comparison ? <ScreenEnginePublicWidget firmId="fictional-screen-preview" firmName="Example Law Firm"
      canRequestQuestionPolicy={capability} /> : undefined}
  </ScreenParityPreview>;
}

function startEnquiry() {
  fireEvent.change(screen.getByRole("textbox", { name: "Tell us how a lawyer can help you today." }), {
    target: { value: opening },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue matter review" }));
}

async function prepareWrittenAnswer() {
  const other = screen.queryByRole("button", { name: /^Something else$/i });
  if (other) fireEvent.click(other);
  await waitFor(() => expect(document.querySelector('[data-parity-stage="questions"] textarea')).toBeTruthy());
  const field = document.querySelector<HTMLTextAreaElement>('[data-parity-stage="questions"] textarea')!;
  fireEvent.change(field, { target: { value: reply } });
  return field;
}

async function completeEnquiry() {
  for (let limit = 0; limit < 24; limit++) {
    const submit = screen.queryByRole("button", { name: "Complete fictional enquiry" });
    if (submit) {
      fireEvent.change(screen.getByRole("textbox", { name: "Full name" }), { target: { value: "Alex Example" } });
      fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "alex@example.test" } });
      await act(async () => { fireEvent.click(submit); });
      await waitFor(() => expect(document.querySelector("#parity-brief")).toBeTruthy());
      return;
    }
    const share = screen.queryByRole("button", { name: /Share my contact details/i });
    const skip = screen.queryByRole("button", { name: "Skip this question" })
      ?? screen.queryByRole("button", { name: /^Not sure$/i });
    if (!share && !skip) throw Error("The enquiry could not reach contact capture.");
    await act(async () => { fireEvent.click((share ?? skip)!); });
  }
  throw Error("The enquiry did not finish within its question budget.");
}

describe("Screen question policy rollback while a visitor uses the widget", () => {
  it.each([true, false])("keeps the admitted turn and final report after rollback, comparison=%s", async (comparison) => {
    let resolveOpening: (() => void) | undefined;
    extract.mockImplementationOnce((_text, state: EngineState) => new Promise((resolve) => {
      resolveOpening = () => resolve(extraction(state));
    }));
    const current = render(entry(comparison));
    startEnquiry();
    await waitFor(() => expect(resolveOpening).toBeTypeOf("function"));
    expect(extract.mock.calls[0][1].question_policy).toBe("grounded_v1");
    vi.stubEnv("SCREEN_PARITY_QUESTION_POLICY", "");
    await act(async () => { resolveOpening!(); });
    expect(requests[0].returnedPolicy).toBe("grounded_v1");

    const field = await prepareWrittenAnswer();
    current.rerender(entry(comparison));
    expect(field.value).toBe(reply);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Continue$/i })); });
    expect(requests[1]).toMatchObject({ body: { reply, question_policy: "grounded_v1" }, returnedPolicy: "grounded_v1" });
    await completeEnquiry();
    const settledRequests = requests.length;
    const acknowledgedChoices = requests.slice(2);
    expect(acknowledgedChoices.length).toBeGreaterThan(0);
    expect(acknowledgedChoices.some(item => item.body.review_skipped === true)).toBe(true);
    for (const acknowledgement of acknowledgedChoices) {
      expect(acknowledgement).toMatchObject({
        body: { reply: expect.any(String), review_question: expect.any(String), question_policy: "grounded_v1" },
        returnedPolicy: "grounded_v1",
      });
    }

    const savedJson = document.querySelector("#parity-submission")!.textContent!;
    const savedHtml = (document.querySelector("#parity-brief") as HTMLIFrameElement).srcdoc;
    const report = JSON.parse(savedJson);
    expect(report.brief_html).toContain(opening);
    expect(report.brief_html).toContain(reply);
    expect(report.brief_html).not.toContain('Not sure');
    expect(savedHtml).toContain(reply);
    expect(report.contact).toMatchObject({ name: "Alex Example", email: "alex@example.test" });
    vi.stubEnv("SCREEN_PARITY_QUESTION_POLICY", "grounded_v1");
    current.rerender(entry(comparison));
    vi.stubEnv("SCREEN_PARITY_QUESTION_POLICY", "");
    current.rerender(entry(comparison));
    expect(document.querySelector("#parity-submission")!.textContent).toBe(savedJson);
    expect((document.querySelector("#parity-brief") as HTMLIFrameElement).srcdoc).toBe(savedHtml);
    expect(requests).toHaveLength(settledRequests);

    current.unmount();
    const later = render(entry(comparison));
    await act(async () => { startEnquiry(); });
    expect(requests[settledRequests]).toMatchObject({ body: { question_policy: "grounded_v1" }, returnedPolicy: undefined });
    await prepareWrittenAnswer();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Continue$/i })); });
    expect(requests[settledRequests + 1].body.question_policy).toBeUndefined();
    expect(requests[settledRequests + 1].returnedPolicy).toBeUndefined();
    later.unmount();
  });

  it("keeps an already-open legacy enquiry on its original protocol after admission is enabled", async () => {
    vi.stubEnv("SCREEN_PARITY_QUESTION_POLICY", "");
    const legacy = render(entry(false, false));
    await act(async () => { startEnquiry(); });
    expect(requests[0].body.question_policy).toBeUndefined();
    await prepareWrittenAnswer();
    vi.stubEnv("SCREEN_PARITY_QUESTION_POLICY", "grounded_v1");
    legacy.rerender(entry(false, true));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Continue$/i })); });
    expect(requests[1].body).toMatchObject({ reply });
    expect(requests[1].body.question_policy).toBeUndefined();
    expect(requests[1].returnedPolicy).toBeUndefined();
  });
});
