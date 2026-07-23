/**
 * Tests for the two client-list operator lifecycle routes:
 *   POST .../client-list/verify
 *   POST .../client-list/delete-working-copy
 *
 * Coverage: unauthenticated 401, verify stamps the timestamp and note,
 * delete is blocked before verify (409), delete after verify removes
 * exactly the union of client_list_files paths plus the legacy
 * customer_base path and stamps client_list_working_copy_deleted_at, a
 * second delete is blocked (409), and a storage removal error propagates
 * as 500 without stamping the row.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

interface Row {
  id: string;
  client_list_path: string | null;
  client_list_files: unknown;
  customer_base_storage_path: string | null;
  client_list_import_verified_at: string | null;
  client_list_working_copy_deleted_at: string | null;
}

const state = {
  session: null as { firm_id: string; role: "operator"; exp: number } | null,
  row: null as Row | null,
  removeArgs: null as string[] | null,
  removeError: null as { message: string } | null,
  updatePayload: null as Record<string, unknown> | null,
};

vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(state.session),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: state.row, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        state.updatePayload = payload;
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
    storage: {
      from: () => ({
        remove: (paths: string[]) => {
          state.removeArgs = paths;
          return Promise.resolve({ error: state.removeError });
        },
      }),
    },
  },
}));

import { POST as verifyPOST } from "../verify/route";
import { POST as deletePOST } from "../delete-working-copy/route";

const ID = "row-1";
const OPERATOR = { firm_id: "all", role: "operator" as const, exp: 9999999999 };

function req(body: Record<string, unknown> = {}) {
  return { json: async () => body } as never;
}

const params = () => ({ params: Promise.resolve({ id: ID }) }) as never;

function baseRow(overrides: Partial<Row> = {}): Row {
  return {
    id: ID,
    client_list_path: "share_with_us",
    client_list_files: [{ storage_path: "TOKEN/profile/1-a.csv" }, { storage_path: "TOKEN/profile/2-b.pdf" }],
    customer_base_storage_path: "TOKEN/legacy-file.csv",
    client_list_import_verified_at: null,
    client_list_working_copy_deleted_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  state.session = OPERATOR;
  state.row = baseRow();
  state.removeArgs = null;
  state.removeError = null;
  state.updatePayload = null;
});

describe("POST client-list/verify", () => {
  it("401s without an operator session", async () => {
    state.session = null;
    const res = await verifyPOST(req(), params());
    expect(res.status).toBe(401);
  });

  it("stamps the verified timestamp and the note", async () => {
    const res = await verifyPOST(req({ note: "Imported 40 contacts into GHL." }), params());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.verified_at).toEqual(expect.any(String));
    expect(state.updatePayload?.client_list_import_verified_at).toEqual(expect.any(String));
    expect(state.updatePayload?.client_list_import_verified_note).toBe("Imported 40 contacts into GHL.");
  });
});

describe("POST client-list/delete-working-copy", () => {
  it("401s without an operator session", async () => {
    state.session = null;
    const res = await deletePOST(req(), params());
    expect(res.status).toBe(401);
  });

  it("409s when the import has not been verified yet", async () => {
    state.row = baseRow({ client_list_import_verified_at: null });
    const res = await deletePOST(req(), params());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("import not verified yet");
  });

  it("removes exactly the union of client_list_files paths plus the legacy path, and stamps the deletion", async () => {
    state.row = baseRow({ client_list_import_verified_at: "2026-07-22T00:00:00Z" });
    const res = await deletePOST(req(), params());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.removed).toBe(3);
    expect(state.removeArgs).toEqual(["TOKEN/profile/1-a.csv", "TOKEN/profile/2-b.pdf", "TOKEN/legacy-file.csv"]);
    expect(state.updatePayload?.client_list_working_copy_deleted_at).toEqual(expect.any(String));
  });

  it("409s on a second delete after the working copy is already gone", async () => {
    state.row = baseRow({
      client_list_import_verified_at: "2026-07-22T00:00:00Z",
      client_list_working_copy_deleted_at: "2026-07-23T00:00:00Z",
    });
    const res = await deletePOST(req(), params());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("already deleted");
  });

  it("propagates a storage removal error as 500 without stamping the row", async () => {
    state.row = baseRow({ client_list_import_verified_at: "2026-07-22T00:00:00Z" });
    state.removeError = { message: "bucket unreachable" };
    const res = await deletePOST(req(), params());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain("bucket unreachable");
    expect(state.updatePayload).toBeNull();
  });
});
