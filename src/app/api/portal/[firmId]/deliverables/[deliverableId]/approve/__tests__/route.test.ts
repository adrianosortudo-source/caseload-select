/**
 * Integration tests for the sign-off route
 * (POST /api/portal/[firmId]/deliverables/[deliverableId]/approve).
 *
 * This is the compliance-critical route: the lawyer's LSO Rule 4.2-1 sign-off.
 * The guards under test:
 *   - operator cannot sign (lawyer only)            403
 *   - a lawyer with no email on file cannot sign     400
 *   - the confirmation checkbox is mandatory         400
 *   - the version signed must be the CURRENT one     409  (version-drift guard)
 *   - the frozen attestation matches the decision    (approve vs changes)
 *   - IP + user agent are captured for the record
 *
 * The data-access layer and actor resolver are mocked; the real
 * deliverables-pure attestation copy is exercised.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { APPROVAL_ATTESTATION, CHANGES_ATTESTATION } from "@/lib/deliverables-pure";

// The route posts the sign-off into the CaseLoad Connect channel; mock that
// module so the test does not pull in the real supabase-admin chain.
vi.mock("@/lib/deliverable-channel-post", () => ({
  postDeliverableCommentToChannel: vi.fn(() => Promise.resolve()),
  postDeliverableLifecycleToChannel: vi.fn(() => Promise.resolve()),
}));

vi.mock("server-only", () => ({}));

const FIRM = "11111111-1111-1111-1111-111111111111";
const DELIV = "22222222-2222-2222-2222-222222222222";
const V_CUR = "33333333-3333-3333-3333-333333333333";
const V_OLD = "44444444-4444-4444-4444-444444444444";

type Actor = { role: string; id: string | null; name: string | null; email: string | null } | null;

interface State {
  actor: Actor;
  detail: unknown;
  recordResult: { ok: true; record: unknown } | { ok: false; error: string; stale?: boolean };
  recordArgs: Record<string, unknown> | null;
}

const state: State = {
  actor: null,
  detail: null,
  recordResult: { ok: true, record: { id: "rec1" } },
  recordArgs: null,
};

vi.mock("@/lib/deliverables-auth", () => ({
  resolveDeliverableActor: () =>
    Promise.resolve(state.actor ? { session: {}, actor: state.actor } : null),
}));

vi.mock("@/lib/deliverables", () => ({
  getDeliverableDetail: () => Promise.resolve(state.detail),
  recordApproval: (args: Record<string, unknown>) => {
    state.recordArgs = args;
    return Promise.resolve(state.recordResult);
  },
}));

import { POST } from "../route";

const LAWYER: Actor = { role: "lawyer", id: "law1", name: "Damaris", email: "damaris@firm.ca" };
const OPERATOR: Actor = { role: "operator", id: null, name: "Operator", email: null };

function makeDetail(over: {
  firm_id?: string;
  current_version_id?: string | null;
  suggestions?: unknown[];
  suggestionEvents?: unknown[];
} = {}) {
  return {
    deliverable: {
      id: DELIV,
      firm_id: over.firm_id ?? FIRM,
      title: "October blog post",
      current_version_id: over.current_version_id === undefined ? V_CUR : over.current_version_id,
    },
    versions: [
      { id: V_CUR, version_number: 2 },
      { id: V_OLD, version_number: 1 },
    ],
    comments: [],
    approvals: [],
    suggestions: over.suggestions ?? [],
    suggestionEvents: over.suggestionEvents ?? [],
  };
}

function makeReq(body: unknown, headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {};
  for (const k of Object.keys(headers)) lower[k.toLowerCase()] = headers[k];
  return {
    json: async () => body,
    headers: { get: (k: string) => lower[k.toLowerCase()] ?? null },
    url: "https://app.caseloadselect.ca/x",
  } as never;
}

const params = () => ({ params: Promise.resolve({ firmId: FIRM, deliverableId: DELIV }) }) as never;

beforeEach(() => {
  state.actor = LAWYER;
  state.detail = makeDetail();
  state.recordResult = { ok: true, record: { id: "rec1" } };
  state.recordArgs = null;
});

describe("POST approve", () => {
  it("401 when there is no actor", async () => {
    state.actor = null;
    const res = await POST(makeReq({ version_id: V_CUR, decision: "approved", agreed: true }), params());
    expect(res.status).toBe(401);
  });

  it("403 when the actor is the operator (lawyer only)", async () => {
    state.actor = OPERATOR;
    const res = await POST(makeReq({ version_id: V_CUR, decision: "approved", agreed: true }), params());
    expect(res.status).toBe(403);
    expect(state.recordArgs).toBeNull();
  });

  it("400 when the lawyer has no email on file", async () => {
    state.actor = { role: "lawyer", id: "law1", name: "Damaris", email: null };
    const res = await POST(makeReq({ version_id: V_CUR, decision: "approved", agreed: true }), params());
    expect(res.status).toBe(400);
  });

  it("400 when the confirmation is not checked", async () => {
    const res = await POST(makeReq({ version_id: V_CUR, decision: "approved", agreed: false }), params());
    expect(res.status).toBe(400);
    expect(state.recordArgs).toBeNull();
  });

  it("404 when the deliverable is missing", async () => {
    state.detail = null;
    const res = await POST(makeReq({ version_id: V_CUR, decision: "approved", agreed: true }), params());
    expect(res.status).toBe(404);
  });

  it("404 when the deliverable belongs to another firm", async () => {
    state.detail = makeDetail({ firm_id: "99999999-9999-9999-9999-999999999999" });
    const res = await POST(makeReq({ version_id: V_CUR, decision: "approved", agreed: true }), params());
    expect(res.status).toBe(404);
  });

  it("409 when signing a stale (non-current) version", async () => {
    const res = await POST(makeReq({ version_id: V_OLD, decision: "approved", agreed: true }), params());
    expect(res.status).toBe(409);
    expect(state.recordArgs).toBeNull();
  });

  it("409 when no version_id is provided", async () => {
    const res = await POST(makeReq({ decision: "approved", agreed: true }), params());
    expect(res.status).toBe(409);
  });

  it("200 on approve: records the frozen approval attestation, version, IP, UA", async () => {
    const res = await POST(
      makeReq(
        { version_id: V_CUR, decision: "approved", agreed: true },
        { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "Mozilla/5.0 Test" },
      ),
      params(),
    );
    expect(res.status).toBe(200);
    expect(state.recordArgs).not.toBeNull();
    expect(state.recordArgs!.decision).toBe("approved");
    expect(state.recordArgs!.attestation).toBe(APPROVAL_ATTESTATION);
    expect(state.recordArgs!.versionNumber).toBe(2);
    expect(state.recordArgs!.ipAddress).toBe("203.0.113.7");
    expect(state.recordArgs!.userAgent).toBe("Mozilla/5.0 Test");
    expect((state.recordArgs!.signer as { email: string }).email).toBe("damaris@firm.ca");
  });

  it("200 on request-changes: uses the changes attestation", async () => {
    const res = await POST(
      makeReq({ version_id: V_CUR, decision: "changes_requested", agreed: true, note: "tighten the headline" }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(state.recordArgs!.decision).toBe("changes_requested");
    expect(state.recordArgs!.attestation).toBe(CHANGES_ATTESTATION);
    expect(state.recordArgs!.note).toBe("tighten the headline");
  });

  it("409 when approving a version with an open wording suggestion", async () => {
    state.detail = makeDetail({
      suggestions: [{ id: "suggestion-1", version_id: V_CUR }],
      suggestionEvents: [{
        id: "event-1",
        suggestion_id: "suggestion-1",
        event_type: "created",
        created_at: "2026-07-13T12:00:00.000Z",
      }],
    });
    const res = await POST(
      makeReq({ version_id: V_CUR, decision: "approved", agreed: true }),
      params(),
    );
    expect(res.status).toBe(409);
    expect(state.recordArgs).toBeNull();
  });

  it("allows request-changes while wording suggestions remain open", async () => {
    state.detail = makeDetail({
      suggestions: [{ id: "suggestion-1", version_id: V_CUR }],
      suggestionEvents: [{
        id: "event-1",
        suggestion_id: "suggestion-1",
        event_type: "created",
        created_at: "2026-07-13T12:00:00.000Z",
      }],
    });
    const res = await POST(
      makeReq({ version_id: V_CUR, decision: "changes_requested", agreed: true }),
      params(),
    );
    expect(res.status).toBe(200);
  });

  it("500 when the record write fails", async () => {
    state.recordResult = { ok: false, error: "insert failed" };
    const res = await POST(makeReq({ version_id: V_CUR, decision: "approved", agreed: true }), params());
    expect(res.status).toBe(500);
  });

  it("409 when the version goes stale during sign-off (F-04 race)", async () => {
    // Pre-check passes (version_id === current), but recordApproval's conditional
    // update finds the version superseded and reports stale.
    state.recordResult = { ok: false, stale: true, error: "a newer version exists" };
    const res = await POST(makeReq({ version_id: V_CUR, decision: "approved", agreed: true }), params());
    expect(res.status).toBe(409);
  });

  it("200 on request-changes with a valid attachment scoped to this deliverable", async () => {
    const path = `deliverables/${FIRM}/${DELIV}/feedback/abc-shot.png`;
    const res = await POST(
      makeReq({
        version_id: V_CUR,
        decision: "changes_requested",
        agreed: true,
        note: "see the attached screenshot",
        attachments: [{ storage_path: path, name: "shot.png" }],
      }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(state.recordArgs!.attachments).toEqual([{ storage_path: path, name: "shot.png" }]);
  });

  it("400 when attachments reference another deliverable's storage prefix", async () => {
    const res = await POST(
      makeReq({
        version_id: V_CUR,
        decision: "changes_requested",
        agreed: true,
        attachments: [{ storage_path: "deliverables/other-firm/other-deliv/feedback/x.png", name: "x.png" }],
      }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(state.recordArgs).toBeNull();
  });
});
