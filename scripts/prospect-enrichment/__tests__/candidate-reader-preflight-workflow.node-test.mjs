import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const yaml = createRequire(import.meta.url)("js-yaml");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const preflightPath = ".github/workflows/prospect-candidate-reader-preflight.yml";
const combinedPath = ".github/workflows/prospect-candidate-reader-repair.yml";

test("reader-repair preflight is static-only, read-only, protected, and bound to the reviewed 14-migration receipt", () => {
  const workflowText = fs.readFileSync(path.join(root, preflightPath), "utf8");
  const workflow = yaml.load(workflowText);
  const combined = yaml.load(fs.readFileSync(path.join(root, combinedPath), "utf8"));
  const job = workflow.jobs.preflight;
  const combinedJob = combined.jobs.preflight;
  const steps = job.steps;
  const step = name => steps.find(item => item.name === name);

  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(Object.keys(workflow.on.workflow_dispatch.inputs), ["reviewed_source_sha"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.reviewed_source_sha.required, true);
  assert.deepEqual(Object.keys(workflow.jobs), ["preflight"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.concurrency.group, "gta-prospect-migrations-production");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.equal(job.if, combinedJob.if);
  assert.equal(job.uses, undefined);
  assert.equal(job.environment.name, "Production prospect migrations");
  assert.equal(job.env.PROJECT_REF, "ssxryjxifwiivghglqer");
  assert.equal(job.env.REVIEWED_SOURCE_SHA, "${{ inputs.reviewed_source_sha }}");
  assert.ok(steps.every(item => item.if === undefined && item["continue-on-error"] !== true));
  assert.ok(steps.filter(item => item.uses).every(item => /@[0-9a-f]{40}$/.test(item.uses)));

  const checkout = step("Check out the exact dispatch commit");
  const combinedCheckout = combinedJob.steps.find(item => item.name === checkout.name);
  assert.equal(checkout.uses, combinedCheckout.uses);
  assert.deepEqual(checkout.with, combinedCheckout.with);

  for (const name of [
    "Verify exact current main source and reader receipt",
    "Configure pinned database TLS",
    "Install pinned Supabase CLI",
    "Validate protected connection and reviewed CLI",
    "Verify existing additive receipt, ledger statements and prerequisite catalog",
    "Require exactly the reader-repair migration suffix in full-ledger preflight",
    "Bind preflight evidence to run, source and migration",
  ]) {
    assert.deepEqual(step(name), combinedJob.steps.find(item => item.name === name), "changed retained safety step: " + name);
  }

  const connection = step("Load protected static database connection");
  assert.deepEqual(connection.env, {
    STATIC_MIGRATION_DATABASE_URL: "${{ secrets.CASELOAD_PRODUCTION_SUPABASE_MIGRATOR_DB_URL }}",
  });
  assert.equal(connection.if, undefined);
  assert.match(connection.run, /test -n "\$STATIC_MIGRATION_DATABASE_URL"/);
  assert.match(connection.run, /MIGRATION_DATABASE_URL=%s/);

  const currentMainCheck = step("Verify exact current main source and reader receipt");
  assert.match(currentMainCheck.run, /REVIEWED_SOURCE_SHA.*git rev-parse HEAD/);
  assert.match(currentMainCheck.run, /REVIEWED_SOURCE_SHA.*\$GITHUB_SHA/);
  assert.match(currentMainCheck.run, /git fetch --no-tags origin main/);
  assert.match(currentMainCheck.run, /REVIEWED_SOURCE_SHA.*git rev-parse origin\/main/);
  assert.match(currentMainCheck.run, /candidate-reader-repair-gate\.mjs source/);
  assert.match(currentMainCheck.run, /additive-release-gate\.mjs receipt/);

  assert.match(step("Configure pinned database TLS").run, /configure-migration-tls\.mjs/);
  assert.equal(step("Install pinned Supabase CLI").with.version, "2.117.0");
  assert.match(step("Validate protected connection and reviewed CLI").run, /migration-gate\.mjs connection/);
  assert.match(step("Verify existing additive receipt, ledger statements and prerequisite catalog").run, /--agent no/);

  const fullLedger = step("Require exactly the reader-repair migration suffix in full-ledger preflight");
  const combinedFullLedger = combined.jobs.preflight.steps.find(item => item.name === fullLedger.name);
  assert.equal(fullLedger.run, combinedFullLedger.run);
  assert.ok(fullLedger.run.indexOf("reader-history-query") < fullLedger.run.indexOf("reader-history-stage"));
  assert.ok(fullLedger.run.indexOf("reader-history-stage") < fullLedger.run.indexOf("full-ledger-check.json"));
  assert.match(fullLedger.run, /candidate-reader-repair-held-pending/);
  assert.match(fullLedger.run, /reader-repair-stage/);
  const fullLedgerCommand = fullLedger.run.split("\n").find(line => line.includes("migration-gate.mjs full-ledger "));
  assert.ok(fullLedgerCommand, "full-ledger command is missing");
  assert.match(fullLedgerCommand, /full-ledger\.json" "\$RUNNER_TEMP\/reader-migrations" candidate-reader-repair-held-pending '[^']*' "\$GITHUB_WORKSPACE" > "\$RUNNER_TEMP\/full-ledger-check\.json"/);
  assert.match(fullLedger.run, /--dry-run --include-all --skip-vault/);
  assert.match(fullLedger.run, /reader-history-cleanup/);
  assert.ok(fullLedger.run.indexOf("reader-history-cleanup") < fullLedger.run.indexOf("verify-stage"));
  assert.match(fullLedger.run, /PLAN_PHASE=pre/);
  assert.doesNotMatch(fullLedger.run, /--yes/);

  const applyReadback = combined.jobs.apply.steps.find(item => item.name === "Verify exact migration ledger statements, catalog contract and empty plan");
  assert.match(applyReadback.run, /reader-history-query/);
  assert.match(applyReadback.run, /reader-repair-stage/);
  assert.match(applyReadback.run, /reader-history-stage/);
  assert.match(applyReadback.run, /reader-history-cleanup/);
  assert.ok(applyReadback.run.indexOf("reader-history-stage") < applyReadback.run.indexOf("full-ledger-check.json"));
  assert.ok(applyReadback.run.indexOf("reader-history-cleanup") < applyReadback.run.indexOf("verify-stage"));
  assert.match(applyReadback.run, /post-full-ledger\.json" "\$RUNNER_TEMP\/reader-migrations-post" candidate-reader-repair-held-complete - "\$GITHUB_WORKSPACE"/);

  const applyMigration = combined.jobs.apply.steps.find(item => item.name === "Recheck original receipt, full ledger and exact dry-run before apply");
  const guardStage = applyMigration.run.indexOf("reader-history-stage");
  const dryRun = applyMigration.run.indexOf("--dry-run --include-all");
  const apply = applyMigration.run.indexOf("--yes --include-all");
  const cleanup = applyMigration.run.indexOf("reader-history-cleanup");
  const cleanInventory = applyMigration.run.indexOf("verify-stage");
  assert.ok(guardStage >= 0 && guardStage < dryRun && dryRun < apply && apply < cleanup && cleanup < cleanInventory,
    "pinned history guards must remain staged for the write and be removed before clean source-inventory verification");
  assert.match(applyMigration.run, /if \(cd .*supabase db push .*--yes --include-all[\s\S]*?then[\s\S]*?apply_status=\$\?/);
  assert.match(applyMigration.run, /echo "apply_started=true"[\s\S]*?--yes --include-all/);
  assert.match(applyMigration.run, /full-ledger\.json" "\$RUNNER_TEMP\/reader-migrations-immediate" candidate-reader-repair-held-pending[\s\S]*? "\$GITHUB_WORKSPACE"/);
  assert.match(applyMigration.run, /reader-repair-stage/);

  const binding = step("Bind preflight evidence to run, source and migration");
  const combinedBinding = combined.jobs.preflight.steps.find(item => item.name === binding.name);
  assert.equal(binding.run, combinedBinding.run);
  assert.match(binding.run, /runId:process\.env\.GITHUB_RUN_ID/);
  assert.match(binding.run, /sourceSha:process\.env\.REVIEWED_SOURCE_SHA/);
  assert.match(binding.run, /receiptSha256:/);
  assert.match(binding.run, /databaseWrites:0/);
  assert.match(binding.run, /r[.]migrations\.length!==14/);

  const upload = step("Upload redacted read-only preflight evidence");
  assert.equal(upload.uses, "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
  const combinedUpload = combinedJob.steps.find(item => item.name === "Upload redacted preflight evidence for second review");
  assert.equal(upload.with.path, combinedUpload.with.path);
  assert.equal(upload.with["if-no-files-found"], combinedUpload.with["if-no-files-found"]);
  assert.equal(upload.with["retention-days"], combinedUpload.with["retention-days"]);
  for (const artifact of [
    "preflight-binding.json",
    "reader-source-check.json",
    "additive-receipt-check.json",
    "connection-check.json",
    "additive-ledger-check.json",
    "additive-complete-check.json",
    "operator-catalog-check.json",
    "staged-inventory.json",
    "full-ledger-check.json",
    "reader-history-reference-check.json",
    "reader-history-stage-check.json",
    "reader-history-cleanup-check.json",
    "reader-history-cleanup-summary.json",
    "preflight-plan-check.json",
    "stage-check.json",
  ]) assert.ok(upload.with.path.includes(artifact), "missing artifact " + artifact);
  assert.equal(upload.with["if-no-files-found"], "error");

  assert.doesNotMatch(workflowText, /CASELOAD_PRODUCTION_SUPABASE_MIGRATOR_TOKEN|MIGRATION_ACCESS_TOKEN|temporary-credential\.mjs|USE_TEMPORARY_DATABASE_CREDENTIAL|use_temporary_database_credential|workflow_call|schedule:/i);
  assert.doesNotMatch(workflowText, /--yes/);
  assert.equal((workflowText.match(/supabase\s+db\s+push\s+--db-url/g) ?? []).length, 1);
  assert.equal((workflowText.match(/--dry-run/g) ?? []).length, 1);
});


test("read-only reader reconciliation verifies pinned historical migration sources and cleans temporary references", () => {
  const workflowPath = ".github/workflows/prospect-candidate-reader-reconcile.yml";
  const workflowText = fs.readFileSync(path.join(root, workflowPath), "utf8");
  const workflow = yaml.load(workflowText);
  const job = workflow.jobs.reconcile;
  const steps = job.steps;
  const step = name => steps.find(item => item.name === name);

  assert.deepEqual(Object.keys(workflow.jobs), ["reconcile"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(job.environment.name, "Production prospect migrations");
  assert.equal(job.env.CREDENTIAL_GATE, "candidate-reader-repair");

  const sourceStage = step("Verify connection and exact reader migration sources");
  assert.match(sourceStage.run, /reader-repair-stage/);
  assert.doesNotMatch(sourceStage.run, /verify-stage/);

  const ledger = step("Read full migration ledger and verify pinned historical source references");
  assert.ok(ledger.run.indexOf("reader-history-query") < ledger.run.indexOf("reader-history-stage"));
  assert.ok(ledger.run.indexOf("reader-history-stage") < ledger.run.indexOf("full-ledger-check.json"));
  assert.match(ledger.run, /candidate-reader-repair-held-complete - "\$GITHUB_WORKSPACE"/);

  const plan = step("Require an empty read-only migration dry-run");
  const cleanup = step("Remove temporary historical migration references and verify clean source stage");
  assert.ok(plan.run.includes("--dry-run --include-all --skip-vault"));
  assert.ok(steps.indexOf(plan) < steps.indexOf(cleanup));
  assert.ok(cleanup.run.indexOf("reader-history-cleanup") < cleanup.run.indexOf("verify-stage"));
  assert.doesNotMatch(workflowText, /--yes/);

  const upload = step("Upload redacted read-only reconciliation evidence");
  for (const artifact of [
    "full-ledger-check.json",
    "reader-history-reference-check.json",
    "reader-history-stage-check.json",
    "reader-history-cleanup-check.json",
    "reader-history-cleanup-summary.json",
    "stage-check.json",
  ]) assert.ok(upload.with.path.includes(artifact), "missing artifact " + artifact);
});
