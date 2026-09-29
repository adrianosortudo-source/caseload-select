import assert from "node:assert/strict";
import test from "node:test";
import { PROJECT_REF } from "../migration-gate.mjs";
import { DATABASE_CA_PATH } from "../database-ca.mjs";
import { validateTemporaryCredential } from "../temporary-credential.mjs";
import { createBackfillCredentialProvider, createCoverageBatchRunner, initialCredentialFromEnvironment, redactedBackfillFailureCode, runCoverageBackfill, safeDatabaseDiagnostic, validateBackfillStatus } from "../candidate-coverage-backfill-worker.mjs";

const id1 = "00000000-0000-4000-8000-000000000001";
const id2 = "00000000-0000-4000-8000-000000000002";
function rows(states) {
  const total = states.length, completed = states.filter(row => row.complete).length;
  return states.map(row => ({ total_tables: total, complete_tables: completed, incomplete_tables: total - completed,
    table_name: row.table_name, last_id: row.last_id, rows_projected: row.rows_projected, complete: row.complete }));
}
const cred = async () => ({ projectRef: PROJECT_REF, url: "postgresql://masked", role: "cli_login_test", issuedAt: 1, expiresAt: 300001 });
function testTlsConfig({ environment, mask, persist }) {
  const url = new URL(environment.MIGRATION_DATABASE_URL);
  url.searchParams.set("sslrootcert", "/trusted/supabase-root.crt");
  mask(url.href);
  persist(url.href);
}
function realTemporaryCredential(now, ttlSeconds = 300) {
  const credential = validateTemporaryCredential({ role: "cli_login_postgres", password: "synthetic-password", ttl_seconds: ttlSeconds }, now);
  return { ...credential, url: credential.url };
}

test("production batch adapter accepts its SQL-supported adaptive sizes and rejects out-of-range input", async () => {
  const queries = [];
  const runBatch = createCoverageBatchRunner((sql, credential) => {
    queries.push({ sql, credential });
    const size = Number(sql.slice(0, sql.indexOf(" AS result")).split(", ").at(-1).replace(")", ""));
    return JSON.stringify([{ result: { table_name: "alpha", previous_cursor: null, last_id: id1, rows_projected: size, complete: false } }]);
  });
  const credential = await cred();
  for (const size of [100, 50, 1]) {
    const result = await runBatch("alpha", null, size, credential);
    assert.equal(result.rows_projected, size);
    assert.match(queries.at(-1).sql, new RegExp(`, ${size}\\) AS result`));
    assert.equal(queries.at(-1).credential, credential);
  }
  for (const size of [0, 101, 1.5]) await assert.rejects(runBatch("alpha", null, size, credential), /candidate_backfill_arguments_invalid/);
  assert.equal(queries.length, 3);
});

test("worker diagnostics preserve only enumerated safe codes", () => {
  assert.equal(redactedBackfillFailureCode(Error("candidate_backfill_arguments_invalid")), "candidate_backfill_arguments_invalid");
  assert.equal(redactedBackfillFailureCode(Error("candidate_backfill_query_exit_1")), "candidate_backfill_query_exit_1");
  assert.equal(redactedBackfillFailureCode(Error("candidate_backfill_query_exit_timeout_or_signal")), "candidate_backfill_query_exit_timeout_or_signal");
  assert.equal(redactedBackfillFailureCode(Error("Bearer synthetic-token")), "candidate_backfill_unexpected_failure");
  assert.equal(redactedBackfillFailureCode(Error("candidate_backfill_query_exit_secret")), "candidate_backfill_unexpected_failure");
});

test("database diagnostics retain SQLSTATE and a fixed category without CLI details", () => {
  const diagnostic = safeDatabaseDiagnostic(Buffer.from('ERROR: insert failed for secret firm name\nDETAIL: Key (id)=(secret-value) already exists. SQLSTATE 23505\npostgresql://user:password@host/db'));
  assert.deepEqual(diagnostic, { postgresSqlstate: "23505", sanitizedMessage: "unique_violation" });
  assert.equal(JSON.stringify(diagnostic).includes("secret"), false);
  assert.deepEqual(safeDatabaseDiagnostic("temporary credential expired"), {
    postgresSqlstate: null, sanitizedMessage: "database_cli_error_without_sqlstate",
  });
});

