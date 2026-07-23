/**
 * Tests for POST /api/internal/vercel-deployment-check, the production
 * deployment gate webhook (issue #61). Covers signature rejection, event
 * and target filtering, and the create-check-then-background-resolve path.
 */

import crypto from "crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  createDeploymentCheck: vi.fn(),
  resolveDeployGate: vi.fn(),
}));

vi.mock("@/lib/deploy-gate/vercel-api", () => ({
  createDeploymentCheck: mocks.createDeploymentCheck,
}));

vi.mock("@/lib/deploy-gate/resolve", () => ({
  resolveDeployGate: mocks.resolveDeployGate,
  CHECK_NAME: "Production deploy gate",
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => p,
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
  mocks.createDeploymentCheck.mockResolvedValue("chk_123");
  mocks.resolveDeployGate.mockResolvedValue(undefined);
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
    expect(mocks.createDeploymentCheck).not.toHaveBeenCalled();
  });

  it("skips preview-target deployments without creating a check", async () => {
    const req = signedRequest({
      type: "deployment.created",
      payload: { deployment: { id: "dpl_1" }, target: "preview" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body).toEqual({ ok: true, skipped: "not_production" });
    expect(mocks.createDeploymentCheck).not.toHaveBeenCalled();
  });

  it("creates a blocking check and schedules background resolution for a production deployment", async () => {
    const req = signedRequest({
      type: "deployment.created",
      payload: { deployment: { id: "dpl_prod_1" }, target: "production" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, checkId: "chk_123" });
    expect(mocks.createDeploymentCheck).toHaveBeenCalledWith("dpl_prod_1", "Production deploy gate");
    expect(mocks.resolveDeployGate).toHaveBeenCalledWith("dpl_prod_1", "chk_123");
  });

  it("fails closed (502) when check creation itself fails", async () => {
    mocks.createDeploymentCheck.mockResolvedValueOnce(null);
    const req = signedRequest({
      type: "deployment.created",
      payload: { deployment: { id: "dpl_prod_2" }, target: "production" },
    });
    const res = await POST(req);
    expect(res.status).toBe(502);
    expect(mocks.resolveDeployGate).not.toHaveBeenCalled();
  });
});
