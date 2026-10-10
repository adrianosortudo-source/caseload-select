import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANDIDATE_PROJECTION_REPAIR_PATH,
  PROJECT_REF,
  sha256,
  verifyFullMigrationLedger,
} from "./migration-gate.mjs";

export const REPAIR_PATH = CANDIDATE_PROJECTION_REPAIR_PATH;
export const REPAIR_SHA256 = "01a95245ecd1604ffde65ec4b82adfe1e7fca8b6cc7bd4ce6e46e53a8b173928";
export const RELEASE_PATH = "scripts/prospect-enrichment/projection-repair-release.json";
export const RECORD_HISTORY_SIGNATURE = "prospect_candidate_private.record_history(uuid,bigint,text,text,text,uuid,text,uuid,jsonb,text,jsonb,jsonb,uuid)";
export const STORE_CONTENT_SIGNATURE = "prospect_candidate_private.store_revision_content(uuid)";
export const REPAIR_CONFIRMATION = "APPLY-PROSPECT-PROJECTION-INSERT-REPAIR-V1";
export const ORIGINAL_FUNCTION_SHA256 = Object.freeze({
  [RECORD_HISTORY_SIGNATURE]: "e7380bec5baa9e371d40a7e92273f2a20769c6a99d77de282abb015c24fd4abb",
  [STORE_CONTENT_SIGNATURE]: "2962b46e4b4791ff3ceadf92c05ab3e935dfc550f9faca40a382e454ce11d937",
});
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => record(value) && same(Object.keys(value).sort(), [...keys].sort());
const fail = code => { throw new Error(code); };
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const rows = value => Array.isArray(value) ? value : record(value) && Array.isArray(value.data) ? value.data : record(value) && Array.isArray(value.rows) ? value.rows : fail("candidate_projection_repair_query_shape_invalid");

export function verifyProjectionRepairReceipt(receipt, migrationBytes) {
  const keys = ["approvalGranted", "migration", "projectRef", "reviewOnly", "schemaVersion"];
  if (!exact(receipt, keys) || receipt.schemaVersion !== "prospect-projection-repair-release/v1" ||
      receipt.projectRef !== PROJECT_REF || receipt.reviewOnly !== true || receipt.approvalGranted !== false ||
      !exact(receipt.migration, ["bytes", "name", "path", "sha256", "version"]) ||
      receipt.migration.path !== REPAIR_PATH || receipt.migration.version !== "20261009191000" ||
      receipt.migration.name !== "prospect_candidate_projection_insert_reuse" ||
      !Buffer.isBuffer(migrationBytes) || receipt.migration.bytes !== migrationBytes.length ||
      receipt.migration.sha256 !== REPAIR_SHA256 || sha256(migrationBytes) !== REPAIR_SHA256) {
    fail("candidate_projection_repair_receipt_invalid");
  }
  return { verified: true, reviewOnly: true, productionApplicationApproved: false, migration: receipt.migration };
}

export function verifyProjectionRepairSource(input) {
  const env = input?.environment;
  if (!record(env) || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_REPOSITORY !== "adrianosortudo-source/caseload-select" || env.GITHUB_RUN_ATTEMPT !== "1" ||
      !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "") || env.PROJECT_REF !== PROJECT_REF ||
      env.USE_TEMPORARY_DATABASE_CREDENTIAL !== "true" || env.REPAIR_CONFIRMATION !== REPAIR_CONFIRMATION ||
      !/^[a-f0-9]{40}$/.test(env.REVIEWED_SOURCE_SHA ?? "") || input.checkoutSha !== env.REVIEWED_SOURCE_SHA ||
      input.mainSha !== input.checkoutSha || env.GITHUB_SHA !== input.checkoutSha ||
      !/^[a-f0-9]{64}$/.test(env.REVIEWED_RECEIPT_SHA256 ?? "") ||
      input.actualReceiptSha256 !== env.REVIEWED_RECEIPT_SHA256 || input.actualMigrationSha256 !== REPAIR_SHA256) {
    fail("candidate_projection_repair_source_or_confirmation_invalid");
  }
  return { runId: env.GITHUB_RUN_ID, sourceSha: input.checkoutSha, projectRef: PROJECT_REF,
    receiptSha256: input.actualReceiptSha256, migrationSha256: input.actualMigrationSha256 };
}

