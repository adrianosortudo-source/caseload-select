import { afterEach, describe, expect, it } from "vitest";

vi.mock("server-only", () => ({}));

import {
  isScreenFunnelTelemetryCollectionEnabled,
  mintScreenFunnelContextToken,
  resolveScreenFunnelTelemetryContext,
  verifyScreenFunnelContextToken,
} from "@/lib/screen-funnel-context";

const ENV_KEYS = [
  "SCREEN_FUNNEL_CONTEXT_SECRET",
  "SCREEN_FUNNEL_TELEMETRY_DEMO_ENABLED",
  "SCREEN_FUNNEL_TELEMETRY_FIRM_ALLOWLIST",
] as const;
const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
const FIRM_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = previous.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Screen funnel signed context", () => {
  it("signs and verifies only server-derived demo context", () => {
    process.env.SCREEN_FUNNEL_CONTEXT_SECRET = "test-secret";
    const token = mintScreenFunnelContextToken({ surface: "marketing_demo", firmId: null }, "test-secret", 10_000);
    expect(verifyScreenFunnelContextToken(token, 10_001)).toEqual({ surface: "marketing_demo", firmId: null });
  });

  it("rejects tampered, expired, and malformed context", () => {
    process.env.SCREEN_FUNNEL_CONTEXT_SECRET = "test-secret";
    const token = mintScreenFunnelContextToken({ surface: "firm_widget", firmId: FIRM_ID }, "test-secret", 10_000);
    expect(verifyScreenFunnelContextToken(`${token}x`, 10_001)).toBeNull();
    expect(verifyScreenFunnelContextToken(token, 10_000 + 2 * 60 * 60 * 1000)).toBeNull();
    expect(verifyScreenFunnelContextToken("not-a-token", 10_001)).toBeNull();
  });

  it("is disabled by default and fails closed if its signing secret is absent", () => {
    delete process.env.SCREEN_FUNNEL_CONTEXT_SECRET;
    process.env.SCREEN_FUNNEL_TELEMETRY_DEMO_ENABLED = "true";
    expect(isScreenFunnelTelemetryCollectionEnabled()).toBe(false);
    expect(resolveScreenFunnelTelemetryContext({ surface: "marketing_demo", firmId: null }))
      .toEqual({ telemetryEnabled: false, contextToken: null });
  });

  it("enables a signed context only for an explicit server flag or allowlisted firm", () => {
    process.env.SCREEN_FUNNEL_CONTEXT_SECRET = "test-secret";
    process.env.SCREEN_FUNNEL_TELEMETRY_DEMO_ENABLED = "true";
    process.env.SCREEN_FUNNEL_TELEMETRY_FIRM_ALLOWLIST = FIRM_ID;
    const demo = resolveScreenFunnelTelemetryContext({ surface: "marketing_demo", firmId: null });
    const widget = resolveScreenFunnelTelemetryContext({ surface: "firm_widget", firmId: FIRM_ID });
    expect(demo.telemetryEnabled).toBe(true);
    expect(widget.telemetryEnabled).toBe(true);
    expect(verifyScreenFunnelContextToken(demo.contextToken!)).toEqual({ surface: "marketing_demo", firmId: null });
    expect(verifyScreenFunnelContextToken(widget.contextToken!)).toEqual({ surface: "firm_widget", firmId: FIRM_ID });
  });
});
