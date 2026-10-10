import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import yaml from "js-yaml";
import { CANDIDATE_PROJECTION_REPAIR_PATH } from "../migration-gate.mjs";
import { PREFLIGHT_FILES, createPreflightBinding, verifyPreflightBinding } from "../candidate-projection-repair-binding.mjs";
import {
  REPAIR_PATH, REPAIR_SHA256, RELEASE_PATH, RECORD_HISTORY_SIGNATURE, STORE_CONTENT_SIGNATURE,
  ORIGINAL_FUNCTION_SHA256, REPAIR_CONFIRMATION, verifyProjectionRepairReceipt, verifyProjectionRepairSource,
  verifyProjectionRepairPlan, verifyProjectionRepairLedger, projectionRepairCatalogQuery, verifyProjectionRepairCatalog,
} from "../candidate-projection-repair-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = fs.readFileSync(path.join(root, REPAIR_PATH));
const receipt = JSON.parse(fs.readFileSync(path.join(root, RELEASE_PATH), "utf8"));
const sha = value => createHash("sha256").update(value).digest("hex");
const baseEnv = {
  GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "adrianosortudo-source/caseload-select",
  GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "42", PROJECT_REF: "ssxryjxifwiivghglqer", USE_TEMPORARY_DATABASE_CREDENTIAL: "true",
  REPAIR_CONFIRMATION, REVIEWED_SOURCE_SHA: "a".repeat(40), GITHUB_SHA: "a".repeat(40), REVIEWED_RECEIPT_SHA256: "b".repeat(64),
};


test("preflight binding producer and both validators share file-keyed hashes and reject missing or tampered files", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "projection-repair-binding-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const file of Object.values(PREFLIGHT_FILES)) fs.writeFileSync(path.join(dir, file), "fixture:" + file);
  const environment = { GITHUB_RUN_ID: "42", GITHUB_RUN_ATTEMPT: "1", REVIEWED_SOURCE_SHA: "a".repeat(40), REVIEWED_RECEIPT_SHA256: "b".repeat(64) };
  const binding = createPreflightBinding(dir, environment);
  assert.deepEqual(Object.keys(binding.sha256).sort(), Object.keys(PREFLIGHT_FILES).sort());
  assert.deepEqual(binding.files, PREFLIGHT_FILES);
  const expected = { ...environment, EXPECTED_MIGRATION_SHA256: binding.migrationSha256 };
  assert.equal(verifyPreflightBinding(dir, binding, expected).fileCount, Object.keys(PREFLIGHT_FILES).length);
  const missing = structuredClone(binding);
  delete missing.files.catalogCheck;
  assert.throws(() => verifyPreflightBinding(dir, missing, expected), /candidate_projection_repair_binding_invalid/);
  fs.writeFileSync(path.join(dir, PREFLIGHT_FILES.catalog), "tampered");
  assert.throws(() => verifyPreflightBinding(dir, binding, expected), /candidate_projection_repair_binding_hash_mismatch/);
});
test("review-only receipt is pinned to the exact existing migration and never grants activation", () => {
  assert.equal(sha(source), REPAIR_SHA256);
  assert.equal(verifyProjectionRepairReceipt(receipt, source).productionApplicationApproved, false);
  for (const changed of [
    { ...receipt, approvalGranted: true }, { ...receipt, reviewOnly: false },
    { ...receipt, migration: { ...receipt.migration, sha256: "0".repeat(64) } },
    { ...receipt, migration: { ...receipt.migration, version: "20261009191001" } },
  ]) assert.throws(() => verifyProjectionRepairReceipt(changed, source), /candidate_projection_repair_receipt_invalid/);
  assert.throws(() => verifyProjectionRepairReceipt(receipt, Buffer.concat([source, Buffer.from("-- changed")])), /candidate_projection_repair_receipt_invalid/);
});

