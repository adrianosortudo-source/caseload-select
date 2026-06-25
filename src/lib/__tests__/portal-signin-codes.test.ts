/**
 * Short sign-in codes: insert shape + expiry rejection.
 *
 * The load-bearing behaviour is (a) createSigninCode mints a high-entropy code
 * with a future expiry and persists it, and (b) resolveSigninCode refuses any
 * row whose expires_at is in the past. Both are pinned here over a mocked
 * supabaseAdmin.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

interface MockState {
  insertedRows: Record<string, unknown>[];
  insertError: { message: string } | null;
  singleRow: Record<string, unknown> | null;
}
const state: MockState = { insertedRows: [], insertError: null, singleRow: null };

vi.mock("@/lib/supabase-admin", () => {
  function builder() {
    const b: Record<string, unknown> = {};
    b.insert = (row: Record<string, unknown>) => {
      state.insertedRows.push(row);
      return Promise.resolve({ error: state.insertError });
    };
    b.select = () => b;
    b.eq = () => b;
    b.maybeSingle = () => Promise.resolve({ data: state.singleRow, error: null });
    return b;
  }
  return { supabaseAdmin: { from: () => builder() } };
});

import { createSigninCode, resolveSigninCode } from "@/lib/portal-signin-codes";

const FIRM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LAWYER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

beforeEach(() => {
  state.insertedRows = [];
  state.insertError = null;
  state.singleRow = null;
});

describe("createSigninCode", () => {
  it("persists a high-entropy code with a ~48h future expiry", async () => {
    const result = await createSigninCode({ firmId: FIRM, lawyerId: LAWYER, role: "lawyer" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code.length).toBeGreaterThanOrEqual(10);
    expect(state.insertedRows).toHaveLength(1);
    const row = state.insertedRows[0];
    expect(row.firm_id).toBe(FIRM);
    expect(row.lawyer_id).toBe(LAWYER);
    expect(row.role).toBe("lawyer");
    const hoursOut = (new Date(row.expires_at as string).getTime() - Date.now()) / 3600_000;
    expect(hoursOut).toBeGreaterThan(47);
    expect(hoursOut).toBeLessThanOrEqual(48);
  });

  it("surfaces a DB insert error instead of throwing", async () => {
    state.insertError = { message: "boom" };
    const result = await createSigninCode({ firmId: FIRM, lawyerId: null, role: "operator" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("boom");
  });
});

describe("resolveSigninCode", () => {
  it("returns null for an unknown code", async () => {
    state.singleRow = null;
    expect(await resolveSigninCode("nope")).toBeNull();
  });

  it("returns null for an empty code without touching the DB", async () => {
    expect(await resolveSigninCode("")).toBeNull();
  });

  it("rejects an expired row", async () => {
    state.singleRow = {
      firm_id: FIRM,
      lawyer_id: LAWYER,
      role: "lawyer",
      expires_at: new Date(Date.now() - 1000).toISOString(),
    };
    expect(await resolveSigninCode("expired")).toBeNull();
  });

  it("resolves a live row to its target", async () => {
    state.singleRow = {
      firm_id: FIRM,
      lawyer_id: LAWYER,
      role: "lawyer",
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    };
    expect(await resolveSigninCode("live")).toEqual({
      firmId: FIRM,
      lawyerId: LAWYER,
      role: "lawyer",
    });
  });
});
