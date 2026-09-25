import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
  APPLIED_OPERATOR_RPC,
  CATALOG_EXPECTED,
  MIGRATION_PATHS,
  PROJECT_REF,
  RELEASE_PATH,
  catalogQuery,
  createReleaseReceipt,
  ledgerQuery,
  verifyLedgerState,
  verifyMigrationPlan,
  verifyOperatorRpcCatalog,
  verifyReleaseReceipt,
  verifySourceGate,
} from "../additive-release-gate.mjs";
import { MIGRATION_PATHS as ORIGINAL_SIX_PATHS } from "../migration-gate.mjs";

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

test("ledger accepts only a verified applied RPC plus an exact ordered migration prefix", () => {
  for (const count of [0, 1, 5, 9, 10, 11]) {
    const proof = verifyLedgerState(rowsForPrefix(count), fakeReceipt, fakeSources);
    assert.equal(proof.appliedPrefixLength, count);
    assert.equal(proof.pending.length, 11 - count);
    assert.equal(proof.appliedPrerequisite.version, APPLIED_OPERATOR_RPC.version);
  }
});

for (const [label, rows] of [
  ["missing applied RPC", rowsForPrefix(10).filter(row => row.version !== APPLIED_OPERATOR_RPC.version)],
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
  assert.deepEqual(verifyOperatorRpcCatalog([CATALOG_EXPECTED], receipt), { prerequisite: "verified_applied_operator_rpc", catalog: CATALOG_EXPECTED });
  for (const changed of [
    { ...CATALOG_EXPECTED, definitionMd5: "0".repeat(32) },
    { ...CATALOG_EXPECTED, securityDefiner: false },
    { ...CATALOG_EXPECTED, searchPathSetting: "search_path=public" },
    { ...CATALOG_EXPECTED, anonExecute: true },
    { ...CATALOG_EXPECTED, nonOwnerExecuteGrantees: ["authenticated", "service_role"] },
  ]) assert.throws(() => verifyOperatorRpcCatalog([changed], receipt), /catalog_mismatch/);
  assert.throws(() => verifyOperatorRpcCatalog([], receipt), /catalog_ambiguous/);
  assert.throws(() => verifyOperatorRpcCatalog([CATALOG_EXPECTED, CATALOG_EXPECTED], receipt), /catalog_ambiguous/);
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
    assert.match(step.env.MIGRATION_DATABASE_URL, /secrets\.CASELOAD_PRODUCTION_SUPABASE_MIGRATOR_DB_URL/);
    assert.match(step.run, /additive-release-gate\.mjs connection/);
  }
  for (const step of remote.filter(s => /supabase db push/.test(s.run))) assert.match(step.run, /--dry-run/);
  assert.doesNotMatch(JSON.stringify(workflow), /--yes|\bapply\b|--password|SUPABASE_ACCESS_TOKEN/);
  const oldWorkflow = fs.readFileSync(path.join(root, ".github/workflows/prospect-enrichment-migration-gate.yml"), "utf8");
  assert.match(oldWorkflow, /Require the exact six pending migrations/);
  assert.match(oldWorkflow, /migration-gate\.mjs/);
  assert.equal(ORIGINAL_SIX_PATHS.length, 6);
});
