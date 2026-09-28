import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
  APPLIED_OPERATOR_RPC,
  CATALOG_EXPECTED,
  CANDIDATE_APPLY_CONFIRMATION,
  CANDIDATE_PREREQUISITE_PREFIX_LENGTH,
  MIGRATION_PATHS,
  PROJECT_REF,
  RELEASE_PATH,
  catalogQuery,
  createReleaseReceipt,
  ledgerQuery,
  summarizeLedgerPayload,
  operatorRpcCatalogDiagnostic,
  verifyLedgerState,
  verifyApplicationGate,
  verifyCandidateCompletePrefix,
  verifyCandidatePrerequisitePrefix,
  verifyMigrationPlan,
  verifyOperatorRpcCatalog,
  verifyReleaseReceipt,
  verifySourceGate,
} from "../additive-release-gate.mjs";
import { MIGRATION_PATHS as ORIGINAL_SIX_PATHS, PREVIEW_MIGRATION_PATHS, HISTORICAL_LEDGER_NAME_ALIASES, stageProductionWorkdir, verifyProductionWorkdir, verifyFullMigrationLedger } from "../migration-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const readSources = () => Object.fromEntries([...MIGRATION_PATHS, APPLIED_OPERATOR_RPC.path].map(file => {
  const working = fs.readFileSync(path.join(root, file));
  const committed = execFileSync("git", ["show", "HEAD:" + file], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  const canonicalWorking = Buffer.from(working.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
  assert.ok(canonicalWorking.equals(committed), file + " differs from its committed source beyond checkout line endings");
  return [file, committed];
}));
const realSources = readSources();
const receipt = JSON.parse(fs.readFileSync(path.join(root, RELEASE_PATH), "utf8"));
const receiptSha256 = execFileSync("node", ["-e", "const c=require('node:crypto'),f=require('node:fs');process.stdout.write(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))", path.join(root, RELEASE_PATH)], { encoding: "utf8" });
const fakeSources = Object.fromEntries([...MIGRATION_PATHS, APPLIED_OPERATOR_RPC.path].map(file => [file, Buffer.from("SELECT 1;\n")]));
const fakeReceipt = createReleaseReceipt(fakeSources);
const fakeStatements = ["SELECT 1"];
const rowsForPrefix = (prefixLength) => {
  const versions = [...MIGRATION_PATHS.slice(0, prefixLength), APPLIED_OPERATOR_RPC.path]
    .map(file => path.posix.basename(file)).sort();
  return versions.map(filename => {
    const match = /^(\d{14})_(.+)\.sql$/.exec(filename);
    return { version: match[1], name: match[2], statements: [...fakeStatements] };
  });
};
const gate = {
  event: "workflow_dispatch", ref: "refs/heads/main", repository: "adrianosortudo-source/caseload-select",
  operation: "dry-run", reviewedSourceSha: "a".repeat(40), configuredReviewedSha: "a".repeat(40),
  checkoutSha: "a".repeat(40), githubSha: "a".repeat(40),
  databaseUrl: `postgresql://postgres:synthetic-only@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=verify-full`,
  environment: {}, projectEnvFiles: [],
};

test("review-only receipt binds all eleven ordered release migrations and the applied RPC prerequisite", () => {
  assert.equal(MIGRATION_PATHS.length, 11);
  assert.equal(receipt.reviewOnly, true);
  assert.equal(receipt.productionApplicationApproved, false);
  assert.deepEqual(verifyReleaseReceipt(receipt, realSources), receipt);
  assert.equal(receipt.migrations.length, 11);
  const qualification = receipt.migrations.filter(m => m.path.includes("prospect_qualification_"));
  const candidates = receipt.migrations.filter(m => m.path.includes("candidate_") || m.path.includes("database_firm_profile_link"));
  assert.equal(qualification.length, 2);
  assert.equal(candidates.length, 3);
  assert.equal(receipt.migrations.length - qualification.length - candidates.length, 6);
  assert.equal(receipt.appliedPrerequisite.path, APPLIED_OPERATOR_RPC.path);
  assert.equal(receipt.appliedPrerequisite.expectedCatalog.definitionMd5, "625afed49f4c9cde1084c1acd175ef47");
  assert.ok(receipt.migrations.every(m => m.bytes > 0 && /^[a-f0-9]{64}$/.test(m.sha256)));
  assert.deepEqual(ORIGINAL_SIX_PATHS.length, 6, "the original six-migration contract stays separate");
});

test("receipt rejects changed, missing, extra, reordered and approval-mutated inputs", () => {
  assert.throws(() => verifyReleaseReceipt({ ...receipt, productionApplicationApproved: true }, realSources), /receipt_source_mismatch/);
  assert.throws(() => verifyReleaseReceipt({ ...receipt, migrations: receipt.migrations.slice(1) }, realSources), /receipt_source_mismatch/);
  assert.throws(() => verifyReleaseReceipt({ ...receipt, migrations: [...receipt.migrations].reverse() }, realSources), /receipt_source_mismatch/);
  const alteredSources = { ...realSources, [MIGRATION_PATHS[0]]: Buffer.concat([realSources[MIGRATION_PATHS[0]], Buffer.from("-- altered\n")]) };
  assert.throws(() => verifyReleaseReceipt(receipt, alteredSources), /receipt_source_mismatch/);
  const missing = { ...realSources }; delete missing[MIGRATION_PATHS[0]];
  assert.throws(() => createReleaseReceipt(missing), /exact_release_sources_required/);
  assert.throws(() => createReleaseReceipt({ ...realSources, "supabase/migrations/20990101000000_unreviewed.sql": Buffer.from("SELECT 1;") }), /exact_release_sources_required/);
});

