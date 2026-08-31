import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { importContactCreateOnly } from "@/lib/ghl-client-import-api";

afterEach(() => vi.unstubAllGlobals());

const base = {
  locationId: "loc-1",
  token: "pit-token",
  batchId: "batch-1",
  firstName: "Ana",
  lastName: "Silva",
  email: "ana@example.com",
  phone: "+14165550123",
  relationshipType: "former_client" as const,
  marketingPermission: "unknown" as const,
  practiceArea: "Corporate law",
  matterClosedYear: 2025,
};

function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

describe("importContactCreateOnly", () => {
  it("looks up email and phone, then creates a held DND contact only when both are new", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ contacts: [], meta: {} }))
      .mockResolvedValueOnce(response({ contacts: [], meta: {} }))
      .mockResolvedValueOnce(response({ contact: { id: "new-1" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await importContactCreateOnly(base)).toEqual({ ok: true, status: "created", contactId: "new-1" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/contacts/lookup?");
    expect(String(fetchMock.mock.calls[1][0])).toContain("phone=%2B14165550123");
    const create = fetchMock.mock.calls[2][1] as RequestInit;
    expect((create.headers as Record<string, string>).Version).toBe("v3");
    const createBody = JSON.parse(String(create.body));
    expect(createBody).toMatchObject({ dnd: true, source: "CaseLoad Select firm-authorized relationship import" });
    expect(createBody.tags).toContain("caseload-select:import-hold");
    expect(createBody.tags).toContain("caseload-select:relationship:former_client");
    expect(createBody.tags).toContain("caseload-select:permission:unknown");
    expect(fetchMock.mock.calls.every((call) => !String(call[0]).includes("/contacts/upsert"))).toBe(true);
  });

  it("leaves one exact existing match unchanged and never creates", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ contacts: [{ id: "existing-1" }], meta: {} }))
      .mockResolvedValueOnce(response({ contacts: [{ id: "existing-1" }], meta: {} }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await importContactCreateOnly(base)).toEqual({ ok: true, status: "existing_unchanged", contactId: "existing-1", matchCount: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("holds conflicting email and phone matches", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ contacts: [{ id: "email-contact" }], meta: {} }))
      .mockResolvedValueOnce(response({ contacts: [{ id: "phone-contact" }], meta: {} })));
    expect(await importContactCreateOnly(base)).toEqual({ ok: true, status: "held_for_review", matchCount: 2 });
  });

  it("paginates lookup before deciding", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ contacts: [{ id: "c1" }], meta: { nextCursor: "next" } }))
      .mockResolvedValueOnce(response({ contacts: [{ id: "c2" }], meta: {} }))
      .mockResolvedValueOnce(response({ contacts: [], meta: {} }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await importContactCreateOnly(base)).toEqual({ ok: true, status: "held_for_review", matchCount: 2 });
    expect(String(fetchMock.mock.calls[1][0])).toContain("nextCursor=next");
  });

  it("blocks creation when lookup fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "no scope" }, 403)));
    expect(await importContactCreateOnly(base)).toEqual({ ok: false, code: "lookup_unauthorized", reconcileRequired: false, retryAfterSeconds: undefined });
  });

  it("marks an uncertain create failure for reconciliation instead of retrying", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ contacts: [], meta: {} }))
      .mockResolvedValueOnce(response({ contacts: [], meta: {} }))
      .mockRejectedValueOnce(new Error("connection reset"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await importContactCreateOnly(base)).toEqual({ ok: false, code: "create_uncertain", reconcileRequired: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
