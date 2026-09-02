import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL = process.env.DIRECT_DATABASE_URL;

function parseDirectDatabaseUrl(url: string) {
  const trimmed = url.trim();
  const unquoted = trimmed.length >= 2 && (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) ? trimmed.slice(1, -1) : trimmed;
  const parsed = new URL(unquoted);
  return {
    host: decodeURIComponent(parsed.hostname),
    port: parsed.port ? Number(parsed.port) : undefined,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, "") || undefined,
  };
}

function fingerprint(label: string) {
  return createHash("sha256").update(label).digest("hex");
}

describe.skipIf(!DB_URL)("Secure Import resume concurrency (real Postgres)", () => {
  let Client: typeof import("pg").Client;
  let connA: import("pg").Client;
  let connB: import("pg").Client;
  const firmId = randomUUID();
  const lawyerId = randomUUID();
  const batchId = randomUUID();

  async function createBatch(connection: import("pg").Client, id: string, declared: number) {
    const challengeId = randomUUID();
    await connection.query(
      `insert into public.secure_client_import_challenges
         (id, firm_id, lawyer_id, code_hash, recipient_hash, expires_at)
       values ($1, $2, $3, 'fixture-code', 'fixture-recipient', now() + interval '1 hour')`,
      [challengeId, firmId, lawyerId],
    );
    await connection.query(
      `insert into public.secure_client_import_batches
         (id, firm_id, lawyer_id, challenge_id, file_sha256, file_byte_count,
          authorization_text, declared_row_count, status)
       values ($1, $2, $3, $4, $5, 100, 'synthetic test authorization', $6, 'pending')`,
      [id, firmId, lawyerId, challengeId, fingerprint(`file-${id}`), declared],
    );
  }

  async function claim(connection: import("pg").Client, id: string, rows: Array<{ row_number: number; row_fingerprint: string }>) {
    return connection.query(
      `select * from public.claim_secure_client_import_rows($1, $2, $3, $4::jsonb)`,
      [id, firmId, lawyerId, JSON.stringify(rows)],
    );
  }

  beforeAll(async () => {
    ({ Client } = await import("pg"));
    const options = parseDirectDatabaseUrl(DB_URL!);
    connA = new Client(options);
    connB = new Client(options);
    await connA.connect();
    await connB.connect();
    await connA.query(
      `insert into public.intake_firms (id, name, custom_domain, subdomain)
       values ($1, 'Secure Import Concurrency Fixture', null, $2)`,
      [firmId, `secure-import-concurrency-${firmId}`],
    );
    await connA.query(
      `insert into public.firm_lawyers (id, firm_id, email, name, role)
       values ($1, $2, $3, 'Synthetic Lawyer', 'lawyer')`,
      [lawyerId, firmId, `secure-import-${lawyerId}@example.test`],
    );
    await createBatch(connA, batchId, 26);
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (let rowNumber = 2; rowNumber <= 26; rowNumber += 1) {
      const offset = values.length;
      values.push(batchId, firmId, rowNumber, fingerprint(`row-${rowNumber}`), `ghl-${rowNumber}`);
      tuples.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, 'created', $${offset + 5})`);
    }
    await connA.query(
      `insert into public.secure_client_import_rows
         (batch_id, firm_id, row_number, row_fingerprint, status, ghl_contact_id)
       values ${tuples.join(", ")}`,
      values,
    );
    await connA.query(
      `select public.refresh_secure_client_import_batch($1, $2, $3)`,
      [batchId, firmId, lawyerId],
    );
  }, 30000);

  afterAll(async () => {
    await connA?.end();
    await connB?.end();
  });

  it("allows one final-row external-create decision and keeps completion monotonic", async () => {
    const finalFingerprint = fingerprint("row-27");
    const [claimA, claimB] = await Promise.all([
      claim(connA, batchId, [{ row_number: 27, row_fingerprint: finalFingerprint }]),
      claim(connB, batchId, [{ row_number: 27, row_fingerprint: finalFingerprint }]),
    ]);
    const decisions = [...claimA.rows, ...claimB.rows];
    expect(decisions.filter((row) => row.outcome === "claimed")).toHaveLength(1);
    expect(decisions.filter((row) => row.outcome === "in_progress")).toHaveLength(1);
    const token = decisions.find((row) => row.outcome === "claimed")!.claim_token as string;

    const finalizeSql = `select public.finalize_secure_client_import_row(
      $1, $2, $3, 27, $4, $5, 'created', 'ghl-27', 0, null
    ) as result`;
    const [finishA, finishB] = await Promise.all([
      connA.query(finalizeSql, [batchId, firmId, lawyerId, finalFingerprint, token]),
      connB.query(finalizeSql, [batchId, firmId, lawyerId, finalFingerprint, token]),
    ]);
    const finishes = [finishA.rows[0].result, finishB.rows[0].result];
    expect(finishes.filter((result) => result.outcome === "finalized")).toHaveLength(1);
    expect(finishes.filter((result) => result.outcome === "claim_not_owned")).toHaveLength(1);

    const completedBeforeRefresh = await connA.query(
      `select completed_at from public.secure_client_import_batches where id = $1`,
      [batchId],
    );
    const originalCompletedAt = completedBeforeRefresh.rows[0].completed_at;
    expect(originalCompletedAt).not.toBeNull();

    // This is the delayed first-chunk aggregate: it executes after the final
    // row completed and must derive 26 from rows rather than write stale 25.
    await connB.query(`select public.refresh_secure_client_import_batch($1, $2, $3)`, [batchId, firmId, lawyerId]);
    const { rows } = await connA.query(
      `select status, processed_row_count, created_count, completed_at
       from public.secure_client_import_batches where id = $1`,
      [batchId],
    );
    expect(rows[0].status).toBe("completed");
    expect(rows[0].processed_row_count).toBe(26);
    expect(rows[0].created_count).toBe(26);
    expect(rows[0].completed_at).toEqual(originalCompletedAt);
    const count = await connA.query(
      `select count(*)::int as n from public.secure_client_import_rows where batch_id = $1 and row_number = 27`,
      [batchId],
    );
    expect(count.rows[0].n).toBe(1);
  }, 30000);

  it("checks a stale row fingerprint before failing the unknown outcome closed", async () => {
    const staleBatch = randomUUID();
    await createBatch(connA, staleBatch, 1);
    const originalFingerprint = fingerprint("stale-original");
    await connA.query(
      `insert into public.secure_client_import_rows
         (batch_id, firm_id, row_number, row_fingerprint, status, claim_token, claim_started_at)
       values ($1, $2, 2, $3, 'processing', $4, now() - interval '16 minutes')`,
      [staleBatch, firmId, originalFingerprint, randomUUID()],
    );

    const mismatch = await claim(connA, staleBatch, [{ row_number: 2, row_fingerprint: fingerprint("changed") }]);
    expect(mismatch.rows).toEqual([expect.objectContaining({ outcome: "row_fingerprint_mismatch" })]);
    const before = await connA.query(
      `select status, error_code, claim_token from public.secure_client_import_rows where batch_id = $1`,
      [staleBatch],
    );
    expect(before.rows[0].status).toBe("processing");
    expect(before.rows[0].error_code).toBeNull();
    expect(before.rows[0].claim_token).not.toBeNull();

    const exact = await claim(connA, staleBatch, [{ row_number: 2, row_fingerprint: originalFingerprint }]);
    expect(exact.rows).toEqual([expect.objectContaining({
      outcome: "reconcile_required",
      status: "reconcile_required",
      error_code: "processing_outcome_unknown",
      claim_token: null,
    })]);
    const after = await connA.query(
      `select r.status as row_status, r.claim_token, b.status as batch_status, b.reconcile_count
       from public.secure_client_import_rows r
       join public.secure_client_import_batches b on b.id = r.batch_id
       where r.batch_id = $1`,
      [staleBatch],
    );
    expect(after.rows[0]).toEqual(expect.objectContaining({
      row_status: "reconcile_required",
      claim_token: null,
      batch_status: "completed_with_exceptions",
      reconcile_count: 1,
    }));
  }, 30000);

  it("rejects an over-budget chunk before inserting any row", async () => {
    const budgetBatch = randomUUID();
    await createBatch(connA, budgetBatch, 26);
    const result = await claim(connA, budgetBatch, [
      { row_number: 27, row_fingerprint: fingerprint("budget-27") },
      { row_number: 28, row_fingerprint: fingerprint("budget-28") },
    ]);
    expect(result.rows).toEqual([expect.objectContaining({ outcome: "invalid_row_claim" })]);
    const count = await connA.query(
      `select count(*)::int as n from public.secure_client_import_rows where batch_id = $1`,
      [budgetBatch],
    );
    expect(count.rows[0].n).toBe(0);
  }, 30000);

  it("keeps the service-only RPCs unavailable to browser roles", async () => {
    const privileges = await connA.query(
      `select
         has_function_privilege('anon', 'public.claim_secure_client_import_rows(uuid,uuid,uuid,jsonb)', 'EXECUTE') as anon_claim,
         has_function_privilege('anon', 'public.finalize_secure_client_import_row(uuid,uuid,uuid,integer,text,uuid,text,text,integer,text)', 'EXECUTE') as anon_finalize,
         has_function_privilege('anon', 'public.refresh_secure_client_import_batch(uuid,uuid,uuid)', 'EXECUTE') as anon_refresh,
         has_function_privilege('authenticated', 'public.claim_secure_client_import_rows(uuid,uuid,uuid,jsonb)', 'EXECUTE') as authenticated_claim,
         has_function_privilege('authenticated', 'public.finalize_secure_client_import_row(uuid,uuid,uuid,integer,text,uuid,text,text,integer,text)', 'EXECUTE') as authenticated_finalize,
         has_function_privilege('authenticated', 'public.refresh_secure_client_import_batch(uuid,uuid,uuid)', 'EXECUTE') as authenticated_refresh,
         has_function_privilege('service_role', 'public.claim_secure_client_import_rows(uuid,uuid,uuid,jsonb)', 'EXECUTE') as service_claim,
         has_function_privilege('service_role', 'public.finalize_secure_client_import_row(uuid,uuid,uuid,integer,text,uuid,text,text,integer,text)', 'EXECUTE') as service_finalize,
         has_function_privilege('service_role', 'public.refresh_secure_client_import_batch(uuid,uuid,uuid)', 'EXECUTE') as service_refresh`,
    );
    expect(privileges.rows[0]).toEqual({
      anon_claim: false,
      anon_finalize: false,
      anon_refresh: false,
      authenticated_claim: false,
      authenticated_finalize: false,
      authenticated_refresh: false,
      service_claim: true,
      service_finalize: true,
      service_refresh: true,
    });

    const serviceBatch = randomUUID();
    await createBatch(connA, serviceBatch, 1);
    await connA.query("begin");
    try {
      await connA.query("set local role service_role");
      const serviceClaim = await claim(connA, serviceBatch, [{
        row_number: 2,
        row_fingerprint: fingerprint("service-role-claim"),
      }]);
      expect(serviceClaim.rows).toEqual([expect.objectContaining({ outcome: "claimed" })]);
    } finally {
      await connA.query("rollback");
    }
  });
});