test("database CLI diagnostics inspect both output streams and retain only safe process facts", () => {
  const diagnostic = safeDatabaseDiagnostic({
    status: 1,
    signal: null,
    killed: false,
    code: "ECONNRESET",
    stderr: Buffer.from("request failed for secret-firm; connection reset by peer; postgresql://user:password@host/db"),
    stdout: Buffer.from("secret firm contents"),
  });
  assert.deepEqual(diagnostic, {
    postgresSqlstate: null,
    sanitizedMessage: "database_connection_error",
    cliExitCode: 1,
    cliErrorCode: "ECONNRESET",
  });
  assert.equal(JSON.stringify(diagnostic).includes("secret"), false);
  assert.equal(JSON.stringify(diagnostic).includes("password"), false);
  assert.deepEqual(safeDatabaseDiagnostic({ status: 1, stderr: Buffer.alloc(0), stdout: Buffer.from("ERROR SQLSTATE 57014") }), {
    postgresSqlstate: "57014", sanitizedMessage: "query_canceled", cliExitCode: 1,
  });
  assert.deepEqual(safeDatabaseDiagnostic({ status: null, signal: "SIGTERM", killed: true, code: "ETIMEDOUT", stderr: Buffer.alloc(0), stdout: Buffer.alloc(0) }), {
    postgresSqlstate: null, sanitizedMessage: "database_cli_error_without_sqlstate", cliSignal: "SIGTERM", cliKilled: true, cliErrorCode: "ETIMEDOUT",
  });
  assert.deepEqual(safeDatabaseDiagnostic({ status: 1, code: "ENOBUFS", stderr: Buffer.alloc(0), stdout: Buffer.alloc(0) }), {
    postgresSqlstate: null, sanitizedMessage: "database_cli_error_without_sqlstate", cliExitCode: 1, cliErrorCode: "ENOBUFS",
  });
});

test("persistent batch failure identifies only the safe operation, table and database category", async () => {
  const status = [{ table_name: "gta_prospect_offices", last_id: id1, rows_projected: 100, complete: false }];
  await assert.rejects(runCoverageBackfill({
    readStatus: async () => rows(status), acquire: cred,
    runBatch: async () => {
      const error = Error("candidate_backfill_query_exit_1");
      error.safeDatabaseDiagnostic = { postgresSqlstate: "23503", sanitizedMessage: "foreign_key_violation" };
      throw error;
    },
  }), error => {
    assert.match(error.message, /candidate_backfill_query_exit_1/);
    assert.deepEqual(error.safeContext, {
      operation: "coverage_backfill_batch", tableName: "gta_prospect_offices", batchSize: 1,
      checkpointRowsProjected: 100, postgresSqlstate: "23503", sanitizedMessage: "foreign_key_violation",
    });
    assert.equal(JSON.stringify(error.safeContext).includes(id1), false);
    return true;
  });
});

test("production adapter lets the worker downshift after an atomic batch failure", async () => {
  let states = [{ table_name: "alpha", last_id: null, rows_projected: 0, complete: false }];
  const sizes = [];
  const runBatch = createCoverageBatchRunner(sql => {
    const size = Number(sql.slice(0, sql.indexOf(" AS result")).split(", ").at(-1).replace(")", ""));
    sizes.push(size);
    if (size === 100) throw Error("candidate_backfill_query_exit_1");
    const result = { table_name: "alpha", previous_cursor: null, last_id: id1, rows_projected: 1, complete: true };
    states = [{ table_name: "alpha", last_id: id1, rows_projected: 1, complete: true }];
    return JSON.stringify([{ result }]);
  });
  const result = await runCoverageBackfill({ readStatus: async () => rows(states), acquire: cred, runBatch });
  assert.equal(result.complete, true);
  assert.equal(result.rowsProjected, 1);
  assert.deepEqual(sizes, [100, 50]);
});

