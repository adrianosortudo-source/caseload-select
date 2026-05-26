/**
 * Codex pushback (2026-05-26): finalizeChannelSession + loadRecentFinalizedSession
 * must distinguish finalized-successful (screened_lead created) from
 * finalized-abandoned (contact-capture exhausted / send failure / duplicate
 * lead_id).
 *
 * Repro the failure mode that motivated the fix:
 *   1. Lead sends 3 inbound messages without contact → MAX_FOLLOW_UPS hit.
 *   2. Processor sends graceful exhausted message + finalizes the session.
 *     screened_lead_id stays NULL because no brief was created.
 *   3. Lead sends "here is my phone."
 *   4. Engine classifies "here is my phone" as matter_type='unknown'.
 *   5. Post-finalization secretary mode would normally fire (matter_type
 *      'unknown' + recent finalized session for this sender). The bug
 *      was: it would tell the lead "a lawyer is reviewing your matter"
 *      even though no brief exists.
 *   6. Fix: loadRecentFinalizedSession filters on screened_lead_id IS
 *      NOT NULL. Abandoned sessions are invisible to it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

interface CapturedUpdate {
  finalized?: boolean;
  screened_lead_id?: string;
  last_activity_at?: string;
}

const mocks = vi.hoisted(() => ({
  updateCapture: null as CapturedUpdate | null,
  updateErr: null as { message: string } | null,
  queryFilters: [] as Array<{ field: string; value: unknown }>,
  queryNotFilters: [] as Array<{ field: string; op: string; value: unknown }>,
  loadResult: null as object | null,
  loadErr: null as { message: string } | null,
}));

vi.mock("@/lib/supabase-admin", () => {
  function fromChain(_table: string) {
    return {
      update: (payload: CapturedUpdate) => {
        mocks.updateCapture = payload;
        return {
          eq: (_field: string, _v: unknown) =>
            mocks.updateErr
              ? Promise.resolve({ error: mocks.updateErr })
              : Promise.resolve({ error: null }),
        };
      },
      select: (_cols: string) => {
        const chain: Record<string, unknown> = {
          eq: (field: string, value: unknown) => {
            mocks.queryFilters.push({ field, value });
            return chain;
          },
          not: (field: string, op: string, value: unknown) => {
            mocks.queryNotFilters.push({ field, op, value });
            return chain;
          },
          gte: (field: string, value: unknown) => {
            mocks.queryFilters.push({ field: `${field}_gte`, value });
            return chain;
          },
          order: () => chain,
          limit: () => chain,
          maybeSingle: () =>
            mocks.loadErr
              ? Promise.resolve({ data: null, error: mocks.loadErr })
              : Promise.resolve({ data: mocks.loadResult, error: null }),
        };
        return chain;
      },
    };
  }
  return { supabaseAdmin: { from: fromChain } };
});

import {
  finalizeChannelSession,
  loadRecentFinalizedSession,
} from "../channel-intake-session-store";

beforeEach(() => {
  mocks.updateCapture = null;
  mocks.updateErr = null;
  mocks.queryFilters = [];
  mocks.queryNotFilters = [];
  mocks.loadResult = null;
  mocks.loadErr = null;
});

describe("finalizeChannelSession", () => {
  it("without screenedLeadId, leaves screened_lead_id unset (abandoned/exhausted path)", async () => {
    const r = await finalizeChannelSession("session-1");
    expect(r.ok).toBe(true);
    expect(mocks.updateCapture?.finalized).toBe(true);
    expect(mocks.updateCapture?.last_activity_at).toBeDefined();
    // The key invariant: no screened_lead_id is written when none was provided.
    expect(mocks.updateCapture).not.toHaveProperty("screened_lead_id");
  });

  it("with screenedLeadId, writes the FK (successful path)", async () => {
    const r = await finalizeChannelSession("session-1", "lead-uuid-abc");
    expect(r.ok).toBe(true);
    expect(mocks.updateCapture?.finalized).toBe(true);
    expect(mocks.updateCapture?.screened_lead_id).toBe("lead-uuid-abc");
  });

  it("with null screenedLeadId, treats as undefined and leaves column unset", async () => {
    const r = await finalizeChannelSession("session-1", null);
    expect(r.ok).toBe(true);
    expect(mocks.updateCapture).not.toHaveProperty("screened_lead_id");
  });

  it("propagates DB errors", async () => {
    mocks.updateErr = { message: "RLS denied" };
    const r = await finalizeChannelSession("session-1", "lead-uuid-abc");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("RLS denied");
  });
});

describe("loadRecentFinalizedSession", () => {
  it("queries with screened_lead_id IS NOT NULL — abandoned sessions are filtered out", async () => {
    mocks.loadResult = null;
    await loadRecentFinalizedSession({
      firmId: "firm-1",
      channel: "facebook",
      senderId: "psid-1",
    });
    // The .not('screened_lead_id', 'is', null) filter is the critical
    // guard that prevents the secretary-mode false positive.
    const notFilter = mocks.queryNotFilters.find((f) => f.field === "screened_lead_id");
    expect(notFilter).toBeDefined();
    expect(notFilter?.op).toBe("is");
    expect(notFilter?.value).toBeNull();
  });

  it("preserves the existing finalized=true filter (didn't accidentally drop it)", async () => {
    await loadRecentFinalizedSession({
      firmId: "firm-1",
      channel: "facebook",
      senderId: "psid-1",
    });
    const finalized = mocks.queryFilters.find((f) => f.field === "finalized");
    expect(finalized?.value).toBe(true);
  });

  it("preserves the firm + channel + sender filters", async () => {
    await loadRecentFinalizedSession({
      firmId: "firm-xyz",
      channel: "whatsapp",
      senderId: "16475551111",
    });
    const firmFilter = mocks.queryFilters.find((f) => f.field === "firm_id");
    expect(firmFilter?.value).toBe("firm-xyz");
    const channelFilter = mocks.queryFilters.find((f) => f.field === "channel");
    expect(channelFilter?.value).toBe("whatsapp");
    const senderFilter = mocks.queryFilters.find((f) => f.field === "sender_id");
    expect(senderFilter?.value).toBe("16475551111");
  });

  it("returns null on DB error", async () => {
    mocks.loadErr = { message: "connection refused" };
    const r = await loadRecentFinalizedSession({
      firmId: "firm-1",
      channel: "facebook",
      senderId: "psid-1",
    });
    expect(r).toBeNull();
  });
});
