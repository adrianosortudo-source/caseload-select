import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  existingRow: null as { id: string; finalized: boolean } | null,
  readError: null as { message: string } | null,
  insertError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  inserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  finalizeUpdates: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase-admin", () => {
  function from(table: string) {
    if (table !== "web_intake_sessions") throw new Error(`unexpected table ${table}`);
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = (field: string, value: unknown) => {
      // Track the eq chain for finalize's WHERE clauses; the finalize test
      // asserts on the final update payload, not the eq calls themselves.
      void field;
      void value;
      return chain;
    };
    chain.order = () => chain;
    chain.limit = () => chain;
    chain.maybeSingle = () =>
      mocks.readError
        ? Promise.resolve({ data: null, error: mocks.readError })
        : Promise.resolve({ data: mocks.existingRow, error: null });
    chain.insert = (payload: Record<string, unknown>) => {
      mocks.inserts.push(payload);
      return mocks.insertError ? Promise.resolve({ error: mocks.insertError }) : Promise.resolve({ error: null });
    };
    chain.update = (payload: Record<string, unknown>) => {
      mocks.updates.push(payload);
      mocks.finalizeUpdates.push(payload);
      const updateChain: Record<string, unknown> = {};
      updateChain.eq = () => updateChain;
      // Terminal await resolves the whole chain; since every .eq() returns
      // updateChain, awaiting updateChain itself must resolve. Attach a
      // thenable so `await supabase.from(...).update(...).eq().eq()` works.
      (updateChain as unknown as { then: PromiseLike<unknown>["then"] }).then = (resolve) =>
        Promise.resolve({ error: mocks.updateError }).then(resolve as never);
      return updateChain;
    };
    return chain;
  }
  return { supabaseAdmin: { from } };
});

import { checkpointWebSession, finalizeWebSessionOnSubmit } from "@/lib/web-intake-session-store";
import type { EngineState } from "@/lib/screen-engine/types";

function fakeState(): EngineState {
  return { lead_id: "L-2026-07-02-ABC" } as unknown as EngineState;
}

beforeEach(() => {
  mocks.existingRow = null;
  mocks.readError = null;
  mocks.insertError = null;
  mocks.updateError = null;
  mocks.inserts = [];
  mocks.updates = [];
  mocks.finalizeUpdates = [];
});

describe("checkpointWebSession", () => {
  it("inserts a new row when no open session exists", async () => {
    const result = await checkpointWebSession({
      firmId: "firm-1",
      leadId: "L-1",
      engineState: fakeState(),
      utm_source: "google",
    });
    expect(result.ok).toBe(true);
    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0]).toMatchObject({ firm_id: "firm-1", lead_id: "L-1", utm_source: "google" });
  });

  it("updates the existing open session instead of inserting a duplicate", async () => {
    mocks.existingRow = { id: "session-1", finalized: false };
    const result = await checkpointWebSession({
      firmId: "firm-1",
      leadId: "L-1",
      engineState: fakeState(),
    });
    expect(result.ok).toBe(true);
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.updates.length).toBeGreaterThan(0);
  });

  it("skips (does not resurrect) an already-finalized session", async () => {
    mocks.existingRow = { id: "session-1", finalized: true };
    const result = await checkpointWebSession({
      firmId: "firm-1",
      leadId: "L-1",
      engineState: fakeState(),
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe("already_finalized");
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.updates).toHaveLength(0);
  });

  it("surfaces a read error without throwing", async () => {
    mocks.readError = { message: "db down" };
    const result = await checkpointWebSession({
      firmId: "firm-1",
      leadId: "L-1",
      engineState: fakeState(),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("db down");
  });

  it("surfaces an insert error without throwing", async () => {
    mocks.insertError = { message: "insert failed" };
    const result = await checkpointWebSession({
      firmId: "firm-1",
      leadId: "L-1",
      engineState: fakeState(),
    });
    expect(result.ok).toBe(false);
  });
});

describe("finalizeWebSessionOnSubmit", () => {
  it("marks the open session finalized with the screened_lead_id", async () => {
    const result = await finalizeWebSessionOnSubmit("firm-1", "L-1", "screened-row-id");
    expect(result.ok).toBe(true);
    expect(mocks.finalizeUpdates[0]).toMatchObject({
      finalized: true,
      screened_lead_id: "screened-row-id",
    });
  });

  it("surfaces an update error without throwing", async () => {
    mocks.updateError = { message: "update failed" };
    const result = await finalizeWebSessionOnSubmit("firm-1", "L-1", "screened-row-id");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("update failed");
  });
});
