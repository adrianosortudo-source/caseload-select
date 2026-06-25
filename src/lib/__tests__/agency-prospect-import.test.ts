/**
 * Agency CRM bulk prospect import tests.
 *
 * Covers sanitizeRow (firm_name gate, source default, fit_score clamp),
 * prospectKey, and importProspects (dedupe vs existing rows and within the
 * batch, invalid count, chunked insert). supabaseAdmin is mocked: the first
 * from().select() returns the existing keys; insert().select() echoes ids.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Existing = { firm_name: string; city: string | null };

const h = vi.hoisted(() => {
  const state: { existing: Existing[]; inserted: Record<string, unknown>[]; failInsert: boolean } = {
    existing: [],
    inserted: [],
    failInsert: false,
  };
  function makeQuery() {
    let insertedRows: Record<string, unknown>[] | null = null;
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      insert: (rows: Record<string, unknown>[]) => { insertedRows = rows; return q; },
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
        if (insertedRows) {
          state.inserted.push(...insertedRows);
          const res = state.failInsert
            ? { data: null, error: { message: "insert boom" } }
            : { data: insertedRows.map((_, i) => ({ id: `id-${i}` })), error: null };
          return Promise.resolve(res).then(onF, onR);
        }
        return Promise.resolve({ data: state.existing, error: null }).then(onF, onR);
      },
    });
    return q;
  }
  return { state, supabaseAdmin: { from: () => makeQuery() } };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: h.supabaseAdmin }));

import { sanitizeRow, prospectKey, importProspects } from "@/lib/agency-prospect-import";

beforeEach(() => {
  h.state.existing = [];
  h.state.inserted = [];
  h.state.failInsert = false;
});

describe("sanitizeRow", () => {
  it("drops a row with no firm_name", () => {
    expect(sanitizeRow({ city: "Toronto" })).toBeNull();
    expect(sanitizeRow({ firm_name: "   " })).toBeNull();
    expect(sanitizeRow(null)).toBeNull();
  });

  it("defaults source to 'import' and keeps a provided source", () => {
    expect(sanitizeRow({ firm_name: "Acme" })?.source).toBe("import");
    expect(sanitizeRow({ firm_name: "Acme", source: "toronto_law_firms_db" })?.source).toBe("toronto_law_firms_db");
  });

  it("clamps fit_score to a 0-100 integer or null", () => {
    expect(sanitizeRow({ firm_name: "Acme", fit_score: 150 })?.fit_score).toBeNull();
    expect(sanitizeRow({ firm_name: "Acme", fit_score: -1 })?.fit_score).toBeNull();
    expect(sanitizeRow({ firm_name: "Acme", fit_score: 72.6 })?.fit_score).toBe(73);
    expect(sanitizeRow({ firm_name: "Acme", fit_score: "x" })?.fit_score).toBeNull();
  });

  it("ignores an invalid stage", () => {
    expect(sanitizeRow({ firm_name: "Acme", stage: "bogus" })?.stage).toBeUndefined();
    expect(sanitizeRow({ firm_name: "Acme", stage: "pitched" })?.stage).toBe("pitched");
  });
});

describe("prospectKey", () => {
  it("is case- and whitespace-insensitive on name + city", () => {
    expect(prospectKey("  Acme Law ", "Toronto")).toBe(prospectKey("acme law", "  toronto"));
    expect(prospectKey("Acme Law", "Toronto")).not.toBe(prospectKey("Acme Law", "Markham"));
  });
});

describe("importProspects", () => {
  it("inserts new rows and reports counts", async () => {
    const res = await importProspects([
      { firm_name: "Acme Law", city: "Toronto" },
      { firm_name: "Beta Law", city: "Markham" },
    ]);
    expect(res).toMatchObject({ ok: true, received: 2, inserted: 2, skipped: 0, invalid: 0 });
    expect(h.state.inserted).toHaveLength(2);
    expect(h.state.inserted[0].source).toBe("import");
    expect(h.state.inserted[0].stage).toBe("new");
  });

  it("skips rows that duplicate an existing prospect", async () => {
    h.state.existing = [{ firm_name: "Acme Law", city: "Toronto" }];
    const res = await importProspects([
      { firm_name: "acme law", city: " toronto " }, // dupe (case/space-insensitive)
      { firm_name: "Beta Law", city: "Markham" },
    ]);
    expect(res).toMatchObject({ inserted: 1, skipped: 1, invalid: 0 });
    expect(h.state.inserted).toHaveLength(1);
    expect(h.state.inserted[0].firm_name).toBe("Beta Law");
  });

  it("dedupes within the batch", async () => {
    const res = await importProspects([
      { firm_name: "Acme Law", city: "Toronto" },
      { firm_name: "Acme Law", city: "Toronto" },
    ]);
    expect(res).toMatchObject({ inserted: 1, skipped: 1 });
  });

  it("counts rows with no firm_name as invalid", async () => {
    const res = await importProspects([{ firm_name: "Acme Law" }, { city: "Toronto" }, {}]);
    expect(res).toMatchObject({ received: 3, inserted: 1, invalid: 2 });
  });

  it("inserts across chunks for a large batch", async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ firm_name: `Firm ${i}`, city: "Toronto" }));
    const res = await importProspects(rows);
    expect(res.inserted).toBe(501);
    expect(h.state.inserted).toHaveLength(501);
  });

  it("surfaces an insert error without throwing", async () => {
    h.state.failInsert = true;
    const res = await importProspects([{ firm_name: "Acme Law", city: "Toronto" }]);
    expect(res.ok).toBe(false);
    expect(res.inserted).toBe(0);
    expect(res.errors[0]).toContain("insert boom");
  });
});
