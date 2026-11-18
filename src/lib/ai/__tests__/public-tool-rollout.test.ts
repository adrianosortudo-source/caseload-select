import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { publicToolProvider } from "../public-tool-rollout";
import { ipFromHeaders, ipFromRequest } from "@/lib/rate-limit";

const feature = "SCREEN_DEMO_AI_PROVIDER";
const percent = "SCREEN_DEMO_AI_OPENAI_PERCENT";
const identity = (id: number) => "192.0.2." + id;
const cohort = () => Array.from({ length: 100 }, (_, i) => publicToolProvider(feature, percent, identity(i)));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T00:00:00Z"));
  vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv(feature, "openai");
  vi.stubEnv("CASELOAD_OPENAI_API_KEY", "fixture"); vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fixture.invalid");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fixture"); vi.stubEnv("CASELOAD_PUBLIC_TOOLS_PILOT_USD", "5");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it("requires explicit production funding and percentages, and keeps cohorts stable at larger percentages", () => {
  expect(publicToolProvider(feature, percent, identity(1))).toBe("gemini");
  vi.stubEnv(percent, "10"); const ten = cohort();
  expect(ten).toContain("openai"); expect(ten).toContain("gemini"); expect(cohort()).toEqual(ten);
  expect(publicToolProvider(feature, percent, "unknown")).toBe("gemini");
  vi.stubEnv(percent, "50"); const fifty = cohort();
  ten.forEach((provider, i) => { if (provider === "openai") expect(fifty[i]).toBe("openai"); });
  vi.stubEnv(percent, "100"); expect(publicToolProvider(feature, percent)).toBe("openai");
  vi.stubEnv("CASELOAD_PUBLIC_TOOLS_PILOT_USD", ""); expect(publicToolProvider(feature, percent)).toBe("gemini");
  vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv(percent, undefined);
  expect(publicToolProvider(feature, percent)).toBe("openai");
  vi.stubEnv("CASELOAD_OPENAI_PILOT_BUDGET", "true"); expect(publicToolProvider(feature, percent)).toBe("gemini");
});

it("uses the same first-party identity in server-rendered pages and their API calls", () => {
  const headers = new Headers({ "x-forwarded-for": "192.0.2.19, 192.0.2.22", "x-real-ip": "192.0.2.30" });
  expect(ipFromHeaders(headers)).toBe("192.0.2.19");
  expect(ipFromRequest(new Request("https://example.test", { headers }))).toBe(ipFromHeaders(headers));
});
