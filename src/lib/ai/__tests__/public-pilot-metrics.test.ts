import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPilotMetrics } from "../public-pilot-metrics";

const { evalRedis, waitUntil } = vi.hoisted(() => ({ evalRedis: vi.fn(), waitUntil: vi.fn() }));
vi.mock("@upstash/redis", () => ({ Redis: class { eval = evalRedis; } }));
vi.mock("@vercel/functions", () => ({ waitUntil }));

const beforeMidnight = Date.parse("2026-11-17T23:59:57Z");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(beforeMidnight);
  vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test"); evalRedis.mockReset().mockResolvedValue(1); waitUntil.mockClear();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
const writes = () => evalRedis.mock.calls.map(([, [key], fields]) => [key, fields]);

describe("aggregate daily pilot metrics", () => {
  it("keeps the origin day across midnight, distinguishes fallback and counts one final outcome", () => {
    const metrics = startPilotMetrics("design", "openai", beforeMidnight);
    metrics.attempt("gemini"); metrics.attempt("openai");
    vi.setSystemTime(beforeMidnight + 4100);
    metrics.finish("degraded"); metrics.finish("failed");
    expect(writes()).toEqual([
      ["caseload:public-ai-pilot:daily:v1:2026-11-17:design:openai", ["assigned"]],
      ["caseload:public-ai-pilot:daily:v1:2026-11-17:design:gemini", ["attempted", "fallback_from_openai"]],
      ["caseload:public-ai-pilot:daily:v1:2026-11-17:design:gemini", ["degraded", "latency_ms_5000"]],
    ]);
  });
  it("recognizes a preflight failure and first-turn/finished-profile events", () => {
    startPilotMetrics("message", "gemini", beforeMidnight).finish("failed");
    const voice = startPilotMetrics("voice", "openai", beforeMidnight);
    voice.attempt("openai", true); voice.finish("completed", "voice_profile");
    expect(writes().map(r => r[1])).toEqual([
      ["assigned"], ["preflight_failed"], ["assigned"], ["attempted", "voice_first_turn"],
      ["completed", "latency_ms_1000", "voice_profile"],
    ]);
  });
  it("skips previews, fails open when storage rejects and detaches unfinished writes from the response", async () => {
    vi.stubEnv("VERCEL_ENV", "preview"); startPilotMetrics("voice", "openai", beforeMidnight);
    expect(waitUntil).not.toHaveBeenCalled();
    vi.stubEnv("VERCEL_ENV", "production"); evalRedis.mockRejectedValueOnce(new Error("store unavailable"));
    let resolve!: () => void;
    evalRedis.mockImplementationOnce(() => new Promise<void>(r => { resolve = r; }));
    const metric = startPilotMetrics("voice", "openai", beforeMidnight);
    expect(metric.attempt("openai")).toBeUndefined();
    expect(waitUntil).toHaveBeenCalledTimes(2);
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
    resolve(); await waitUntil.mock.calls[1][0];
  });
});
