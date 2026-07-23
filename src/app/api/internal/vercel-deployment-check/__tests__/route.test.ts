/**
 * Tests for POST /api/internal/vercel-deployment-check, the production
 * deployment alarm webhook (issue #61). Covers signature rejection, event
 * and target filtering, and the schedule-background-alarm path.
 */

import crypto from "crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluateAndAlarm: vi.fn(),
}));

vi.mock("@/lib/deploy-gate/resolve", () => ({
  evaluateAndAlarm: mocks.evaluateAndAlarm,
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => {
    void p.catch(() => undefined);
  },
}));

import { POST } from "../route";

const SECRET = "test-webhook-secret";

function signedRequest(body: unknown, secretOverride = SECRET) {
  const raw = JSON.stringify(body);
  const signature = crypto.createHmac("sha1", secretOverride).update(raw).digest("hex");
  return new Request("https://app.caseloadselect.ca/api/internal/vercel-deployment-check", {
    method: "POST",
    headers: { "x-vercel-signature": signature },
    body: raw,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VERCEL_WEBHOOK_SECRET = SECRET;
  mocks.evaluateAndAlarm.mockResolvedValue(undefined);
});

describe("POST /api/internal/vercel-deployment-check", () => {
  it("rejects a request with no signature header", async () => {
    const req = new Request("https://app.caseloadselect.ca/api/internal/vercel-deployment-check", {
      method: "POST",
      body: JSON.stringify({ type: "deployment.created", payload: { deployment: { id: "dpl_1" }, target: "production" } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("rejects a request with a wrong signature", async () => {
    const req = signedRequest(
      { type: "deployment.created", payload: { deployment: { id: "dpl_1" }, target: "production" } },
      "wrong-secret",
    );
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("skips non-deployment.created events", async () => {
    const req = signedRequest({ type: "deployment.succeeded", payload: {} });
    const res = await POST(req);
    const body = await res.json();
    expect(body).toEqual({ ok: true, skipped: "not_deployment_created" });
    expect(mocks.evaluateAndAlarm).not.toHaveBeenCalled();
  });

  it("skips preview-target deployments without scheduling an alarm check", async () => {
    const req = signedRequest({
      type: "deployment.created",
      payload: { deployment: { id: "dpl_1" }, target: "preview" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body).toEqual({ ok: true, skipped: "not_production" });
    expect(mocks.evaluateAndAlarm).not.toHaveBeenCalled();
  });

  it("schedules the background alarm check for a production deployment", async () => {
    const req = signedRequest({
      type: "deployment.created",
      payload: { deployment: { id: "dpl_prod_1" }, target: "production" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, mode: "alarm" });
    expect(mocks.evaluateAndAlarm).toHaveBeenCalledWith("dpl_prod_1");
  });

  it("still returns 200 when the background alarm check itself rejects", async () => {
    mocks.evaluateAndAlarm.mockRejectedValueOnce(new Error("boom"));
    const req = signedRequest({
      type: "deployment.created",
      payload: { deployment: { id: "dpl_prod_2" }, target: "production" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, mode: "alarm" });
  });
});
