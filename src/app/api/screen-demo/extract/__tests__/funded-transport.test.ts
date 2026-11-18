import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { GET, POST } from "../route";

const { ledger, send } = vi.hoisted(() => ({ ledger: vi.fn(), send: vi.fn() }));
vi.mock("@upstash/redis", () => ({ Redis: class { eval = ledger; } }));
vi.mock("@/lib/ai/openai", async original => ({
  ...await original<typeof import("@/lib/ai/openai")>(), requestOpenAI: send,
}));
vi.mock("@/lib/rate-limit", async original => ({
  ...await original<typeof import("@/lib/rate-limit")>(),
  checkRateLimit: async () => ({ ok: true }),
}));
vi.mock("@/lib/ai/public-pilot-metrics", () => ({
  startPilotMetrics: () => ({ attempt: vi.fn(), finish: vi.fn() }),
}));

const url = "https://example.test/api/screen-demo/extract";
function post(body: object, provider = "openai") {
  return POST(new Request(url, { method: "POST", headers: { "X-Screen-Demo-Provider": provider }, body: JSON.stringify(body) }));
}
const family = { description: "Fictional case. I need help separating. There is no court order.", matter_type: "family_general", family_enabled: true };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-18T00:00:00Z"));
  vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("CASELOAD_PUBLIC_TOOLS_PILOT_USD", "5");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fixture.invalid"); vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fixture");
  vi.stubEnv("SCREEN_DEMO_AI_PROVIDER", "openai"); vi.stubEnv("SCREEN_DEMO_AI_OPENAI_PERCENT", "100");
  vi.stubEnv("CASELOAD_OPENAI_API_KEY", "fixture"); vi.stubEnv("SCREEN_OPENAI_MODEL", "unrelated-private-model");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network forbidden"); }));
  ledger.mockReset().mockResolvedValue(1);
  send.mockReset().mockImplementation(async ({ format }) => ({ text: format.name === "screen_extraction" ? "{}" : '{"value":"Neither"}', inputTokens: 100, outputTokens: 10 }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it("reserves extraction, mapping and a transient retry separately; uncertain family answers stay unanswered", async () => {
  send.mockRejectedValueOnce(new Error("OpenAI request failed (503)"));
  const response = await post({ ...family, pending_slot_id: "family_existing_order", reply: "I only know about the order." });
  const result = await response.json();
  expect(result).toMatchObject({ mode: "live", attempts: 2, mapping_mode: "live" });
  expect(result.mapped_answer).toBeUndefined();
  expect(send).toHaveBeenCalledTimes(3);
  expect(send.mock.calls.map(([req]) => req.format.name).sort()).toEqual(["screen_extraction", "screen_extraction", "screen_option_map"]);
  expect(send.mock.calls.every(([req]) => req.model === "gpt-6-luna" && req.serviceTier === "default")).toBe(true);
  const holds = ledger.mock.calls.filter(([, , args]) => args.length === 4);
  expect(holds.map(([, , args]) => args[2]).sort()).toEqual([922256, 926096, 926096]);
  expect(ledger.mock.calls).toHaveLength(5); // The failed transport retains its full reservation.
});

it("stays local on wallet exhaustion, refuses changed disclosure and never calls another provider", async () => {
  expect(await (await GET(new Request(url))).json()).toEqual({ provider: "openai", available: true });
  ledger.mockResolvedValue(0);
  expect(await (await post(family)).json()).toMatchObject({ mode: "error", extracted: {}, reason: "GPT pilot capacity unavailable" });
  vi.stubEnv("SCREEN_DEMO_AI_OPENAI_PERCENT", "0");
  expect((await post(family)).status).toBe(409);
  expect(send).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
