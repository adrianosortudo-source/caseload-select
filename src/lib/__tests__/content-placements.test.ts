/**
 * content-placements.ts: I/O layer over content_placements. A minimal
 * in-memory Postgrest mock proves this module surfaces the database's own
 * scope/identity-lock trigger errors rather than swallowing or duplicating
 * that logic (the database is the actual enforcement; see
 * supabase/migrations/20260715130100_content_placements.sql).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;

const state: { placements: Row[]; nextError: string | null } = {
  placements: [],
  nextError: null,
};

function chainable(rows: Row[]) {
  let current = rows;
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      current = current.filter((r) => r[col] === val);
      return builder;
    },
    order: () => builder,
    insert: (row: Row) => {
      if (state.nextError) {
        const err = state.nextError;
        state.nextError = null;
        return {
          select: () => ({
            single: () => Promise.resolve({ data: null, error: { message: err } }),
          }),
        };
      }
      const inserted = { id: `p-${state.placements.length + 1}`, updated_at: new Date(0).toISOString(), ...row };
      state.placements.push(inserted);
      return {
        select: () => ({
          single: () => Promise.resolve({ data: inserted, error: null }),
        }),
      };
    },
    update: (patch: Row) => ({
      eq: (col: string, val: unknown) => ({
        select: () => ({
          single: () => {
            const row = current.find((r) => r[col] === val);
            if (!row) return Promise.resolve({ data: null, error: { message: "not found" } });
            Object.assign(row, patch);
            return Promise.resolve({ data: row, error: null });
          },
        }),
      }),
    }),
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: current, error: null }),
  };
  return builder;
}

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "content_placements") return chainable(state.placements);
      throw new Error(`unexpected table in mock: ${table}`);
    },
  },
}));

import { createPlacement, updatePlacement, listPlacementsForDeliverable } from "@/lib/content-placements";

const FIRM_ID = "f1111111-1111-1111-1111-111111111111";
const DELIVERABLE_ID = "d1111111-1111-1111-1111-111111111111";

beforeEach(() => {
  state.placements = [];
  state.nextError = null;
});

describe("createPlacement", () => {
  it("creates a placement and returns it", async () => {
    const result = await createPlacement({
      firmId: FIRM_ID,
      deliverableId: DELIVERABLE_ID,
      destination: "linkedin_post",
      createdByRole: "operator",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placement.destination).toBe("linkedin_post");
    expect(result.placement.firm_id).toBe(FIRM_ID);
  });

  it("surfaces the database's own ownership-scope trigger error rather than swallowing it", async () => {
    state.nextError = "content placement must reference a deliverable from the same firm";
    const result = await createPlacement({
      firmId: FIRM_ID,
      deliverableId: DELIVERABLE_ID,
      destination: "firm_website",
      createdByRole: "operator",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("same firm");
  });
});

describe("updatePlacement", () => {
  it("updates only mutable fields, never attempts to send identity fields", async () => {
    const created = await createPlacement({
      firmId: FIRM_ID,
      deliverableId: DELIVERABLE_ID,
      destination: "google_business_profile",
      createdByRole: "operator",
    });
    if (!created.ok) throw new Error("expected ok");

    const updated = await updatePlacement(created.placement.id, { state: "ready" });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.placement.state).toBe("ready");
    // Identity fields are untouched.
    expect(updated.placement.destination).toBe("google_business_profile");
    expect(updated.placement.firm_id).toBe(FIRM_ID);
  });
});

describe("listPlacementsForDeliverable", () => {
  it("returns only placements for the requested deliverable", async () => {
    await createPlacement({
      firmId: FIRM_ID,
      deliverableId: DELIVERABLE_ID,
      destination: "linkedin_post",
      createdByRole: "operator",
    });
    await createPlacement({
      firmId: FIRM_ID,
      deliverableId: "d-other",
      destination: "firm_website",
      createdByRole: "operator",
    });
    const rows = await listPlacementsForDeliverable(DELIVERABLE_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].deliverable_id).toBe(DELIVERABLE_ID);
  });
});
