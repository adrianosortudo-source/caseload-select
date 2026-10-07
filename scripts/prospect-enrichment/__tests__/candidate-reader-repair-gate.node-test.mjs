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
  targetLedgerQuery,
  verifyTargetLedgerStatements,
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
     "20261006003626_prospect_candidate_scoped_reader_fastpaths.sql",
      "20261006111650_prospect_candidate_global_text_search_scoped.sql",
      "20261006133000_prospect_candidate_global_text_search_set_identity.sql",
      "20261006150000_prospect_candidate_global_text_search_warning_fastpath.sql",
    "20261006160000_prospect_candidate_global_text_search_index_only.sql",
    "20261006170000_prospect_candidate_global_text_search_direct_scope.sql",
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
   const scopedReader = "20261006003626_prospect_candidate_scoped_reader_fastpaths.sql";
   const globalTextScoped = "20261006111650_prospect_candidate_global_text_search_scoped.sql";
   const setIdentity = "20261006133000_prospect_candidate_global_text_search_set_identity.sql";
   const warningFastpath = "20261006150000_prospect_candidate_global_text_search_warning_fastpath.sql";
  const indexOnly = "20261006160000_prospect_candidate_global_text_search_index_only.sql";
  const directScope = "20261006170000_prospect_candidate_global_text_search_direct_scope.sql";
  const pending = paths => ({ phase: "candidate-reader-repair-pending", pendingPaths: paths.map(file => "supabase/migrations/" + file) });
  assert.deepEqual(verifyReaderRepairPlan(
      { dryRun: true, upToDate: false, migrations: [earlier, later, refreshGate, firmFieldFastpath, originalStatusFastpath, scopedReader, globalTextScoped, setIdentity, warningFastpath,indexOnly,directScope], seeds: [], roles: [] },
      pending([earlier, later, refreshGate, firmFieldFastpath, originalStatusFastpath, scopedReader, globalTextScoped, setIdentity, warningFastpath,indexOnly,directScope]),
    "pre",
      ), { phase: "pre", migrations: [earlier, later, refreshGate, firmFieldFastpath, originalStatusFastpath, scopedReader, globalTextScoped, setIdentity, warningFastpath,indexOnly,directScope], dryRun: true, upToDate: false, exactScope: true });
  assert.deepEqual(verifyReaderRepairPlan(
      { dryRun: true, upToDate: false, migrations: [refreshGate, firmFieldFastpath, originalStatusFastpath, scopedReader, globalTextScoped, setIdentity, warningFastpath,indexOnly,directScope], seeds: [], roles: [] },
      pending([refreshGate, firmFieldFastpath, originalStatusFastpath, scopedReader, globalTextScoped, setIdentity, warningFastpath,indexOnly,directScope]),
    "pre",
      ), { phase: "pre", migrations: [refreshGate, firmFieldFastpath, originalStatusFastpath, scopedReader, globalTextScoped, setIdentity, warningFastpath,indexOnly,directScope], dryRun: true, upToDate: false, exactScope: true });
  assert.deepEqual(verifyReaderRepairPlan(
      { dryRun: true, upToDate: false, migrations: [later, refreshGate, firmFieldFastpath, originalStatusFastpath, scopedReader, globalTextScoped, setIdentity, warningFastpath,indexOnly,directScope], seeds: [], roles: [] },
      pending([later, refreshGate, firmFieldFastpath, originalStatusFastpath, scopedReader, globalTextScoped, setIdentity, warningFastpath,indexOnly,directScope]),
    "pre",
      ), { phase: "pre", migrations: [later, refreshGate, firmFieldFastpath, originalStatusFastpath, scopedReader, globalTextScoped, setIdentity, warningFastpath,indexOnly,directScope], dryRun: true, upToDate: false, exactScope: true });
  assert.deepEqual(verifyReaderRepairPlan(
      { dryRun: true, upToDate: false, migrations: [originalStatusFastpath, scopedReader, globalTextScoped, setIdentity, warningFastpath,indexOnly,directScope], seeds: [], roles: [] },
      pending([originalStatusFastpath, scopedReader, globalTextScoped, setIdentity, warningFastpath,indexOnly,directScope]),
    "pre",
      ), { phase: "pre", migrations: [originalStatusFastpath, scopedReader, globalTextScoped, setIdentity, warningFastpath,indexOnly,directScope], dryRun: true, upToDate: false, exactScope: true });
  assert.deepEqual(verifyReaderRepairPlan(
      { dryRun: true, upToDate: false, migrations: [scopedReader, globalTextScoped, setIdentity, warningFastpath,indexOnly,directScope], seeds: [], roles: [] },
      pending([scopedReader, globalTextScoped, setIdentity, warningFastpath,indexOnly,directScope]),
    "pre",
      ), { phase: "pre", migrations: [scopedReader, globalTextScoped, setIdentity, warningFastpath,indexOnly,directScope], dryRun: true, upToDate: false, exactScope: true });

  assert.deepEqual(verifyReaderRepairPlan(
    { dryRun: true, upToDate: false, migrations: [setIdentity, warningFastpath,indexOnly,directScope], seeds: [], roles: [] },
    pending([setIdentity, warningFastpath,indexOnly,directScope]),
    "pre",
  ), { phase: "pre", migrations: [setIdentity, warningFastpath,indexOnly,directScope], dryRun: true, upToDate: false, exactScope: true });

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
  for (const key of ["private_firm_list_service_role_execute", "firm_list_security_definer", "firm_list_empty_search_path",
    "private_text_list_service_role_execute", "text_list_security_definer", "text_list_empty_search_path", "public_list_text_dispatch",
    "public_list_security_invoker", "public_list_empty_search_path", "public_list_firm_dispatch",
    "apply_refresh_security_definer", "apply_refresh_empty_search_path", "apply_refresh_update_transition",
    "apply_refresh_own_core_audit_excluded", "apply_refresh_current_identity_excluded"]) {
    assert.throws(() => verifyReaderCatalog([{ reader_contract: { ...catalogExpectations, [key]: false } }]), /reader_catalog_contract_mismatch/);
  }
});