test("worker reuses the freshly issued protected credential instead of immediately minting another", () => {
  const now = 1_000_000;
  const environment = {
    MIGRATION_DATABASE_URL: "postgresql://credential-url",
    TEMPORARY_DATABASE_ROLE: "cli_login_postgres",
    TEMPORARY_DATABASE_ISSUED_AT: String(now - 1000),
    TEMPORARY_DATABASE_EXPIRES_AT: String(now + 240_000),
  };
  let validationCalls = 0;
  const initial = initialCredentialFromEnvironment(environment, now, (url, context) => {
    validationCalls += 1;
    assert.equal(url, environment.MIGRATION_DATABASE_URL);
    assert.equal(context.TEMPORARY_DATABASE_ROLE, environment.TEMPORARY_DATABASE_ROLE);
  });
  assert.deepEqual(initial, { projectRef: PROJECT_REF, url: environment.MIGRATION_DATABASE_URL, role: environment.TEMPORARY_DATABASE_ROLE,
    issuedAt: now - 1000, expiresAt: now + 240_000 });
  assert.equal(validationCalls, 1);
  assert.equal(initialCredentialFromEnvironment({}, now), null);
});

test("worker rejects incomplete or malformed inherited credentials and discards nearly expired credentials", () => {
  const now = 1_000_000;
  const valid = {
    MIGRATION_DATABASE_URL: "postgresql://credential-url",
    TEMPORARY_DATABASE_ROLE: "cli_login_postgres",
    TEMPORARY_DATABASE_ISSUED_AT: String(now - 1000),
    TEMPORARY_DATABASE_EXPIRES_AT: String(now + 240_000),
  };
  assert.throws(() => initialCredentialFromEnvironment({ MIGRATION_DATABASE_URL: valid.MIGRATION_DATABASE_URL }, now, () => {}), /candidate_backfill_credential_context_invalid/);
  assert.throws(() => initialCredentialFromEnvironment({ ...valid, TEMPORARY_DATABASE_ROLE: "postgres" }, now, () => {}), /candidate_backfill_credential_context_invalid/);
  assert.equal(initialCredentialFromEnvironment({ ...valid, TEMPORARY_DATABASE_EXPIRES_AT: String(now + 90_000) }, now, () => {}), null);
});

test("credential provider uses inherited auth first and refreshes only inside the three-minute safety window", async () => {
  let now = 1_000_000, mintCalls = 0;
  const environment = {
    MIGRATION_DATABASE_URL: "postgresql://credential-url",
    TEMPORARY_DATABASE_ROLE: "cli_login_postgres",
    TEMPORARY_DATABASE_ISSUED_AT: String(now - 1000),
    TEMPORARY_DATABASE_EXPIRES_AT: String(now + 240_000),
  };
  const acquire = createBackfillCredentialProvider(environment, {
    now: () => now, mask: () => {}, validateUrl: () => {}, configureTls: testTlsConfig,
    mint: async ({ persist }) => {
      mintCalls += 1;
      persist({ url: "postgresql://refreshed", role: "cli_login_postgres", issuedAt: now, expiresAt: now + 300_000 });
    },
  });
  assert.equal((await acquire()).url, environment.MIGRATION_DATABASE_URL);
  assert.equal(mintCalls, 0);
  now += 61_000;
  const renewedUrl = (await acquire()).url;
  assert.equal(new URL(renewedUrl).searchParams.get("sslrootcert"), "/trusted/supabase-root.crt");
  assert.equal((await acquire()).url, renewedUrl);
  assert.equal(mintCalls, 1);
});

