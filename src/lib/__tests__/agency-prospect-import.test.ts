/**
 * Agency CRM bulk prospect import tests.
 *
 * Covers sanitizeRow (firm_name gate, source default, fit_score clamp),
 * prospectKey, and importProspects (in-batch dedupe, invalid count, chunked
 * upsert, cross-run dedupe via the DB constraint). supabaseAdmin is mocked:
 * upsert(rows).select('id') simulates onConflict+ignoreDuplicates by
 * returning only rows whose key is not already in existingKeys, then adding
 * those keys so a later chunk within the same call also sees them as taken
 * (mirrors what the real uq_agency_prospects_dedupe_key constraint would do
 * to a second colliding chunk in the same import). There is no unpaginated
 * pre-read to mock anymore: dedupe_key is enforced entirely at the DB layer
 * plus this in-batch JS pass (Codex audit 2026-07-06, finding 4).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

function dedupeKeyOf(row: Record<string, unknown>): string {
  return `${String(row.firm_name).trim().toLowerCase()}|${String(row.city ?? "").trim().toLowerCase()}`;
}

const h = vi.hoisted(() => {
  const state: { existingKeys: Set<string>; upserted: Record<string, unknown>[]; failInsert: boolean } = {
    existingKeys: new Set<string>(),
    upserted: [],
    failInsert: false,
  };
  function makeQuery() {
    let upsertedRows: Record<string, unknown>[] | null = null;
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      upsert: (rows: Record<string, unknown>[]) => { upsertedRows = rows; return q; },
      select: () => q,
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
        if (!upsertedRows) return Promise.resolve({ data: [], error: null }).then(onF, onR);
        state.upserted.push(...upsertedRows);
        if (state.failInsert) {
          return Promise.resolve({ data: null, error: { message: "insert boom" } }).then(onF, onR);
        }
        const returned: { id: string }[] = [];
        for (const row of upsertedRows) {
          const key = dedupeKeyOf(row as Record<string, unknown>);
          if (state.existingKeys.has(key)) continue;
          state.existingKeys.add(key);
          returned.push({ id: `id-${returned.length}` });
        }
        return Promise.resolve({ data: returned, error: null }).then(onF, onR);
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
  h.state.existingKeys = new Set<string>();
  h.state.upserted = [];
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
    expect(h.state.upserted).toHaveLength(2);
    expect(h.state.upserted[0].source).toBe("import");
    expect(h.state.upserted[0].stage).toBe("new");
  });

  it("skips a row that collides with an existing prospect via the DB constraint", async () => {
    // Simulates a row already present in agency_prospects (as its dedupe_key
    // would compute): the mock's upsert returns nothing for this row, exactly
    // like ignoreDuplicates would against uq_agency_prospects_dedupe_key.
    const acmeKey = dedupeKeyOf({ firm_name: "Acme Law", city: "Toronto" });
    const betaKey = dedupeKeyOf({ firm_name: "Beta Law", city: "Markham" });
    h.state.existingKeys = new Set([acmeKey]);
    const res = await importProspects([
      { firm_name: "acme law", city: " toronto " }, // dupe (case/space-insensitive)
      { firm_name: "Beta Law", city: "Markham" },
    ]);
    expect(res).toMatchObject({ inserted: 1, skipped: 1, invalid: 0 });
    expect(h.state.upserted).toHaveLength(2); // both rows are SENT to upsert; the constraint handles the skip
    // Beta's key is now marked "existing" in the mock (it was the one that
    // was actually inserted); Acme's was already there and stays there.
    expect(h.state.existingKeys.has(betaKey)).toBe(true);
    expect(h.state.existingKeys.has(acmeKey)).toBe(true);
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
    expect(h.state.upserted).toHaveLength(501);
  });

  it("surfaces an insert error without throwing", async () => {
    h.state.failInsert = true;
    const res = await importProspects([{ firm_name: "Acme Law", city: "Toronto" }]);
    expect(res.ok).toBe(false);
    expect(res.inserted).toBe(0);
    expect(res.errors[0]).toContain("insert boom");
  });
});
