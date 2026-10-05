import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  catalogExpectations,
  verifyReaderCatalog,
  verifyReaderRepairPlan,
  verifyReaderRepairReceipt,
} from "../candidate-reader-repair-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("reader repair receipt binds the exact ordered migration sources", () => {
  const receipt = JSON.parse(fs.readFileSync(path.join(root, "scripts/prospect-enrichment/candidate-reader-repair-review.json"), "utf8"));
  const verified = verifyReaderRepairReceipt(receipt, root);
  assert.equal(verified.verified, true);
  assert.deepEqual(verified.migrations.map(item => item.filename), [
    "20260930050000_prospect_candidate_coverage_warning_index.sql",
    "20260930130000_prospect_candidate_reader_defer_legacy_audit.sql",
    "20260930225510_prospect_enrichment_apply_refresh_gate.sql",
    "20261004120000_prospect_candidate_firm_field_fastpath.sql",
    "20261005141204_prospect_candidate_original_status_fastpath.sql",
  ]);
  assert.equal(verified.productionApplicationApproved, false);
  assert.throws(() => verifyReaderRepairReceipt({ ...receipt, migrations: receipt.migrations.map((item, index) => index === 1 ? { ...item, sha256: "0".repeat(64) } : item) }, root), /reader_repair_receipt_source_mismatch/);
});

test("reader repair preflight allows only its exact ordered suffix and post-readback allows none", () => {
  const earlier = "20260930050000_prospect_candidate_coverage_warning_index.sql";
  const later = "20260930130000_prospect_candidate_reader_defer_legacy_audit.sql";
  const refreshGate = "20260930225510_prospect_enrichment_apply_refresh_gate.sql";
  const firmFieldFastpath = "20261004120000_prospect_candidate_firm_field_fastpath.sql";
  const originalStatusFastpath = "20261005141204_prospect_candidate_original_status_fastpath.sql";
  const pending = paths => ({ phase: "candidate-reader-repair-pending", pendingPaths: paths.map(file => "supabase/migrations/" + file) });
  assert.deepEqual(verifyReaderRepairPlan(
    { dryRun: true, upToDate: false, migrations: [earlier, later, refreshGate, firmFieldFastpath, originalStatusFastpath], seeds: [], roles: [] },
    pending([earlier, later, refreshGate, firmFieldFastpath, originalStatusFastpath]),
    "pre",
  ), { phase: "pre", migrations: [earlier, later, refreshGate, firmFieldFastpath, originalStatusFastpath], dryRun: true, upToDate: false, exactScope: true });
  assert.deepEqual(verifyReaderRepairPlan(
    { dryRun: true, upToDate: false, migrations: [refreshGate, firmFieldFastpath, originalStatusFastpath], seeds: [], roles: [] },
    pending([refreshGate, firmFieldFastpath, originalStatusFastpath]),
    "pre",
  ), { phase: "pre", migrations: [refreshGate, firmFieldFastpath, originalStatusFastpath], dryRun: true, upToDate: false, exactScope: true });
  assert.deepEqual(verifyReaderRepairPlan(
    { dryRun: true, upToDate: false, migrations: [later, refreshGate, firmFieldFastpath, originalStatusFastpath], seeds: [], roles: [] },
    pending([later, refreshGate, firmFieldFastpath, originalStatusFastpath]),
    "pre",
  ), { phase: "pre", migrations: [later, refreshGate, firmFieldFastpath, originalStatusFastpath], dryRun: true, upToDate: false, exactScope: true });
  assert.deepEqual(verifyReaderRepairPlan(
    { dryRun: true, upToDate: false, migrations: [originalStatusFastpath], seeds: [], roles: [] },
    pending([originalStatusFastpath]),
    "pre",
  ), { phase: "pre", migrations: [originalStatusFastpath], dryRun: true, upToDate: false, exactScope: true });

  assert.throws(() => verifyReaderRepairPlan(
    { dryRun: true, upToDate: false, migrations: [earlier, refreshGate], seeds: [], roles: [] },
    pending([earlier, refreshGate]),
    "pre",
  ), /unexpected_reader_repair_plan/);
  assert.throws(() => verifyReaderRepairPlan(
    { dryRun: true, upToDate: false, migrations: [earlier, later, firmFieldFastpath], seeds: [], roles: [] },
    pending([earlier, later, firmFieldFastpath]),
    "pre",
  ), /unexpected_reader_repair_plan/);
  assert.deepEqual(verifyReaderRepairPlan(
    { dryRun: true, upToDate: true, migrations: [], seeds: [], roles: [] },
    { phase: "complete", pendingPaths: [] },
    "post",
  ), { phase: "post", migrations: [], dryRun: true, upToDate: true, exactScope: true });
});

test("reader catalog readback requires indexes, privileges and the refresh-trigger security/transition contract", () => {
  assert.equal(verifyReaderCatalog([{ reader_contract: { ...catalogExpectations } }]).verified, true);
  assert.throws(() => verifyReaderCatalog([{ reader_contract: { ...catalogExpectations, invalid_date_coverage_index: false } }]), /reader_catalog_contract_mismatch/);
  assert.throws(() => verifyReaderCatalog([{ reader_contract: { ...catalogExpectations, original_status_exact_index: false } }]), /reader_catalog_contract_mismatch/);
  for (const key of ["apply_refresh_security_definer", "apply_refresh_empty_search_path", "apply_refresh_update_transition",
    "apply_refresh_own_core_audit_excluded", "apply_refresh_current_identity_excluded"]) {
    assert.throws(() => verifyReaderCatalog([{ reader_contract: { ...catalogExpectations, [key]: false } }]), /reader_catalog_contract_mismatch/);
  }
});
