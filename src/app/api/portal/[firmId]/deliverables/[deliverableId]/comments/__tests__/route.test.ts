/**
 * Integration tests for the comment-add route
 * (POST /api/portal/[firmId]/deliverables/[deliverableId]/comments).
 *
 * Guards: auth (401), firm scope (404), the version_id must belong to this
 * deliverable (400), a non-empty body is required (400). The annotation is
 * validated by the real deliverables-pure validator (out-of-range pin coords
 * are clamped).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// The route fans the comment into the CaseLoad Connect channel; mock that
// module so the test does not pull in the real supabase-admin chain.
// vi.hoisted is required because vi.mock's factory is hoisted above this
// file's own top-level const declarations.
const channelPostMock = vi.hoisted(() => ({
  postDeliverableCommentToChannel: vi.fn(() => Promise.resolve()),
  postDeliverableLifecycleToChannel: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/deliverable-channel-post", () => channelPostMock);

const FIRM = "11111111-1111-1111-1111-111111111111";
const DELIV = "22222222-2222-2222-2222-222222222222";
const V_CUR = "33333333-3333-3333-3333-333333333333";

type Actor = { role: string; id: string | null; name: string | null; email: string | null } | null;

const state: {
  actor: Actor;
  detail: unknown;
  addArgs: Record<string, unknown> | null;
  notification: { requested: boolean; status: string; error?: string };
} = {
  actor: null,
  detail: null,
  addArgs: null,
  notification: { requested: false, status: "not_requested" },
};

vi.mock("@/lib/deliverables-auth", () => ({
  resolveDeliverableActor: () =>
    Promise.resolve(state.actor ? { session: {}, actor: state.actor } : null),
}));

vi.mock("@/lib/deliverables", () => ({
  getDeliverableDetail: () => Promise.resolve(state.detail),
  addComment: (args: Record<string, unknown>) => {
    state.addArgs = args;
    return Promise.resolve({ ok: true, comment: { id: "c1" }, notification: state.notification });
  },
}));

import { POST } from "../route";

const LAWYER: Actor = { role: "lawyer", id: "law1", name: "Damaris", email: "d@firm.ca" };
const OPERATOR: Actor = { role: "operator", id: null, name: "Operator", email: null };

const APPROVAL_1 = "55555555-5555-5555-5555-555555555555";
const V_OTHER = "66666666-6666-6666-6666-666666666666";

function makeDetail(firmId = FIRM) {
  return {
    deliverable: { id: DELIV, firm_id: firmId, title: "T" },
    versions: [
      { id: V_CUR, version_number: 1 },
      { id: V_OTHER, version_number: 2 },
    ],
    comments: [],
    approvals: [
      {
        id: APPROVAL_1,
        version_id: V_CUR,
        decision: "changes_requested",
      },
    ],
  };
}

function req(body: unknown) {
  return {
    json: async () => body,
    headers: { get: () => null },
    url: "https://app.caseloadselect.ca/x",
  } as never;
}

const params = () => ({ params: Promise.resolve({ firmId: FIRM, deliverableId: DELIV }) }) as never;

beforeEach(() => {
  state.actor = LAWYER;
  state.detail = makeDetail();
  state.addArgs = null;
  state.notification = { requested: false, status: "not_requested" };
  channelPostMock.postDeliverableCommentToChannel.mockClear();
});

describe("POST comments", () => {
  it("401 when unauthenticated", async () => {
    state.actor = null;
    const res = await POST(req({ version_id: V_CUR, body: "hi" }), params());
    expect(res.status).toBe(401);
  });

  it("404 when the deliverable is another firm's", async () => {
    state.detail = makeDetail("99999999-9999-9999-9999-999999999999");
    const res = await POST(req({ version_id: V_CUR, body: "hi" }), params());
    expect(res.status).toBe(404);
  });

  it("400 when the version_id is not part of this deliverable", async () => {
    const res = await POST(req({ version_id: "ffffffff-ffff-ffff-ffff-ffffffffffff", body: "hi" }), params());
    expect(res.status).toBe(400);
  });

  it("400 when the body is empty", async () => {
    const res = await POST(req({ version_id: V_CUR, body: "   " }), params());
    expect(res.status).toBe(400);
  });

  it("200 and clamps an out-of-range pin annotation", async () => {
    const res = await POST(
      req({ version_id: V_CUR, body: "move this up", annotation: { type: "pin", x: 1.4, y: -0.3 } }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(state.addArgs!.annotation).toEqual({ type: "pin", x: 1, y: 0 });
    expect(state.addArgs!.body).toBe("move this up");
  });

  it("200 with a null annotation (general comment) when annotation is omitted", async () => {
    const res = await POST(req({ version_id: V_CUR, body: "looks good overall" }), params());
    expect(res.status).toBe(200);
    expect(state.addArgs!.annotation).toBeNull();
  });

  it("a reply on an approval record forces version_id to the record's own version and annotation to null", async () => {
    const res = await POST(
      req({
        // client-supplied version_id and annotation must be ignored/overridden
        version_id: V_OTHER,
        annotation: { type: "pin", x: 0.5, y: 0.5 },
        body: "we tightened the disbursement figure",
        approval_record_id: APPROVAL_1,
      }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(state.addArgs!.approvalRecordId).toBe(APPROVAL_1);
    expect(state.addArgs!.versionId).toBe(V_CUR);
    expect(state.addArgs!.annotation).toBeNull();
  });

  it("400 when approval_record_id does not belong to this deliverable", async () => {
    const res = await POST(
      req({
        body: "reply",
        approval_record_id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(state.addArgs).toBeNull();
  });

  it("400 when attachments are malformed", async () => {
    const res = await POST(
      req({
        version_id: V_CUR,
        body: "see screenshot",
        attachments: [{ storage_path: "deliverables/other-firm/other-deliv/feedback/x.png", name: "x.png" }],
      }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(state.addArgs).toBeNull();
  });

  it("200 and passes through valid attachments scoped to this deliverable", async () => {
    const path = `deliverables/${FIRM}/${DELIV}/feedback/abc-shot.png`;
    const res = await POST(
      req({
        version_id: V_CUR,
        body: "see screenshot",
        attachments: [{ storage_path: path, name: "shot.png" }],
      }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(state.addArgs!.attachments).toEqual([{ storage_path: path, name: "shot.png" }]);
  });
});

describe("POST comments: client_notification_choice (fail-safe explicit opt-in)", () => {
  it("defaults to silent when the field is omitted (operator comment)", async () => {
    state.actor = OPERATOR;
    const res = await POST(req({ version_id: V_CUR, body: "looks good" }), params());
    expect(res.status).toBe(200);
    expect(state.addArgs!.clientNotificationChoice).toBe("silent");
  });

  it("passes notify_now through explicitly (operator comment)", async () => {
    state.actor = OPERATOR;
    const res = await POST(
      req({ version_id: V_CUR, body: "posted the corrected version", client_notification_choice: "notify_now" }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(state.addArgs!.clientNotificationChoice).toBe("notify_now");
  });

  it("an invalid/legacy value resolves to silent, never to notify", async () => {
    state.actor = OPERATOR;
    const res = await POST(
      req({ version_id: V_CUR, body: "looks good", client_notification_choice: "email" }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(state.addArgs!.clientNotificationChoice).toBe("silent");
  });

  it("surfaces a failed notification in the response so the UI can show the warning", async () => {
    state.actor = OPERATOR;
    state.notification = { requested: true, status: "failed", error: "outbox insert failed" };
    const res = await POST(
      req({ version_id: V_CUR, body: "looks good", client_notification_choice: "notify_now" }),
      params(),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.notification.status).toBe("failed");
  });

  it("posts to the CaseLoad Connect channel unconditionally, regardless of the notification choice", async () => {
    state.actor = OPERATOR;
    await POST(req({ version_id: V_CUR, body: "silent note" }), params());
    expect(channelPostMock.postDeliverableCommentToChannel).toHaveBeenCalledTimes(1);
    await POST(
      req({ version_id: V_CUR, body: "notify note", client_notification_choice: "notify_now" }),
      params(),
    );
    expect(channelPostMock.postDeliverableCommentToChannel).toHaveBeenCalledTimes(2);
  });

  it("still passes client_notification_choice through for a lawyer-authored comment (the lib layer decides applicability, not the route)", async () => {
    state.actor = LAWYER;
    const res = await POST(
      req({ version_id: V_CUR, body: "a reply from the lawyer", client_notification_choice: "notify_now" }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(state.addArgs!.clientNotificationChoice).toBe("notify_now");
  });
});
