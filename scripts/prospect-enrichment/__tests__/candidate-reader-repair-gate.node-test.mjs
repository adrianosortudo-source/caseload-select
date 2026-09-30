import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  catalogExpectations,
  createReaderRepairReceipt,
  verifyReaderCatalog,
  verifyReaderRepairPlan,
  verifyReaderRepairReceipt,
} from "../candidate-reader-repair-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("reader repair receipt binds the exact coverage-warning migration source", () => {
  const receipt = JSON.parse(fs.readFileSync(path.join(root, "scripts/prospect-enrichment/candidate-reader-repair-review.json"), "utf8"));
  const verified = verifyReaderRepairReceipt(receipt, root);
  assert.equal(verified.verified, true);
  assert.equal(verified.migration.filename, "20260930050000_prospect_candidate_coverage_warning_index.sql");
  assert.equal(verified.productionApplicationApproved, false);
  assert.throws(() => verifyReaderRepairReceipt({ ...receipt, migration: { ...receipt.migration, sha256: "0".repeat(64) } }, root), /reader_repair_receipt_source_mismatch/);
});

test("reader repair preflight allows only the exact migration and post-readback allows none", () => {
  const file = "20260930050000_prospect_candidate_coverage_warning_index.sql";
  assert.deepEqual(verifyReaderRepairPlan(
    { dryRun: true, upToDate: false, migrations: [file], seeds: [], roles: [] },
    { phase: "candidate-reader-repair-pending", pendingPaths: ["supabase/migrations/" + file] },
    "pre",
  ), { phase: "pre", migrations: [file], dryRun: true, upToDate: false, exactScope: true });
  assert.throws(() => verifyReaderRepairPlan(
    { dryRun: true, upToDate: false, migrations: [file, "unexpected.sql"], seeds: [], roles: [] },
    { phase: "candidate-reader-repair-pending", pendingPaths: ["supabase/migrations/" + file] },
    "pre",
  ), /unexpected_reader_repair_plan/);
  assert.deepEqual(verifyReaderRepairPlan(
    { dryRun: true, upToDate: true, migrations: [], seeds: [], roles: [] },
    { phase: "complete", pendingPaths: [] },
    "post",
  ), { phase: "post", migrations: [], dryRun: true, upToDate: true, exactScope: true });
});

test("reader catalog readback requires the date-warning partial index and existing privilege boundary", () => {
  assert.equal(verifyReaderCatalog([{ reader_contract: { ...catalogExpectations } }]).verified, true);
  assert.throws(() => verifyReaderCatalog([{ reader_contract: { ...catalogExpectations, invalid_date_coverage_index: false } }]), /reader_catalog_contract_mismatch/);
});