test("source gate requires exact current main, first run, temporary credential, approval phrase and receipt hash", () => {
  const valid = { environment: baseEnv, checkoutSha: baseEnv.GITHUB_SHA, mainSha: baseEnv.GITHUB_SHA,
    actualReceiptSha256: baseEnv.REVIEWED_RECEIPT_SHA256, actualMigrationSha256: REPAIR_SHA256 };
  assert.equal(verifyProjectionRepairSource(valid).migrationSha256, REPAIR_SHA256);
  for (const [name, change] of [
    ["branch", { GITHUB_REF: "refs/heads/codex/other" }], ["event", { GITHUB_EVENT_NAME: "push" }],
    ["repository", { GITHUB_REPOSITORY: "other/repo" }], ["retry", { GITHUB_RUN_ATTEMPT: "2" }],
    ["credential opt-in", { USE_TEMPORARY_DATABASE_CREDENTIAL: "false" }], ["confirmation", { REPAIR_CONFIRMATION: "yes" }],
    ["source", { REVIEWED_SOURCE_SHA: "c".repeat(40) }], ["receipt", { REVIEWED_RECEIPT_SHA256: "d".repeat(64) }],
  ]) assert.throws(() => verifyProjectionRepairSource({ ...valid, environment: { ...baseEnv, ...change } }), /candidate_projection_repair_source_or_confirmation_invalid/, name);
  assert.throws(() => verifyProjectionRepairSource({ ...valid, mainSha: "c".repeat(40) }), /candidate_projection_repair_source_or_confirmation_invalid/);
  assert.throws(() => verifyProjectionRepairSource({ ...valid, actualMigrationSha256: "0".repeat(64) }), /candidate_projection_repair_source_or_confirmation_invalid/);
});

test("dry-run accepts exactly one migration before and none after, with no seeds or roles", () => {
  assert.deepEqual(verifyProjectionRepairPlan({ dryRun: true, upToDate: false, migrations: [path.posix.basename(REPAIR_PATH)], seeds: [], roles: [] }),
    { phase: "pre", dryRun: true, upToDate: false, migrations: [path.posix.basename(REPAIR_PATH)], seeds: [], roles: [] });
  assert.deepEqual(verifyProjectionRepairPlan({ dryRun: true, upToDate: true, migrations: [], seeds: [], roles: [] }, "post").migrations, []);
  for (const plan of [
    { dryRun: false, upToDate: false, migrations: [path.posix.basename(REPAIR_PATH)], seeds: [], roles: [] },
    { dryRun: true, upToDate: false, migrations: [path.posix.basename(REPAIR_PATH), "unreviewed.sql"], seeds: [], roles: [] },
    { dryRun: true, upToDate: false, migrations: [path.posix.basename(REPAIR_PATH)], seeds: ["seed.sql"], roles: [] },
    { dryRun: true, upToDate: false, migrations: [path.posix.basename(REPAIR_PATH)], seeds: [], roles: ["role.sql"] },
  ]) assert.throws(() => verifyProjectionRepairPlan(plan), /candidate_projection_repair_exact_singleton_plan_required/);
});

test("full ledger gate permits only the exact repair as a singleton hole", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "projection-repair-ledger-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const migrationDir = path.join(dir, "supabase", "migrations");
  fs.mkdirSync(migrationDir, { recursive: true });
  fs.writeFileSync(path.join(migrationDir, path.basename(REPAIR_PATH)), source);
  const version = path.basename(REPAIR_PATH).slice(0, 14), name = path.basename(REPAIR_PATH).slice(15, -4);
  assert.deepEqual(verifyProjectionRepairLedger([], dir, "pre").pendingPaths, [REPAIR_PATH]);
  assert.deepEqual(verifyProjectionRepairLedger([{ version, name }], dir, "post").pendingPaths, []);
  assert.throws(() => verifyProjectionRepairLedger([{ version, name: "wrong" }], dir, "post"), /remote_migration_source_missing_or_mismatched/);
  assert.throws(() => verifyProjectionRepairLedger([{ version, name }], dir, "pre"), /unexpected_full_history_delta/);
  assert.throws(() => verifyProjectionRepairLedger([{ version: "20261009191001", name }], dir, "pre"), /remote_migration_source_missing_or_mismatched/);
});

