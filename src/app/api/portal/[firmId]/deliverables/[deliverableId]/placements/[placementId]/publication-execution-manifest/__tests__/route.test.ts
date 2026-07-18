/**
 * Tests for GET .../placements/[placementId]/publication-execution-manifest:
 * auth gate, deliverable/placement mismatch rejection, and that a happy-path
 * response assembles manifest + preflightStatus + configuration + dryRun
 * without ever touching claim/receipt write paths.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const DELIVERABLE = "d1111111-1111-1111-1111-111111111111";
const OTHER_DELIVERABLE = "d2222222-2222-2222-2222-222222222222";
const PLACEMENT = "pl111111-1111-1111-1111-111111111111";

function readyManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "publication-execution-manifest-1.0",
    generatedAt: "2026-07-18T00:00:00.000Z",
    generatedBy: { role: "operator", id: "op-1", name: "Adriano" },
    idempotencyKey: "key",
    firmId: FIRM,
    contentPeriodId: "period-1",
    periodLifecycle: "enforced",
    deliverableId: DELIVERABLE,
    approvedVersionId: "version-1",
    versionBodyHash: "hash",
    releaseAuthorizationPath: "individual_approval",
    placementId: PLACEMENT,
    destination: "firm_website",
    destinationAccount: { configured: true, identifier: "https://drglaw.ca", note: "resolved" },
    locale: "en-CA",
    title: "Founder vesting in Ontario corporations",
    body: "<p>Body</p>",
    excerpt: "Excerpt",
    ctaTargetPath: null,
    canonicalUrl: "https://drglaw.ca/journal/founder-vesting-ontario",
    trackedUrl: "https://drglaw.ca/journal/founder-vesting-ontario?utm_content=" + PLACEMENT,
    assets: [],
    scheduledPublishDate: null,
    scheduledTimezone: null,
    destinationMetadata: { bodyLength: 4, priorReceiptVerificationState: null },
    blocked: false,
    blockReasons: [],
    ...overrides,
  };
}

const state = {
  resolvedActor: { role: "operator", id: "op-1", name: "Adriano", email: null } as {
    role: string;
    id: string | null;
    name: string | null;
    email: string | null;
  } | null,
  loadResult: { ok: true, manifest: readyManifest() } as
    | { ok: true; manifest: ReturnType<typeof readyManifest> }
    | { ok: false; error: string; status: 404 | 422 },
  loadArgs: null as unknown,
};

vi.mock("@/lib/deliverables-auth", () => ({
  resolveDeliverableActor: () => Promise.resolve(state.resolvedActor ? { actor: state.resolvedActor } : null),
}));

vi.mock("@/lib/publication-execution-manifest-loader", () => ({
  loadPublicationExecutionManifest: (firmId: string, placementId: string, generatedBy: unknown) => {
    state.loadArgs = { firmId, placementId, generatedBy };
    return Promise.resolve(state.loadResult);
  },
}));

import { GET } from "../route";

function params(deliverableId = DELIVERABLE) {
  return { params: Promise.resolve({ firmId: FIRM, deliverableId, placementId: PLACEMENT }) } as never;
}

beforeEach(() => {
  state.resolvedActor = { role: "operator", id: "op-1", name: "Adriano", email: null };
  state.loadResult = { ok: true, manifest: readyManifest() };
  state.loadArgs = null;
});

describe("GET publication-execution-manifest — auth", () => {
  it("401s with no session", async () => {
    state.resolvedActor = null;
    const res = await GET({} as NextRequest, params());
    expect(res.status).toBe(401);
  });

  it("403s for a lawyer session (operator-only)", async () => {
    state.resolvedActor = { role: "lawyer", id: "lawyer-1", name: "Damaris", email: null };
    const res = await GET({} as NextRequest, params());
    expect(res.status).toBe(403);
  });
});

describe("GET publication-execution-manifest — scoping", () => {
  it("404s when the placement's manifest deliverableId does not match the URL's deliverableId", async () => {
    const res = await GET({} as NextRequest, params(OTHER_DELIVERABLE));
    expect(res.status).toBe(404);
  });

  it("propagates the loader's own 404/422 status on failure", async () => {
    state.loadResult = { ok: false, error: "placement not found for this firm", status: 404 };
    const res = await GET({} as NextRequest, params());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("placement not found for this firm");
  });

  it("passes the resolved operator's real identity to the loader, never a hardcoded literal", async () => {
    await GET({} as NextRequest, params());
    expect(state.loadArgs).toEqual({
      firmId: FIRM,
      placementId: PLACEMENT,
      generatedBy: { role: "operator", id: "op-1", name: "Adriano" },
    });
  });
});

describe("GET publication-execution-manifest — happy path", () => {
  it("assembles manifest + preflightStatus + configuration + dryRun for a ready website placement", async () => {
    const res = await GET({} as NextRequest, params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.manifest.placementId).toBe(PLACEMENT);
    expect(body.preflightStatus.category).toBe("ready");
    expect(body.configuration.configured).toBe(true);
    expect(body.dryRun.requiresManualAction).toBe(true);
    expect(body.dryRun.summary).toContain("https://drglaw.ca/journal/founder-vesting-ontario");
  });

  it("reports blocked_missing_configuration for a LinkedIn placement with no integration configured", async () => {
    state.loadResult = {
      ok: true,
      manifest: readyManifest({
        destination: "linkedin_post",
        destinationAccount: { configured: false, identifier: null, note: "no LinkedIn account configured" },
        canonicalUrl: null,
        trackedUrl: null,
        blocked: true,
        blockReasons: ["destination not configured: no LinkedIn account configured"],
      }),
    };
    const res = await GET({} as NextRequest, params());
    const body = await res.json();
    expect(body.preflightStatus.category).toBe("blocked_missing_configuration");
    expect(body.configuration.configured).toBe(false);
  });

  it("never returns a claimId, receiptId, or any evidence of a real publish action", async () => {
    const res = await GET({} as NextRequest, params());
    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/claimId|receiptId|external_post_id.*:\s*"[^"]+"\s*,\s*"published/i);
  });
});
