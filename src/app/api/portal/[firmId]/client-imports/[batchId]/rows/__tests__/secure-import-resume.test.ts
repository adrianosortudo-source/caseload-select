import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";

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
  supabaseAdmin: {
    from: (table: string) => new Query(table),
    rpc: async (name: string, params: Record<string, unknown>) => {
      const batch = database.secure_client_import_batches.find((row) => row.id === params.p_batch_id);
      if (!batch) return { data: name === "claim_secure_client_import_rows" ? [{ outcome: "batch_not_found" }] : { outcome: "batch_not_found" }, error: null };
      const currentBatch = batch;

      function refresh() {
        const rows = database.secure_client_import_rows.filter((row) => row.batch_id === params.p_batch_id);
        const final = rows.filter((row) => row.status !== "processing");
        const counts = {
          processed: final.length,
          created: final.filter((row) => row.status === "created").length,
          existing: final.filter((row) => row.status === "existing_unchanged").length,
          held: final.filter((row) => row.status === "held_for_review").length,
          invalid: final.filter((row) => row.status === "invalid").length,
          failed: final.filter((row) => row.status === "failed").length,
          reconcile: final.filter((row) => row.status === "reconcile_required").length,
        };
        const complete = counts.processed === Number(currentBatch.declared_row_count);
        const exceptions = counts.held + counts.invalid + counts.failed + counts.reconcile > 0;
        const hasProcessing = rows.some((row) => row.status === "processing");
        currentBatch.processed_row_count = counts.processed;
        currentBatch.created_count = counts.created;
        currentBatch.existing_count = counts.existing;
        currentBatch.held_count = counts.held;
        currentBatch.invalid_count = counts.invalid;
        currentBatch.failed_count = counts.failed;
        currentBatch.reconcile_count = counts.reconcile;
        currentBatch.status = complete
          ? (exceptions ? "completed_with_exceptions" : "completed")
          : (counts.processed || hasProcessing ? "processing" : "pending");
        if (complete && !currentBatch.completed_at) currentBatch.completed_at = new Date().toISOString();
        return { outcome: "ok", status: currentBatch.status, counts };
      }

      if (name === "refresh_secure_client_import_batch") return { data: refresh(), error: null };
      if (name === "claim_secure_client_import_rows") {
        const requested = params.p_rows as Array<{ row_number: number; row_fingerprint: string }>;
        const mismatch = requested.some((item) => {
          const existing = database.secure_client_import_rows.find((row) => row.batch_id === params.p_batch_id && row.row_number === item.row_number);
          return existing && existing.row_fingerprint !== item.row_fingerprint;
        });
        if (mismatch) return { data: [{ outcome: "row_fingerprint_mismatch" }], error: null };
        const claims = requested.map((item) => {
          const existing = database.secure_client_import_rows.find((row) => row.batch_id === params.p_batch_id && row.row_number === item.row_number);
          if (existing) {
            if (existing.status === "processing") {
              const started = new Date(String(existing.claim_started_at ?? "")).getTime();
              if (!Number.isFinite(started) || started <= Date.now() - 15 * 60 * 1000) {
                Object.assign(existing, {
                  status: "reconcile_required",
                  error_code: "processing_outcome_unknown",
                  claim_token: null,
                  claim_started_at: null,
                });
                refresh();
                return { row_number: item.row_number, outcome: "reconcile_required", status: "reconcile_required", error_code: "processing_outcome_unknown", claim_token: null };
              }
              return { row_number: item.row_number, outcome: "in_progress", status: "processing", claim_token: null };
            }
            return { row_number: item.row_number, outcome: "replay", status: existing.status, error_code: existing.error_code ?? null, claim_token: null };
          }
          const token = randomUUID();
          database.secure_client_import_rows.push({
            id: `secure_client_import_rows-${database.secure_client_import_rows.length + 1}`,
            batch_id: params.p_batch_id,
            firm_id: params.p_firm_id,
            row_number: item.row_number,
            row_fingerprint: item.row_fingerprint,
            status: "processing",
            claim_token: token,
            claim_started_at: new Date().toISOString(),
            attempt_count: 1,
          });
          return { row_number: item.row_number, outcome: "claimed", status: "processing", claim_token: token };
        });
        currentBatch.status = currentBatch.status === "pending" ? "processing" : currentBatch.status;
        return { data: claims, error: null };
      }
      if (name === "finalize_secure_client_import_row") {
        const row = database.secure_client_import_rows.find((item) => item.batch_id === params.p_batch_id && item.row_number === params.p_row_number);
        if (!row || row.status !== "processing" || row.claim_token !== params.p_claim_token || row.row_fingerprint !== params.p_row_fingerprint) {
          return { data: { outcome: "claim_not_owned" }, error: null };
        }
        Object.assign(row, {
          status: params.p_status,
          ghl_contact_id: params.p_ghl_contact_id,
          match_count: params.p_match_count,
          error_code: params.p_error_code,
          claim_token: null,
          claim_started_at: null,
          processed_at: new Date().toISOString(),
        });
        return { data: { ...refresh(), outcome: "finalized" }, error: null };
      }
      return { data: null, error: { message: "unexpected_rpc" } };
    },
  },
}));
vi.mock("@/lib/client-import-server", () => ({
  guardClientImportWrite: async () => ({
    ok: true,
    actor: { id: "lawyer-1" },
    config: { locationId: "location-1", token: "synthetic-token" },
  }),
  importFeatureGate: () => ({ ok: true }),
  clientImportDigest: (namespace: string, value: string) => createHash("sha256").update(`${namespace}:${value}`).digest("hex"),
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
      status: "pending",
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

  it("checks identity before stale-claim handling and never retries an expired external write", async () => {
    const { POST } = await import("../route");
    const original = fixtureRow(0);
    const fingerprint = createHash("sha256")
      .update(`row:${JSON.stringify({ batchId: "batch-1", ...original, phone: null })}`)
      .digest("hex");
    database.secure_client_import_rows.push({
      id: "stale-row",
      batch_id: "batch-1",
      firm_id: "firm-1",
      row_number: 2,
      row_fingerprint: fingerprint,
      status: "processing",
      claim_token: randomUUID(),
      claim_started_at: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    });

    const mismatchResponse = await POST(request([{ ...original, email: "changed@example.test" }]), routeParams());
    expect(mismatchResponse.status).toBe(409);
    expect(await mismatchResponse.json()).toEqual({ error: "row_fingerprint_mismatch" });
    expect(database.secure_client_import_rows[0].status).toBe("processing");
    expect(importContactCreateOnlyMock).not.toHaveBeenCalled();

    const expiredResponse = await POST(request([original]), routeParams());
    const expiredBody = await expiredResponse.json();
    expect(expiredResponse.status).toBe(200);
    expect(expiredBody.outcomes).toEqual([{
      rowNumber: 2,
      status: "reconcile_required",
      errorCode: "processing_outcome_unknown",
    }]);
    expect(database.secure_client_import_rows[0].status).toBe("reconcile_required");
    expect(importContactCreateOnlyMock).not.toHaveBeenCalled();
  });

  it("allows only one external create decision across concurrent final-row requests", async () => {
    const { POST } = await import("../route");
    batch().declared_row_count = 1;
    let releaseCreate: (() => void) | undefined;
    importContactCreateOnlyMock.mockImplementationOnce(async (input: { email: string }) => {
      await new Promise<void>((resolve) => { releaseCreate = resolve; });
      return { ok: true, status: "created", contactId: `ghl-${input.email}`, matchCount: 0 };
    });

    const row = fixtureRow(0);
    const firstPromise = POST(request([row]), routeParams());
    await vi.waitFor(() => expect(importContactCreateOnlyMock).toHaveBeenCalledTimes(1));
    const secondResponse = await POST(request([row]), routeParams());
    const secondBody = await secondResponse.json();
    expect(secondResponse.status).toBe(200);
    expect(secondBody.status).toBe("processing");
    expect(secondBody.outcomes).toEqual([{ rowNumber: 2, status: "processing" }]);
    expect(importContactCreateOnlyMock).toHaveBeenCalledTimes(1);

    releaseCreate?.();
    const firstResponse = await firstPromise;
    const firstBody = await firstResponse.json();
    expect(firstResponse.status).toBe(200);
    expect(firstBody.status).toBe("completed");
    expect(database.secure_client_import_rows).toHaveLength(1);
    expect(importContactCreateOnlyMock).toHaveBeenCalledTimes(1);
  });

  it("does not treat a materially changed invalid payload as an exact replay", async () => {
    const { POST } = await import("../route");
    batch().declared_row_count = 1;
    const invalid = { ...fixtureRow(0), email: "not-an-email", phone: "not-a-phone" };

    const firstResponse = await POST(request([invalid]), routeParams());
    const firstBody = await firstResponse.json();
    expect(firstResponse.status).toBe(200);
    expect(firstBody.outcomes).toEqual([{
      rowNumber: 2,
      status: "invalid",
      errorCode: "server_validation_failed",
    }]);
    expect(importContactCreateOnlyMock).not.toHaveBeenCalled();

    const changedResponse = await POST(request([{ ...invalid, email: "still-invalid-but-different" }]), routeParams());
    expect(changedResponse.status).toBe(409);
    expect(await changedResponse.json()).toEqual({ error: "row_fingerprint_mismatch" });
    expect(importContactCreateOnlyMock).not.toHaveBeenCalled();
  });
});
