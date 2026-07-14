import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const DELIVERABLE = "22222222-2222-2222-2222-222222222222";
const VERSION = "33333333-3333-3333-3333-333333333333";

const state = {
  actor: { role: "operator", id: null, name: "Operator", email: null } as {
    role: "operator" | "lawyer";
    id: string | null;
    name: string | null;
    email: string | null;
  } | null,
  eventType: "created",
  rpcArgs: null as Record<string, unknown> | null,
  notified: false,
};

vi.mock("@/lib/deliverables-auth", () => ({
  resolveDeliverableActor: () => Promise.resolve(state.actor ? { session: {}, actor: state.actor } : null),
}));

vi.mock("@/lib/preview-guard", () => ({ denyWriteIfPreview: () => Promise.resolve(null) }));

vi.mock("@/lib/deliverables", () => ({
  getDeliverableDetail: () => Promise.resolve({
    deliverable: {
      id: DELIVERABLE,
      firm_id: FIRM,
      title: "PT lease article",
      content_kind: "text",
      current_version_id: VERSION,
      status: "in_review",
    },
    versions: [{
      id: VERSION,
      body_html: "<p>Before you sign.</p>",
      version_number: 2,
    }],
    comments: [],
    approvals: [],
    suggestions: [{
      id: "suggestion-1",
      deliverable_id: DELIVERABLE,
      version_id: VERSION,
      firm_id: FIRM,
      author_role: "lawyer",
      author_id: "lawyer-1",
      author_name: "Damaris",
      operation: "replace",
      annotation: { type: "text", start: 0, end: 6, quote: "Before" },
      original_text: "Before",
      replacement_text: "Prior to",
      rationale: "Clearer wording",
      source_body_sha256: null,
      created_at: "2026-07-13T12:00:00.000Z",
    }],
    suggestionEvents: [{
      id: "event-1",
      suggestion_id: "suggestion-1",
      firm_id: FIRM,
      event_type: state.eventType,
      actor_role: "lawyer",
      actor_id: "lawyer-1",
      note: null,
      resulting_version_id: null,
      created_at: "2026-07-13T12:00:00.000Z",
    }],
  }),
  notifyVersionReady: () => {
    state.notified = true;
    return Promise.resolve({ ok: true });
  },
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    rpc: (_name: string, args: Record<string, unknown>) => {
      state.rpcArgs = args;
      return Promise.resolve({
        data: { version_id: "44444444-4444-4444-4444-444444444444", version_number: 3 },
        error: null,
      });
    },
  },
}));

vi.mock("@/lib/deliverable-channel-post", () => ({
  postDeliverableLifecycleToChannel: () => Promise.resolve(),
}));

import { POST } from "../route";

function request() {
  return { json: () => Promise.resolve({ suggestion_ids: ["suggestion-1"] }) } as never;
}

function context() {
  return { params: Promise.resolve({ firmId: FIRM, deliverableId: DELIVERABLE }) } as never;
}

beforeEach(() => {
  state.actor = { role: "operator", id: null, name: "Operator", email: null };
  state.eventType = "created";
  state.rpcArgs = null;
  state.notified = false;
});

describe("POST apply suggestions", () => {
  it("creates the next version atomically and queues review notification", async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    expect(state.rpcArgs?.p_body_html).toBe("<p>Prior to you sign.</p>");
    expect(state.rpcArgs?.p_source_version_id).toBe(VERSION);
    expect(state.notified).toBe(true);
  });

  it("rejects lawyer application", async () => {
    state.actor = { role: "lawyer", id: "lawyer-1", name: "Damaris", email: "info@drglaw.ca" };
    const response = await POST(request(), context());
    expect(response.status).toBe(403);
    expect(state.rpcArgs).toBeNull();
  });

  it("rejects a suggestion that is no longer open", async () => {
    state.eventType = "declined";
    const response = await POST(request(), context());
    expect(response.status).toBe(409);
    expect(state.rpcArgs).toBeNull();
  });
});