test("catalog gate pins original definitions and preserves owner, ACL and invoker security", () => {
  const signatures = [RECORD_HISTORY_SIGNATURE, STORE_CONTENT_SIGNATURE];
  const rows = signatures.map((signature, index) => ({
    signature, functionName: index === 0 ? "record_history" : "store_revision_content",
    identityArguments: signature.slice(signature.indexOf("(") + 1, -1), owner: "postgres", securityDefiner: false,
    settings: ['search_path=""'], acl: "{postgres=X/postgres}", bodySha256: ORIGINAL_FUNCTION_SHA256[signature],
  }));
  assert.equal(verifyProjectionRepairCatalog(rows, "pre").verified, true);
  assert.match(projectionRepairCatalogQuery(), /prosecdef/);
  for (const changed of [
    rows.map((row, i) => i === 0 ? { ...row, bodySha256: "0".repeat(64) } : row),
    rows.map((row, i) => i === 1 ? { ...row, acl: "{postgres=X/postgres,service_role=X/postgres}" } : row),
    rows.map((row, i) => i === 0 ? { ...row, securityDefiner: true } : row),
    rows.slice(1),
  ]) assert.throws(() => verifyProjectionRepairCatalog(changed, "pre"), /candidate_projection_repair_catalog_invalid/);
});

test("post catalog expects exact source function bodies while retaining the original security envelope", () => {
  const names = ["record_history", "store_revision_content"];
  const rows = names.map((name, index) => {
    const marker = `CREATE OR REPLACE FUNCTION prospect_candidate_private.${name}(`;
    const start = source.toString("utf8").indexOf(marker), bodyStart = source.toString("utf8").indexOf("AS $function$", start) + 13;
    const bodyEnd = source.toString("utf8").indexOf("$function$", bodyStart);
    const signature = index === 0 ? RECORD_HISTORY_SIGNATURE : STORE_CONTENT_SIGNATURE;
    return { signature, functionName: name, identityArguments: signature.slice(signature.indexOf("(") + 1, -1),
      owner: "postgres", securityDefiner: false, settings: ['search_path=""'], acl: "{postgres=X/postgres}",
      bodySha256: sha(Buffer.from(source.toString("utf8").slice(bodyStart, bodyEnd), "utf8")) };
  });
  assert.equal(verifyProjectionRepairCatalog(rows, "post", source).verified, true);
  assert.throws(() => verifyProjectionRepairCatalog(rows.map((row, i) => i === 0 ? { ...row, owner: "service_role" } : row), "post", source), /candidate_projection_repair_catalog_invalid/);
});

test("production workflow is manual, current-main-only, two-review and migration-only", () => {
  const workflow = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/prospect-candidate-projection-repair.yml"), "utf8"));
  const trigger = workflow.on ?? workflow["on"];
  assert.deepEqual(Object.keys(trigger), ["workflow_dispatch"]);
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.deepEqual(workflow.permissions, { contents: "read", actions: "read" });
  assert.match(workflow.jobs.preflight.if, /refs\/heads\/main/);
  assert.match(workflow.jobs.preflight.if, /adrianosortudo-source\/caseload-select/);
  assert.equal(workflow.jobs.preflight.environment, "Production prospect migrations");
  assert.equal(workflow.jobs.verify_preflight.environment, undefined);
  assert.deepEqual(workflow.jobs.apply.needs, ["preflight", "verify_preflight"]);
  assert.equal(workflow.jobs.apply.environment, "Production prospect migrations");
  const apply = workflow.jobs.apply.steps.find(step => step.name === "Apply only the reviewed singleton migration");
  assert.match(apply.run, /supabase db push .*--yes --include-all --skip-vault/);
  assert.ok(workflow.jobs.apply.steps.find(step => (step.name ?? "").includes("Recheck exact pending ledger")));
  assert.ok(workflow.jobs.apply.steps.find(step => (step.name ?? "").includes("Verify exact ledger version")));
  assert.ok(workflow.jobs.preflight.steps.some(step => /candidate-projection-repair-binding.mjs create/.test(step.run ?? "")));
  const bindingValidators = [workflow.jobs.verify_preflight, workflow.jobs.apply].flatMap(job => job.steps).filter(step => /candidate-projection-repair-binding.mjs verify/.test(step.run ?? ""));
  assert.equal(bindingValidators.length, 2);
  assert.ok(CANDIDATE_PROJECTION_REPAIR_PATH.endsWith("20261009191000_prospect_candidate_projection_insert_reuse.sql"));
  const text = JSON.stringify(workflow);
  assert.doesNotMatch(text, /vercel deploy --prod|migration repair --status applied/);
  assert.doesNotMatch(text, /CASELOAD.*CASEY.*REQUEST/i, "the writer workflow must never submit the held-evidence request");
});