export function verifyProjectionRepairPlan(plan, phase = "pre") {
  const pending = phase === "pre" ? [path.posix.basename(REPAIR_PATH)] : [];
  if (!["pre", "post"].includes(phase) || !record(plan) || plan.dryRun !== true ||
      plan.upToDate !== (phase === "post") || !same(plan.migrations, pending) ||
      !same(plan.seeds, []) || !same(plan.roles, [])) fail("candidate_projection_repair_exact_singleton_plan_required");
  return { phase, dryRun: true, upToDate: phase === "post", migrations: pending, seeds: [], roles: [] };
}

export function verifyProjectionRepairLedger(rows, sourceRoot = ROOT, phase = "pre") {
  if (!["pre", "post"].includes(phase)) fail("candidate_projection_repair_phase_invalid");
  const proof = verifyFullMigrationLedger(rows, sourceRoot,
    phase === "pre" ? "candidate-projection-repair-pending" : "complete",
    phase === "pre" ? [REPAIR_PATH] : undefined);
  return { ...proof, migrationSha256: REPAIR_SHA256 };
}

function migrationFunctionHashes(source) {
  const sql = source.toString("utf8").replace(/\r\n/g, "\n");
  const result = {};
  for (const [signature, name] of [[RECORD_HISTORY_SIGNATURE, "record_history"], [STORE_CONTENT_SIGNATURE, "store_revision_content"]]) {
    const marker = `CREATE OR REPLACE FUNCTION prospect_candidate_private.${name}(`;
    const start = sql.indexOf(marker);
    if (start < 0 || sql.indexOf(marker, start + marker.length) >= 0) fail("candidate_projection_repair_function_source_invalid");
    const bodyStart = sql.indexOf("AS $function$", start), bodyEnd = sql.indexOf("$function$", bodyStart + 13);
    if (bodyStart < 0 || bodyEnd < 0) fail("candidate_projection_repair_function_source_invalid");
    result[signature] = sha256(Buffer.from(sql.slice(bodyStart + 13, bodyEnd), "utf8"));
  }
  return result;
}

export function projectionRepairCatalogQuery() {
  return `SELECT p.oid::regprocedure::text AS signature, p.proname AS "functionName", oidvectortypes(p.proargtypes) AS "identityArguments",
  r.rolname AS owner, p.prosecdef AS "securityDefiner", p.proconfig AS settings, p.proacl::text AS acl,
  encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') AS "bodySha256"
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
  WHERE n.nspname='prospect_candidate_private' AND p.proname IN ('record_history','store_revision_content')
  ORDER BY p.proname;\n`;
}

export function normalizeProjectionIdentityArguments(value) {
  return typeof value === "string" ? value.replace(/\s*,\s*/g, ",") : value;
}

