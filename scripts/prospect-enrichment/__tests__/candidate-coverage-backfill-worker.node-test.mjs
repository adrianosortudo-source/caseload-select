import assert from "node:assert/strict";
import test from "node:test";
import { PROJECT_REF } from "../migration-gate.mjs";
import { runCoverageBackfill, validateBackfillStatus } from "../candidate-coverage-backfill-worker.mjs";

const id1 = "00000000-0000-4000-8000-000000000001";
const id2 = "00000000-0000-4000-8000-000000000002";
function rows(states) {
  const total = states.length, completed = states.filter(row => row.complete).length;
  return states.map(row => ({ total_tables: total, complete_tables: completed, incomplete_tables: total - completed,
    table_name: row.table_name, last_id: row.last_id, rows_projected: row.rows_projected, complete: row.complete }));
}
const cred = async () => ({ projectRef: PROJECT_REF, url: "postgresql://masked", role: "cli_login_test", issuedAt: 1, expiresAt: 300001 });

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
