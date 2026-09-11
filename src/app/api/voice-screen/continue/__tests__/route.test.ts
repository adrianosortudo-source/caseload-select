import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ config: vi.fn(), lookup: vi.fn(), save: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/voice-screen-store", () => ({ liveConfig: mocks.config, inquiryByToken: mocks.lookup, saveInquiry: mocks.save }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.limit, ipFromRequest: () => "test-ip" }));
import { GET, POST } from "../route";
import { seedCallState } from "@/lib/voice-screen-demo";
import { getNextStep } from "@/lib/screen-engine/control";
const token = "a".repeat(43);
const req = (body?: unknown, bearer = token) => new NextRequest("https://example.test/api/voice-screen/continue", { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${bearer}`, Origin: "https://example.test" }, ...(body ? { body: JSON.stringify(body) } : {}) });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.test"); vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test"); mocks.config.mockReturnValue({}); mocks.limit.mockResolvedValue({ active: true, ok: true }); mocks.lookup.mockResolvedValue({ id: "inquiry", revision: 0, status: "open", engine_state: seedCallState(), answers: [], token_hash: "hash" }); mocks.save.mockResolvedValue(true); });
describe("secure continuation", () => {
  it("fails closed while disabled or limiter unavailable", async () => { mocks.config.mockReturnValue(null); expect((await GET(req())).status).toBe(503); mocks.config.mockReturnValue({}); mocks.limit.mockResolvedValue({ active: false, ok: true }); expect((await GET(req())).status).toBe(503); expect(mocks.lookup).not.toHaveBeenCalled(); });
  it("rejects malformed and expired tokens without disclosing details", async () => { expect((await GET(req(undefined, "bad"))).status).toBe(404); mocks.lookup.mockResolvedValue(null); expect((await GET(req())).status).toBe(404); });
  it("returns no PII, state or report to the bearer holder", async () => { const result = await (await GET(req())).json(); expect(Object.keys(result).sort()).toEqual(["question", "revision", "status"]); expect(JSON.stringify(result)).not.toContain("Alex"); });
  it("rejects stale versions and client-selected questions", async () => { expect((await POST(req({ revision: 2, slotId: "x", value: "yes" }))).status).toBe(409); expect((await POST(req({ revision: 0, slotId: "client_phone", value: "123" }))).status).toBe(400); expect(mocks.save).not.toHaveBeenCalled(); });
  it("persists partial answers with server-selected question provenance", async () => { const slot = getNextStep(seedCallState()).slot!; const value = slot.options?.[0]?.value ?? "Yes"; const result = await POST(req({ revision: 0, slotId: slot.id, value })); expect(result.status).toBe(200); expect(mocks.save.mock.calls[0][2][0]).toMatchObject({ question: slot.question, answer: value, source: "screen" }); expect(mocks.save.mock.calls[0][3]).toBe("partial"); });
  it("rejects nonboolean flags and mixed completion payloads", async () => {
    expect((await POST(req({ revision: 0, finish: "true" }))).status).toBe(400);
    expect((await POST(req({ revision: 0, finish: true, value: "hidden" }))).status).toBe(400);
    expect((await POST(req({ revision: 0, skip: "yes", value: "" }))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("saves early completion and surfaces a concurrent takeover conflict", async () => { expect((await POST(req({ revision: 0, finish: true }))).status).toBe(200); expect(mocks.save.mock.calls[0][3]).toBe("completed"); mocks.save.mockResolvedValue(false); expect((await POST(req({ revision: 0, finish: true }))).status).toBe(409); });
});
