/**
 * listDeliverables' open_comments count must only count passage comments on
 * the article, never replies threaded under an approval_records row (the
 * change-request loop, WP-A). A minimal in-memory query mock applies the same
 * filters the real Postgrest chain would (.eq/.in/.is), so this exercises the
 * actual filter logic in deliverables.ts rather than just recording calls.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

interface DeliverableRow {
  id: string;
  firm_id: string;
  status: string;
  updated_at: string;
}
interface CommentRow {
  deliverable_id: string;
  resolved: boolean;
  approval_record_id: string | null;
}
interface VersionRow {
  deliverable_id: string;
}

const state: {
  deliverables: DeliverableRow[];
  comments: CommentRow[];
  versions: VersionRow[];
} = { deliverables: [], comments: [], versions: [] };

type Row = Record<string, unknown>;

function chainable(rows: Row[]) {
  let current = rows;
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      current = current.filter((r) => r[col] === val);
      return builder;
    },
    neq: (col: string, val: unknown) => {
      current = current.filter((r) => r[col] !== val);
      return builder;
    },
    in: (col: string, vals: unknown[]) => {
      current = current.filter((r) => vals.includes(r[col]));
      return builder;
    },
    is: (col: string, val: null) => {
      current = current.filter((r) => r[col] === val);
      return builder;
    },
    order: () => builder,
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
      resolve({ data: current, error: null }),
  };
  return builder;
}

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "content_deliverables") return chainable(state.deliverables as unknown as Row[]);
      if (table === "deliverable_comments") return chainable(state.comments as unknown as Row[]);
      if (table === "deliverable_versions") return chainable(state.versions as unknown as Row[]);
      throw new Error(`unexpected table in mock: ${table}`);
    },
  },
}));

import { listDeliverables } from "@/lib/deliverables";

beforeEach(() => {
  state.deliverables = [
    { id: "d1", firm_id: "f1", status: "in_review", updated_at: "2026-07-01T00:00:00Z" },
  ];
  state.comments = [];
  state.versions = [];
});

describe("listDeliverables: open_comments excludes approval-record replies", () => {
  it("counts unresolved passage comments (approval_record_id null)", async () => {
    state.comments = [
      { deliverable_id: "d1", resolved: false, approval_record_id: null },
      { deliverable_id: "d1", resolved: false, approval_record_id: null },
    ];
    const rows = await listDeliverables("f1");
    expect(rows[0].open_comments).toBe(2);
  });

  it("excludes an unresolved reply threaded under an approval record", async () => {
    state.comments = [
      { deliverable_id: "d1", resolved: false, approval_record_id: null },
      { deliverable_id: "d1", resolved: false, approval_record_id: "approval-1" },
    ];
    const rows = await listDeliverables("f1");
    expect(rows[0].open_comments).toBe(1);
  });

  it("a deliverable with only unresolved approval-record replies shows zero open comments", async () => {
    state.comments = [{ deliverable_id: "d1", resolved: false, approval_record_id: "approval-1" }];
    const rows = await listDeliverables("f1");
    expect(rows[0].open_comments).toBe(0);
  });
});