test("ledger query is fixed to the eleven release migrations plus the applied RPC prerequisite", () => {
  const query = ledgerQuery(receipt);
  const versions = [...receipt.migrations.map(m => m.version), receipt.appliedPrerequisite.version].sort();
  assert.equal((query.match(/\d{14}/g) ?? []).length, 12);
  for (const version of versions) assert.match(query, new RegExp(version));
  assert.match(query, /^SELECT version, name, statements FROM supabase_migrations\.schema_migrations WHERE version IN /);
  assert.match(query, /ORDER BY version;\n$/);
});

test("ledger summary reports only row identity and statement-array shape", () => {
  const summary = summarizeLedgerPayload({ data: [
    { version: APPLIED_OPERATOR_RPC.version, name: APPLIED_OPERATOR_RPC.name, statements: null },
    { version: "20260921120000", name: "prospect_qualification_evidence", statements: ["SELECT 'private SQL';"] },
    { version: "attacker SQL SELECT secret", name: "private SQL", statements: [] },
  ] });
  assert.equal(summary.resultShape, "data_array");
  assert.equal(summary.rowCount, 3);
  assert.equal(summary.rows[0].statementField, "null");
  assert.equal(summary.rows[0].statementCount, null);
  assert.equal(summary.rows[0].statementArrayBlankOnly, false);
  assert.equal(summary.rows[1].statementCount, 1);
  assert.equal(summary.rows[1].statementArrayBlankOnly, false);
  assert.equal(summary.rows[1].statementEntryHasOuterWhitespace, false);
  assert.equal(summary.rows[2].identityRecognized, false);
  assert.equal(summary.rows[2].version, null);
  assert.equal(summary.rows[2].name, null);
  assert.doesNotMatch(JSON.stringify(summary), /private SQL|attacker SQL|secret/);
  const blankSummary = summarizeLedgerPayload([{ version: "20260924180541", name: "restore_operator_membership_rpc", statements: [" "] }]);
  assert.equal(blankSummary.rows[0].statementArrayBlankOnly, true);
  assert.equal(blankSummary.rows[0].statementEntryHasOuterWhitespace, true);
  assert.doesNotMatch(JSON.stringify(blankSummary), /statement contents|private SQL/);
  const paddedSummary = summarizeLedgerPayload([{ version: "20260924180541", name: "restore_operator_membership_rpc", statements: [" private SQL "] }]);
  assert.equal(paddedSummary.rows[0].statementArrayBlankOnly, false);
  assert.equal(paddedSummary.rows[0].statementEntryHasOuterWhitespace, true);
  assert.doesNotMatch(JSON.stringify(paddedSummary), /private SQL/);
});

test("ledger accepts only a verified applied RPC plus an exact ordered migration prefix", () => {
  for (const count of [0, 1, 5, 9, 10, 11]) {
    const proof = verifyLedgerState(rowsForPrefix(count), fakeReceipt, fakeSources);
    assert.equal(proof.appliedPrefixLength, count);
    assert.equal(proof.pending.length, 11 - count);
    assert.equal(proof.appliedPrerequisite.version, APPLIED_OPERATOR_RPC.version);
  }
});

