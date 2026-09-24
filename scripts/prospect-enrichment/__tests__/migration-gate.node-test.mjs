import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
  CLI_VERSION, CONFIRMATION, MIGRATION_PATH, PROJECT_REF, RELEASE_PATH,
  createReleaseManifest, findProjectEnvFiles, ledgerQuery, sha256, verifyConfirmation, verifyDirectDatabaseUrl, verifyExecutionGate,
  verifyLedgerStatements, verifyMigrationLedger, verifyMigrationPlan, verifyReleaseManifest,
} from "../migration-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = Buffer.from("-- scope\nBEGIN;\nCREATE FUNCTION f() RETURNS text LANGUAGE sql AS $$ SELECT 'x;y'; $$;\nCOMMIT;\n");
const statements = ["-- scope\nBEGIN", "CREATE FUNCTION f() RETURNS text LANGUAGE sql AS $$ SELECT 'x;y'; $$", "COMMIT"];
const manifest = createReleaseManifest(source);
const row = { version: manifest.migrations[0].version, name: manifest.migrations[0].name, statements };
const reviewed = "a".repeat(40), different = "b".repeat(40);
const databaseUrl = "postgresql://postgres:synthetic-only@db." + PROJECT_REF + ".supabase.co:5432/postgres?sslmode=verify-full";
const gate = { event: "workflow_dispatch", ref: "refs/heads/main", repository: "adrianosortudo-source/caseload-select", operation: "dry-run", reviewedSourceSha: reviewed, configuredReviewedSha: reviewed, checkoutSha: reviewed, githubSha: reviewed, databaseUrl };
const plan = (phase) => ({ dryRun: phase !== "apply", upToDate: phase === "post", migrations: phase === "post" ? [] : [manifest.migrations[0].filename], seeds: [], roles: [] });

test("release manifest is generated from the exact committed migration bytes", () => {
  const actual = fs.readFileSync(path.join(root, MIGRATION_PATH));
  const saved = JSON.parse(fs.readFileSync(path.join(root, RELEASE_PATH), "utf8"));
  assert.deepEqual(verifyReleaseManifest(saved, actual), createReleaseManifest(actual));
  assert.equal(saved.projectRef, PROJECT_REF);
  assert.equal(saved.cliVersion, CLI_VERSION);
  assert.equal(saved.migrations.length, 1);
  assert.equal(saved.migrations[0].version, "20260923161812");
  assert.equal(saved.migrations[0].sha256, sha256(actual));
});
test("changed migration bytes and expanded allowlists fail closed", () => {
  assert.throws(() => verifyReleaseManifest(manifest, Buffer.concat([source, Buffer.from("-- changed")])), /source_mismatch/);
  assert.throws(() => verifyReleaseManifest({ ...manifest, migrations: [...manifest.migrations, manifest.migrations[0]] }, source), /source_mismatch/);
  assert.throws(() => verifyReleaseManifest({ ...manifest, projectRef: "other-project" }, source), /source_mismatch/);
});
test("manual reviewed main is accepted for dry-run", () => assert.equal(verifyExecutionGate(gate).projectRef, PROJECT_REF));
for (const [label, change] of [
  ["push event", { event: "push" }], ["PR branch", { ref: "refs/heads/codex/example" }],
  ["different repository", { repository: "other/caseload-select" }], ["unknown operation", { operation: "reset" }],
  ["missing reviewed SHA", { reviewedSourceSha: undefined }], ["abbreviated SHA", { reviewedSourceSha: "abc123" }],
  ["missing environment config", { configuredReviewedSha: undefined }], ["wrong environment SHA", { configuredReviewedSha: different }],
  ["changed checkout", { checkoutSha: different }], ["changed dispatch SHA", { githubSha: different }],
  ["missing database URL", { databaseUrl: undefined }],
]) test("execution gate rejects " + label, () => assert.throws(() => verifyExecutionGate({ ...gate, ...change })));
test("apply needs the exact confirmation; dry-run does not", () => {
  verifyConfirmation("dry-run", undefined);
  verifyConfirmation("apply", CONFIRMATION);
  for (const value of [undefined, "", "yes", CONFIRMATION + " "]) assert.throws(() => verifyConfirmation("apply", value), /confirmation/);
});
for (const phase of ["pre", "apply", "post"]) test("accepts exact " + phase + " plan", () => verifyMigrationPlan(plan(phase), manifest, phase));
for (const [label, change] of [
  ["extra migration", { migrations: [...plan("pre").migrations, "20260924000000_unreviewed.sql"] }],
  ["no pending migration", { migrations: [], upToDate: true }],
  ["seed", { seeds: ["supabase/seed.sql"] }], ["role", { roles: ["roles.sql"] }],
  ["wrong dryRun", { dryRun: false }], ["missing roles", { roles: undefined }],
]) test("preflight rejects " + label, () => assert.throws(() => verifyMigrationPlan({ ...plan("pre"), ...change }, manifest, "pre"), /unexpected_pending/));
test("post-apply requires an empty pending plan", () => assert.throws(() => verifyMigrationPlan(plan("pre"), manifest, "post"), /unexpected_pending/));
test("ledger readback covers complete source including comments and dollar bodies", () => {
  const proof = verifyMigrationLedger([row], manifest, source);
  assert.equal(proof.statementCount, 3);
  assert.equal(proof.sourceSha256, sha256(source));
  assert.equal(proof.ledgerStatementsSha256, sha256(JSON.stringify(statements)));
  assert.equal(proof.statementContentMatchesReviewedSource, true);
});
for (const [label, rows] of [
  ["missing row", []], ["duplicate row", [row, row]], ["wrong version", [{ ...row, version: "20260923161813" }]],
  ["wrong name", [{ ...row, name: "other" }]], ["missing statements", [{ ...row, statements: null }]],
  ["changed literal", [{ ...row, statements: statements.map((s) => s.replace("x;y", "changed")) }]],
  ["omitted statement", [{ ...row, statements: statements.slice(0, 2) }]],
  ["reordered statements", [{ ...row, statements: [...statements].reverse() }]],
  ["extra statement", [{ ...row, statements: [...statements, "DROP TABLE unexpected"] }]],
  ["extra fields", [{ ...row, unreviewed: true }]],
]) test("ledger rejects " + label, () => assert.throws(() => verifyMigrationLedger(rows, manifest, source)));
test("truncated token boundaries cannot masquerade as complete statements", () => {
  assert.throws(() => verifyLedgerStatements(Buffer.from("SELECT abc;"), ["SELECT ab", "c"]), /boundary_mismatch/);
});
test("whitespace cannot split one SQL statement into multiple ledger entries", () => {
  assert.throws(() => verifyLedgerStatements(Buffer.from("SELECT abc;"), ["SELECT", "abc"]), /terminator_missing/);
});

