/**
 * Tests for `lib/firm-resolver` — channel-to-firm asset resolution.
 *
 * These tests mock @/lib/supabase-admin so we observe exactly which column
 * the resolver queries (intake_firms.facebook_page_id vs
 * instagram_business_account_id vs whatsapp_phone_number_id) and what it
 * returns for each shape.
 *
 * Coverage:
 *   - Match: returns FirmContext for a row Supabase produces.
 *   - No match: returns null when supabase data is null.
 *   - Empty input: returns null without hitting supabase.
 *   - Supabase error: returns null and logs.
 *   - Each resolver hits the correct column (no cross-contamination).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

interface CapturedQuery {
  table: string;
  column: string | null;
  value: unknown;
}

const state: {
  queries: CapturedQuery[];
  nextResult: { data: { id: string; name: string } | null; error: { message: string } | null };
} = {
  queries: [],
  nextResult: { data: null, error: null },
};

vi.mock("@/lib/supabase-admin", () => {
  const makeChain = (table: string) => {
    const capture: CapturedQuery = { table, column: null, value: undefined };
    state.queries.push(capture);
    const chain = {
      select: (_cols: string) => chain,
      eq: (column: string, value: unknown) => {
        capture.column = column;
        capture.value = value;
        return chain;
      },
      maybeSingle: () => Promise.resolve(state.nextResult),
    };
    return chain;
  };
  return {
    supabaseAdmin: {
      from: (table: string) => makeChain(table),
    },
  };
});

// Import after the mocks are wired.
import {
  resolveFirmByFacebookPageId,
  resolveFirmByInstagramBusinessAccountId,
  resolveFirmByWhatsappPhoneNumberId,
} from "../firm-resolver";

beforeEach(() => {
  state.queries = [];
  state.nextResult = { data: null, error: null };
});

describe("resolveFirmByFacebookPageId", () => {
  it("returns FirmContext when a row matches", async () => {
    state.nextResult = { data: { id: "firm-uuid", name: "DRG Law Test" }, error: null };
    const ctx = await resolveFirmByFacebookPageId("1179834051874177");
    expect(ctx).toEqual({ firmId: "firm-uuid", firmName: "DRG Law Test" });
    expect(state.queries[0]).toEqual({
      table: "intake_firms",
      column: "facebook_page_id",
      value: "1179834051874177",
    });
  });

  it("returns null when no row matches", async () => {
    state.nextResult = { data: null, error: null };
    const ctx = await resolveFirmByFacebookPageId("nonexistent");
    expect(ctx).toBeNull();
  });

  it("returns null without hitting supabase for an empty page id", async () => {
    const ctx = await resolveFirmByFacebookPageId("");
    expect(ctx).toBeNull();
    expect(state.queries.length).toBe(0);
  });

  it("returns null and logs on supabase error", async () => {
    state.nextResult = { data: null, error: { message: "connection refused" } };
    const ctx = await resolveFirmByFacebookPageId("123");
    expect(ctx).toBeNull();
  });
});

describe("resolveFirmByInstagramBusinessAccountId", () => {
  it("queries the instagram_business_account_id column", async () => {
    state.nextResult = { data: { id: "f", name: "F" }, error: null };
    await resolveFirmByInstagramBusinessAccountId("17841400000");
    expect(state.queries[0]?.column).toBe("instagram_business_account_id");
    expect(state.queries[0]?.value).toBe("17841400000");
  });

  it("returns null for empty input without a DB roundtrip", async () => {
    const ctx = await resolveFirmByInstagramBusinessAccountId("");
    expect(ctx).toBeNull();
    expect(state.queries.length).toBe(0);
  });
});

describe("resolveFirmByWhatsappPhoneNumberId", () => {
  it("queries the whatsapp_phone_number_id column", async () => {
    state.nextResult = { data: { id: "f", name: "F" }, error: null };
    await resolveFirmByWhatsappPhoneNumberId("1135653749626764");
    expect(state.queries[0]?.column).toBe("whatsapp_phone_number_id");
    expect(state.queries[0]?.value).toBe("1135653749626764");
  });

  it("returns null for empty input", async () => {
    const ctx = await resolveFirmByWhatsappPhoneNumberId("");
    expect(ctx).toBeNull();
    expect(state.queries.length).toBe(0);
  });
});
