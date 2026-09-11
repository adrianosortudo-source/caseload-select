import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ config: vi.fn(), lookup: vi.fn(), save: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/voice-screen-store", () => ({ liveConfig: mocks.config, inquiryByToken: mocks.lookup, saveInquiry: mocks.save }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.limit, ipFromRequest: () => "test-ip" }));

import { GET, POST } from "@/app/api/voice-screen/continue/route";
import { createVoiceScreenTestSession } from "../voice-screen-test-session";
import { ContinuationError, seedContinuationState, type ContinuationPayload, type ContinuationSession } from "../voice-screen-continuation";
import { FICTIONAL_CALL } from "../voice-screen-demo";
import { buildReport } from "../screen-engine/report";

const request = (payload?: unknown) => new NextRequest("https://example.test/api/voice-screen/continue", {
  method: payload === undefined ? "GET" : "POST",
  headers: { Authorization: `Bearer ${"a".repeat(43)}`, Origin: "https://example.test" },
  ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.test");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fixture");
  mocks.config.mockReturnValue({});
  mocks.limit.mockResolvedValue({ active: true, ok: true });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("independent caller segment", () => {
  it("runs without transport or credentials and keeps its state isolated", () => {
    const network = vi.fn(() => { throw new Error("No network expected"); });
    vi.stubGlobal("fetch", network);
    vi.stubGlobal("localStorage", { setItem: network, getItem: network });
    vi.stubGlobal("sessionStorage", { setItem: network, getItem: network });
    vi.stubEnv("V2S_ENABLED", "false");
    const a = createVoiceScreenTestSession();
    const b = createVoiceScreenTestSession();
    const first = a.getView();
    const question = first.question!;
    expect(question).not.toBeNull();
    expect(["client_name", "client_phone", ...Object.keys(FICTIONAL_CALL.capturedSlots)]).not.toContain(question.id);
    a.save({ revision: first.revision, slotId: question.id, value: "", skip: true });
    expect(a.getAnswers()).toHaveLength(1);
    expect(b.getAnswers()).toEqual([]);
    const snapshot = a.getSnapshot();
    snapshot.facts.name = "Changed outside the session";
    snapshot.answers.length = 0;
    expect(a.getSnapshot().facts.name).toBe(FICTIONAL_CALL.name);
    expect(a.getAnswers()).toHaveLength(1);
    expect(a.reset()).toEqual(first);
    expect(a.getAnswers()).toEqual([]);
    expect(network).not.toHaveBeenCalled();
  });

  it("enforces stale revisions, selected questions and answer limits without altering state", () => {
    const session = createVoiceScreenTestSession();
    const initial = session.getView();
    const question = initial.question!;
    const invalid = [
      { revision: 0, slotId: "client_phone", value: "change captured phone" },
      { revision: 0, slotId: question.id, value: "x".repeat(1501) },
      { revision: 0, slotId: question.id, value: "" },
      { revision: 0, finish: true, value: "hidden" },
      { revision: 0, finish: "true" },
    ];
    for (const payload of invalid) {
      expect(() => session.save(payload)).toThrow(ContinuationError);
      expect(session.getView()).toEqual(initial);
    }
    session.save({ revision: 0, slotId: question.id, value: "", skip: true });
    expect(() => session.save({ revision: 0, finish: true })).toThrow("refresh_required");
    expect(session.getAnswers()[0]).toMatchObject({ question: question.text, answer: "Skipped by caller", source: "screen" });
    session.save({ revision: 1, finish: true });
    expect(session.getView()).toEqual({ revision: 2, status: "completed", question: null });
    expect(() => session.save({ revision: 2, finish: true })).toThrow("refresh_required");
  });

  it("matches the authenticated API question sequence, saved answers and normal lawyer report", async () => {
    const independent = createVoiceScreenTestSession();
    let live: ContinuationSession = {
      state: seedContinuationState({
        callerName: FICTIONAL_CALL.name,
        broadNeed: FICTIONAL_CALL.situation,
        callback: { number: FICTIONAL_CALL.phone },
        capturedSlots: FICTIONAL_CALL.capturedSlots,
      }),
      revision: 0, status: "open", answers: [],
    };
    mocks.lookup.mockImplementation(async () => ({
      id: "inquiry", engine_state: live.state, revision: live.revision,
      answers: live.answers, status: live.status, token_hash: "hash",
    }));
    mocks.save.mockImplementation(async (_inquiry, state, answers, status) => {
      live = { state, answers, status, revision: live.revision + 1 };
      return true;
    });
    expect(await (await GET(request())).json()).toEqual(independent.getView());
    for (let index = 0; index < 4; index += 1) {
      const view = independent.getView();
      if (!view.question) break;
      expect(["client_name", "client_phone"]).not.toContain(view.question.id);
      const payload: ContinuationPayload = {
        revision: view.revision, slotId: view.question.id,
        value: view.question.options[0]?.value ?? "The invoice and email exchange are available.",
      };
      const response = await POST(request(payload));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(independent.save(payload));
      expect(live.answers.map(({ question, answer, source }) => ({ question, answer, source }))).toEqual(independent.getAnswers().map(({ question, answer, source }) => ({ question, answer, source })));
    }
    const payload = { revision: independent.getView().revision, finish: true };
    const response = await POST(request(payload));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(independent.save(payload));
    expect(independent.getReport()).toEqual(buildReport(live.state));
    const caller = JSON.stringify(independent.getView());
    expect(caller).not.toContain(FICTIONAL_CALL.name);
    expect(caller).not.toContain(FICTIONAL_CALL.phone);
    expect(caller).not.toContain("report");
  });
});
