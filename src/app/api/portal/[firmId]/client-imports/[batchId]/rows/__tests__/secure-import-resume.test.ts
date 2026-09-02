import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

type StoredRow = Record<string, unknown>;

const database: Record<string, StoredRow[]> = {
  secure_client_import_batches: [],
  secure_client_import_rows: [],
};

const importContactCreateOnlyMock = vi.fn();

function matchingRows(table: string, filters: Array<[string, unknown]>) {
  return database[table].filter((row) => filters.every(([key, value]) => row[key] === value));
}

class Query {
  private filters: Array<[string, unknown]> = [];
  private mode: "select" | "update" = "select";
  private updateValues: StoredRow = {};

  constructor(private readonly table: string) {}

  select() {
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.push([key, value]);
    return this;
  }

  async maybeSingle() {
    if (this.mode === "update") {
      const rows = matchingRows(this.table, this.filters);
      for (const row of rows) Object.assign(row, this.updateValues);
      return { data: rows[0] ?? null, error: null };
    }
    return { data: matchingRows(this.table, this.filters)[0] ?? null, error: null };
  }

  async insert(value: StoredRow) {
    const rows = database[this.table];
    if (
      this.table === "secure_client_import_rows"
      && rows.some((row) => row.batch_id === value.batch_id && row.row_number === value.row_number)
    ) {
      return { data: null, error: { code: "23505" } };
    }
    rows.push({ id: `${this.table}-${rows.length + 1}`, attempt_count: 1, ...value });
    return { data: null, error: null };
  }

  async upsert(value: StoredRow, options: { ignoreDuplicates?: boolean } = {}) {
    const rows = database[this.table];
    const existing = rows.find((row) => row.batch_id === value.batch_id && row.row_number === value.row_number);
    if (!existing) rows.push({ id: `${this.table}-${rows.length + 1}`, attempt_count: 1, ...value });
    else if (!options.ignoreDuplicates) Object.assign(existing, value);
    return { data: null, error: null };
  }

  update(value: StoredRow) {
    this.mode = "update";
    this.updateValues = value;
    return this;
  }

  private async execute() {
    if (this.mode === "update") {
      const rows = matchingRows(this.table, this.filters);
      for (const row of rows) Object.assign(row, this.updateValues);
      return { data: null, error: null };
    }
    return { data: matchingRows(this.table, this.filters), error: null };
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { from: (table: string) => new Query(table) },
}));
vi.mock("@/lib/client-import-server", () => ({
  guardClientImportWrite: async () => ({
    ok: true,
    actor: { id: "lawyer-1" },
    config: { locationId: "location-1", token: "synthetic-token" },
  }),
  importFeatureGate: () => ({ ok: true }),
  clientImportDigest: (namespace: string, value: string) => `${namespace}:${value}`,
}));
vi.mock("@/lib/ghl-client-import-api", () => ({
  importContactCreateOnly: (input: unknown) => importContactCreateOnlyMock(input),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ ok: true, active: true }),
  ipFromRequest: () => "127.0.0.1",
  rateLimitHeaders: () => ({}),
}));

function fixtureRow(index: number) {
  return {
    rowNumber: index + 2,
    firstName: `Fixture${index + 1}`,
    lastName: "Contact",
    email: `fixture-${index + 1}@example.test`,
    phone: "",
    relationshipType: "former_client",
    practiceArea: "Employment",
    matterClosedYear: 2024,
    marketingPermission: "unknown",
  };
}