test("fixed ledger query contains only a single version-scoped SELECT", () => {
  const query = ledgerQuery(manifest);
  assert.equal(query, "SELECT version, name, statements FROM supabase_migrations.schema_migrations WHERE version = '20260923161812' ORDER BY version;\n");
});
test("workflow is manual, main-only, protected and all external actions are pinned", () => {
  const workflow = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/prospect-enrichment-migration-gate.yml"), "utf8"));
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.operation.default, "dry-run");
  const job = workflow.jobs.migrate;
  assert.match(job.if, /refs\/heads\/main/);
  assert.equal(job.environment.name, "Production prospect migrations");
  assert.equal(job.env.PROJECT_REF, PROJECT_REF);
  assert.match(job.env.CONFIGURED_REVIEWED_SHA, /vars\.PROSPECT_ENRICHMENT_MIGRATION_REVIEWED_SHA/);
  const firstRemote = job.steps.findIndex((s) => /supabase db push --db-url/.test(s.run ?? ""));
  const sourceGate = job.steps.findIndex((s) => /migration-gate\.mjs source/.test(s.run ?? ""));
  assert.ok(sourceGate >= 0 && sourceGate < firstRemote);
  const apply = job.steps.find((s) => /supabase db push .*--yes/.test(s.run ?? ""));
  assert.equal(apply.if, "inputs.operation == 'apply'");
  assert.equal(apply.id, "apply_migration");
  assert.ok(apply.run.indexOf("plan pre") < apply.run.indexOf("apply_started=true"));
  assert.ok(apply.run.indexOf("apply_started=true") < apply.run.indexOf("--yes"));
  assert.match(apply.run, /migration-gate\.mjs source/);
  assert.ok(apply.run.indexOf("plan pre") < apply.run.indexOf("--yes"));
  const readback = job.steps.find((s) => /migration-gate\.mjs ledger/.test(s.run ?? ""));
  assert.equal(readback.if, "always() && inputs.operation == 'apply' && steps.apply_migration.outputs.apply_started == 'true'");
  assert.match(readback.run, /--db-url "\$MIGRATION_DATABASE_URL"/);
  assert.match(readback.run, /--output json --agent no/);
  assert.match(readback.run, /plan post/);
  for (const step of job.steps.filter((s) => /supabase db (push|query) .*--db-url/.test(s.run ?? ""))) {
    assert.doesNotMatch(step.run, /--linked|--project-ref|--password|SUPABASE_ACCESS_TOKEN/);
    assert.match(step.run, /migration-gate\.mjs connection/);
    assert.match(step.env.MIGRATION_DATABASE_URL, /secrets\.CASELOAD_PRODUCTION_SUPABASE_MIGRATOR_DB_URL/);
    assert.ok(step.run.indexOf("migration-gate.mjs connection") < step.run.indexOf("supabase db"));
  }
  for (const step of job.steps.filter((s) => s.uses)) assert.match(step.uses, /@[a-f0-9]{40}$/);
  const upload = job.steps.find((s) => /upload-artifact/.test(s.uses ?? ""));
  assert.doesNotMatch(upload.with.path, /\/ledger\.json|\/apply\.json|\/plan\.json/);
});


