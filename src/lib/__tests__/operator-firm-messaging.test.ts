/**
 * CaseLoad Connect: unread math, participant keys, and route auth gates.
 *
 * The send/edit/delete I/O paths are thin wrappers over supabaseAdmin; the
 * load-bearing logic worth pinning is (a) the unread "other side" role
 * mapping, (b) the participant key per actor, and (c) that every route
 * rejects an unauthenticated caller before touching the data layer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// ── Mutable mock state for supabaseAdmin ────────────────────────────────────
interface MockState {
  lawyerMessages: { firm_id: string; created_at: string }[];
  operatorReads: { firm_id: string; last_read_at: string }[];
}
const state: MockState = { lawyerMessages: [], operatorReads: [] };

vi.mock("@/lib/supabase-admin", () => {
  // A thenable query builder. Chain methods return `this`; awaiting resolves
  // to { data } chosen by the table the chain started on.
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "gt", "order", "limit", "maybeSingle", "single", "upsert", "insert", "update"]) {
      b[m] = () => b;
    }
    b.then = (resolve: (v: { data: unknown; count: number }) => unknown) => {
      const data =
        table === "operator_firm_messages"
          ? state.lawyerMessages
          : table === "operator_firm_channel_reads"
          ? state.operatorReads
          : [];
      return Promise.resolve({ data, count: 0 }).then(resolve);
    };
    return b;
  }
  return { supabaseAdmin: { from: (table: string) => builder(table) } };
});

let sessionState: { operator: unknown; firm: unknown } = { operator: null, firm: null };
vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(sessionState.operator),
  getFirmSession: () => Promise.resolve(sessionState.firm),
}));

import { participantKey, getOperatorUnreadByFirm, sendFirmMessage } from "@/lib/operator-firm-messaging";
import { resolveLawyerActor } from "@/lib/operator-firm-messaging-handlers";

const FIRM_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const FIRM_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

beforeEach(() => {
  state.lawyerMessages = [];
  state.operatorReads = [];
  sessionState = { operator: null, firm: null };
});

describe("participantKey", () => {
  it("operator collapses to the shared operator key", () => {
    expect(participantKey({ role: "operator", id: "operator", name: "CaseLoad" })).toBe("operator");
  });
  it("lawyer keys on the lawyer id", () => {
    expect(participantKey({ role: "lawyer", id: "law-1", name: "Damaris" })).toBe("law-1");
  });
});

describe("getOperatorUnreadByFirm", () => {
  it("counts lawyer messages newer than the operator's last_read per firm", async () => {
    state.lawyerMessages = [
      { firm_id: FIRM_A, created_at: "2026-06-24T10:00:00Z" }, // before read -> not unread
      { firm_id: FIRM_A, created_at: "2026-06-24T12:00:00Z" }, // after read  -> unread
      { firm_id: FIRM_B, created_at: "2026-06-24T09:00:00Z" }, // no read row -> unread
    ];
    state.operatorReads = [{ firm_id: FIRM_A, last_read_at: "2026-06-24T11:00:00Z" }];

    const counts = await getOperatorUnreadByFirm();
    expect(counts.get(FIRM_A)).toBe(1);
    expect(counts.get(FIRM_B)).toBe(1);
  });

  it("is empty when there are no lawyer messages", async () => {
    const counts = await getOperatorUnreadByFirm();
    expect(counts.size).toBe(0);
  });
});

describe("security guards (audit fixes)", () => {
  it("H-1: resolveLawyerActor returns null without a lawyer id (no shared sentinel identity)", async () => {
    expect(await resolveLawyerActor(FIRM_A, null)).toBe(null);
    expect(await resolveLawyerActor(FIRM_A, undefined)).toBe(null);
  });

  it("M-1: sendFirmMessage rejects an attachment path outside the firm prefix", async () => {
    const res = await sendFirmMessage({
      firmId: FIRM_A,
      actor: { role: "operator", id: "operator", name: "CaseLoad" },
      body: "",
      attachments: [{ storage_path: `firm-messages/${FIRM_B}/steal.pdf`, name: "x" }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid attachment path");
  });

  it("M-1: sendFirmMessage rejects an arbitrary bucket path", async () => {
    const res = await sendFirmMessage({
      firmId: FIRM_A,
      actor: { role: "operator", id: "operator", name: "CaseLoad" },
      body: "hi",
      attachments: [{ storage_path: `deliverables/${FIRM_B}/secret.pdf`, name: "x" }],
    });
    expect(res.ok).toBe(false);
  });
});

describe("route auth gates", () => {
  it("operator messages GET 401s without an operator session", async () => {
    const { GET } = await import("@/app/api/admin/firms/[firmId]/messages/route");
    const res = await GET({} as never, { params: Promise.resolve({ firmId: FIRM_A }) });
    expect(res.status).toBe(401);
  });

  it("lawyer messages GET 401s without a firm session", async () => {
    const { GET } = await import("@/app/api/portal/[firmId]/messages/route");
    const res = await GET({} as never, { params: Promise.resolve({ firmId: FIRM_A }) });
    expect(res.status).toBe(401);
  });

  it("operator message edit 401s without an operator session", async () => {
    const { PATCH } = await import("@/app/api/admin/firms/[firmId]/messages/[messageId]/route");
    const res = await PATCH({} as never, {
      params: Promise.resolve({ firmId: FIRM_A, messageId: "m-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("operator message action (react/pin) 401s without an operator session", async () => {
    const { POST } = await import("@/app/api/admin/firms/[firmId]/messages/[messageId]/action/route");
    const res = await POST({} as never, {
      params: Promise.resolve({ firmId: FIRM_A, messageId: "m-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("lawyer message action (react/pin) 401s without a firm session", async () => {
    const { POST } = await import("@/app/api/portal/[firmId]/messages/[messageId]/action/route");
    const res = await POST({} as never, {
      params: Promise.resolve({ firmId: FIRM_A, messageId: "m-1" }),
    });
    expect(res.status).toBe(401);
  });
});