export function verifyProjectionRepairCatalog(rows, phase = "pre", migrationBytes = fs.readFileSync(path.join(ROOT, REPAIR_PATH))) {
  const signatures = [RECORD_HISTORY_SIGNATURE, STORE_CONTENT_SIGNATURE];
  if (!["pre", "post"].includes(phase) || !Array.isArray(rows) || rows.length !== 2) fail("candidate_projection_repair_catalog_invalid");
  const postHashes = migrationFunctionHashes(migrationBytes);
  const expectedHashes = phase === "pre" ? ORIGINAL_FUNCTION_SHA256 : postHashes;
  for (const [index, row] of rows.entries()) {
    const signature = signatures[index];
    if (!exact(row, ["signature", "functionName", "identityArguments", "owner", "securityDefiner", "settings", "acl", "bodySha256"]) ||
        row.signature !== signature || row.functionName !== (index === 0 ? "record_history" : "store_revision_content") ||
        normalizeProjectionIdentityArguments(row.identityArguments) !== signature.slice(signature.indexOf("(") + 1, -1) || row.owner !== "postgres" ||
        row.securityDefiner !== false || !same(row.settings, ['search_path=""']) || row.acl !== "{postgres=X/postgres}" ||
        row.bodySha256 !== expectedHashes[signature]) fail("candidate_projection_repair_catalog_invalid");
  }
  return { verified: true, phase, signatures, invoker: true, emptySearchPath: true,
    bodySha256: Object.fromEntries(rows.map(row => [row.signature, row.bodySha256])) };
}

export function verifyProjectionRepairEvidence(receipt, migrationBytes, ledgerRows, plan, catalogRows, phase = "pre", sourceRoot = ROOT) {
  const receiptProof = verifyProjectionRepairReceipt(receipt, migrationBytes);
  const ledgerProof = verifyProjectionRepairLedger(ledgerRows, sourceRoot, phase);
  const planProof = verifyProjectionRepairPlan(plan, phase);
  const catalogProof = verifyProjectionRepairCatalog(catalogRows, phase, migrationBytes);
  return { receiptProof, ledgerProof, planProof, catalogProof };
}

async function main([command, ...args]) {
  const source = fs.readFileSync(path.join(ROOT, REPAIR_PATH));
  if (sha256(source) !== REPAIR_SHA256) fail("candidate_projection_repair_source_hash_mismatch");
  if (command === "receipt" && !args.length) {
    const receipt = read(path.join(ROOT, RELEASE_PATH));
    const proof = verifyProjectionRepairReceipt(receipt, source);
    const actual = sha256(fs.readFileSync(path.join(ROOT, RELEASE_PATH)));
    if (actual !== process.env.REVIEWED_RECEIPT_SHA256) fail("candidate_projection_repair_receipt_hash_mismatch");
    console.log(JSON.stringify(proof));
    return;
  }
  if (command === "ledger-query" && !args.length) { process.stdout.write("SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;\n"); return; }
  if (command === "catalog-query" && !args.length) { process.stdout.write(projectionRepairCatalogQuery()); return; }
  if (command === "ledger" && args.length === 3) {
    const proof = verifyProjectionRepairLedger(rows(read(args[0])), args[1], args[2]); console.log(JSON.stringify(proof)); return;
  }
  if (command === "plan" && args.length === 2) {
    const proof = verifyProjectionRepairPlan(read(args[0]), args[1]); console.log(JSON.stringify(proof)); return;
  }
  if (command === "catalog" && args.length === 2) {
    const proof = verifyProjectionRepairCatalog(rows(read(args[0])), args[1], source); console.log(JSON.stringify(proof)); return;
  }
  if (command === "source" && !args.length) {
    const receiptBytes = fs.readFileSync(path.join(ROOT, RELEASE_PATH));
    const checkoutSha = (await import("node:child_process")).execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const mainSha = (await import("node:child_process")).execFileSync("git", ["rev-parse", "origin/main"], { cwd: ROOT, encoding: "utf8" }).trim();
    const proof = verifyProjectionRepairSource({ environment: process.env, checkoutSha, mainSha,
      actualReceiptSha256: sha256(receiptBytes), actualMigrationSha256: sha256(source) });
    verifyProjectionRepairReceipt(JSON.parse(receiptBytes.toString("utf8")), source);
    console.log(JSON.stringify(proof));
    return;
  }
  fail("candidate_projection_repair_usage_invalid");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => {
  const code = error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : "candidate_projection_repair_failed";
  process.stderr.write(code + "\n");
  process.exitCode = 1;
});