test("target ledger query includes every reviewed reader-repair migration and rejects an incomplete read-back", () => {
  const receipt = JSON.parse(fs.readFileSync(path.join(root, "scripts/prospect-enrichment/candidate-reader-repair-review.json"), "utf8"));
  const versions = receipt.migrations.map(item => item.version);
  const expectedQuery = `SELECT version,name,statements FROM supabase_migrations.schema_migrations WHERE version IN (${versions.map(version => `'${version}'`).join(",")}) ORDER BY version;\n`;
  assert.equal(targetLedgerQuery(), expectedQuery);
   assert.equal((targetLedgerQuery().match(/'\d{14}'/g) ?? []).length, 11);

  const rows = receipt.migrations.map(({ version, name }) => ({ version, name, statements: ["SELECT 1"] }));
  assert.throws(() => verifyTargetLedgerStatements(rows.slice(0, 4), root), /reader_repair_target_ledger_invalid/);
});

test("read-only reader reconciliation is protected and contains no database writer", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/prospect-candidate-reader-reconcile.yml"), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment:\s*\n\s+name: Production prospect migrations/);
  assert.match(workflow, /candidate-reader-repair-gate\.mjs target-ledger-query/);
  assert.match(workflow, /candidate-reader-repair-gate\.mjs target-ledger/);
  assert.match(workflow, /candidate-reader-repair-gate\.mjs catalog/);
  assert.match(workflow, /--dry-run/);
  assert.doesNotMatch(workflow, /--yes/);
  assert.equal((workflow.match(/supabase\s+db\s+push/g) ?? []).length, 1);
  assert.match(workflow, /supabase db push[^\n]*--dry-run[^\n]*--include-all/);
});
