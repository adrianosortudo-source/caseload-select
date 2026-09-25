import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
  CLI_VERSION, CONFIRMATION, MIGRATION_PATHS, PROJECT_REF, RELEASE_PATH,
  PREVIEW_MIGRATION_PATHS, QUALIFICATION_HISTORY, QUALIFICATION_HISTORY_CONFIRMATION,
  compareQualificationCatalogs, stageProductionWorkdir, verifyFullMigrationLedger, verifyQualificationRepairAuthorization,
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

const coverageReviewPath = "docs/runbooks/prospect-candidate-firm-coverage-review.json";
const coverageMigrationPath = "supabase/migrations/20260924192549_prospect_enrichment_candidate_firm_coverage.sql";
function verifyCoverageReviewOnlyReceipt(receipt, coverageBytes, candidateReceiptBytes, candidateBytes) {
  assert.deepEqual(Object.keys(receipt).sort(), ["execution", "migration", "prerequisiteCandidateReceipt", "prerequisiteCandidateReceiptSha256", "prerequisiteCatalogReview", "prerequisiteMigration", "productionApplicationApproved", "projectRef", "reviewOnly", "schemaVersion", "sourceBaseSha"]);
  assert.equal(receipt.schemaVersion, "prospect-candidate-firm-coverage-review/v1");
  assert.equal(receipt.reviewOnly, true); assert.equal(receipt.productionApplicationApproved, false);
  assert.equal(receipt.projectRef, PROJECT_REF); assert.match(receipt.sourceBaseSha, /^[a-f0-9]{40}$/);
  assert.equal(receipt.prerequisiteCandidateReceipt, candidateReviewPath);
  assert.equal(receipt.prerequisiteCandidateReceiptSha256, sha256(candidateReceiptBytes));
  assert.equal(receipt.prerequisiteCatalogReview, "pending_separate_release_review");
  assert.deepEqual(receipt.prerequisiteMigration, { path: candidateMigrationPath, bytes: candidateBytes.length, sha256: sha256(candidateBytes) });
  assert.deepEqual(receipt.migration, { path: coverageMigrationPath, version: "20260924192549", name: "prospect_enrichment_candidate_firm_coverage", bytes: coverageBytes.length, sha256: sha256(coverageBytes) });
  assert.match(receipt.execution, /No existing workflow consumes this review receipt/);
  return coverageMigrationPath;
}

