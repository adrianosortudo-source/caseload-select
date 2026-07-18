/**
 * standing-publishing-authorization.ts: the RPC call shape, response
 * mapping, and canonical-text assembly. Real DB-level enforcement
 * (lawyer-only, append-only, concurrency) is proven at the database layer
 * -- scripts/verify-standing-publishing-authorization.sql, run against
 * production, and the gated concurrency integration test. This file
 * covers the I/O wrapper only.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const state = {
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
  rpcResponse: { data: null as unknown, error: null as { message: string } | null },
  tableResponses: {} as Record<string, unknown>,
};

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    rpc: (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve(state.rpcResponse);
    },
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve(state.tableResponses[table] ?? { data: null, error: null }),
        then: undefined,
      };
      return chain;
    },
  },
}));

import {
  buildStandingAuthorizationText,
  enableStandingAuthorization,
  disableStandingAuthorization,
  setDeliverableVersionIndividualReviewRequirement,
  getStandingAuthorizationState,
  STANDING_AUTHORIZATION_POLICY_VERSION,
  STANDING_AUTHORIZATION_SCOPE,
} from "../standing-publishing-authorization";

const FIRM = "f1111111-1111-1111-1111-111111111111";
const LAWYER_ACTOR = { role: "lawyer" as const, id: "law-1", name: "Damaris", email: "damaris@drglaw.ca" };

beforeEach(() => {
  state.rpcCalls = [];
  state.rpcResponse = { data: null, error: null };
  state.tableResponses = {};
});

describe("buildStandingAuthorizationText", () => {
  it("interpolates the firm name into the canonical copy", () => {
    const text = buildStandingAuthorizationText("DRG Law");
    expect(text).toContain("DRG Law content");
    expect(text).toContain("You may turn this off at any time");
    expect(text.toLowerCase()).not.toContain("blanket");
    expect(text.toLowerCase()).not.toContain("approval by damaris");
  });
});

describe("enableStandingAuthorization", () => {
  it("calls the RPC with the canonical text, policy version, and scope -- never caller-supplied text", async () => {
    state.rpcResponse = {
      data: { ok: true, event_id: "e1", event_seq: 1, event: "enabled", effective_at: "2026-07-17T00:00:00Z" },
      error: null,
    };
    await enableStandingAuthorization({
      firmId: FIRM,
      firmName: "DRG Law",
      actor: LAWYER_ACTOR,
      notificationPreference: "weekly_digest",
      ipAddress: "203.0.113.1",
      userAgent: "test-agent",
    });
    expect(state.rpcCalls).toHaveLength(1);
    const call = state.rpcCalls[0];
    expect(call.name).toBe("set_standing_publishing_authorization");
    expect(call.args).toMatchObject({
      p_firm_id: FIRM,
      p_event: "enabled",
      p_actor_role: "lawyer",
      p_actor_id: "law-1",
      p_actor_name: "Damaris",
      p_actor_email: "damaris@drglaw.ca",
      p_policy_version: STANDING_AUTHORIZATION_POLICY_VERSION,
      p_scope: STANDING_AUTHORIZATION_SCOPE,
      p_notification_preference: "weekly_digest",
    });
    expect((call.args as { p_authorization_text: string }).p_authorization_text).toContain("DRG Law content");
  });

  it("maps a successful RPC response into camelCase", async () => {
    state.rpcResponse = {
      data: { ok: true, event_id: "e1", event_seq: 3, event: "enabled", effective_at: "2026-07-17T00:00:00Z" },
      error: null,
    };
    const result = await enableStandingAuthorization({
      firmId: FIRM,
      firmName: "DRG Law",
      actor: LAWYER_ACTOR,
      notificationPreference: "weekly_digest",
      ipAddress: null,
      userAgent: null,
    });
    expect(result).toEqual({
      ok: true,
      eventId: "e1",
      eventSeq: 3,
      event: "enabled",
      effectiveAt: "2026-07-17T00:00:00Z",
    });
  });

  it("surfaces a DB-level rejection (e.g. non-lawyer actor) as ok:false, never throwing", async () => {
    state.rpcResponse = {
      data: { ok: false, error: "only an authorized firm lawyer/client decision-maker may change standing publishing authorization" },
      error: null,
    };
    const result = await enableStandingAuthorization({
      firmId: FIRM,
      firmName: "DRG Law",
      actor: LAWYER_ACTOR,
      notificationPreference: "weekly_digest",
      ipAddress: null,
      userAgent: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("lawyer");
  });
});

describe("disableStandingAuthorization", () => {
  it("sends null authorization_text/policy_version/scope/notification_preference -- a disable event grants nothing", async () => {
    state.rpcResponse = {
      data: { ok: true, event_id: "e2", event_seq: 2, event: "disabled", effective_at: "2026-07-17T01:00:00Z" },
      error: null,
    };
    await disableStandingAuthorization({
      firmId: FIRM,
      actor: LAWYER_ACTOR,
      reason: "testing",
      ipAddress: null,
      userAgent: null,
    });
    const call = state.rpcCalls[0];
    expect(call.args).toMatchObject({
      p_event: "disabled",
      p_authorization_text: null,
      p_policy_version: null,
      p_scope: null,
      p_notification_preference: null,
      p_reason: "testing",
    });
  });
});

describe("setDeliverableVersionIndividualReviewRequirement", () => {
  it("calls the RPC with the operator actor and reason", async () => {
    state.rpcResponse = {
      data: { ok: true, version_id: "v1", requires_individual_review: true },
      error: null,
    };
    const result = await setDeliverableVersionIndividualReviewRequirement({
      versionId: "v1",
      firmId: FIRM,
      required: true,
      actor: { role: "operator", id: "op-1", name: "Adriano" },
      reason: "unusual jurisdiction claim",
    });
    expect(state.rpcCalls[0].args).toMatchObject({
      p_version_id: "v1",
      p_firm_id: FIRM,
      p_required: true,
      p_actor_role: "operator",
      p_reason: "unusual jurisdiction claim",
    });
    expect(result).toEqual({ ok: true, versionId: "v1", requiresIndividualReview: true });
  });
});

describe("getStandingAuthorizationState", () => {
  it("returns null when the firm has never touched this feature", async () => {
    state.tableResponses["standing_publishing_authorizations"] = { data: null, error: null };
    const result = await getStandingAuthorizationState(FIRM);
    expect(result).toBeNull();
  });

  it("derives active:true from a latest 'enabled' event", async () => {
    state.tableResponses["standing_publishing_authorizations"] = {
      data: { id: "e1", firm_id: FIRM, event_seq: 5, event: "enabled" },
      error: null,
    };
    const result = await getStandingAuthorizationState(FIRM);
    expect(result?.active).toBe(true);
  });

  it("derives active:false from a latest 'disabled' event", async () => {
    state.tableResponses["standing_publishing_authorizations"] = {
      data: { id: "e2", firm_id: FIRM, event_seq: 6, event: "disabled" },
      error: null,
    };
    const result = await getStandingAuthorizationState(FIRM);
    expect(result?.active).toBe(false);
  });
});
