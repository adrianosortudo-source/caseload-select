import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
  CLI_VERSION, CONFIRMATION, MIGRATION_PATHS, PROJECT_REF, RELEASE_PATH,
  createReleaseManifest, findProjectEnvFiles, ledgerQuery, sha256, verifyConfirmation, verifyDirectDatabaseUrl, verifyExecutionGate,
  verifyLedgerStatements, verifyMigrationLedger, verifyMigrationPlan, verifyReleaseManifest,
} from "../migration-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = Buffer.from("-- scope\nBEGIN;\nCREATE FUNCTION f() RETURNS text LANGUAGE sql AS $$ SELECT 'x;y'; $$;\nCOMMIT;\n");
const statements = ["-- scope\nBEGIN", "CREATE FUNCTION f() RETURNS text LANGUAGE sql AS $$ SELECT 'x;y'; $$", "COMMIT"];
const sources = Object.fromEntries(MIGRATION_PATHS.map((file, index) => [file, Buffer.concat([source, Buffer.from("-- file " + index + "\nSELECT " + index + ";\n")])]));
const manifest = createReleaseManifest(sources);
const rows = manifest.migrations.map((migration, index) => ({ version: migration.version, name: migration.name, statements: [...statements, "-- file " + index + "\nSELECT " + index] }));
const changedRow = (index, change) => rows.map((row, current) => current === index ? { ...row, ...change } : row);
const reviewed = "a".repeat(40), different = "b".repeat(40);
const databaseUrl = "postgresql://postgres:synthetic-only@db." + PROJECT_REF + ".supabase.co:5432/postgres?sslmode=verify-full";
const gate = { event: "workflow_dispatch", ref: "refs/heads/main", repository: "adrianosortudo-source/caseload-select", operation: "dry-run", reviewedSourceSha: reviewed, configuredReviewedSha: reviewed, checkoutSha: reviewed, githubSha: reviewed, databaseUrl };
const plan = (phase) => ({ dryRun: phase !== "apply", upToDate: phase === "post", migrations: phase === "post" ? [] : manifest.migrations.map(migration => migration.filename), seeds: [], roles: [] });

const candidateReviewPath = "docs/runbooks/prospect-candidate-migration-review.json";
const candidateMigrationPath = "supabase/migrations/20260924172758_prospect_enrichment_candidate_profiles.sql";
function verifyCandidateReviewOnlyReceipt(receipt, candidateBytes, prerequisiteBytes) {
  assert.deepEqual(Object.keys(receipt).sort(), ["execution", "migration", "prerequisiteManifest", "prerequisiteManifestBlobSha256", "prerequisiteMigrations", "productionApplicationApproved", "projectRef", "reviewOnly", "schemaVersion", "sourceBaseSha"]);
  assert.equal(receipt.schemaVersion, "prospect-candidate-migration-review/v1");
  assert.equal(receipt.reviewOnly, true);
  assert.equal(receipt.productionApplicationApproved, false);
  assert.equal(receipt.projectRef, PROJECT_REF);
  assert.match(receipt.sourceBaseSha, /^[a-f0-9]{40}$/);
  assert.equal(receipt.prerequisiteManifest, RELEASE_PATH);
  assert.equal(receipt.prerequisiteManifestBlobSha256, sha256(prerequisiteBytes));
  assert.deepEqual(receipt.prerequisiteMigrations, JSON.parse(prerequisiteBytes.toString("utf8")).migrations);
  assert.deepEqual(receipt.migration, { path: candidateMigrationPath, version: "20260924172758", name: "prospect_enrichment_candidate_profiles", bytes: candidateBytes.length, sha256: sha256(candidateBytes) });
  assert.match(receipt.execution, /No existing workflow consumes this review receipt/);
  return candidateMigrationPath;
}

