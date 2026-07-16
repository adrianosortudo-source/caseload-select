/**
 * Tests for POST .../receipts/[receiptId]/verify (Workstream 6). The HTTP
 * boundary: 404s for cross-entity mismatches, the manual-attestation path
 * for LinkedIn/GBP (never auto-persists a fabricated "verified"), and the
 * automated path persisting exactly what the validator returned.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const DELIVERABLE = "d1111111-1111-1111-1111-111111111111";
const PLACEMENT = "pl111111-1111-1111-1111-111111111111";
const RECEIPT = "r1111111-1111-1111-1111-111111111111";

const state = {
  detail: null as { deliverable: { firm_id: string } } | null,
  placements: [] as Array<{ id: string; destination: string; required_artifact_type: string | null }>,
  receipt: null as {
    id: string;
    placement_id: string;
    artifact_id?: string | null;
    artifact_sha256?: string | null;
    approved_version_id?: string | null;
  } | null,
  versionRow: null as { asset_sha256: string | null } | null,
  validateResult: { outcome: "verified", method: "url_fetch", checks: {}, reason: null } as {
    outcome: string;
    method: string;
    checks: Record<string, unknown>;
    reason: string | null;
  },
  verifyReceiptArgs: null as unknown,
  validateCallArgs: null as { destination: string; receipt: unknown; opts: Record<string, unknown> } | null,
};

vi.mock("@/lib/admin-auth", () => ({
  requireOperator: () => Promise.resolve(null),
}));

vi.mock("@/lib/deliverables", () => ({
  getDeliverableDetail: () => Promise.resolve(state.detail),
}));

vi.mock("@/lib/content-placements", () => ({
  listPlacementsForDeliverable: () => Promise.resolve(state.placements),
}));

vi.mock("@/lib/publication-receipts", () => ({
  getReceiptById: () => Promise.resolve(state.receipt),
  verifyReceipt: (id: string, args: unknown) => {
    state.verifyReceiptArgs = { id, args };
    return Promise.resolve({ ok: true, receipt: { id, verification_state: "verified" } });
  },
}));

vi.mock("@/lib/channel-validation", () => ({
  validateReceiptForDestination: (destination: string, receipt: unknown, opts: Record<string, unknown>) => {
    state.validateCallArgs = { destination, receipt, opts };
    return Promise.resolve(state.validateResult);
  },
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            if (table === "intake_firms") return Promise.resolve({ data: { custom_domain: "drglaw.ca" } });
            if (table === "deliverable_versions") return Promise.resolve({ data: state.versionRow });
            return Promise.resolve({ data: null });
          },
        }),
      }),
    }),
  },
}));

import { POST } from "../route";

function makeReq(body?: unknown): NextRequest {
  return { text: async () => (body ? JSON.stringify(body) : "") } as unknown as NextRequest;
}

function params() {
  return {
    params: Promise.resolve({
      firmId: FIRM,
      deliverableId: DELIVERABLE,
      placementId: PLACEMENT,
      receiptId: RECEIPT,
    }),
  } as never;
}

beforeEach(() => {
  state.detail = { deliverable: { firm_id: FIRM } };
  state.placements = [{ id: PLACEMENT, destination: "firm_website", required_artifact_type: "webpage" }];
  state.receipt = { id: RECEIPT, placement_id: PLACEMENT };
  state.versionRow = null;
  state.validateResult = { outcome: "verified", method: "url_fetch", checks: {}, reason: null };
  state.verifyReceiptArgs = null;
  state.validateCallArgs = null;
});

describe("POST verify: expectedSha256 resolution (Workstream 2)", () => {
  it("resolves expectedSha256 from receipt.artifact_sha256 when artifact_id is set on a pdf placement", async () => {
    state.placements = [{ id: PLACEMENT, destination: "firm_website", required_artifact_type: "pdf" }];
    state.receipt = {
      id: RECEIPT,
      placement_id: PLACEMENT,
      artifact_id: "art-1",
      artifact_sha256: "a".repeat(64),
      approved_version_id: null,
    };
    await POST(makeReq(), params());
    expect(state.validateCallArgs?.opts.expectedSha256).toBe("a".repeat(64));
  });

  it("falls back to deliverable_versions.asset_sha256 when the receipt has no artifact_id", async () => {
    state.placements = [{ id: PLACEMENT, destination: "firm_website", required_artifact_type: "pdf" }];
    state.receipt = {
      id: RECEIPT,
      placement_id: PLACEMENT,
      artifact_id: null,
      artifact_sha256: null,
      approved_version_id: "v-1",
    };
    state.versionRow = { asset_sha256: "b".repeat(64) };
    await POST(makeReq(), params());
    expect(state.validateCallArgs?.opts.expectedSha256).toBe("b".repeat(64));
  });

  it("never resolves a hash for a non-pdf placement (webpage)", async () => {
    state.placements = [{ id: PLACEMENT, destination: "firm_website", required_artifact_type: "webpage" }];
    state.receipt = {
      id: RECEIPT,
      placement_id: PLACEMENT,
      artifact_id: "art-1",
      artifact_sha256: "a".repeat(64),
      approved_version_id: null,
    };
    await POST(makeReq(), params());
    expect(state.validateCallArgs?.opts.expectedSha256).toBeNull();
  });

  it("never trusts a hash supplied in the request body -- resolution is server-side only", async () => {
    state.placements = [{ id: PLACEMENT, destination: "firm_website", required_artifact_type: "pdf" }];
    state.receipt = {
      id: RECEIPT,
      placement_id: PLACEMENT,
      artifact_id: "art-1",
      artifact_sha256: "a".repeat(64),
      approved_version_id: null,
    };
    await POST(makeReq({ expectedSha256: "f".repeat(64) }), params());
    expect(state.validateCallArgs?.opts.expectedSha256).toBe("a".repeat(64));
  });

  it("missing trusted hash never silently produces a fabricated 'verified' -- the validator itself reports unverifiable and the route does not persist it", async () => {
    state.placements = [{ id: PLACEMENT, destination: "firm_website", required_artifact_type: "pdf" }];
    state.receipt = {
      id: RECEIPT,
      placement_id: PLACEMENT,
      artifact_id: null,
      artifact_sha256: null,
      approved_version_id: null,
    };
    state.validateResult = {
      outcome: "unverifiable",
      method: "url_fetch",
      checks: { sha256_checked: false },
      reason: "no trusted sha256 on file",
    };
    const res = await POST(makeReq(), params());
    const body = await res.json();
    expect(state.validateCallArgs?.opts.expectedSha256).toBeNull();
    expect(body.persisted).toBe(false);
    expect(state.verifyReceiptArgs).toBeNull();
  });
});

describe("POST verify: entity mismatches", () => {
  it("404s when the placement does not belong to this deliverable", async () => {
    state.placements = [];
    const res = await POST(makeReq(), params());
    expect(res.status).toBe(404);
  });

  it("404s when the receipt does not belong to this placement", async () => {
    state.receipt = { id: RECEIPT, placement_id: "some-other-placement" };
    const res = await POST(makeReq(), params());
    expect(res.status).toBe(404);
  });
});

describe("POST verify: automated path", () => {
  it("persists a verified result via verifyReceipt", async () => {
    const res = await POST(makeReq(), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.persisted).toBe(true);
    expect((state.verifyReceiptArgs as { args: { passed: boolean } }).args.passed).toBe(true);
  });

  it("persists a failed result when the validator fails", async () => {
    state.validateResult = { outcome: "failed", method: "url_fetch", checks: {}, reason: "HTTP 404" };
    const res = await POST(makeReq(), params());
    const body = await res.json();
    expect(body.persisted).toBe(true);
    expect((state.verifyReceiptArgs as { args: { passed: boolean } }).args.passed).toBe(false);
  });

  it("does NOT persist when the validator reports unverifiable (LinkedIn/GBP), and tells the operator to attest manually", async () => {
    state.validateResult = { outcome: "unverifiable", method: "operator_attestation", checks: {}, reason: "no API" };
    const res = await POST(makeReq(), params());
    const body = await res.json();
    expect(body.persisted).toBe(false);
    expect(state.verifyReceiptArgs).toBeNull();
    expect(body.hint).toMatch(/manualOutcome/);
  });
});

describe("POST verify: manual attestation path", () => {
  it("records an operator's manual attestation without running the automated validator", async () => {
    const res = await POST(makeReq({ manualOutcome: "verified" }), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.automated).toBe(false);
    expect((state.verifyReceiptArgs as { args: { method: string; passed: boolean } }).args.method).toBe(
      "operator_attestation",
    );
    expect((state.verifyReceiptArgs as { args: { passed: boolean } }).args.passed).toBe(true);
  });

  it("records a manual failed attestation with the operator's reason", async () => {
    const res = await POST(makeReq({ manualOutcome: "failed", manualReason: "post was deleted" }), params());
    expect(res.status).toBe(200);
    expect(
      (state.verifyReceiptArgs as { args: { failureReason: string } }).args.failureReason,
    ).toBe("post was deleted");
  });
});
