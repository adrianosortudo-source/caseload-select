import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = { session: null as { role: "operator" } | null };
  const plan = {
    accepted: { packageId: "pkg-evidence-001" },
    payloadSha256: "a".repeat(64),
    rejected: [] as { path: string; message: string }[],
    summary: { evidence: 1, identityMappings: 1, downtownGeography: 1, websiteIntakeFindings: 1, qualificationAssessments: 1 },
  };
  return {
    state,
    plan,
    review: vi.fn(async () => plan),
    apply: vi.fn(async () => ({ state: "applied", payloadSha256: plan.payloadSha256, packageId: plan.accepted.packageId, receipt: { id: "receipt-1" } })),
  };
});

vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: () => Promise.resolve(h.state.session) }));
vi.mock("@/lib/gta-prospect-evidence-import", () => ({
  defaultGtaProspectEvidenceSourceName: (value: unknown) => value === undefined ? "gta-operator-evidence" : value,
  buildGtaProspectEvidenceImportPlan: h.review,
}));
vi.mock("@/lib/gta-prospect-operator-evidence-import", () => ({ applyGtaProspectOperatorEvidenceImport: h.apply }));
vi.mock("@/lib/gta-prospect-research-reader", () => ({ listGtaProspectResearchForOperator: () => Promise.resolve([{ id: "gta-prospect-001" }]) }));
vi.mock("@/lib/gta-prospect-research-import", () => ({ sha256: () => Promise.resolve("c".repeat(64)) }));

import { POST, PUT } from "../route";

function request(method: "POST" | "PUT", body: unknown) {
  return new Request("https://example.test/admin/prospects/evidence-import", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  h.state.session = null;
  h.plan.rejected = [];
  h.review.mockClear();
  h.apply.mockClear();
});

describe("supplemental prospect evidence import route", () => {
  it("keeps the operator gate ahead of evidence review", async () => {
    const response = await POST(request("POST", { payload: {} }));
    expect(response.status).toBe(401);
    expect(h.review).not.toHaveBeenCalled();
  });

  it("accepts one JSON evidence package for a no-write review", async () => {
    h.state.session = { role: "operator" };
    const response = await POST(request("POST", { sourceName: "downtown-evidence", payload: { schemaVersion: "1.0.0" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: "dry_run", sourceName: "downtown-evidence", sourceSha256: "a".repeat(64), packageId: "pkg-evidence-001" });
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("rejects a stale fingerprint before the apply writer", async () => {
    h.state.session = { role: "operator" };
    const response = await PUT(request("PUT", { sourceSha256: "b".repeat(64), payload: {} }));
    expect(response.status).toBe(409);
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("blocks a package that still has rejected evidence", async () => {
    h.state.session = { role: "operator" };
    h.plan.rejected = [{ path: "evidence[0]", message: "Evidence source is missing." }];
    const response = await PUT(request("PUT", { sourceSha256: "a".repeat(64), payload: {} }));
    expect(response.status).toBe(422);
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("rechecks the package then applies only the reviewed evidence plan", async () => {
    h.state.session = { role: "operator" };
    const response = await PUT(request("PUT", { sourceName: "downtown-evidence", sourceSha256: "a".repeat(64), payload: {} }));
    expect(response.status).toBe(200);
    expect(h.apply).toHaveBeenCalledWith({ plan: h.plan });
    expect(await response.json()).toMatchObject({ mode: "applied", sourceSha256: "a".repeat(64) });
  });
});