test("release manifest keeps exactly six production migrations plus two separately documented review-only candidate migrations", () => {
  const featurePaths = fs.readdirSync(path.join(root, "supabase/migrations")).filter(name => /_prospect_enrichment_|_fix_gta_prospect_operator_projection_gaps\.sql$/.test(name)).sort().map(name => "supabase/migrations/" + name);
  const candidateBytes = execFileSync("git", ["cat-file", "blob", "HEAD:" + candidateMigrationPath], { cwd: root });
  const prerequisiteBytes = execFileSync("git", ["cat-file", "blob", "HEAD:" + RELEASE_PATH], { cwd: root });
  const reviewOnly = JSON.parse(fs.readFileSync(path.join(root, candidateReviewPath), "utf8"));
  const documentedAddition = verifyCandidateReviewOnlyReceipt(reviewOnly, candidateBytes, prerequisiteBytes);
  const candidateReceiptBytes = execFileSync("git", ["cat-file", "blob", "HEAD:" + candidateReviewPath], { cwd: root });
  const coverageBytes = execFileSync("git", ["cat-file", "blob", "HEAD:" + coverageMigrationPath], { cwd: root });
  const coverageReview = JSON.parse(fs.readFileSync(path.join(root, coverageReviewPath), "utf8"));
  const documentedCoverage = verifyCoverageReviewOnlyReceipt(coverageReview, coverageBytes, candidateReceiptBytes, candidateBytes);
  assert.deepEqual(Buffer.from(fs.readFileSync(path.join(root, coverageMigrationPath), "utf8").replace(/\r\n/g, "\n")), coverageBytes);
  assert.ok(!MIGRATION_PATHS.includes(documentedCoverage));
  for (const changed of [{ ...coverageReview, productionApplicationApproved: true }, { ...coverageReview, reviewOnly: false }, { ...coverageReview, prerequisiteCatalogReview: "complete" }, { ...coverageReview, migration: { ...coverageReview.migration, sha256: "0".repeat(64) } }, { ...coverageReview, prerequisiteCandidateReceiptSha256: "0".repeat(64) }]) assert.throws(() => verifyCoverageReviewOnlyReceipt(changed, coverageBytes, candidateReceiptBytes, candidateBytes));
  assert.throws(() => verifyMigrationPlan({ ...plan("pre"), migrations: [...plan("pre").migrations, path.posix.basename(documentedCoverage)] }, manifest, "pre"), /unexpected_pending/);
  assert.deepEqual([...MIGRATION_PATHS, documentedAddition, documentedCoverage].sort(), featurePaths, "any other feature migration requires explicit release review");
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
  assert.equal(workflow.on.workflow_dispatch.inputs.operation.type, "choice");
  assert.equal(job.env.POSTGRES_CONTAINER_ID, undefined);
  assert.doesNotMatch(JSON.stringify(job.env), /\$\{\{\s*job\./);
  const qualificationCatalog = job.steps.find((s) => /Build and compare exact qualification catalog contract/.test(s.name));
  assert.equal(qualificationCatalog.env.POSTGRES_CONTAINER_ID, "${{ job.services.postgres.id }}");
  assert.match(qualificationCatalog.run, /docker exec -i "\$POSTGRES_CONTAINER_ID"/);
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
  const readback = job.steps.find((s) => s.if === "always() && inputs.operation == 'apply' && steps.apply_migration.outputs.apply_started == 'true'");
  assert.equal(readback.if, "always() && inputs.operation == 'apply' && steps.apply_migration.outputs.apply_started == 'true'");
  assert.match(readback.run, /--db-url "\$MIGRATION_DATABASE_URL"/);
  assert.match(readback.run, /--output-format json --agent no/);
  assert.match(readback.run, /plan post/);
  const qualificationRepair = job.steps.find((s) => s.id === "qualification_repair");
  assert.equal(qualificationRepair.if, "inputs.operation == 'qualification-repair'");
  assert.match(qualificationRepair.run, /migration-gate\.mjs source/);
  assert.match(qualificationRepair.run, /full-ledger.*qualification-pending/);
  assert.match(qualificationRepair.run, /catalog-compare/);
  assert.match(qualificationRepair.run, /repair-authorization/);
  assert.match(qualificationRepair.run, /supabase migration repair --db-url .*--status applied 20260921120000 20260921121500/);
  assert.doesNotMatch(qualificationRepair.run, /supabase db push/);
  const qualificationRepairReadback = job.steps.find((s) => s.if === "always() && inputs.operation == 'qualification-repair' && steps.qualification_repair.outputs.repair_started == 'true'");
  assert.ok(qualificationRepairReadback);
  assert.match(qualificationRepairReadback.run, /full-ledger.*enrichment-pending/);
  assert.match(qualificationRepairReadback.run, /ledger-delta .*20260921120000 20260921121500/);
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

test("production staging excludes exactly the two preview migrations and preserves every included byte", t => {
  const base = fs.mkdtempSync(path.join(process.env.TEMP ?? process.cwd(), "migration-stage-test-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const sourceRoot = path.join(base, "source"), migrationsDir = path.join(sourceRoot, "supabase", "migrations");
  const destinationRoot = path.join(base, "staged");
  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "supabase", "config.toml"), "project_id = 'fixture'\n");
  const fixturePaths = [...MIGRATION_PATHS, ...QUALIFICATION_HISTORY.map(entry => entry.path), ...PREVIEW_MIGRATION_PATHS,
    "supabase/migrations/20260413_legacy_numeric.sql", "supabase/migrations/manual_notes.sql"];
  for (const [index, relative] of fixturePaths.entries()) {
    fs.writeFileSync(path.join(sourceRoot, relative), Buffer.from(`-- fixture ${index}\nSELECT ${index};\n`));
  }
  const result = stageProductionWorkdir(sourceRoot, destinationRoot);
  assert.equal(result.exclusions.length, PREVIEW_MIGRATION_PATHS.length);
  assert.deepEqual(result.exclusions.map(item => item.path).sort(), [...PREVIEW_MIGRATION_PATHS].sort());
  assert.equal(result.migrationCount, fixturePaths.length - PREVIEW_MIGRATION_PATHS.length - 1);
  const stagedNames = fs.readdirSync(path.join(destinationRoot, "supabase", "migrations")).sort();
  assert.deepEqual(stagedNames, fixturePaths.filter(p => /^supabase\/migrations\/\d+_.+\.sql$/.test(p) && !PREVIEW_MIGRATION_PATHS.includes(p)).map(p => path.basename(p)).sort());
  for (const relative of fixturePaths.filter(p => /^supabase\/migrations\/\d+_.+\.sql$/.test(p) && !PREVIEW_MIGRATION_PATHS.includes(p))) {
    assert.deepEqual(fs.readFileSync(path.join(destinationRoot, relative)), fs.readFileSync(path.join(sourceRoot, relative)), relative);
  }
  assert.throws(() => stageProductionWorkdir(sourceRoot, destinationRoot), /staging_destination_must_be_fresh_absolute_path/);
});

test("full production ledger admits only the exact source-backed phase and rejects unknown or mismatched versions", t => {
  const makeRows = paths => paths.map(relative => {
    const filename = path.basename(relative), match = /^(\d+)_(.+)\.sql$/.exec(filename);
    return { version: match[1], name: match[2] };
  }).sort((a, b) => a.version.localeCompare(b.version));
  const localPaths = [...MIGRATION_PATHS, ...QUALIFICATION_HISTORY.map(entry => entry.path), "supabase/migrations/20260413_legacy_numeric.sql"];
  const full = makeRows(localPaths);
  const preQualification = full.filter(row => !QUALIFICATION_HISTORY.some(item => item.version === row.version) && !MIGRATION_PATHS.some(item => item.includes(row.version)));
  const afterRepair = full.filter(row => !MIGRATION_PATHS.some(item => item.includes(row.version)));
  const base = fs.mkdtempSync(path.join(process.env.TEMP ?? process.cwd(), "migration-ledger-test-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const migrationDir = path.join(base, "supabase", "migrations"); fs.mkdirSync(migrationDir, { recursive: true });
  for (const relative of localPaths) fs.writeFileSync(path.join(base, relative), "SELECT 1;\n");
  for (const relative of PREVIEW_MIGRATION_PATHS) fs.writeFileSync(path.join(base, relative), "SELECT 1;\n");
  assert.equal(verifyFullMigrationLedger(preQualification, base, "qualification-pending").pendingPaths.length, QUALIFICATION_HISTORY.length + MIGRATION_PATHS.length);
  assert.equal(verifyFullMigrationLedger(afterRepair, base, "enrichment-pending").pendingPaths.length, MIGRATION_PATHS.length);
  assert.equal(verifyFullMigrationLedger(full, base, "complete").pendingPaths.length, 0);
  assert.throws(() => verifyFullMigrationLedger([...preQualification, { version: "20260414", name: "unknown_remote" }].sort((a, b) => a.version.localeCompare(b.version)), base, "qualification-pending"), /remote_migration_source_missing_or_mismatched/);
  const mismatched = preQualification.map(row => row.version === "20260413" ? { ...row, name: "other_migration" } : row);
  assert.throws(() => verifyFullMigrationLedger(mismatched, base, "qualification-pending"), /remote_migration_source_missing_or_mismatched/);
  assert.throws(() => verifyFullMigrationLedger(preQualification, base, "complete"), /unexpected_full_history_delta/);
});

test("qualification catalog comparison rejects missing tables, changed indexes, constraints, and column privileges", t => {
  const base = fs.mkdtempSync(path.join(process.env.TEMP ?? process.cwd(), "qualification-catalog-test-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const catalog = { schemaVersion: "qualification-catalog-contract/v1", tables: [
    "prospect_advertising_observations", "prospect_decision_maker_contacts", "prospect_diagnostic_ready_profiles",
    "prospect_diagnostic_reservations", "prospect_export_runs", "prospect_firm_affiliations",
    "prospect_firm_fit_observations", "prospect_lso_licensees", "prospect_opportunity_observations",
    "prospect_qualification_decisions", "prospect_research_attempts", "prospect_service_observations",
    "prospect_source_captures", "prospect_source_record_map"
  ].map(name => ({ name, present: true, columns: [{ name: "id", type: "uuid", nullable: false, default: null, anonPrivileges: { select: false }, authenticatedPrivileges: { select: false }, serviceRolePrivileges: { select: true } }], constraints: [{ name: name + "_pkey", definition: "PRIMARY KEY (id)" }], indexes: [{ name: name + "_pkey", definition: "CREATE UNIQUE INDEX ON id" }], policies: [], triggers: [], anon: {}, authenticated: {}, serviceRole: {}, owner: "postgres", rlsEnabled: true, forceRls: false })) };
  const scratch = path.join(base, "scratch.json"), production = path.join(base, "production.json");
  const writeScratch = value => fs.writeFileSync(scratch, JSON.stringify([{ catalog_contract: value }]));
  const writeProduction = value => fs.writeFileSync(production, JSON.stringify({ rows: [{ catalog_contract: value }] }));
  const expected = structuredClone(catalog); writeScratch(expected); writeProduction(expected);
  // Catalog comparison also validates pinned SQL bytes, so the fixture source root uses the real checked-out files.
  const sourceRoot = root;
  assert.equal(compareQualificationCatalogs(scratch, production, sourceRoot).tableCount, 14);
  for (const mutate of [
    value => { value.tables.pop(); },
    value => { value.tables[0].present = false; },
    value => { value.tables[0].indexes[0].name = "renamed_index"; },
    value => { value.tables[0].indexes[0].definition += " WHERE id IS NOT NULL"; },
    value => { value.tables[0].constraints[0].name = "renamed_constraint"; },
    value => { value.tables[0].constraints[0].definition = "CHECK (id IS NOT NULL)"; },
    value => { value.tables[0].columns[0].anonPrivileges.select = true; },
    value => { value.tables[0].serviceRole.tablePrivileges = { select: false }; },
  ]) {
    const changed = structuredClone(expected); mutate(changed); writeProduction(changed);
    assert.throws(() => compareQualificationCatalogs(scratch, production, sourceRoot), /catalog_contract_incomplete|catalog_contract_facet_missing|production_qualification_catalog_does_not_match_source/);
  }
});

test("qualification repair authorization binds exact confirmation token and reviewed catalog hash", () => {
  const digest = "a".repeat(64);
  assert.deepEqual(verifyQualificationRepairAuthorization({ confirmation: QUALIFICATION_HISTORY_CONFIRMATION, reviewedCatalogSha256: digest, currentCatalogSha256: digest }), { operation: "qualification-repair", catalogEvidenceSha256: digest });
  for (const values of [
    { confirmation: "wrong", reviewedCatalogSha256: digest, currentCatalogSha256: digest },
    { confirmation: QUALIFICATION_HISTORY_CONFIRMATION, reviewedCatalogSha256: "b".repeat(64), currentCatalogSha256: digest },
    { confirmation: QUALIFICATION_HISTORY_CONFIRMATION, reviewedCatalogSha256: "invalid", currentCatalogSha256: digest },
  ]) assert.throws(() => verifyQualificationRepairAuthorization(values));
});

test("dotenv detection covers both directories and all pinned default filenames without reading values", () => {
  const checked = [];
  const present = findProjectEnvFiles(file => { checked.push(file.replaceAll("\\", "/")); return true; });
  const names = [".env.development.local", ".env.local", ".env.development", ".env"];
  assert.deepEqual(checked.sort(), [...names.map(name => "supabase/" + name), ...names].sort());
  assert.equal(present.length, 8);
  assert.throws(() => verifyDirectDatabaseUrl(databaseUrl, {}, present), /project_database_env_files_prohibited/);
});
