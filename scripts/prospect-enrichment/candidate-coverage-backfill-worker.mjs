// Resumable, database-checkpointed worker for the reviewed candidate coverage backfill.
// Source row values never leave PostgreSQL; output contains counts and cursors only.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acquireTemporaryCredential, redactedFailureCode } from "./temporary-credential.mjs";
import { PROJECT_REF, verifyDirectDatabaseUrl } from "./migration-gate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BATCH_SIZE = 100;
// PostgreSQL UUID accepts all 128-bit values, not only RFC version/variant UUIDs.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE = /^[a-z][a-z0-9_]{0,62}$/;
const fail = code => { throw Error(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const BACKFILL_FAILURE_CODES = new Set([
  "candidate_backfill_status_invalid", "candidate_backfill_batch_result_invalid", "candidate_backfill_batch_no_progress",
  "candidate_backfill_credential_invalid", "candidate_backfill_table_disappeared", "candidate_backfill_checkpoint_mismatch",
  "candidate_backfill_no_progress", "candidate_backfill_query_response_invalid", "candidate_backfill_credential_context_invalid",
  "candidate_backfill_credential_budget_insufficient", "candidate_backfill_arguments_invalid", "candidate_backfill_authorization_invalid",
  "candidate_backfill_batch_response_invalid",
]);
const SQLSTATE_MESSAGES = new Map([
  ["23502", "not_null_violation"], ["23503", "foreign_key_violation"], ["23505", "unique_violation"],
  ["23514", "check_violation"], ["22P02", "invalid_text_representation"], ["22001", "string_data_right_truncation"],
  ["42501", "insufficient_privilege"], ["57014", "query_canceled"], ["40001", "serialization_failure"],
  ["40P01", "deadlock_detected"], ["P0001", "raised_exception"],
]);

export function safeDatabaseDiagnostic(input) {
  const asText = value => Buffer.isBuffer(value) ? value.toString("utf8") : typeof value === "string" ? value : "";
  const isProcessError = input && typeof input === "object" && !Buffer.isBuffer(input);
  const text = isProcessError ? `${asText(input.stderr)}\n${asText(input.stdout)}` : asText(input);
  // Parse both CLI streams because the CLI may put a failed query response on
  // stdout. Keep only SQLSTATEs, fixed categories, and bounded process fields;
  // never emit raw CLI output, which can contain row values or credentials.
  const match = text.match(/(?:SQLSTATE\s*[:=]?\s*|\bcode\s*[:=]\s*["']?)([0-9A-Z]{5})\b/i);
  const sqlstate = match?.[1]?.toUpperCase() ?? null;
  let sanitizedMessage = sqlstate ? SQLSTATE_MESSAGES.get(sqlstate) ?? "postgresql_error" : "database_cli_error_without_sqlstate";
  if (!sqlstate) {
    if (/certificate|tls|ssl handshake/i.test(text)) sanitizedMessage = "tls_connection_error";
    else if (/password authentication failed|authentication failed|unauthorized|invalid login/i.test(text)) sanitizedMessage = "database_authentication_error";
    else if (/timeout|timed out|deadline exceeded/i.test(text)) sanitizedMessage = "database_cli_timeout";
    else if (/connection refused|connection reset|could not connect|server closed the connection|no route to host|network is unreachable/i.test(text)) sanitizedMessage = "database_connection_error";
    else if (/unknown flag|unknown option|unexpected argument/i.test(text)) sanitizedMessage = "database_cli_argument_error";
  }
  const diagnostic = {
    postgresSqlstate: sqlstate,
    sanitizedMessage,
  };
  if (isProcessError) {
    if (Number.isSafeInteger(input.status)) diagnostic.cliExitCode = Math.abs(input.status);
    if (typeof input.signal === "string" && ["SIGABRT", "SIGBUS", "SIGFPE", "SIGHUP", "SIGILL", "SIGINT", "SIGKILL", "SIGPIPE", "SIGQUIT", "SIGSEGV", "SIGTERM"].includes(input.signal)) diagnostic.cliSignal = input.signal;
    if (input.killed === true) diagnostic.cliKilled = true;
    if (typeof input.code === "string" && ["EACCES", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN", "ENOBUFS", "ENOENT", "ENOTFOUND", "ETIMEDOUT"].includes(input.code)) diagnostic.cliErrorCode = input.code;
  }
  return diagnostic;
}

export function redactedBackfillFailureCode(error) {
  const credentialCode = redactedFailureCode(error);
  if (credentialCode !== "temporary_credential_unexpected_failure") return credentialCode;
  const code = error instanceof Error ? error.message : "";
  if (BACKFILL_FAILURE_CODES.has(code) || /^candidate_backfill_query_exit_(?:[1-9][0-9]*|timeout_or_signal)$/.test(code)) return code;
  return "candidate_backfill_unexpected_failure";
}

export function validateBackfillStatus(rows) {
  if (!Array.isArray(rows) || rows.length === 0) fail("candidate_backfill_status_invalid");
  const total = rows[0]?.total_tables;
  if (!Number.isSafeInteger(total) || total !== rows.length) fail("candidate_backfill_status_invalid");
  const seen = new Set();
  const normalized = rows.map(row => {
    if (!row || !Number.isSafeInteger(row.total_tables) || row.total_tables !== total ||
        !Number.isSafeInteger(row.complete_tables) || !Number.isSafeInteger(row.incomplete_tables) ||
        row.complete_tables + row.incomplete_tables !== total || typeof row.table_name !== "string" || !TABLE.test(row.table_name) ||
        seen.has(row.table_name) || (row.last_id !== null && (typeof row.last_id !== "string" || !UUID.test(row.last_id))) ||
        !Number.isSafeInteger(Number(row.rows_projected)) || Number(row.rows_projected) < 0 || typeof row.complete !== "boolean") fail("candidate_backfill_status_invalid");
    seen.add(row.table_name);
    return { table_name: row.table_name, last_id: row.last_id, rows_projected: Number(row.rows_projected), complete: row.complete };
  });
  const completeCount = normalized.filter(row => row.complete).length;
  if (rows.some(row => row.complete_tables !== completeCount || row.incomplete_tables !== total - completeCount)) fail("candidate_backfill_status_invalid");
  return normalized.sort((a, b) => a.table_name.localeCompare(b.table_name));
}

function validateBatchResult(result, tableName, before) {
  const keys = ["table_name", "previous_cursor", "last_id", "rows_projected", "complete"];
  if (!result || typeof result !== "object" || Array.isArray(result) || !same(Object.keys(result).sort(), [...keys].sort()) ||
      result.table_name !== tableName || result.previous_cursor !== before.last_id ||
      (result.last_id !== null && (typeof result.last_id !== "string" || !UUID.test(result.last_id))) ||
      !Number.isSafeInteger(Number(result.rows_projected)) || Number(result.rows_projected) < before.rows_projected ||
      typeof result.complete !== "boolean") fail("candidate_backfill_batch_result_invalid");
  const changed = result.last_id !== before.last_id || Number(result.rows_projected) !== before.rows_projected || result.complete !== before.complete;
  if (!changed && !result.complete) fail("candidate_backfill_batch_no_progress");
  return { table_name: tableName, last_id: result.last_id, rows_projected: Number(result.rows_projected), complete: result.complete };
}

export async function runCoverageBackfill({ readStatus, runBatch, acquire, onProgress = () => {}, maxNoProgress = 2 }) {
  let status = validateBackfillStatus(await readStatus());
  let noProgress = 0;
  const batchSizes = new Map();
  while (status.some(row => !row.complete)) {
    const before = status.find(row => !row.complete);
    const batchSize = batchSizes.get(before.table_name) ?? BATCH_SIZE;
    const credential = await acquire();
    if (!credential || credential.projectRef !== PROJECT_REF || typeof credential.url !== "string") fail("candidate_backfill_credential_invalid");
    let commandResult;
    try {
      commandResult = validateBatchResult(await runBatch(before.table_name, before.last_id, batchSize, credential), before.table_name, before);
    } catch (error) {
      // A lost response may follow a committed batch. Read the durable checkpoint first.
      status = validateBackfillStatus(await readStatus());
      const actual = status.find(row => row.table_name === before.table_name);
      if (!actual) fail("candidate_backfill_table_disappeared");
      const advanced = actual.last_id !== before.last_id || actual.rows_projected !== before.rows_projected || actual.complete !== before.complete;
      if (advanced) { noProgress = 0; batchSizes.set(before.table_name, BATCH_SIZE); onProgress(status); continue; }
      noProgress += 1;
      if (batchSize > 1) batchSizes.set(before.table_name, Math.max(1, Math.floor(batchSize / 2)));
      else if (noProgress > maxNoProgress) {
        if (error && typeof error === "object") {
          error.safeContext = {
            operation: "coverage_backfill_batch", tableName: before.table_name, batchSize,
            checkpointRowsProjected: before.rows_projected,
            ...(error.safeDatabaseDiagnostic ?? {}),
          };
        }
        throw error;
      }
      continue; // Transaction did not advance its checkpoint; retry is safe.
    }
    status = validateBackfillStatus(await readStatus());
    const actual = status.find(row => row.table_name === before.table_name);
    if (!actual || !same(actual, commandResult)) fail("candidate_backfill_checkpoint_mismatch");
    if (actual.last_id === before.last_id && actual.rows_projected === before.rows_projected && !actual.complete) {
      noProgress += 1;
      if (noProgress > maxNoProgress) fail("candidate_backfill_no_progress");
    } else { noProgress = 0; batchSizes.set(before.table_name, BATCH_SIZE); }
    onProgress(status);
  }
  return { complete: true, tables: status.length, rowsProjected: status.reduce((sum, row) => sum + row.rows_projected, 0), status };
}

function responseRows(value) {
  const parsed = JSON.parse(value);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.data)) return parsed.data;
  if (Array.isArray(parsed?.rows)) return parsed.rows;
  fail("candidate_backfill_query_response_invalid");
}
export function initialCredentialFromEnvironment(environment, now = Date.now(), validateUrl = verifyDirectDatabaseUrl) {
  const keys = ["MIGRATION_DATABASE_URL", "TEMPORARY_DATABASE_ROLE", "TEMPORARY_DATABASE_ISSUED_AT", "TEMPORARY_DATABASE_EXPIRES_AT"];
  const present = keys.filter(key => typeof environment[key] === "string" && environment[key].length > 0);
  if (present.length === 0) return null;
  if (present.length !== keys.length) fail("candidate_backfill_credential_context_invalid");
  const issuedAt = Number(environment.TEMPORARY_DATABASE_ISSUED_AT);
  const expiresAt = Number(environment.TEMPORARY_DATABASE_EXPIRES_AT);
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now || !Number.isSafeInteger(expiresAt) || expiresAt - issuedAt < 60000 ||
      expiresAt - issuedAt > 86400000 || typeof environment.TEMPORARY_DATABASE_ROLE !== "string" ||
      !/^cli_login_[a-z0-9_]{1,53}$/.test(environment.TEMPORARY_DATABASE_ROLE)) {
    fail("candidate_backfill_credential_context_invalid");
  }
  // The coverage migration can consume most of the original five-minute TTL.
  // Discard a credential inside the refresh window and mint a fresh one instead.
  if (expiresAt - now <= 180000) return null;
  validateUrl(environment.MIGRATION_DATABASE_URL, { ...environment, TEMPORARY_DATABASE_ISSUED_AT: String(issuedAt), TEMPORARY_DATABASE_EXPIRES_AT: String(expiresAt) }, []);
  return { url: environment.MIGRATION_DATABASE_URL, role: environment.TEMPORARY_DATABASE_ROLE, issuedAt, expiresAt, projectRef: PROJECT_REF };
}
export function createBackfillCredentialProvider(environment, { now = Date.now, mint = acquireTemporaryCredential,
  mask = value => process.stdout.write(`::add-mask::${value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}\n`),
  validateUrl = verifyDirectDatabaseUrl } = {}) {
  let cachedCredential = initialCredentialFromEnvironment(environment, now(), validateUrl);
  return async () => {
    if (cachedCredential && cachedCredential.expiresAt - now() > 180000) return cachedCredential;
    let credential;
    await mint({ environment, authorize: async () => {}, mask, persist: value => { credential = value; } });
    if (!credential || credential.expiresAt - now() < 90000) fail("candidate_backfill_credential_budget_insufficient");
    cachedCredential = { ...credential, projectRef: PROJECT_REF };
    return cachedCredential;
  };
}
function runSql(sql, credential) {
  verifyDirectDatabaseUrl(credential.url, {
    ...process.env, MIGRATION_DATABASE_URL: credential.url, TEMPORARY_DATABASE_ROLE: credential.role,
    TEMPORARY_DATABASE_ISSUED_AT: String(credential.issuedAt), TEMPORARY_DATABASE_EXPIRES_AT: String(credential.expiresAt),
  }, []);
  const temp = path.join(os.tmpdir(), `candidate-backfill-${process.pid}-${Date.now()}.sql`);
  fs.writeFileSync(temp, sql, { flag: "wx" });
  try {
    return execFileSync("supabase", ["db", "query", "--file", temp, "--output-format", "json", "--agent", "no", "--db-url", credential.url],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    const status = Number.isInteger(error.status) ? String(Math.abs(error.status)) : "timeout_or_signal";
    const failure = Error(`candidate_backfill_query_exit_${status}`);
    failure.safeDatabaseDiagnostic = safeDatabaseDiagnostic(error);
    throw failure;
  } finally { fs.rmSync(temp, { force: true }); }
}

export function createCoverageBatchRunner(query = runSql) {
  return async (table, cursor, size, credential) => {
    if (!TABLE.test(table) || (cursor !== null && !UUID.test(cursor)) || !Number.isSafeInteger(size) || size < 1 || size > BATCH_SIZE) {
      fail("candidate_backfill_arguments_invalid");
    }
    const tableSql = `'${table}'`;
    const cursorSql = cursor === null ? "NULL::uuid" : `'${cursor}'::uuid`;
    const rows = responseRows(query(`SELECT prospect_candidate_private.coverage_backfill_batch(${tableSql}, ${cursorSql}, ${size}) AS result;\n`, credential));
    if (rows.length !== 1) fail("candidate_backfill_batch_response_invalid");
    const result = rows[0].result;
    return typeof result === "string" ? JSON.parse(result) : result;
  };
}

async function main() {
  if (process.argv.length !== 2) fail("candidate_backfill_arguments_invalid");
  if (process.env.CREDENTIAL_GATE !== "candidate-recovery" || process.env.COMPLETE_PHASE !== "coverage-backfill" ||
      process.env.USE_TEMPORARY_DATABASE_CREDENTIAL !== "true" || !process.env.MIGRATION_ACCESS_TOKEN || !process.env.RUNNER_TEMP) fail("candidate_backfill_authorization_invalid");
  execFileSync(process.execPath, [path.join(ROOT, "scripts/prospect-enrichment/candidate-recovery-gate.mjs"), "credential-authorization"], { cwd: ROOT, stdio: "pipe" });
  const acquire = createBackfillCredentialProvider(process.env);
  const statusQuery = async () => {
    const credential = await acquire();
    try {
      return responseRows(runSql("SELECT * FROM prospect_candidate_private.coverage_backfill_status();\n", credential));
    } catch (error) {
      if (error && typeof error === "object") error.safeContext = { operation: "coverage_backfill_status", ...(error.safeDatabaseDiagnostic ?? {}) };
      throw error;
    }
  };
  const runBatch = createCoverageBatchRunner();
  const markerPath = path.join(path.resolve(process.env.RUNNER_TEMP), "candidate-recovery", "coverage-backfill-marker.json");
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify({ phase: "candidate-coverage-backfill", state: "started_unverified", replayAllowed: false, readOnlyReconciliationRequired: true }) + "\n");
  try {
    const result = await runCoverageBackfill({ readStatus: statusQuery, runBatch, acquire,
      onProgress: status => process.stdout.write(JSON.stringify({ event: "coverage_backfill_checkpoint", completeTables: status.filter(row => row.complete).length,
        totalTables: status.length, rowsProjected: status.reduce((sum, row) => sum + row.rows_projected, 0) }) + "\n"),
    });
    const receipt = { state: "backfill_complete_readback_pending", complete: true, tables: result.tables, rowsProjected: result.rowsProjected,
      finishedAt: new Date().toISOString(), batchSize: BATCH_SIZE, progressSource: "database_checkpoints" };
    fs.writeFileSync(path.join(path.dirname(markerPath), "coverage-backfill-receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
    fs.rmSync(markerPath, { force: true });
    process.stdout.write(JSON.stringify(receipt) + "\n");
  } catch (error) {
    const diagnostic = error && typeof error === "object" ? error.safeContext : null;
    process.stderr.write(`${JSON.stringify({ event: "coverage_backfill_failure", code: redactedBackfillFailureCode(error), ...(diagnostic ?? {}) })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