test("credential provider refreshes when migration work left less than three minutes on the inherited credential", async () => {
  const now = 1_000_000;
  let mintCalls = 0;
  const acquire = createBackfillCredentialProvider({
    MIGRATION_DATABASE_URL: "postgresql://nearly-expired",
    TEMPORARY_DATABASE_ROLE: "cli_login_postgres",
    TEMPORARY_DATABASE_ISSUED_AT: String(now - 200_000),
    TEMPORARY_DATABASE_EXPIRES_AT: String(now + 100_000),
  }, {
    now: () => now, mask: () => {}, validateUrl: () => {}, configureTls: testTlsConfig,
    mint: async ({ persist }) => {
      mintCalls += 1;
      persist({ url: "postgresql://refreshed", role: "cli_login_postgres", issuedAt: now, expiresAt: now + 300_000 });
    },
  });
  assert.equal(new URL((await acquire()).url).searchParams.get("sslrootcert"), "/trusted/supabase-root.crt");
  assert.equal(mintCalls, 1);
});

test("refreshed credential gets the exact pinned CA before it is returned or cached", async () => {
  const now = Date.now();
  const inherited = realTemporaryCredential(now - 200_000, 300);
  const inheritedUrl = new URL(inherited.url);
  inheritedUrl.searchParams.set("sslrootcert", DATABASE_CA_PATH);
  const environment = {
    USE_TEMPORARY_DATABASE_CREDENTIAL: "true",
    MIGRATION_DATABASE_URL: inheritedUrl.href,
    TEMPORARY_DATABASE_ROLE: inherited.role,
    TEMPORARY_DATABASE_ISSUED_AT: String(inherited.issuedAt),
    TEMPORARY_DATABASE_EXPIRES_AT: String(inherited.expiresAt),
  };
  const masks = [];
  let mintCalls = 0;
  const acquire = createBackfillCredentialProvider(environment, {
    now: () => now, mask: value => masks.push(value),
    mint: async ({ persist }) => {
      mintCalls += 1;
      const refreshed = realTemporaryCredential(now, 300);
      assert.equal(new URL(refreshed.url).searchParams.has("sslrootcert"), false, "the credential issuer does not supply the pinned CA");
      persist(refreshed);
    },
  });
  const refreshed = await acquire();
  const url = new URL(refreshed.url);
  assert.equal(url.searchParams.get("sslmode"), "verify-full");
  assert.equal(url.searchParams.get("sslrootcert"), DATABASE_CA_PATH);
  assert.equal(url.searchParams.getAll("sslrootcert").length, 1);
  assert.ok(masks.includes(refreshed.url), "mask the fully configured credential URL before it can be logged");
  assert.equal(mintCalls, 1);
  assert.equal((await acquire()).url, refreshed.url, "cache only the TLS-configured URL");
});

test("refreshed credentials with a caller-supplied CA path fail closed", async () => {
  const now = Date.now();
  const inherited = realTemporaryCredential(now - 200_000, 300);
  const inheritedUrl = new URL(inherited.url);
  inheritedUrl.searchParams.set("sslrootcert", DATABASE_CA_PATH);
  const environment = {
    USE_TEMPORARY_DATABASE_CREDENTIAL: "true",
    MIGRATION_DATABASE_URL: inheritedUrl.href,
    TEMPORARY_DATABASE_ROLE: inherited.role,
    TEMPORARY_DATABASE_ISSUED_AT: String(inherited.issuedAt),
    TEMPORARY_DATABASE_EXPIRES_AT: String(inherited.expiresAt),
  };
  const acquire = createBackfillCredentialProvider(environment, {
    now: () => now, mask: () => {},
    mint: async ({ persist }) => {
      const refreshed = realTemporaryCredential(now, 300);
      const url = new URL(refreshed.url);
      url.searchParams.set("sslrootcert", "/tmp/untrusted-ca.pem");
      persist({ ...refreshed, url: url.href });
    },
  });
  await assert.rejects(acquire(), /candidate_backfill_credential_invalid/);
});