test("release manifest keeps exactly six production migrations plus one separately documented review-only candidate migration", () => {
  const featurePaths = fs.readdirSync(path.join(root, "supabase/migrations")).filter(name => /_prospect_enrichment_|_fix_gta_prospect_operator_projection_gaps\.sql$/.test(name)).sort().map(name => "supabase/migrations/" + name);
  const candidateBytes = execFileSync("git", ["cat-file", "blob", "HEAD:" + candidateMigrationPath], { cwd: root });
  const prerequisiteBytes = execFileSync("git", ["cat-file", "blob", "HEAD:" + RELEASE_PATH], { cwd: root });
  const reviewOnly = JSON.parse(fs.readFileSync(path.join(root, candidateReviewPath), "utf8"));
  const documentedAddition = verifyCandidateReviewOnlyReceipt(reviewOnly, candidateBytes, prerequisiteBytes);
  assert.deepEqual([...MIGRATION_PATHS, documentedAddition].sort(), featurePaths, "any other feature migration requires explicit release review");
  assert.deepEqual(Buffer.from(fs.readFileSync(path.join(root, candidateMigrationPath), "utf8").replace(/\r\n/g, "\n")), candidateBytes);
  assert.ok(!MIGRATION_PATHS.includes(documentedAddition), "candidate review receipt must not authorize production application");
  for (const changed of [{ ...reviewOnly, productionApplicationApproved: true }, { ...reviewOnly, reviewOnly: false }, { ...reviewOnly, migration: { ...reviewOnly.migration, sha256: "0".repeat(64) } }]) {
    assert.throws(() => verifyCandidateReviewOnlyReceipt(changed, candidateBytes, prerequisiteBytes));
  }
  assert.throws(() => verifyMigrationPlan({ ...plan("pre"), migrations: [...plan("pre").migrations, path.posix.basename(documentedAddition)] }, manifest, "pre"), /unexpected_pending/);
  assert.equal(MIGRATION_PATHS.length, 6);
  assert.ok(Object.isFrozen(MIGRATION_PATHS));
  const actual = Object.fromEntries(MIGRATION_PATHS.map(file => {
    const committed = execFileSync("git", ["cat-file", "blob", "HEAD:" + file], { cwd: root });
    assert.deepEqual(Buffer.from(fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n")), committed, "checkout must match committed SQL; only Windows CRLF differs");
    return [file, committed];
  }));
  const saved = JSON.parse(fs.readFileSync(path.join(root, RELEASE_PATH), "utf8"));
  assert.deepEqual(verifyReleaseManifest(saved, actual), createReleaseManifest(actual));
  for (const entry of saved.migrations) assert.equal(entry.sha256, sha256(actual[entry.path]));
});
for (const [index, file] of MIGRATION_PATHS.entries()) {
  test("source inventory rejects missing migration " + index, () => {
    const missing = { ...sources }; delete missing[file];
    assert.throws(() => createReleaseManifest(missing), /exact_migration_sources_required/);
  });
  test("manifest rejects changed source or metadata at migration " + index, () => {
    assert.throws(() => verifyReleaseManifest(manifest, { ...sources, [file]: Buffer.concat([sources[file], Buffer.from("-- changed")]) }), /source_mismatch/);
    for (const field of ["sha256", "bytes", "version", "name", "path", "filename"]) {
      const altered = structuredClone(manifest); altered.migrations[index][field] = field === "bytes" ? 1 : "changed";
      assert.throws(() => verifyReleaseManifest(altered, sources), /source_mismatch/);
    }
  });
}
test("source inventory and manifest reject additions, omissions, duplicates, reorder and invalid bytes", () => {
  assert.throws(() => createReleaseManifest({ ...sources, "supabase/migrations/20990101000000_unreviewed.sql": source }), /exact_migration_sources_required/);
  for (const invalid of [Buffer.alloc(0), Buffer.from([0xff]), "not-bytes"]) assert.throws(() => createReleaseManifest({ ...sources, [MIGRATION_PATHS[0]]: invalid }));
  for (const migrations of [manifest.migrations.slice(1), [...manifest.migrations, manifest.migrations[0]], [...manifest.migrations].reverse()]) assert.throws(() => verifyReleaseManifest({ ...manifest, migrations }, sources), /source_mismatch/);
  assert.throws(() => verifyReleaseManifest({ ...manifest, projectRef: "other-project" }, sources), /source_mismatch/);
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
test("ledger readback covers every ordered source including comments and dollar bodies", () => {
  const proof = verifyMigrationLedger(rows, manifest, sources);
  assert.equal(proof.migrationCount, 6);
  assert.equal(proof.releaseManifestContentSha256, sha256(JSON.stringify(manifest)));
  for (const [index, item] of proof.migrations.entries()) {
    assert.equal(item.path, MIGRATION_PATHS[index]);
    assert.equal(item.statementCount, 4);
    assert.equal(item.sourceSha256, sha256(sources[item.path]));
    assert.equal(item.ledgerStatementsSha256, sha256(JSON.stringify(rows[index].statements)));
    assert.equal(item.statementContentMatchesReviewedSource, true);
  }
});
for (const [label, changed] of [
  ["missing row", rows.slice(1)], ["duplicate row", [...rows.slice(0, 5), rows[0]]], ["additional row", [...rows, rows[0]]], ["reordered rows", [...rows].reverse()],
  ["wrong version", changedRow(0, { version: "20990101000000" })], ["wrong name", changedRow(0, { name: "other" })],
  ["missing statements", changedRow(0, { statements: null })], ["changed literal", changedRow(0, { statements: rows[0].statements.map(s => s.replace("x;y", "changed")) })],
  ["omitted statement", changedRow(0, { statements: rows[0].statements.slice(0, 2) })], ["reordered statements", changedRow(0, { statements: [...rows[0].statements].reverse() })],
  ["extra statement", changedRow(0, { statements: [...rows[0].statements, "DROP TABLE unexpected"] })], ["extra fields", changedRow(0, { unreviewed: true })],
]) test("ledger rejects " + label, () => assert.throws(() => verifyMigrationLedger(changed, manifest, sources)));
for (const [index] of MIGRATION_PATHS.entries()) test("ledger binds full content to exact migration " + index, () => {
  assert.throws(() => verifyMigrationLedger(changedRow(index, { statements: rows[index].statements.map(s => s.replace("SELECT " + index, "SELECT 99")) }), manifest, sources), /content_mismatch/);
  assert.throws(() => verifyMigrationLedger(changedRow(index, { statements: rows[(index + 1) % rows.length].statements }), manifest, sources), /content_mismatch/);
});
test("truncated token boundaries cannot masquerade as complete statements", () => {
  assert.throws(() => verifyLedgerStatements(Buffer.from("SELECT abc;"), ["SELECT ab", "c"]), /boundary_mismatch/);
});
test("whitespace cannot split one SQL statement into multiple ledger entries", () => {
  assert.throws(() => verifyLedgerStatements(Buffer.from("SELECT abc;"), ["SELECT", "abc"]), /terminator_missing/);
});

test("fixed ledger query is one SELECT bound to exactly the six ordered versions", () => {
  assert.equal(ledgerQuery(manifest), "SELECT version, name, statements FROM supabase_migrations.schema_migrations WHERE version IN ('20260923161812', '20260923174500', '20260923182000', '20260923221500', '20260924071322', '20260924093317') ORDER BY version;\n");
});
for (const [label, migrations] of [["partial", manifest.migrations.slice(1)], ["expanded", [...manifest.migrations, manifest.migrations[0]]], ["reordered", [...manifest.migrations].reverse()], ["injected", manifest.migrations.map((m, i) => i === 0 ? { ...m, version: "0'); DELETE" } : m)]]) {
  test("query and plan reject " + label + " release scope", () => {
    assert.throws(() => ledgerQuery({ ...manifest, migrations }), /invalid_release_scope/);
    assert.throws(() => verifyMigrationPlan(plan("pre"), { ...manifest, migrations }, "pre"), /invalid_release_scope/);
  });
}
for (const [index] of MIGRATION_PATHS.entries()) test("plan rejects omitted migration " + index, () => {
  const pending = plan("pre"); pending.migrations.splice(index, 1);
  assert.throws(() => verifyMigrationPlan(pending, manifest, "pre"), /unexpected_pending/);
});
test("plan rejects reordered, duplicated or partially applied migration sets", () => {
  for (const migrations of [[...plan("pre").migrations].reverse(), [...plan("pre").migrations.slice(0, 5), plan("pre").migrations[0]], plan("pre").migrations.slice(1)]) assert.throws(() => verifyMigrationPlan({ ...plan("pre"), migrations }, manifest, "pre"), /unexpected_pending/);
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