test("missing statements are allowed only for the applied RPC when its exact live catalog contract passes", () => {
  const rows = rowsForPrefix(0).map(row => row.version === APPLIED_OPERATOR_RPC.version ? { ...row, statements: null } : row);
  const proof = verifyLedgerState(rows, fakeReceipt, fakeSources);
  assert.equal(proof.appliedPrerequisite.statementContentMatchesReviewedSource, null);
  assert.equal(proof.appliedPrerequisite.statementVerification, "operator_rpc_catalog_contract_required");
  assert.equal(
    verifyOperatorRpcCatalog([CATALOG_EXPECTED], fakeReceipt, rows, fakeSources).ledgerStatementVerification,
    "operator_rpc_catalog_contract_required",
  );
  const emptyRows = rowsForPrefix(0).map(row => row.version === APPLIED_OPERATOR_RPC.version ? { ...row, statements: [] } : row);
  assert.equal(verifyLedgerState(emptyRows, fakeReceipt, fakeSources).appliedPrerequisite.statementCount, 0);
  assert.equal(verifyOperatorRpcCatalog([CATALOG_EXPECTED], fakeReceipt, emptyRows, fakeSources).ledgerStatementVerification, "operator_rpc_catalog_contract_required");
  for (const blankStatements of [[""], ["   ", "\n\t"]]) {
    const blankRows = rowsForPrefix(0).map(row => row.version === APPLIED_OPERATOR_RPC.version ? { ...row, statements: blankStatements } : row);
    const blankProof = verifyLedgerState(blankRows, fakeReceipt, fakeSources);
    assert.equal(blankProof.appliedPrerequisite.statementCount, null);
    assert.equal(blankProof.appliedPrerequisite.statementVerification, "operator_rpc_catalog_contract_required");
    assert.equal(verifyOperatorRpcCatalog([CATALOG_EXPECTED], fakeReceipt, blankRows, fakeSources).ledgerStatementVerification, "operator_rpc_catalog_contract_required");
  }
  const outerWhitespaceRows = rowsForPrefix(1).map(row => ({ ...row, statements: row.statements.map(statement => ` \n${statement}\t `) }));
  const outerWhitespaceProof = verifyLedgerState(outerWhitespaceRows, fakeReceipt, fakeSources);
  assert.equal(outerWhitespaceProof.appliedPrerequisite.statementContentMatchesReviewedSource, true);
  assert.equal(outerWhitespaceProof.appliedPrerequisite.statementVerification, "ledger_statements_match_reviewed_source");
  assert.equal(outerWhitespaceProof.appliedMigrations.length, 1);
  const releaseRows = rowsForPrefix(1).map(row => row.version === MIGRATION_PATHS[0].match(/(\d{14})_/)[1] ? { ...row, statements: null } : row);
  assert.throws(() => verifyLedgerState(releaseRows, fakeReceipt, fakeSources), /ledger_statements_missing/);
  for (const blankStatements of [[""], ["   ", "\n\t"]]) {
    const blankReleaseRows = rowsForPrefix(1).map(row => row.version === MIGRATION_PATHS[0].match(/(\d{14})_/)[1] ? { ...row, statements: blankStatements } : row);
    assert.throws(() => verifyLedgerState(blankReleaseRows, fakeReceipt, fakeSources), /ledger_statements_missing/);
  }
  assert.throws(() => verifyOperatorRpcCatalog([CATALOG_EXPECTED], fakeReceipt, {
    ...proof,
    appliedPrerequisite: { ...proof.appliedPrerequisite, statementContentMatchesReviewedSource: false },
  }, fakeSources), /operator_rpc_catalog_ledger_binding_invalid/);
});

test("candidate apply requires the exact eight prerequisites and derives the three-migration candidate suffix", () => {
  assert.equal(CANDIDATE_PREREQUISITE_PREFIX_LENGTH, 8);
  const ready = verifyLedgerState(rowsForPrefix(8), fakeReceipt, fakeSources);
  assert.deepEqual(verifyCandidatePrerequisitePrefix(ready), {
    requiredAppliedPrefixLength: 8,
    pending: fakeReceipt.migrations.slice(8).map(migration => migration.filename),
    candidateMigrations: fakeReceipt.migrations.slice(8).map(migration => migration.filename),
  });
  const exactSuffixPlan = { dryRun: true, upToDate: false, migrations: ready.pending, seeds: [], roles: [] };
  assert.deepEqual(verifyMigrationPlan(exactSuffixPlan, ready, "pre").migrations, fakeReceipt.migrations.slice(8).map(migration => migration.filename));
  assert.throws(() => verifyMigrationPlan({ ...exactSuffixPlan, migrations: [...exactSuffixPlan.migrations, "20990101000000_unreviewed.sql"] }, ready, "pre"), /unexpected_pending/);
  for (const count of [0, 7, 9, 10, 11]) {
    const proof = verifyLedgerState(rowsForPrefix(count), fakeReceipt, fakeSources);
    assert.throws(() => verifyCandidatePrerequisitePrefix(proof), /requires_exact_eight/);
  }
  const complete = verifyLedgerState(rowsForPrefix(11), fakeReceipt, fakeSources);
  assert.deepEqual(verifyCandidateCompletePrefix(complete), {
    appliedPrefixLength: 11, pending: [], candidateMigrations: fakeReceipt.migrations.slice(8).map(migration => migration.filename),
  });
  assert.throws(() => verifyCandidateCompletePrefix(ready), /ledger_incomplete/);
});

for (const [label, rows] of [
  ["missing applied RPC", rowsForPrefix(11).filter(row => row.version !== APPLIED_OPERATOR_RPC.version)],
  ["missing prefix entry", rowsForPrefix(4).filter(row => row.version !== "20260923161812")],
  ["non-prefix release row", rowsForPrefix(0).concat({ version: "20260925200000", name: "gta_prospect_operator_database_firm_profile_link", statements: fakeStatements })],
  ["wrong RPC name", rowsForPrefix(0).map(row => row.version === APPLIED_OPERATOR_RPC.version ? { ...row, name: "wrong" } : row)],
  ["tampered stored SQL", rowsForPrefix(1).map(row => row.version === "20260921120000" ? { ...row, statements: ["SELECT 2"] } : row)],
  ["extra ledger columns", rowsForPrefix(0).map(row => row.version === APPLIED_OPERATOR_RPC.version ? { ...row, unexpected: true } : row)],
  ["reordered ledger rows", [...rowsForPrefix(2)].reverse()],
]) test("ledger fails closed on " + label, () => assert.throws(() => verifyLedgerState(rows, fakeReceipt, fakeSources)));

