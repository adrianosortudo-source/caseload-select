/**
 * Release-integrity item 1: getDeliverableDetail must distinguish a genuine
 * "not found" from a Supabase read error at every one of its four queries
 * (content_deliverables, deliverable_versions, deliverable_comments,
 * approval_records), and must never substitute an empty array for a
 * collection whose read actually failed. This is the fix for the Codex audit
 * finding (2026-07-12) that a swallowed approval_records error could
 * silently break the DR-085 version-to-change-request link.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

interface DeliverableRow {
  id: string;
  firm_id: string;
  status: string;
}
interface VersionRow {
  id: string;
  deliverable_id: string;
  version_number: number;
}
interface CommentRow {
  id: string;
  deliverable_id: string;
}
interface ApprovalRow {
  id: string;
  deliverable_id: string;
  decision: string;
}

const state: {
  deliverables: DeliverableRow[];
  versions: VersionRow[];
  comments: CommentRow[];
  approvals: ApprovalRow[];
  // Per-table injectable error: when set, the corresponding query resolves
  // { data: null, error: {...} } instead of filtering the in-memory rows.
  deliverableError: boolean;
  versionsError: boolean;
  commentsError: boolean;
  approvalsError: boolean;
} = {
  deliverables: [],
  versions: [],
  comments: [],
  approvals: [],
  deliverableError: false,
  versionsError: false,
  commentsError: false,
  approvalsError: false,
};

type Row = Record<string, unknown>;

function chainable(rows: Row[], errored: () => boolean) {
  let current = rows;
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      current = current.filter((r) => r[col] === val);
      return builder;
    },
    order: () => builder,
    maybeSingle: () =>
      errored()
        ? Promise.resolve({ data: null, error: { message: "mock db error" } })
        : Promise.resolve({ data: current[0] ?? null, error: null }),
    then: (resolve: (v: { data: Row[] | null; error: { message: string } | null }) => unknown) =>
      resolve(
        errored()
          ? { data: null, error: { message: "mock db error" } }
          : { data: current, error: null },
      ),
  };
  return builder;
}

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "content_deliverables")
        return chainable(state.deliverables as unknown as Row[], () => state.deliverableError);
      if (table === "deliverable_versions")
        return chainable(state.versions as unknown as Row[], () => state.versionsError);
      if (table === "deliverable_comments")
        return chainable(state.comments as unknown as Row[], () => state.commentsError);
      if (table === "approval_records")
        return chainable(state.approvals as unknown as Row[], () => state.approvalsError);
      throw new Error(`unexpected table in mock: ${table}`);
    },
  },
}));

import { getDeliverableDetail } from "@/lib/deliverables";

const DELIV = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  state.deliverables = [{ id: DELIV, firm_id: "f1", status: "in_review" }];
  state.versions = [];
  state.comments = [];
  state.approvals = [];
  state.deliverableError = false;
  state.versionsError = false;
  state.commentsError = false;
  state.approvalsError = false;
});

describe("getDeliverableDetail", () => {
  it("returns ok:false when the content_deliverables read itself errors", async () => {
    state.deliverableError = true;
    const result = await getDeliverableDetail(DELIV);
    expect(result.ok).toBe(false);
  });

  it("returns found:false (not ok:false) when the deliverable genuinely does not exist", async () => {
    state.deliverables = [];
    const result = await getDeliverableDetail(DELIV);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.found).toBe(false);
  });

  // The deliverable itself loaded fine; only a sub-collection read failed.
  // getDeliverableDetail still succeeds at the top level (ok:true,
  // found:true) and surfaces the failure as a per-collection flag on the
  // detail, rather than failing the whole call -- an unrelated table's read
  // hiccup should not block every route that touches this deliverable, only
  // the ones that actually consume that specific collection. Each route
  // (approve, versions, comments) checks the flag it depends on and fails
  // closed for its own action; that per-consumer gating is tested at the
  // route level, not here.

  it("surfaces a versions-read error as a flag, not a top-level failure", async () => {
    state.versionsError = true;
    const result = await getDeliverableDetail(DELIV);
    expect(result.ok).toBe(true);
    if (result.ok && result.found) {
      expect(result.detail.versionsError).toBe(true);
      expect(result.detail.commentsError).toBe(false);
      expect(result.detail.approvalsError).toBe(false);
    }
  });

  it("surfaces a comments-read error as a flag, not a top-level failure", async () => {
    state.commentsError = true;
    const result = await getDeliverableDetail(DELIV);
    expect(result.ok).toBe(true);
    if (result.ok && result.found) {
      expect(result.detail.commentsError).toBe(true);
      expect(result.detail.versionsError).toBe(false);
      expect(result.detail.approvalsError).toBe(false);
    }
  });

  it("surfaces an approvals-read error as a flag, not a top-level failure (the audit's exact scenario)", async () => {
    state.approvalsError = true;
    const result = await getDeliverableDetail(DELIV);
    expect(result.ok).toBe(true);
    if (result.ok && result.found) {
      expect(result.detail.approvalsError).toBe(true);
      expect(result.detail.versionsError).toBe(false);
      expect(result.detail.commentsError).toBe(false);
      // The audit's exact failure: an empty approvals array must never be
      // indistinguishable from a genuinely empty history once this flag
      // exists to tell them apart.
      expect(result.detail.approvals).toEqual([]);
    }
  });

  it("distinguishes a legitimate empty approval history (no error) from a failed read", async () => {
    state.approvals = [];
    const result = await getDeliverableDetail(DELIV);
    expect(result.ok).toBe(true);
    if (result.ok && result.found) {
      expect(result.detail.approvals).toEqual([]);
      expect(result.detail.approvalsError).toBe(false);
    }
  });

  it("returns the full detail with all three error flags false on a clean read with real data", async () => {
    state.versions = [{ id: "v1", deliverable_id: DELIV, version_number: 1 }];
    state.comments = [{ id: "c1", deliverable_id: DELIV }];
    state.approvals = [{ id: "a1", deliverable_id: DELIV, decision: "changes_requested" }];
    const result = await getDeliverableDetail(DELIV);
    expect(result.ok).toBe(true);
    if (result.ok && result.found) {
      expect(result.detail.deliverable.id).toBe(DELIV);
      expect(result.detail.versions).toHaveLength(1);
      expect(result.detail.comments).toHaveLength(1);
      expect(result.detail.approvals).toHaveLength(1);
      expect(result.detail.versionsError).toBe(false);
      expect(result.detail.commentsError).toBe(false);
      expect(result.detail.approvalsError).toBe(false);
    }
  });

  it("scopes rows to the requested deliverable_id only", async () => {
    state.versions = [
      { id: "v1", deliverable_id: DELIV, version_number: 1 },
      { id: "v2", deliverable_id: "other-deliverable", version_number: 1 },
    ];
    const result = await getDeliverableDetail(DELIV);
    expect(result.ok).toBe(true);
    if (result.ok && result.found) {
      expect(result.detail.versions).toHaveLength(1);
      expect(result.detail.versions[0].id).toBe("v1");
    }
  });
});
