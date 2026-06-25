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

type QueryResult = { data: unknown; error: { message: string } | null };
type CallRecord = { table: string; insert?: unknown; update?: unknown; eq: Array<[string, unknown]> };

const h = vi.hoisted(() => {
  const calls: CallRecord[] = [];
  const box: { result: QueryResult } = { result: { data: null, error: null } };

  function makeQuery(record: CallRecord): Record<string, unknown> {
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      insert: (row: unknown) => { record.insert = row; return q; },
      update: (row: unknown) => { record.update = row; return q; },
      eq: (col: string, val: unknown) => { record.eq.push([col, val]); return q; },
      order: () => q,
      single: () => Promise.resolve(box.result),
      maybeSingle: () => Promise.resolve(box.result),
      // thenable so `await q` (the list path, which has no single/maybeSingle) resolves
      then: (onF: (v: QueryResult) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(box.result).then(onF, onR),
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
  listProspects, createProspect, updateProspect,
  listDeals, createDeal, updateDeal,
  listReminders, createReminder, updateReminder,
} from "@/lib/agency-crm";

const ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  h.calls.length = 0;
  h.box.result = { data: null, error: null };
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
});