test("plan accepts only the ledger-derived exact pending suffix and empty post-release plan", () => {
  const before = verifyLedgerState(rowsForPrefix(3), fakeReceipt, fakeSources);
  const prePlan = { dryRun: true, upToDate: false, migrations: before.pending, seeds: [], roles: [] };
  assert.deepEqual(verifyMigrationPlan(prePlan, before, "pre").migrations, before.pending);
  assert.throws(() => verifyMigrationPlan({ ...prePlan, migrations: [...prePlan.migrations, "20990101000000_unreviewed.sql"] }, before, "pre"), /unexpected_pending/);
  assert.throws(() => verifyMigrationPlan({ ...prePlan, seeds: ["seed.sql"] }, before, "pre"), /unexpected_pending/);
  assert.throws(() => verifyMigrationPlan({ ...prePlan, roles: ["anon"] }, before, "pre"), /unexpected_pending/);
  const complete = verifyLedgerState(rowsForPrefix(11), fakeReceipt, fakeSources);
  const post = { dryRun: true, upToDate: true, migrations: [], seeds: [], roles: [] };
  assert.deepEqual(verifyMigrationPlan(post, complete, "pre").migrations, [], "an already-complete exact release is a read-only no-op");
  assert.deepEqual(verifyMigrationPlan(post, complete, "post").migrations, []);
  assert.throws(() => verifyMigrationPlan(post, before, "post"), /unexpected_pending/);
  assert.throws(() => verifyMigrationPlan({ ...prePlan, dryRun: false }, before, "pre"), /unexpected_pending/);
});

