/**
 * Tests for lib/channel-message-dedup (launch audit H1).
 *
 * The claim is INSERT ... ON CONFLICT DO NOTHING via supabase-js upsert
 * with ignoreDuplicates. Coverage:
 *
 *   - First claim inserts and returns claimed (process).
 *   - Conflict swallowed (zero returned rows) reads as duplicate (skip).
 *   - A raw 23505 from the DB reads as duplicate, not as an error.
 *   - Any other DB error fails open: process, reason claim_error.
 *   - Missing/blank mid skips the claim entirely (no DB call, process).
 *
 * Release (the crash-path counterpart):
 *   - Deletes the claim row keyed on firm_id + channel + trimmed mid.
 *   - Missing/blank mid skips the delete entirely (no DB call).
 *   - A DB error is logged, never thrown (best-effort).
 *   - A thrown exception is swallowed, never propagated (best-effort).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      upsert: (payload: Record<string, unknown>, opts: Record<string, unknown>) => ({
        select: (_cols: string) => mocks.upsert(table, payload, opts),
      }),
      delete: () => ({
        eq: (c1: string, v1: unknown) => ({
          eq: (c2: string, v2: unknown) => ({
            eq: (c3: string, v3: unknown) =>
              mocks.del(table, { [c1]: v1, [c2]: v2, [c3]: v3 }),
          }),
        }),
      }),
    }),
  },
}));

import {
  claimChannelMessage,
  releaseChannelMessageClaim,
} from "../channel-message-dedup";

beforeEach(() => {
  mocks.upsert.mockReset();
  mocks.del.mockReset();
  mocks.del.mockResolvedValue({ error: null });
});

describe("claimChannelMessage", () => {
  it("returns claimed (process) when the insert lands", async () => {
    mocks.upsert.mockResolvedValue({ data: [{ id: "row-1" }], error: null });
    const result = await claimChannelMessage({
      firmId: "11111111-1111-1111-1111-111111111111",
      channel: "whatsapp",
      messageMid: "wamid.first",
    });
    expect(result).toEqual({ duplicate: false, reason: "claimed" });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const [table, payload, opts] = mocks.upsert.mock.calls[0] as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(table).toBe("processed_channel_messages");
    expect(payload).toEqual({
      firm_id: "11111111-1111-1111-1111-111111111111",
      channel: "whatsapp",
      message_mid: "wamid.first",
    });
    expect(opts).toEqual({
      onConflict: "firm_id,channel,message_mid",
      ignoreDuplicates: true,
    });
  });

  it("returns duplicate (skip) when the conflict was swallowed and zero rows came back", async () => {
    mocks.upsert.mockResolvedValue({ data: [], error: null });
    const result = await claimChannelMessage({
      firmId: "11111111-1111-1111-1111-111111111111",
      channel: "facebook",
      messageMid: "mid.redelivered",
    });
    expect(result).toEqual({ duplicate: true, reason: "duplicate" });
  });

  it("treats a raw 23505 as duplicate, not as an error", async () => {
    mocks.upsert.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    const result = await claimChannelMessage({
      firmId: "11111111-1111-1111-1111-111111111111",
      channel: "instagram",
      messageMid: "mid.race-loser",
    });
    expect(result).toEqual({ duplicate: true, reason: "duplicate" });
  });

  it("fails open on any other DB error (process, reason claim_error)", async () => {
    mocks.upsert.mockResolvedValue({
      data: null,
      error: { code: "57014", message: "statement timeout" },
    });
    const result = await claimChannelMessage({
      firmId: "11111111-1111-1111-1111-111111111111",
      channel: "whatsapp",
      messageMid: "wamid.timeout",
    });
    expect(result).toEqual({ duplicate: false, reason: "claim_error" });
  });

  it.each([
    { label: "undefined", mid: undefined },
    { label: "null", mid: null },
    { label: "empty string", mid: "" },
    { label: "whitespace", mid: "   " },
  ])("skips the claim entirely on $label mid (no DB call, process)", async ({ mid }) => {
    const result = await claimChannelMessage({
      firmId: "11111111-1111-1111-1111-111111111111",
      channel: "whatsapp",
      messageMid: mid,
    });
    expect(result).toEqual({ duplicate: false, reason: "no_mid" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("distinct mids each get their own claim attempt", async () => {
    mocks.upsert.mockResolvedValue({ data: [{ id: "row" }], error: null });
    await claimChannelMessage({
      firmId: "11111111-1111-1111-1111-111111111111",
      channel: "whatsapp",
      messageMid: "wamid.one",
    });
    await claimChannelMessage({
      firmId: "11111111-1111-1111-1111-111111111111",
      channel: "whatsapp",
      messageMid: "wamid.two",
    });
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    const mids = mocks.upsert.mock.calls.map(
      (c) => (c[1] as Record<string, unknown>).message_mid,
    );
    expect(mids).toEqual(["wamid.one", "wamid.two"]);
  });
});

describe("releaseChannelMessageClaim", () => {
  it("deletes the claim row keyed on firm_id + channel + trimmed mid", async () => {
    await releaseChannelMessageClaim({
      firmId: "11111111-1111-1111-1111-111111111111",
      channel: "whatsapp",
      messageMid: "  wamid.crashed  ",
    });
    expect(mocks.del).toHaveBeenCalledTimes(1);
    const [table, filters] = mocks.del.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(table).toBe("processed_channel_messages");
    expect(filters).toEqual({
      firm_id: "11111111-1111-1111-1111-111111111111",
      channel: "whatsapp",
      message_mid: "wamid.crashed",
    });
  });

  it.each([
    { label: "undefined", mid: undefined },
    { label: "null", mid: null },
    { label: "empty string", mid: "" },
    { label: "whitespace", mid: "   " },
  ])("skips the delete entirely on $label mid (no claim was taken)", async ({ mid }) => {
    await releaseChannelMessageClaim({
      firmId: "11111111-1111-1111-1111-111111111111",
      channel: "facebook",
      messageMid: mid,
    });
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("logs a DB error and resolves (best-effort, never throws)", async () => {
    mocks.del.mockResolvedValue({
      error: { code: "57014", message: "statement timeout" },
    });
    await expect(
      releaseChannelMessageClaim({
        firmId: "11111111-1111-1111-1111-111111111111",
        channel: "instagram",
        messageMid: "mid.release-error",
      }),
    ).resolves.toBeUndefined();
  });

  it("swallows a thrown exception (best-effort, never propagates)", async () => {
    mocks.del.mockRejectedValue(new Error("network down"));
    await expect(
      releaseChannelMessageClaim({
        firmId: "11111111-1111-1111-1111-111111111111",
        channel: "whatsapp",
        messageMid: "wamid.release-throw",
      }),
    ).resolves.toBeUndefined();
  });
});