function request(rows: unknown[]): NextRequest {
  return new Request("http://localhost/api/portal/firm-1/client-imports/batch-1/rows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  }) as NextRequest;
}

function routeParams() {
  return { params: Promise.resolve({ firmId: "firm-1", batchId: "batch-1" }) };
}

function batch() {
  return database.secure_client_import_batches[0];
}

describe("secure client import interruption and resume", () => {
  beforeEach(() => {
    database.secure_client_import_batches = [{
      id: "batch-1",
      firm_id: "firm-1",
      lawyer_id: "lawyer-1",
      declared_row_count: 26,
      processed_row_count: 0,
      status: "authorized",
      completed_at: null,
    }];
    database.secure_client_import_rows = [];
    importContactCreateOnlyMock.mockReset().mockImplementation(async (input: { email: string }) => ({
      ok: true,
      status: "created",
      contactId: `ghl-${input.email}`,
      matchCount: 0,
    }));
  });

  it("resumes a 25 plus 1 import and keeps exact replays idempotent", async () => {
    const { POST } = await import("../route");
    const rows = Array.from({ length: 26 }, (_, index) => fixtureRow(index));

    const firstResponse = await POST(request(rows.slice(0, 25)), routeParams());
    const firstBody = await firstResponse.json();
    expect(firstResponse.status).toBe(200);
    expect(firstBody.status).toBe("processing");
    expect(firstBody.counts.processed).toBe(25);
    expect(database.secure_client_import_rows).toHaveLength(25);
    expect(importContactCreateOnlyMock).toHaveBeenCalledTimes(25);

    const resumeResponse = await POST(request([rows[25]]), routeParams());
    const resumeBody = await resumeResponse.json();
    expect(resumeResponse.status).toBe(200);
    expect(resumeBody.status).toBe("completed");
    expect(resumeBody.counts.processed).toBe(26);
    expect(database.secure_client_import_rows).toHaveLength(26);
    expect(importContactCreateOnlyMock).toHaveBeenCalledTimes(26);
    const originalCompletedAt = batch().completed_at;
    expect(originalCompletedAt).toEqual(expect.any(String));

    await new Promise((resolve) => setTimeout(resolve, 10));
    const replayResponse = await POST(request(rows.slice(0, 25)), routeParams());
    const replayBody = await replayResponse.json();
    expect(replayResponse.status).toBe(200);
    expect(replayBody.status).toBe("completed");
    expect(replayBody.counts.processed).toBe(26);
    expect(database.secure_client_import_rows).toHaveLength(26);
    expect(importContactCreateOnlyMock).toHaveBeenCalledTimes(26);
    expect(batch().completed_at).toBe(originalCompletedAt);

    const mismatchedFinalRow = { ...rows[25], email: "changed-fixture@example.test" };
    const mismatchResponse = await POST(request([mismatchedFinalRow]), routeParams());
    expect(mismatchResponse.status).toBe(409);
    expect(await mismatchResponse.json()).toEqual({ error: "row_fingerprint_mismatch" });
    expect(database.secure_client_import_rows).toHaveLength(26);
    expect(importContactCreateOnlyMock).toHaveBeenCalledTimes(26);

    const extraResponse = await POST(request([fixtureRow(26)]), routeParams());
    expect(extraResponse.status).toBe(409);
    expect(await extraResponse.json()).toEqual({ error: "row_number_exceeds_declared_count" });
    expect(database.secure_client_import_rows).toHaveLength(26);
    expect(importContactCreateOnlyMock).toHaveBeenCalledTimes(26);
    expect(batch().processed_row_count).toBe(26);
  });

  it("rejects an over-budget resume request atomically", async () => {
    const { POST } = await import("../route");
    const rows = Array.from({ length: 27 }, (_, index) => fixtureRow(index));

    const firstResponse = await POST(request(rows.slice(0, 25)), routeParams());
    expect(firstResponse.status).toBe(200);
    expect(database.secure_client_import_rows).toHaveLength(25);
    expect(importContactCreateOnlyMock).toHaveBeenCalledTimes(25);

    const overBudgetResponse = await POST(request([rows[25], rows[26]]), routeParams());
    expect(overBudgetResponse.status).toBe(409);
    expect(await overBudgetResponse.json()).toEqual({ error: "row_number_exceeds_declared_count" });
    expect(database.secure_client_import_rows).toHaveLength(25);
    expect(importContactCreateOnlyMock).toHaveBeenCalledTimes(25);
    expect(batch().processed_row_count).toBe(25);
    expect(batch().status).toBe("processing");
  });
});