test("operator RPC catalog accepts only the reviewed security, definition, and execute ACL tuple", () => {
  assert.match(catalogQuery(), /md5\(pg_get_functiondef\(p\.oid\)\)/);
  assert.match(catalogQuery(), /has_function_privilege\('anon'/);
  assert.match(catalogQuery(), /has_function_privilege\('authenticated'/);
  assert.match(catalogQuery(), /aclexplode/);
  const ledgerRows = rowsForPrefix(0);
  const ledgerProof = verifyLedgerState(ledgerRows, fakeReceipt, fakeSources);
  const catalogProof = verifyOperatorRpcCatalog([CATALOG_EXPECTED], fakeReceipt, ledgerRows, fakeSources);
  assert.equal(catalogProof.prerequisite, "verified_applied_operator_rpc");
  assert.equal(catalogProof.ledgerStatementVerification, "ledger_statements_match_reviewed_source");
  assert.deepEqual(catalogProof.catalog, CATALOG_EXPECTED);
  for (const changed of [
    { ...CATALOG_EXPECTED, definitionMd5: "0".repeat(32) },
    { ...CATALOG_EXPECTED, securityDefiner: false },
    { ...CATALOG_EXPECTED, searchPathSetting: "search_path=public" },
    { ...CATALOG_EXPECTED, anonExecute: true },
    { ...CATALOG_EXPECTED, nonOwnerExecuteGrantees: ["authenticated", "service_role"] },
  ]) assert.throws(() => verifyOperatorRpcCatalog([changed], fakeReceipt, ledgerRows, fakeSources), /catalog_mismatch/);
  assert.throws(() => verifyOperatorRpcCatalog([], fakeReceipt, ledgerRows, fakeSources), /catalog_ambiguous/);
  assert.throws(() => verifyOperatorRpcCatalog([CATALOG_EXPECTED, CATALOG_EXPECTED], fakeReceipt, ledgerRows, fakeSources), /catalog_ambiguous/);
});

test("operator RPC catalog diagnostic reports only fixed comparison statuses", () => {
  const matching = operatorRpcCatalogDiagnostic([CATALOG_EXPECTED]);
  assert.equal(matching.outcome, "verified");
  assert.equal(matching.keyShape, "exact");
  assert.deepEqual(matching.mismatchedProperties, []);
  const mismatch = operatorRpcCatalogDiagnostic([{
    ...CATALOG_EXPECTED,
    searchPathSetting: "postgres://private-dsn",
    definitionMd5: "SECRET_TOKEN_VALUE",
    injectedField: "SELECT private_data",
  }]);
  assert.equal(mismatch.outcome, "mismatch");
  assert.equal(mismatch.keyShape, "mismatch");
  assert.deepEqual(mismatch.mismatchedProperties, ["searchPathSetting", "definitionMd5"]);
  assert.ok(Object.values(mismatch.properties).every(value => ["match", "mismatch"].includes(value)));
  const serialized = JSON.stringify(mismatch);
  for (const secret of ["private-dsn", "SECRET_TOKEN_VALUE", "SELECT private_data"]) assert.equal(serialized.includes(secret), false);
  for (const rows of [[], [CATALOG_EXPECTED, CATALOG_EXPECTED], null]) {
    const unavailable = operatorRpcCatalogDiagnostic(rows);
    assert.equal(unavailable.outcome, "unavailable");
    assert.equal(unavailable.properties, null);
  }
});
test("source authorization accepts only reviewed manual main dispatch with direct TLS database URL", async (t) => {
  assert.equal(verifySourceGate(gate).operation, "dry-run");
  for (const [label, change] of [
    ["push event", { event: "push" }], ["branch dispatch", { ref: "refs/heads/codex/test" }],
    ["wrong repository", { repository: "other/repo" }], ["apply mode", { operation: "apply" }],
    ["changed current source", { checkoutSha: "b".repeat(40) }], ["wrong protected SHA", { configuredReviewedSha: "b".repeat(40) }],
    ["non-TLS URL", { databaseUrl: gate.databaseUrl.replace("sslmode=verify-full", "sslmode=disable") }],
    ["project env file", { projectEnvFiles: [".env"] }], ["ambient DB override", { environment: { PGHOST: "unexpected" } }],
  ]) await t.test("source gate rejects " + label, () => assert.throws(() => verifySourceGate({ ...gate, ...change })));
});

test("application authorization binds current main SHA, exact receipt hash, TLS target, and typed apply confirmation", () => {
  const applicationGate = {
    ...gate,
    operation: "apply",
    reviewedReceiptSha256: receiptSha256,
    configuredReceiptSha256: receiptSha256,
    actualReceiptSha256: receiptSha256,
    confirmation: CANDIDATE_APPLY_CONFIRMATION,
  };
  assert.equal(verifyApplicationGate(applicationGate).operation, "apply");
  assert.equal(verifyApplicationGate({ ...applicationGate, operation: "dry-run", confirmation: "" }).operation, "dry-run");
  for (const [label, change] of [
    ["wrong receipt input", { reviewedReceiptSha256: "0".repeat(64) }],
    ["wrong protected receipt setting", { configuredReceiptSha256: "0".repeat(64) }],
    ["changed receipt bytes", { actualReceiptSha256: "0".repeat(64) }],
    ["malformed receipt digest", { reviewedReceiptSha256: "not-a-sha256" }],
    ["wrong confirmation", { confirmation: "APPLY-PROSPECT-ENRICHMENT-V1" }],
    ["wrong branch", { ref: "refs/heads/codex/test" }],
    ["changed reviewed source", { githubSha: "b".repeat(40) }],
    ["wrong database host", { databaseUrl: applicationGate.databaseUrl.replace("db." + PROJECT_REF, "db.other-project") }],
    ["ambient database override", { environment: { SUPABASE_DB_URL: "unexpected" } }],
    ["project env file", { projectEnvFiles: ["supabase/.env"] }],
  ]) assert.throws(() => verifyApplicationGate({ ...applicationGate, ...change }), undefined, label);
  assert.throws(() => verifyApplicationGate({ ...applicationGate, operation: "apply", confirmation: undefined }), /exact_candidate_apply_confirmation_required/);
});

test("new workflow is protected and read-only; legacy six-migration writer is unchanged", () => {
  const workflow = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/prospect-candidate-additive-preflight.yml"), "utf8"));
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  const job = workflow.jobs.preflight;
  assert.match(job.if, /refs\/heads\/main/);
  assert.equal(job.environment.name, "Production prospect migrations");
  assert.match(job.env.CONFIGURED_REVIEWED_SHA, /vars\.PROSPECT_CANDIDATE_RELEASE_REVIEWED_SHA/);
  assert.equal(job.env.OPERATION, "dry-run");
  assert.equal(workflow.permissions.contents, "read");
  for (const step of job.steps.filter(s => s.uses)) assert.match(step.uses, /@[a-f0-9]{40}$/);
  const remote = job.steps.filter(s => /supabase db (?:push|query) --db-url/.test(s.run ?? ""));
  assert.ok(remote.length >= 2, "ledger/catalog reads and the dry-run migration plan are present");
  for (const step of remote) {
    assert.match(step.run, /--db-url/);
    assert.equal(step.env?.MIGRATION_DATABASE_URL, undefined);
    assert.match(step.run, /additive-release-gate\.mjs connection/);
  }
  for (const step of remote.filter(s => /supabase db push/.test(s.run))) assert.match(step.run, /--dry-run/);
  const ledgerStep = job.steps.find(s => /Read applied ledger/.test(s.name));
  assert.ok(ledgerStep.run.indexOf("ledger-summary") < ledgerStep.run.indexOf("additive-release-gate.mjs ledger "));
  assert.match(ledgerStep.run, /catalog-bound .*rpc-catalog\.json.*ledger\.json/);
  const evidenceUpload = job.steps.find(s => s.uses?.startsWith("actions/upload-artifact"));
  assert.equal(evidenceUpload.if, "always()");
  assert.match(evidenceUpload.with.path, /ledger-summary\.json/);
  const planStep = job.steps.find(s => /Require exactly the reviewed pending migration suffix/.test(s.name));
  assert.match(planStep.run, /migration-gate\.mjs stage .*candidate-migrations/);
  assert.match(planStep.run, /additive-release-gate\.mjs full-ledger/);
  assert.match(planStep.run, /cd "\$RUNNER_TEMP\/candidate-migrations"/);
  assert.doesNotMatch(planStep.run, /cd "\$GITHUB_WORKSPACE"/);
  assert.doesNotMatch(JSON.stringify(workflow), /--yes|\bapply\b|--password|SUPABASE_ACCESS_TOKEN/);
  const oldWorkflow = fs.readFileSync(path.join(root, ".github/workflows/prospect-enrichment-migration-gate.yml"), "utf8");
  assert.match(oldWorkflow, /The exact six-migration plan matches/);
  assert.match(oldWorkflow, /migration-gate\.mjs/);
  assert.equal(ORIGINAL_SIX_PATHS.length, 6);
});

test("separate additive writer is protected, receipt-bound, and limits writes to the candidate suffix", () => {
  const workflow = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/prospect-candidate-additive-release.yml"), "utf8"));
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  const job = workflow.jobs.release;
  assert.match(job.if, /refs\/heads\/main/);
  assert.match(job.if, /github.repository == 'adrianosortudo-source\/caseload-select'/);
  assert.equal(job.environment.name, "Production prospect migrations");
  assert.match(job.env.CONFIGURED_REVIEWED_SHA, /vars\.PROSPECT_CANDIDATE_RELEASE_REVIEWED_SHA/);
  assert.match(job.env.CONFIGURED_RECEIPT_SHA256, /vars\.PROSPECT_CANDIDATE_RELEASE_REVIEWED_RECEIPT_SHA256/);
  assert.equal(workflow.permissions.contents, "read");
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.operation.options, ["dry-run", "apply"]);
  for (const step of job.steps.filter(s => s.uses)) assert.match(step.uses, /@[a-f0-9]{40}$/);
  const writeSteps = job.steps.filter(s => /supabase db push[^\n]*--yes/.test(s.run ?? ""));
  assert.equal(writeSteps.length, 1);
  assert.equal(writeSteps[0].id, "apply_migration");
  assert.match(writeSteps[0].if, /inputs\.operation == 'apply'/);
  assert.match(writeSteps[0].run, /candidate-prefix/);
  assert.match(writeSteps[0].run, /immediate-rpc-catalog-check/);
  assert.match(writeSteps[0].run, /immediate-plan-check/);
  assert.match(writeSteps[0].run, /apply_started=true/);
  assert.match(job.steps.find(s => /Verify exact candidate-profile/.test(s.name)).if, /always\(\)/);
  assert.match(job.steps.find(s => /Verify exact candidate-profile/.test(s.name)).if, /apply_started == 'true'/);
  const dryRun = job.steps.find(s => /Require exact candidate suffix/.test(s.name));
  assert.match(dryRun.run, /--dry-run/);
  const serialized = JSON.stringify(workflow);
  assert.match(serialized, /APPLY-PROSPECT-CANDIDATE-PROFILES-V1/);
  assert.match(serialized, /additive-release-gate\.mjs application-source/);
  assert.doesNotMatch(serialized, /--password|SUPABASE_ACCESS_TOKEN/);
  assert.equal((serialized.match(/catalog-bound/g) ?? []).length, 3);
  assert.doesNotMatch(serialized, /additive-release-gate\.mjs catalog \$/);
  const legacy = fs.readFileSync(path.join(root, ".github/workflows/prospect-enrichment-migration-gate.yml"), "utf8");
  assert.match(legacy, /Require exactly six enrichment migrations pending/);
  assert.equal(ORIGINAL_SIX_PATHS.length, 6);
});

test("candidate CLI inventory excludes preview SQL and reconciles the complete production ledger", t => {
  // Exercise the actual stager and ledger guard with local files and synthetic
  // ledger rows. No CLI, network, credentials, or production database is used.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-writer-regression-"));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const staged = path.join(scratch, "candidate-migrations");
  const proof = stageProductionWorkdir(root, staged);
  assert.deepEqual(proof.exclusions.map(item => item.path).sort(), [...PREVIEW_MIGRATION_PATHS].sort());
  const filenames = fs.readdirSync(path.join(staged, "supabase/migrations")).sort();
  for (const excluded of PREVIEW_MIGRATION_PATHS) {
    assert.ok(fs.existsSync(path.join(root, excluded)), "preview fixture must exist in repository");
    assert.ok(!filenames.includes(path.basename(excluded)), "preview SQL must never reach the CLI inventory");
  }
  for (const filename of filenames) {
    assert.deepEqual(fs.readFileSync(path.join(staged, "supabase/migrations", filename)),
      fs.readFileSync(path.join(root, "supabase/migrations", filename)), "stage preserves exact bytes");
  }
  assert.deepEqual(fs.readFileSync(path.join(staged, "supabase/config.toml")), fs.readFileSync(path.join(root, "supabase/config.toml")));
  const rows = filenames.map(filename => {
    const [, version, name] = /^(\d+)_(.+)\.sql$/.exec(filename);
    return { version, name: HISTORICAL_LEDGER_NAME_ALIASES[version]?.name ?? name };
  });
  const pending = MIGRATION_PATHS.slice(CANDIDATE_PREREQUISITE_PREFIX_LENGTH);
  const pendingVersions = new Set(pending.map(file => path.basename(file).split("_")[0]));
  const before = rows.filter(row => !pendingVersions.has(row.version));
  assert.equal(verifyFullMigrationLedger(before, staged, "candidate-pending", pending).pendingPaths.length, 3);
  assert.equal(verifyFullMigrationLedger(rows, staged, "candidate-pending", []).pendingPaths.length, 0);
  assert.throws(() => verifyFullMigrationLedger([...before, { version: "20990101000000", name: "unreviewed" }], staged, "candidate-pending", pending), /remote_migration_source_missing_or_mismatched/);
  assert.throws(() => verifyFullMigrationLedger(before.slice(1), staged, "candidate-pending", pending), /unexpected_full_history_delta/);
  // A preview ledger entry is also rejected, rather than silently tolerated.
  const preview = path.basename(PREVIEW_MIGRATION_PATHS[0]);
  const [, version, name] = /^(\d+)_(.+)\.sql$/.exec(preview);
  assert.throws(() => verifyFullMigrationLedger([...before, { version, name }].sort((a,b) => a.version.localeCompare(b.version)), staged, "candidate-pending", pending), /remote_migration_source_missing_or_mismatched/);
});

test("candidate writer uses a fresh byte-checked stage for each CLI migration phase", () => {
  const job = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/prospect-candidate-additive-release.yml"), "utf8")).jobs.release;
  const runs = job.steps.map(step => (step.run ?? "").replace(/\\\r?\n\s*/g, " "));
  const staged = new Set();
  let plans = 0, applies = 0;
  for (const [index, run] of runs.entries()) {
    for (const line of run.split(/\r?\n/)) {
      const stage = /migration-gate\.mjs stage "\$GITHUB_WORKSPACE" "\$RUNNER_TEMP\/(candidate-migrations(?:-immediate|-post)?)"/.exec(line);
      if (stage) { assert.ok(!staged.has(stage[1]), "stage destination must be fresh"); staged.add(stage[1]); }
      if (!/supabase db push/.test(line) || /--help/.test(line)) continue;
      const push = /\(cd "\$RUNNER_TEMP\/(candidate-migrations(?:-immediate|-post)?)" && supabase db push /.exec(line);
      assert.ok(push, "CLI must discover migrations inside verified stage");
      assert.ok(staged.has(push[1]), "staging precedes every migration CLI call");
      const expected = job.steps[index].id === "apply_migration" ? "candidate-migrations-immediate" : /candidate-complete/.test(run) ? "candidate-migrations-post" : "candidate-migrations";
      assert.equal(push[1], expected, "CLI must use the fresh stage for its phase");
      const fullCheck = run.split(/\r?\n/).find(command => /additive-release-gate\.mjs full-ledger/.test(command));
      assert.ok(fullCheck?.includes(`"$RUNNER_TEMP/${expected}"`), "ledger guard must validate the same stage used by CLI");
      assert.doesNotMatch(line, /\$GITHUB_WORKSPACE/);
      assert.match(line, /--db-url "\$MIGRATION_DATABASE_URL"/);
      if (/--yes\b/.test(line)) applies++; else { assert.match(line, /--dry-run\b/); plans++; }
    }
  }
  assert.equal(applies, 1);
  assert.deepEqual([...staged].sort(), ["candidate-migrations", "candidate-migrations-immediate", "candidate-migrations-post"]);
  assert.equal(plans, 3, "initial, immediate-before-apply and post-apply plans must all use the stage");
});

test("staged production proof rejects changed bytes, config, inventory, environment and evidence", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-stage-proof-"));
  try {
    const staged = path.join(scratch, "candidate-migrations");
    const proof = stageProductionWorkdir(root, staged);
    const verify = (evidence = proof) => verifyProductionWorkdir(root, staged, evidence);
    assert.equal(verify().verified, true);
    for (const relative of [MIGRATION_PATHS[8], "supabase/config.toml"]) {
      const target = path.join(staged, relative);
      const original = fs.readFileSync(target);
      fs.appendFileSync(target, "\n-- synthetic mutation\n");
      assert.throws(() => verify(), /staged_migration_source_mismatch|staged_config_mismatch/, relative);
      fs.writeFileSync(target, original);
      assert.equal(verify().verified, true, "restoring exact bytes restores verification");
    }
    const preview = path.join(staged, PREVIEW_MIGRATION_PATHS[0]);
    fs.copyFileSync(path.join(root, PREVIEW_MIGRATION_PATHS[0]), preview);
    assert.throws(() => verify(), /staged_migration_source_mismatch/);
    fs.unlinkSync(preview);
    for (const relative of [".env", "supabase/.env.local"]) {
      const target = path.join(staged, relative);
      fs.writeFileSync(target, "SYNTHETIC_TEST_ONLY=1\n");
      assert.throws(() => verify(), /project_database_env_files_prohibited/);
      fs.unlinkSync(target);
    }
    for (const change of [
      { stagedRoot: scratch }, { migrationCount: proof.migrationCount + 1 },
      { inventorySha256: "0".repeat(64) }, { configSha256: "0".repeat(64) },
      { exclusions: [] },
    ]) assert.throws(() => verify({ ...proof, ...change }), /staged_/);
    assert.equal(verify().verified, true);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("candidate writer preserves temporary credentials and loads static credentials only once", () => {
  const job = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/prospect-candidate-additive-release.yml"), "utf8")).jobs.release;
  assert.equal(job.env.MIGRATION_DATABASE_URL, undefined, "job must not shadow the minted GITHUB_ENV value");
  const loaders = job.steps.filter(step => step.env?.STATIC_MIGRATION_DATABASE_URL !== undefined);
  assert.equal(loaders.length, 1);
  assert.match(loaders[0].if, /!inputs\.use_temporary_database_credential/);
  assert.match(loaders[0].env.STATIC_MIGRATION_DATABASE_URL, /secrets\.CASELOAD_PRODUCTION_SUPABASE_MIGRATOR_DB_URL/);
  assert.match(loaders[0].run, /MIGRATION_DATABASE_URL=%s/);
  assert.match(loaders[0].run, />> "\$GITHUB_ENV"/);
  for (const step of job.steps) assert.equal(step.env?.MIGRATION_DATABASE_URL, undefined, "step env must not replace credential propagated by GITHUB_ENV");
  const mint = job.steps.find(step => /temporary-credential\.mjs/.test(step.run ?? ""));
  assert.equal(mint.if, "inputs.use_temporary_database_credential");
  const firstConnection = job.steps.findIndex(step => /additive-release-gate\.mjs connection|additive-release-gate\.mjs application-source >/.test(step.run ?? ""));
  assert.ok(firstConnection > job.steps.indexOf(loaders[0]));
  assert.ok(firstConnection > job.steps.indexOf(mint));
});

test("candidate writer rechecks full ledger before apply and verifies even an uncertain apply", () => {
  const job = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/prospect-candidate-additive-release.yml"), "utf8")).jobs.release;
  const apply = job.steps.find(step => step.id === "apply_migration");
  const commands = apply.run.replace(/\\\r?\n\s*/g, " ").split(/\r?\n/);
  const fullRead = commands.findIndex(line => /supabase db query/.test(line) && /full-ledger/.test(line));
  const fullCheck = commands.findIndex(line => /additive-release-gate\.mjs full-ledger/.test(line));
  const immediatePlan = commands.findIndex(line => /supabase db push/.test(line) && /--dry-run/.test(line));
  const planCheck = commands.findIndex(line => /additive-release-gate\.mjs plan pre/.test(line));
  const started = commands.findIndex(line => /apply_started=true/.test(line));
  const write = commands.findIndex(line => /supabase db push/.test(line) && /--yes/.test(line));
  assert.ok(fullRead >= 0 && fullCheck > fullRead && immediatePlan > fullCheck && planCheck > immediatePlan && started > planCheck && write > started,
    "fresh full-ledger and pending-plan validation must succeed before marking and attempting apply");
  assert.match(commands[fullCheck], /"\$RUNNER_TEMP\/candidate-migrations-immediate"/);
  assert.match(apply.run, /set -euo pipefail/);
  const post = job.steps.find(step => /candidate-complete/.test(step.run ?? ""));
  assert.equal(post.if, "always() && inputs.operation == 'apply' && steps.apply_migration.outputs.apply_started == 'true'",
    "verification must run when apply exits nonzero after an uncertain database outcome");
  assert.match(post.run, /additive-release-gate\.mjs full-ledger/);
  assert.match(post.run, /"\$RUNNER_TEMP\/candidate-migrations-post"/);
  assert.match(post.run, /additive-release-gate\.mjs plan post/);
  const postCommands = post.run.split(/\r?\n/);
  const recovery = postCommands.findIndex(line => /additive-release-gate\.mjs plan pre/.test(line));
  const complete = postCommands.findIndex(line => /additive-release-gate\.mjs candidate-complete/.test(line));
  const finalPlan = postCommands.findIndex(line => /additive-release-gate\.mjs plan post/.test(line));
  assert.ok(recovery >= 0 && complete > recovery && finalPlan > complete,
    "partial-prefix recovery plan evidence must be saved before completeness can fail");
  assert.match(postCommands[recovery], /post-recovery-plan-check\.json/);
  const upload = job.steps.find(step => step.uses?.startsWith("actions/upload-artifact"));
  assert.equal(upload.if, "always()");
  assert.match(upload.with.path, /post-recovery-plan-check\.json/);
  // A partially applied prefix has valid, useful recovery evidence even though
  // the completeness assertion must fail. This is why shell ordering matters.
  for (const prefix of [8, 9, 10]) {
    const partial = verifyLedgerState(rowsForPrefix(prefix), fakeReceipt, fakeSources);
    const pendingPlan = { dryRun: true, upToDate: false, migrations: partial.pending, seeds: [], roles: [] };
    assert.deepEqual(verifyMigrationPlan(pendingPlan, partial, "pre").migrations, partial.pending);
    assert.throws(() => verifyCandidateCompletePrefix(partial), /ledger_incomplete/);
  }
});