test("only the bound explicit database URL is accepted without echoing credentials", () => {
  const result = verifyDirectDatabaseUrl(databaseUrl);
  assert.equal(result.host, "db." + PROJECT_REF + ".supabase.co");
  assert.equal(result.connectionMode, "explicit-db-url");
  assert.doesNotMatch(JSON.stringify(result), /synthetic-only|password|postgresql:/);
});
for (const [label, value] of [
  ["missing URL", undefined], ["empty URL", ""], ["libpq connection string", "host=example.invalid"],
  ["wrong protocol", databaseUrl.replace("postgresql:", "http:")],
  ["wrong project", databaseUrl.replace(PROJECT_REF, "otherproject")],
  ["pooler endpoint", databaseUrl.replace("db." + PROJECT_REF + ".supabase.co", "example.pooler.supabase.com")],
  ["missing password", databaseUrl.replace(":synthetic-only@", "@")],
  ["temporary role", databaseUrl.replace("//postgres:", "//cli_login_example:")],
  ["missing port", databaseUrl.replace(":5432/", "/")],
  ["wrong port", databaseUrl.replace(":5432/", ":6543/")],
  ["wrong database", databaseUrl.replace("/postgres?", "/template1?")],
  ["missing TLS policy", databaseUrl.replace("?sslmode=verify-full", "")],
  ["unverified TLS", databaseUrl.replace("verify-full", "require")],
  ["plaintext TLS mode", databaseUrl.replace("verify-full", "disable")],
  ["second host", databaseUrl + "&host=example.invalid"],
  ["host address override", databaseUrl + "&hostaddr=127.0.0.1"],
  ["options override", databaseUrl + "&options=reference%3Dother"],
  ["service override", databaseUrl + "&service=other"],
  ["TLS duplicate", databaseUrl + "&sslmode=require"],
  ["fragment", databaseUrl + "#other"],
]) test("direct connection rejects " + label, () => assert.throws(() => verifyDirectDatabaseUrl(value)));
for (const key of ["PGHOST", "PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE", "PGPASSWORD", "PGOPTIONS", "PGSSLMODE", "SUPABASE_ACCESS_TOKEN", "SUPABASE_ENV", "SUPABASE_DB_PASSWORD", "DOTENV_PRIVATE_KEY", "DOCKER_HOST", "NODE_TLS_REJECT_UNAUTHORIZED"]) {
  test("direct connection rejects ambient override " + key, () => assert.throws(() => verifyDirectDatabaseUrl(databaseUrl, { [key]: "synthetic-only" }), /ambient_database_configuration_prohibited/));
}
test("project env files fail closed without reading their values", () => {
  assert.throws(() => verifyDirectDatabaseUrl(databaseUrl, {}, ["supabase/.env"]), /project_database_env_files_prohibited/);
});

test("dotenv detection covers both directories and all pinned default filenames without reading values", () => {
  const checked = [];
  const present = findProjectEnvFiles(file => { checked.push(file.replaceAll("\\", "/")); return true; });
  const names = [".env.development.local", ".env.local", ".env.development", ".env"];
  assert.deepEqual(checked.sort(), [...names.map(name => "supabase/" + name), ...names].sort());
  assert.equal(present.length, 8);
  assert.throws(() => verifyDirectDatabaseUrl(databaseUrl, {}, present), /project_database_env_files_prohibited/);
});
