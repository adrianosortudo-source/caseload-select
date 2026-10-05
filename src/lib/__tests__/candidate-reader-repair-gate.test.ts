import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  catalogQuery, verifyReaderCatalog, verifyReaderRepairPlan,
  verifyReaderRepairReceipt,
} from "../../../scripts/prospect-enrichment/candidate-reader-repair-gate.mjs";
const source = verifyReaderRepairReceipt(JSON.parse(fs.readFileSync("scripts/prospect-enrichment/candidate-reader-repair-review.json","utf8")));
const expectCatalog = {
 candidate_list_service_role_execute:true,candidate_list_anon_execute:false,candidate_list_auth_execute:false,
 candidate_detail_service_role_execute:true,candidate_detail_anon_execute:false,candidate_detail_auth_execute:false,
 candidate_history_service_role_execute:true,candidate_history_anon_execute:false,candidate_history_auth_execute:false,
 candidate_chunk_service_role_execute:true,candidate_chunk_anon_execute:false,candidate_chunk_auth_execute:false,
 private_list_service_role_execute:true,private_list_anon_execute:false,private_list_auth_execute:false,
 private_firm_links_service_role_execute:false,private_firm_links_anon_execute:false,private_firm_links_auth_execute:false,
 history_metadata_search_index:true,identity_by_candidate_index:true,identity_by_firm_index:true,
 invalid_date_coverage_index:true,
 apply_refresh_security_definer:true,apply_refresh_empty_search_path:true,
 apply_refresh_update_transition:true,apply_refresh_own_core_audit_excluded:true,
 apply_refresh_current_identity_excluded:true
};
describe("candidate reader repair gate", () => {
 it("binds the review receipt to all four exact migration sources and never grants write approval", () => {
  expect(source.verified).toBe(true);
  expect(source.productionApplicationApproved).toBe(false);
  expect(source.migrations.map(item => item.filename)).toEqual([
   "20260930050000_prospect_candidate_coverage_warning_index.sql",
   "20260930130000_prospect_candidate_reader_defer_legacy_audit.sql",
   "20260930225510_prospect_enrichment_apply_refresh_gate.sql",
   "20261004120000_prospect_candidate_firm_field_fastpath.sql",
  ]);
  const receipt=JSON.parse(fs.readFileSync("scripts/prospect-enrichment/candidate-reader-repair-review.json","utf8"));
  const changedReceipt={...receipt,migrations:[...receipt.migrations]};
  changedReceipt.migrations[1]={...changedReceipt.migrations[1],sha256:"0".repeat(64)};
  expect(()=>verifyReaderRepairReceipt(changedReceipt)).toThrow("reader_repair_receipt_source_mismatch");
  changedReceipt.migrations=[...receipt.migrations];
  changedReceipt.migrations[2]={...changedReceipt.migrations[2],sha256:"0".repeat(64)};
  expect(()=>verifyReaderRepairReceipt(changedReceipt)).toThrow("reader_repair_receipt_source_mismatch");
  changedReceipt.migrations=[...receipt.migrations];
  changedReceipt.migrations[3]={...changedReceipt.migrations[3],sha256:"0".repeat(64)};
  expect(()=>verifyReaderRepairReceipt(changedReceipt)).toThrow("reader_repair_receipt_source_mismatch");
 });
 it("accepts only the exact ordered pending suffix and empty post-plan", () => {
  const first="20260930050000_prospect_candidate_coverage_warning_index.sql";
  const second="20260930130000_prospect_candidate_reader_defer_legacy_audit.sql";
  const third="20260930225510_prospect_enrichment_apply_refresh_gate.sql";
  const fourth="20261004120000_prospect_candidate_firm_field_fastpath.sql";
  const pending=(files:string[])=>({phase:"candidate-reader-repair-pending",pendingPaths:files.map(file=>"supabase/migrations/"+file)});
  expect(verifyReaderRepairPlan({dryRun:true,upToDate:false,migrations:[first,second,third,fourth],seeds:[],roles:[]},pending([first,second,third,fourth]),"pre").exactScope).toBe(true);
  expect(verifyReaderRepairPlan({dryRun:true,upToDate:false,migrations:[second,third,fourth],seeds:[],roles:[]},pending([second,third,fourth]),"pre").exactScope).toBe(true);
  expect(verifyReaderRepairPlan({dryRun:true,upToDate:false,migrations:[third,fourth],seeds:[],roles:[]},pending([third,fourth]),"pre").exactScope).toBe(true);
  expect(verifyReaderRepairPlan({dryRun:true,upToDate:false,migrations:[fourth],seeds:[],roles:[]},pending([fourth]),"pre").exactScope).toBe(true);
  expect(()=>verifyReaderRepairPlan({dryRun:true,upToDate:false,migrations:[first,third,fourth],seeds:[],roles:[]},pending([first,third,fourth]),"pre")).toThrow("unexpected_reader_repair_plan");
  expect(()=>verifyReaderRepairPlan({dryRun:true,upToDate:false,migrations:[first,second,fourth],seeds:[],roles:[]},pending([first,second,fourth]),"pre")).toThrow("unexpected_reader_repair_plan");
  expect(()=>verifyReaderRepairPlan({dryRun:true,upToDate:false,migrations:[fourth,third],seeds:[],roles:[]},pending([fourth,third]),"pre")).toThrow("unexpected_reader_repair_plan");
  expect(()=>verifyReaderRepairPlan({dryRun:true,upToDate:true,migrations:[],seeds:[],roles:[]},pending([first,second]),"post")).toThrow("invalid_reader_repair_plan");
  expect(verifyReaderRepairPlan({dryRun:true,upToDate:true,migrations:[],seeds:[],roles:[]},{phase:"complete",pendingPaths:[]},"post").upToDate).toBe(true);
 });
 it("binds two protected reviews to one source and makes apply depend on a read-only artifact", () => {
  const workflow=fs.readFileSync(".github/workflows/prospect-candidate-reader-repair.yml","utf8");
  expect(workflow).toMatch(/^on:\s*\n  workflow_dispatch:/m);
  expect(workflow.match(/^  preflight:/gm)).toHaveLength(1);
  expect(workflow.match(/^  apply:/gm)).toHaveLength(1);
  expect(workflow.match(/name: Production prospect migrations/g)).toHaveLength(2);
  expect(workflow).toContain("group: gta-prospect-migrations-production");
  const preflight=workflow.slice(workflow.indexOf("  preflight:"),workflow.indexOf("  apply:"));
  const apply=workflow.slice(workflow.indexOf("  apply:"));
  expect(apply).toContain("needs: preflight");
  expect(preflight).not.toMatch(/supabase db push[^\n]*--yes/);
  expect(apply.indexOf("PLAN_PHASE=pre")).toBeLessThan(apply.indexOf("--yes"));
  expect(apply.indexOf("verify-stage")).toBeLessThan(apply.indexOf("--yes"));
  expect([...workflow.matchAll(/^\s+uses: .+$/gm)].every(step => /@[a-f0-9]{40}$/.test(step[0].trim().replace(/^uses: /,"").replace(/\s+#.*$/,"")))).toBe(true);
 });
 it("requires exact candidate reader grants, private helper revocation and supporting indexes", () => {
  expect(catalogQuery).toContain("has_function_privilege('anon'");
  expect(verifyReaderCatalog([{reader_contract:expectCatalog}]).catalogChecks).toBe(27);
  expect(()=>verifyReaderCatalog([{reader_contract:{...expectCatalog,candidate_list_anon_execute:true}}])).toThrow("reader_catalog_contract_mismatch");
  expect(()=>verifyReaderCatalog([{reader_contract:{...expectCatalog,identity_by_firm_index:false}}])).toThrow("reader_catalog_contract_mismatch");
  for(const field of ["apply_refresh_security_definer","apply_refresh_empty_search_path","apply_refresh_update_transition",
   "apply_refresh_own_core_audit_excluded","apply_refresh_current_identity_excluded"]) {
   expect(catalogQuery).toContain(field);
   expect(()=>verifyReaderCatalog([{reader_contract:{...expectCatalog,[field]:false}}])).toThrow("reader_catalog_contract_mismatch");
  }
 });
});
