/**
 * addVersion / addComment: the explicit client-notification opt-in.
 *
 * Silent is the fail-safe default: no `notification_outbox` row is inserted,
 * `review_notified_at` is never stamped, unless the caller passes
 * clientNotificationChoice: "notify_now" literally. Persistence (the version
 * or comment row) always succeeds independent of whether the notification
 * enqueue succeeds, fails, or never runs.
 *
 * A minimal in-memory Supabase mock backs `deliverable_versions`,
 * `content_deliverables`, `deliverable_comments`, `firm_lawyers`, and
 * `notification_outbox`, exercising the real filter/insert/update logic in
 * deliverables.ts rather than just recording call arguments.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;

interface MockTable {
  rows: Row[];
  insertError: { message: string } | null;
}

function freshTable(): MockTable {
  return { rows: [], insertError: null };
}

const db = {
  deliverable_versions: freshTable(),
  content_deliverables: freshTable(),
  deliverable_comments: freshTable(),
  firm_lawyers: freshTable(),
  notification_outbox: freshTable(),
};

type TableName = keyof typeof db;

function builder(tableName: TableName) {
  const t = db[tableName];
  let filtered = t.rows;
  let pendingInsert: Row[] | null = null;

  const b: {
    select: (cols?: string) => typeof b;
    eq: (col: string, val: unknown) => typeof b;
    order: (col: string, opts?: { ascending?: boolean }) => typeof b;
    limit: (n: number) => typeof b;
    maybeSingle: () => Promise<{ data: Row | null; error: null }>;
    single: () => Promise<{ data: Row | null; error: { message: string } | null }>;
    insert: (rowOrRows: Row | Row[]) => typeof b;
    update: (patch: Row) => { eq: (col: string, val: unknown) => Promise<{ error: null }> };
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => unknown;
  } = {
    select: () => b,
    eq: (col, val) => {
      filtered = filtered.filter((r) => r[col] === val);
      return b;
    },
    order: (col, opts) => {
      const asc = opts?.ascending !== false;
      filtered = [...filtered].sort((a, c) => {
        const av = (a[col] as number) ?? 0;
        const cv = (c[col] as number) ?? 0;
        return asc ? av - cv : cv - av;
      });
      return b;
    },
    limit: (n) => {
      filtered = filtered.slice(0, n);
      return b;
    },
    maybeSingle: () => Promise.resolve({ data: filtered[0] ?? null, error: null }),
    single: () => {
      if (pendingInsert) {
        if (t.insertError) return Promise.resolve({ data: null, error: t.insertError });
        const row = pendingInsert[0];
        t.rows.push(row);
        return Promise.resolve({ data: row, error: null });
      }
      return Promise.resolve({ data: filtered[0] ?? null, error: null });
    },
    insert: (rowOrRows) => {
      pendingInsert = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
      (b as unknown as { then: unknown }).then = (resolve: (v: { error: { message: string } | null }) => unknown) => {
        if (t.insertError) return resolve({ error: t.insertError });
        t.rows.push(...pendingInsert!);
        return resolve({ error: null });
      };
      return b;
    },
    update: (patch) => ({
      eq: (col, val) => {
        t.rows.filter((r) => r[col] === val).forEach((r) => Object.assign(r, patch));
        return Promise.resolve({ error: null });
      },
    }),
    then: (resolve) => resolve({ data: filtered, error: null }),
  };
  return b;
}

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (tableName: TableName) => builder(tableName),
  },
}));

vi.mock("@/lib/publication-readiness", () => ({
  evaluateActivationPreflight: () => ({}),
}));
vi.mock("@/lib/publication-readiness-loader", () => ({
  loadPeriodPublicationReadiness: () => Promise.resolve(null),
}));

import { addVersion, addComment } from "@/lib/deliverables";

const FIRM = "11111111-1111-1111-1111-111111111111";
const DELIV = "22222222-2222-2222-2222-222222222222";
const VERSION = "33333333-3333-3333-3333-333333333333";
const OPERATOR_EMAIL = "adriano@caseloadselect.ca";

const OPERATOR = { role: "operator" as const, id: null, name: "Operator", email: null };
const LAWYER = { role: "lawyer" as const, id: "law-1", name: "Damaris", email: "damaris@firm.ca" };

beforeEach(() => {
  db.deliverable_versions = freshTable();
  db.content_deliverables = freshTable();
  db.deliverable_comments = freshTable();
  db.firm_lawyers = freshTable();
  db.notification_outbox = freshTable();

  db.content_deliverables.rows = [
    { id: DELIV, firm_id: FIRM, title: "Journal article", status: "in_review" },
  ];
  db.firm_lawyers.rows = [
    { firm_id: FIRM, email: "damaris@firm.ca", email_notifications_enabled: true, disabled: false },
  ];
});

function versionInput(overrides: Partial<Parameters<typeof addVersion>[0]> = {}) {
  return {
    deliverableId: DELIV,
    firmId: FIRM,
    bodyHtml: "<p>hello</p>",
    storagePath: null,
    assetMime: null,
    assetSizeBytes: null,
    assetName: null,
    note: null,
    actor: OPERATOR,
    ...overrides,
  };
}

describe("addVersion: client-notification choice", () => {
  it("silent by default (choice omitted): persists the version, no outbox row, no review_notified_at stamp", async () => {
    const result = await addVersion(versionInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notification).toEqual({ requested: false, status: "not_requested" });
    expect(db.notification_outbox.rows).toHaveLength(0);
    expect(db.deliverable_versions.rows).toHaveLength(1);
    expect(db.content_deliverables.rows[0].review_notified_at).toBeUndefined();
  });

  it("an invalid/legacy choice resolves to silent, never to notify", async () => {
    const result = await addVersion(
      versionInput({ clientNotificationChoice: "true" as never }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notification.status).toBe("not_requested");
    expect(db.notification_outbox.rows).toHaveLength(0);
  });

  it("notify_now persists the version first, then sends exactly one notification", async () => {
    const result = await addVersion(versionInput({ clientNotificationChoice: "notify_now" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(db.deliverable_versions.rows).toHaveLength(1);
    expect(result.notification).toEqual({ requested: true, status: "sent" });
    expect(db.notification_outbox.rows).toHaveLength(1);
    expect(db.notification_outbox.rows[0].recipient_email).toBe("damaris@firm.ca");
    expect(db.content_deliverables.rows[0].review_notified_at).toBeTruthy();
  });

  it("email failure leaves the version intact and reports the failure without throwing", async () => {
    db.notification_outbox.insertError = { message: "outbox insert failed" };
    const result = await addVersion(versionInput({ clientNotificationChoice: "notify_now" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(db.deliverable_versions.rows).toHaveLength(1); // still persisted
    expect(result.notification.status).toBe("failed");
    expect(result.notification.error).toContain("outbox insert failed");
    // review_notified_at is only stamped after a successful enqueue.
    expect(db.content_deliverables.rows[0].review_notified_at).toBeUndefined();
  });

  it("assigns increasing version numbers regardless of the notification choice", async () => {
    const first = await addVersion(versionInput());
    const second = await addVersion(versionInput({ clientNotificationChoice: "notify_now" }));
    expect(first.ok && first.version.version_number).toBe(1);
    expect(second.ok && second.version.version_number).toBe(2);
  });
});

function commentInput(overrides: Partial<Parameters<typeof addComment>[0]> = {}) {
  return {
    deliverableId: DELIV,
    versionId: VERSION,
    firmId: FIRM,
    annotation: null,
    body: "looks good",
    parentCommentId: null,
    actor: OPERATOR,
    ...overrides,
  };
}

describe("addComment: client-notification choice (operator-authored)", () => {
  it("silent by default: persists the comment, no outbox row", async () => {
    const result = await addComment(commentInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notification).toEqual({ requested: false, status: "not_requested" });
    expect(db.notification_outbox.rows).toHaveLength(0);
    expect(db.deliverable_comments.rows).toHaveLength(1);
  });

  it("an invalid/legacy choice resolves to silent", async () => {
    const result = await addComment(commentInput({ clientNotificationChoice: "email" as never }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notification.status).toBe("not_requested");
    expect(db.notification_outbox.rows).toHaveLength(0);
  });

  it("notify_now sends exactly one notification to the firm's lawyers", async () => {
    const result = await addComment(commentInput({ clientNotificationChoice: "notify_now" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notification).toEqual({ requested: true, status: "sent" });
    expect(db.notification_outbox.rows).toHaveLength(1);
    expect(db.notification_outbox.rows[0].recipient_email).toBe("damaris@firm.ca");
  });

  it("email failure leaves the comment intact and reports the failure", async () => {
    db.notification_outbox.insertError = { message: "outbox insert failed" };
    const result = await addComment(commentInput({ clientNotificationChoice: "notify_now" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(db.deliverable_comments.rows).toHaveLength(1); // still persisted
    expect(result.notification.status).toBe("failed");
  });
});

describe("addComment: lawyer/client-authored comments are unchanged (out of scope)", () => {
  it("always notifies the operator, regardless of an omitted client_notification_choice", async () => {
    const result = await addComment(
      commentInput({ actor: LAWYER, clientNotificationChoice: undefined }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(db.notification_outbox.rows).toHaveLength(1);
    expect(db.notification_outbox.rows[0].recipient_email).toBe(OPERATOR_EMAIL);
    // Scoped to the CLIENT-notification feature: nothing was "requested" on
    // that axis even though the pre-existing operator ping still fired.
    expect(result.notification).toEqual({ requested: false, status: "not_requested" });
  });

  it("does not double-send when client_notification_choice is explicitly notify_now (that field does not apply to this actor)", async () => {
    const result = await addComment(
      commentInput({ actor: LAWYER, clientNotificationChoice: "notify_now" }),
    );
    expect(result.ok).toBe(true);
    expect(db.notification_outbox.rows).toHaveLength(1);
  });

  it("still notifies the operator when client_notification_choice is explicitly silent", async () => {
    const result = await addComment(
      commentInput({ actor: LAWYER, clientNotificationChoice: "silent" }),
    );
    expect(result.ok).toBe(true);
    expect(db.notification_outbox.rows).toHaveLength(1);
    expect(db.notification_outbox.rows[0].recipient_email).toBe(OPERATOR_EMAIL);
  });
});