test("status read-back is exact, unique, internally consistent and cursor-safe", () => {
  assert.deepEqual(validateBackfillStatus(rows([
    { table_name: "alpha", last_id: null, rows_projected: 0, complete: false },
    { table_name: "beta", last_id: id1, rows_projected: 1, complete: true },
  ])), [
    { table_name: "alpha", last_id: null, rows_projected: 0, complete: false },
    { table_name: "beta", last_id: id1, rows_projected: 1, complete: true },
  ]);
  for (const invalid of [
    [],
    rows([{ table_name: "bad-name", last_id: null, rows_projected: 0, complete: false }]),
    rows([{ table_name: "alpha", last_id: "not-a-uuid", rows_projected: 0, complete: false }]),
    [{ ...rows([{ table_name: "alpha", last_id: null, rows_projected: 0, complete: false }])[0], complete_tables: 1 }],
  ]) assert.throws(() => validateBackfillStatus(invalid), /candidate_backfill_status_invalid/);
});

test("worker resumes from committed checkpoint when a batch response is lost", async () => {
  let states = [{ table_name: "alpha", last_id: null, rows_projected: 0, complete: false }];
  let readCount = 0, batchCount = 0;
  const result = await runCoverageBackfill({
    readStatus: async () => { readCount += 1; return rows(states); },
    acquire: cred,
    runBatch: async (table, cursor, size) => {
      batchCount += 1;
      assert.equal(table, "alpha"); assert.equal(cursor, null); assert.equal(size, 100);
      states = [{ table_name: "alpha", last_id: id1, rows_projected: 1, complete: true }];
      throw Error("lost_response");
    },
  });
  assert.equal(result.complete, true);
  assert.equal(result.rowsProjected, 1);
  assert.equal(batchCount, 1);
  assert.equal(readCount, 2);
});

test("worker retries an atomic batch only when its durable cursor did not move", async () => {
  let states = [{ table_name: "alpha", last_id: null, rows_projected: 0, complete: false }];
  const attemptedSizes = [];
  const result = await runCoverageBackfill({
    readStatus: async () => rows(states), acquire: cred,
    runBatch: async (table, cursor, size) => {
      attemptedSizes.push(size);
      if (attemptedSizes.length === 1) throw Error("connection_dropped_before_commit");
      assert.equal(cursor, null); assert.equal(size, 50);
      const response = { table_name: "alpha", previous_cursor: null, last_id: id2, rows_projected: 1, complete: true };
      states = [{ table_name: "alpha", last_id: id2, rows_projected: 1, complete: true }];
      return response;
    },
  });
  assert.equal(result.complete, true);
  assert.deepEqual(attemptedSizes, [100, 50]);
});

test("worker halves an oversized failing batch and returns to 100 after durable progress", async () => {
  let states = [{ table_name: "alpha", last_id: null, rows_projected: 0, complete: false }];
  const sizes = [];
  const result = await runCoverageBackfill({
    readStatus: async () => rows(states), acquire: cred,
    runBatch: async (table, cursor, size) => {
      sizes.push(size);
      if (size > 25) throw Error("bounded_statement_timeout");
      const response = { table_name: table, previous_cursor: cursor, last_id: id2, rows_projected: 1, complete: true };
      states = [{ table_name: table, last_id: id2, rows_projected: 1, complete: true }];
      return response;
    },
  });
  assert.equal(result.complete, true);
  assert.deepEqual(sizes, [100, 50, 25]);
});

test("worker refuses mismatched read-back and cannot report partial inventory complete", async () => {
  const status = rows([
    { table_name: "alpha", last_id: id1, rows_projected: 1, complete: true },
    { table_name: "beta", last_id: null, rows_projected: 0, complete: false },
  ]);
  await assert.rejects(runCoverageBackfill({ readStatus: async () => status, acquire: cred,
    runBatch: async () => ({ table_name: "beta", previous_cursor: id1, last_id: id2, rows_projected: 1, complete: true }),
  }), /candidate_backfill_batch_result_invalid/);
});
