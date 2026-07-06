/**
 * Agency CRM (Layer B) data-layer tests.
 *
 * Verifies the service-role lib targets the expected Supabase tables on the
 * happy path, and that the update helpers return null (not throw) when no row
 * matches, so the routes can map a stale id to 404 instead of a generic 500.
 *
 * supabaseAdmin is mocked with a chainable, awaitable query stub; no network.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type QueryResult = { data: unknown; error: { message: string } | null; count?: number };
type CallRecord = {
  table: string;
  insert?: unknown;
  update?: unknown;
  eq: Array<[string, unknown]>;
  range?: [number, number];
  or?: string;
};

const h = vi.hoisted(() => {
  const calls: CallRecord[] = [];
  // `queue`, when non-empty, is consumed one result per terminal await (so a
  // multi-page range loop can be driven page by page); otherwise `result` is
  // reused for every await.
  const box: { result: QueryResult; queue: QueryResult[] } = {
    result: { data: null, error: null },
    queue: [],
  };

  function nextResult(): QueryResult {
    return box.queue.length > 0 ? (box.queue.shift() as QueryResult) : box.result;
  }

  function makeQuery(record: CallRecord): Record<string, unknown> {
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      insert: (row: unknown) => { record.insert = row; return q; },
      update: (row: unknown) => { record.update = row; return q; },
      eq: (col: string, val: unknown) => { record.eq.push([col, val]); return q; },
      order: () => q,
      range: (from: number, to: number) => { record.range = [from, to]; return q; },
      or: (expr: string) => { record.or = expr; return q; },
      single: () => Promise.resolve(nextResult()),
      maybeSingle: () => Promise.resolve(nextResult()),
      // thenable so `await q` (the list path, which has no single/maybeSingle) resolves
      then: (onF: (v: QueryResult) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(nextResult()).then(onF, onR),
    });
    return q;
  }

  const supabaseAdmin = {
    from: (table: string) => {
      const record: CallRecord = { table, eq: [] };
      calls.push(record);
      return makeQuery(record);
    },
  };

  return { calls, box, supabaseAdmin };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: h.supabaseAdmin }));

import {
  listProspects, listProspectsPage, createProspect, updateProspect,
  listDeals, createDeal, updateDeal,
  listReminders, createReminder, updateReminder,
} from "@/lib/agency-crm";

const ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  h.calls.length = 0;
  h.box.result = { data: null, error: null };
  h.box.queue = [];
});

describe("agency-crm data layer", () => {
  it("listProspects reads agency_prospects and returns rows", async () => {
    h.box.result = { data: [{ id: ID, firm_name: "Acme Law", stage: "new" }], error: null };
    const rows = await listProspects();
    expect(h.calls[0].table).toBe("agency_prospects");
    expect(rows).toHaveLength(1);
    expect(rows[0].firm_name).toBe("Acme Law");
  });

  it("createProspect inserts into agency_prospects", async () => {
    h.box.result = { data: { id: ID, firm_name: "Acme Law", stage: "new" }, error: null };
    const row = await createProspect({ firm_name: "Acme Law" });
    expect(h.calls[0].table).toBe("agency_prospects");
    expect((h.calls[0].insert as { firm_name: string }).firm_name).toBe("Acme Law");
    expect(row.id).toBe(ID);
  });

  it("updateProspect returns the row on a match and filters by id", async () => {
    h.box.result = { data: { id: ID, firm_name: "Acme Law", stage: "won" }, error: null };
    const row = await updateProspect(ID, { stage: "won" });
    expect(h.calls[0].table).toBe("agency_prospects");
    expect(h.calls[0].eq).toContainEqual(["id", ID]);
    expect(row?.stage).toBe("won");
  });

  it("updateProspect returns null when no row matches (maybeSingle)", async () => {
    h.box.result = { data: null, error: null };
    expect(await updateProspect(ID, { stage: "won" })).toBeNull();
  });

  it("listDeals reads agency_deals", async () => {
    h.box.result = { data: [], error: null };
    await listDeals();
    expect(h.calls[0].table).toBe("agency_deals");
  });

  it("createDeal inserts into agency_deals", async () => {
    h.box.result = { data: { id: ID, prospect_id: ID, title: "Retainer", stage: "proposal" }, error: null };
    const row = await createDeal({ prospect_id: ID, title: "Retainer" });
    expect(h.calls[0].table).toBe("agency_deals");
    expect(row.title).toBe("Retainer");
  });

  it("updateDeal returns null when no row matches", async () => {
    h.box.result = { data: null, error: null };
    expect(await updateDeal(ID, { stage: "won" })).toBeNull();
  });

  it("listReminders reads agency_reminders", async () => {
    h.box.result = { data: [], error: null };
    await listReminders({ openOnly: true });
    expect(h.calls[0].table).toBe("agency_reminders");
  });

  it("createReminder inserts into agency_reminders", async () => {
    h.box.result = { data: { id: ID, due_at: "2026-07-01T00:00:00Z", note: "Follow up", done: false }, error: null };
    const row = await createReminder({ due_at: "2026-07-01T00:00:00Z", note: "Follow up" });
    expect(h.calls[0].table).toBe("agency_reminders");
    expect(row.note).toBe("Follow up");
  });

  it("updateReminder returns null when no row matches", async () => {
    h.box.result = { data: null, error: null };
    expect(await updateReminder(ID, { done: true })).toBeNull();
  });

  it("surfaces a Supabase error as a thrown error", async () => {
    h.box.result = { data: null, error: { message: "boom" } };
    await expect(listProspects()).rejects.toThrow("boom");
  });

  // ── Pagination + search (Codex audit 2026-07-07, finding 4) ──────────────

  it("listProspects range-pages to completion instead of a single silently-capped select", async () => {
    // Page 1 is full (1000 rows) so the loop continues; page 2 is short (2
    // rows) so it stops. Total 1002 proves it did NOT stop at the ~1000 cap.
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({ id: `p-${i}`, firm_name: `Firm ${i}`, stage: "new" }));
    const shortPage = [{ id: "p-1000", firm_name: "Firm 1000", stage: "new" }, { id: "p-1001", firm_name: "Firm 1001", stage: "new" }];
    h.box.queue = [
      { data: fullPage, error: null },
      { data: shortPage, error: null },
    ];

    const rows = await listProspects();

    expect(rows).toHaveLength(1002);
    // Two range windows were requested: [0,999] then [1000,1999].
    const ranges = h.calls.filter((c) => c.table === "agency_prospects" && c.range).map((c) => c.range);
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
  });

  it("listProspectsPage returns a bounded page with the exact total from the head count", async () => {
    h.box.result = { data: [{ id: ID, firm_name: "Acme Law", stage: "new" }], error: null, count: 5648 };
    const page = await listProspectsPage({ limit: 25, offset: 50 });
    expect(page.total).toBe(5648);
    expect(page.limit).toBe(25);
    expect(page.offset).toBe(50);
    expect(page.items).toHaveLength(1);
    // range is offset..offset+limit-1
    expect(h.calls[0].range).toEqual([50, 74]);
  });

  it("listProspectsPage clamps an over-max limit and a negative offset", async () => {
    h.box.result = { data: [], error: null, count: 0 };
    const page = await listProspectsPage({ limit: 99999, offset: -10 });
    expect(page.limit).toBe(500); // MAX_PAGE_LIMIT
    expect(page.offset).toBe(0);
    expect(h.calls[0].range).toEqual([0, 499]);
  });

  it("listProspectsPage builds a sanitized ilike or-filter for search", async () => {
    h.box.result = { data: [], error: null, count: 0 };
    // The metacharacters ( ) , % must be neutralized so the term can't break
    // out of the or-filter grammar.
    await listProspectsPage({ search: "a(b),c%d" });
    expect(h.calls[0].or).toBe("firm_name.ilike.%a b  c d%,city.ilike.%a b  c d%,practice_area.ilike.%a b  c d%");
  });

  it("listProspectsPage omits the or-filter when search is blank", async () => {
    h.box.result = { data: [], error: null, count: 0 };
    await listProspectsPage({ search: "   " });
    expect(h.calls[0].or).toBeUndefined();
  });
});
