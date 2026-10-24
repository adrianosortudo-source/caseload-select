import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorized: true,
  mode: "off" as "off" | "test" | "live",
  ready: false,
  dispatch: vi.fn(),
}));

vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: () => mocks.authorized }));
vi.mock("@/lib/agency-followup-send-config", () => ({
  resolveAgencyFollowupSendConfig: () => ({ mode: mocks.mode, ready: mocks.ready, maxBatchSize: 1 }),
}));
vi.mock("@/lib/agency-followup-service", () => ({ runAgencyFollowupDispatcher: mocks.dispatch }));

import { NextRequest } from "next/server";
import { GET } from "../route";

function request() {
  return new NextRequest("https://example.test/api/cron/agency-followup-dispatch");
}

describe("Agency follow-up dispatch cron route", () => {
  beforeEach(() => {
    mocks.authorized = true;
    mocks.mode = "off";
    mocks.ready = false;
    mocks.dispatch.mockReset().mockResolvedValue({
      claimed: 1, accepted: 1, retryScheduled: 0, failed: 0, unknown: 0, blocked: 0,
    });
  });

  it("requires cron authentication", async () => {
    mocks.authorized = false;
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("returns before claiming when mode is off or configuration is incomplete", async () => {
    mocks.mode = "live";
    mocks.ready = false;
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, mode: "live", dispatched: false, claimed: 0 });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("uses a generated invocation id and never accepts client target or batch controls", async () => {
    mocks.mode = "test";
    mocks.ready = true;
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.invocationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      workerId: `agency-cron:${body.invocationId}`,
    }));
    expect(mocks.dispatch.mock.calls[0][0]).not.toHaveProperty("limit");
  });
});
