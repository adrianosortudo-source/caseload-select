import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  AGENCY_MIGRATIONS,
  APPLY_CONFIRMATION,
  TEMPORARY_CREDENTIAL_CONFIRMATION,
  verifyAgencyTemporaryCredentialAuthorization,
  verifyAgencyConnectionEvidence,
  APPLY_EVIDENCE_FILES,
  PREFLIGHT_EVIDENCE_FILES,
  createPreflightManifest,
  createResultManifest,
  stageAgencyProductionWorkdir,
  verifyAgencyFullLedger,
  verifyAgencyLedgerDeltaRecords,
  verifyAgencyMigrationSources,
  verifyAgencyPlan,
  verifyPreflightArtifact,
  verifySameAgencyLedger,
  verifySameAgencyPlan,
} from "./agency-followup-production-release-gate.mjs";
import {
  HISTORICAL_LEDGER_NAME_ALIASES,
  PREVIEW_MIGRATION_PATHS,
  PROJECT_REF,
  TEMPORARY_DATABASE_HOST,
  sourceMigrationInventory,
} from "./prospect-enrichment/migration-gate.mjs";
import { DATABASE_CA_SHA256 } from "./prospect-enrichment/database-ca.mjs";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const ROOT = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const SOURCE_SHA = "a".repeat(40);
const WORKFLOW_ENV = {
  GITHUB_RUN_ID: "123456",
  GITHUB_RUN_ATTEMPT: "1",
  REVIEWED_SOURCE_SHA: SOURCE_SHA,
};

function writeJson(directory, name, value) {
  fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value)}\n`, { flag: "wx" });
}

function sourceRows(excludedVersions = new Set()) {
  return sourceMigrationInventory(ROOT).migrations
    .filter(item => !PREVIEW_MIGRATION_PATHS.includes(item.path) && !excludedVersions.has(item.version))
    .map(item => ({
      version: item.version,
      name: HISTORICAL_LEDGER_NAME_ALIASES[item.version]?.filename === item.filename
        ? HISTORICAL_LEDGER_NAME_ALIASES[item.version].name
        : item.name,
    }));
}

function agencyPreflightRows() {
  const pending = new Set(AGENCY_MIGRATIONS.map(item => item.version));
  return sourceRows(pending);
}

function makePlan(phase = "pre") {
  const post = phase === "post";
  return {
    dryRun: true,
    upToDate: post,
    migrations: post ? [] : AGENCY_MIGRATIONS.map(item => item.filename),
    seeds: [],
    roles: [],
    message: post ? "Remote database is up to date." : "Finished supabase db push.",
  };
}

function makePreflightEvidence(directory, stagedEvidence, rows, temporary = false) {
  const migrations = verifyAgencyMigrationSources(ROOT);
  const ledgerCheck = verifyAgencyFullLedger(rows, ROOT, "preflight");
  const plan = makePlan();
  const planCheck = verifyAgencyPlan(plan, "pre");
  const connection = {
    host: `db.${PROJECT_REF}.supabase.co`,
    port: 5432,
    database: "postgres",
    user: "postgres",
    sslmode: "verify-full",
    connectionMode: "explicit-db-url",
    certificateTrust: "pinned-supabase-root-2021",
  };
  if (temporary) Object.assign(connection, {
    host: TEMPORARY_DATABASE_HOST, user: `cli_login_synthetic.${PROJECT_REF}`, credentialMode: "temporary-write-capable",
  });
  const values = {
    "source-check.json": {
      schemaVersion: "agency-followup-source-check/v1",
      projectRef: PROJECT_REF,
      sourceSha: SOURCE_SHA,
      runId: WORKFLOW_ENV.GITHUB_RUN_ID,
      runAttempt: WORKFLOW_ENV.GITHUB_RUN_ATTEMPT,
      migrations,
      excludedPreviewMigrations: [...PREVIEW_MIGRATION_PATHS],
    },
    "staged-inventory.json": stagedEvidence,
    "database-tls-check.json": {
      certificateSha256: DATABASE_CA_SHA256,
      validTo: "2099-01-01T00:00:00.000Z",
      ...connection,
    },
    "connection-check.json": connection,
    "full-ledger-before.json": rows,
    "ledger-before-check.json": ledgerCheck,
    "plan.json": plan,
    "plan-check.json": planCheck,
  };
  for (const name of PREFLIGHT_EVIDENCE_FILES) writeJson(directory, name, values[name]);
}

test("pins exactly 18 Agency migrations to the current source bytes in order", () => {
  assert.equal(AGENCY_MIGRATIONS.length, 18);
  assert.deepEqual(AGENCY_MIGRATIONS.map(item => item.version), [...AGENCY_MIGRATIONS.map(item => item.version)].sort());
  assert.ok(AGENCY_MIGRATIONS.every(item => /^[a-f0-9]{64}$/.test(item.sha256)));
  const actual = verifyAgencyMigrationSources(ROOT);
  assert.deepEqual(actual.map(({ path: itemPath, filename, version, name, sha256 }) => ({ path: itemPath, filename, version, name, sha256 })), AGENCY_MIGRATIONS);
  const tampered = AGENCY_MIGRATIONS.map(item => ({ ...item }));
  tampered[0].sha256 = "0".repeat(64);
  assert.throws(() => verifyAgencyMigrationSources(ROOT, tampered), /agency_followup_pinned_migration_source_mismatch/);
  assert.throws(() => verifyAgencyMigrationSources(ROOT, [...AGENCY_MIGRATIONS].reverse()), /agency_followup_migration_pin_order_invalid/);
});

test("stages full production history and excludes exactly both preview-only migrations", () => {
  const temporaryParent = fs.mkdtempSync(path.join(os.tmpdir(), "agency-followup-stage-test-"));
  const destination = path.join(temporaryParent, "staged");
  try {
    const { proof, evidence } = stageAgencyProductionWorkdir(ROOT, destination, SOURCE_SHA);
    const source = sourceMigrationInventory(ROOT);
    const staged = sourceMigrationInventory(destination, { requirePreviewSources: false });
    const expected = source.migrations.filter(item => !PREVIEW_MIGRATION_PATHS.includes(item.path));
    assert.equal(staged.migrations.length, source.migrations.length - 2);
    assert.deepEqual(staged.migrations, expected);
    assert.deepEqual(proof.exclusions.map(item => item.path), [...PREVIEW_MIGRATION_PATHS]);
    assert.deepEqual(evidence.stage.exclusions.map(item => item.path), [...PREVIEW_MIGRATION_PATHS]);
    for (const preview of PREVIEW_MIGRATION_PATHS) assert.equal(fs.existsSync(path.join(destination, preview)), false);
    assert.equal(evidence.stage.migrationCount, expected.length);
  } finally {
    fs.rmSync(temporaryParent, { recursive: true, force: true });
  }
});

test("full ledger accepts only the 18 exact Agency follow-up migrations as pending", () => {
  const before = agencyPreflightRows();
  const preflight = verifyAgencyFullLedger(before, ROOT, "preflight");
  assert.deepEqual(preflight.pendingPaths, AGENCY_MIGRATIONS.map(item => item.path));
  assert.deepEqual(preflight.excludedPreviewMigrations, [...PREVIEW_MIGRATION_PATHS]);
  assert.deepEqual(verifyAgencyFullLedger(sourceRows(), ROOT, "post").pendingPaths, []);

  const unrelated = sourceMigrationInventory(ROOT).migrations.find(item =>
    !PREVIEW_MIGRATION_PATHS.includes(item.path) && !AGENCY_MIGRATIONS.some(target => target.version === item.version));
  assert.ok(unrelated);
  assert.throws(() => verifyAgencyFullLedger(before.filter(row => row.version !== unrelated.version), ROOT, "preflight"),
    /agency_followup_unexpected_pending_migrations/);

  const unexpectedRemote = [...before, { version: "99999999999999", name: "untracked_migration" }];
  assert.throws(() => verifyAgencyFullLedger(unexpectedRemote, ROOT, "preflight"),
    /agency_followup_remote_migration_source_missing_or_mismatched/);

  const previewRemote = [...before, { version: "20260915183000", name: "preview_qa_session_registry" }].sort((a, b) => a.version.localeCompare(b.version));
  assert.throws(() => verifyAgencyFullLedger(previewRemote, ROOT, "preflight"),
    /agency_followup_remote_migration_source_missing_or_mismatched/);
});

test("dry-run plans must contain exactly the pinned filenames with no seeds or roles", () => {
  const pre = verifyAgencyPlan(makePlan("pre"), "pre");
  assert.equal(pre.migrations.length, 18);
  assert.deepEqual(verifyAgencyPlan(makePlan("post"), "post").migrations, []);
  assert.throws(() => verifyAgencyPlan({ ...makePlan(), migrations: [...makePlan().migrations, PREVIEW_MIGRATION_PATHS[0].split("/").at(-1)] }, "pre"),
    /agency_followup_migration_plan_mismatch/);
  assert.throws(() => verifyAgencyPlan({ ...makePlan(), roles: ["authenticated"] }, "pre"),
    /agency_followup_migration_plan_mismatch/);
  assert.deepEqual(verifySameAgencyPlan(makePlan(), makePlan()).unchangedSincePreflight, true);
  assert.throws(() => verifySameAgencyPlan(makePlan(), { ...makePlan(), migrations: [] }),
    /agency_followup_migration_plan_mismatch/);
});

test("ledger delta rejects any missing/extra target version or changed historical row", () => {
  const before = agencyPreflightRows();
  const after = [...sourceRows()];
  const delta = verifyAgencyLedgerDeltaRecords(before, after);
  assert.equal(delta.exactDelta, true);
  assert.deepEqual(delta.addedVersions, AGENCY_MIGRATIONS.map(item => item.version));
  assert.throws(() => verifyAgencyLedgerDeltaRecords(before, [...after, { version: "999999999999", name: "unexpected" }]),
    /agency_followup_ledger_delta_mismatch/);
  const altered = after.map(row => row.version === before[0].version ? { ...row, name: "different_history" } : row);
  assert.throws(() => verifyAgencyLedgerDeltaRecords(before, altered),
    /agency_followup_full_ledger_changed_outside_allowlist/);
  assert.equal(verifySameAgencyLedger(before, before).unchangedSincePreflight, true);
});

test("preflight artifact binds the exact source, plan, stage, metadata and hashes", () => {
  const temporaryParent = fs.mkdtempSync(path.join(os.tmpdir(), "agency-followup-manifest-test-"));
  const stageRoot = path.join(temporaryParent, "stage");
  const evidenceRoot = path.join(temporaryParent, "evidence");
  fs.mkdirSync(evidenceRoot);
  try {
    const { evidence } = stageAgencyProductionWorkdir(ROOT, stageRoot, SOURCE_SHA);
    const rows = agencyPreflightRows();
    makePreflightEvidence(evidenceRoot, evidence, rows);
    const { manifestSha256 } = createPreflightManifest(evidenceRoot, { sourceRoot: ROOT, env: WORKFLOW_ENV, now: Date.parse("2026-10-25T12:00:00.000Z") });
    const artifactEnv = {
      ...WORKFLOW_ENV,
      EXPECTED_ARTIFACT_ID: "987654",
      EXPECTED_ARTIFACT_DIGEST: `sha256:${"b".repeat(64)}`,
      EXPECTED_ARTIFACT_NAME: "agency-followup-production-preflight-123456-1",
      EXPECTED_MANIFEST_SHA256: manifestSha256,
    };
    const metadata = {
      id: 987654,
      name: artifactEnv.EXPECTED_ARTIFACT_NAME,
      digest: artifactEnv.EXPECTED_ARTIFACT_DIGEST,
      expired: false,
      workflow_run: { id: 123456, head_sha: SOURCE_SHA, head_branch: "main" },
    };
    const result = verifyPreflightArtifact(evidenceRoot, metadata, {
      sourceRoot: ROOT,
      env: artifactEnv,
      now: Date.parse("2026-10-25T12:01:00.000Z"),
    });
    assert.equal(result.verified, true);
    assert.equal(result.migrations.length, 18);
    assert.throws(() => verifyPreflightArtifact(evidenceRoot, { ...metadata, expired: true }, {
      sourceRoot: ROOT,
      env: artifactEnv,
      now: Date.parse("2026-10-25T12:01:00.000Z"),
    }), /agency_followup_preflight_artifact_metadata_mismatch/);
  } finally {
    fs.rmSync(temporaryParent, { recursive: true, force: true });
  }
});

test("result evidence manifests hash only the exact allowed output files", () => {
  const temporaryParent = fs.mkdtempSync(path.join(os.tmpdir(), "agency-followup-result-test-"));
  const evidenceRoot = path.join(temporaryParent, "evidence");
  fs.mkdirSync(evidenceRoot);
  try {
    writeJson(evidenceRoot, "apply-authorization.json", { explicitApplyConfirmation: true, confirmation: APPLY_CONFIRMATION });
    const result = createResultManifest(evidenceRoot, WORKFLOW_ENV);
    assert.match(result.resultManifestSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(result.manifest.files), ["apply-authorization.json"]);
    writeJson(evidenceRoot, "unexpected.txt", { secret: false });
    assert.throws(() => createResultManifest(evidenceRoot, WORKFLOW_ENV), /agency_followup_result_files_invalid/);
  } finally {
    fs.rmSync(temporaryParent, { recursive: true, force: true });
  }
});

test("workflow has separate manual read-only preflight and environment-gated apply only", () => {
  const workflowPath = path.join(ROOT, ".github/workflows/agency-followup-production-release.yml");
  const workflowText = fs.readFileSync(workflowPath, "utf8");
  const workflow = yaml.load(workflowText);
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(Object.keys(workflow.jobs).sort(), ["apply", "preflight"]);
  for (const job of Object.values(workflow.jobs)) assert.equal(job.environment.name, "Production prospect migrations");
  assert.match(workflow.jobs.preflight.if, /refs\/heads\/main/);
  assert.match(workflow.jobs.apply.if, /refs\/heads\/main/);
  assert.equal(workflow.jobs.apply.needs, "preflight");
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.permissions.actions, "read");
  assert.match(workflowText, /CASELOAD_PRODUCTION_SUPABASE_MIGRATOR_DB_URL/);
  assert.doesNotMatch(workflowText, /supabase migration repair|\bpsql\b/i);

  const preflightText = workflow.jobs.preflight.steps.map(step => step.run ?? "").join("\n");
  const applyText = workflow.jobs.apply.steps.map(step => step.run ?? "").join("\n");
  assert.match(preflightText, /supabase db push[^\n]*--dry-run[^\n]*--include-all/);
  assert.doesNotMatch(preflightText, /supabase db push[^\n]*--yes/);
  assert.match(applyText, /supabase db push[^\n]*--yes[^\n]*--include-all[^\n]*--skip-vault/);
  assert.equal((applyText.match(/supabase db push[^\n]*--yes/g) ?? []).length, 1);
  for (const step of workflow.jobs.preflight.steps.filter(item => item.uses)) assert.match(step.uses, /@[a-f0-9]{40}$/);
  for (const step of workflow.jobs.apply.steps.filter(item => item.uses)) assert.match(step.uses, /@[a-f0-9]{40}$/);
  const writtenEvidence = [...applyText.matchAll(/\$AGENCY_RESULT_EVIDENCE_DIR\/([a-z0-9-]+\.json)/g)].map(match => match[1]);
  assert.ok(writtenEvidence.length > 0);
  const resultManifestFiles = new Set([...PREFLIGHT_EVIDENCE_FILES, "preflight-manifest.json", ...APPLY_EVIDENCE_FILES]);
  for (const file of writtenEvidence) assert.ok(resultManifestFiles.has(file), `${file} must be covered by result manifest`);
  assert.ok(PREFLIGHT_EVIDENCE_FILES.every(file => file.endsWith(".json")));
  assert.ok(APPLY_EVIDENCE_FILES.includes("staged-inventory-post.json"));
});


test("temporary access requires an exact confirmation, current main and clean source before acquisition", () => {
  const env = {
    ...WORKFLOW_ENV, USE_TEMPORARY_DATABASE_CREDENTIAL: "true", CREDENTIAL_GATE: "agency-followup",
    TEMPORARY_CREDENTIAL_CONFIRMATION, GITHUB_JOB: "preflight", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "adrianosortudo-source/caseload-select", GITHUB_SHA: SOURCE_SHA,
  };
  const context = { checkoutSha: SOURCE_SHA, originMainSha: SOURCE_SHA, worktreeStatus: "", projectEnvFiles: [] };
  assert.equal(verifyAgencyTemporaryCredentialAuthorization(env, context).temporaryAccessConfirmed, true);
  for (const change of [
    { USE_TEMPORARY_DATABASE_CREDENTIAL: "false" }, { TEMPORARY_CREDENTIAL_CONFIRMATION: "" },
    { CREDENTIAL_GATE: "enrichment" }, { GITHUB_JOB: "other" }, { GITHUB_REF: "refs/heads/other" },
    { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_EVENT_NAME: "push" }, { PGPASSWORD: "synthetic" },
    { GITHUB_JOB: "apply", APPLY_CONFIRMATION: "" },
  ]) assert.throws(() => verifyAgencyTemporaryCredentialAuthorization({ ...env, ...change }, context));
  for (const change of [{ originMainSha: "b".repeat(40) }, { checkoutSha: "b".repeat(40) },
    { worktreeStatus: " M package.json" }, { projectEnvFiles: [".env"] }]) {
    assert.throws(() => verifyAgencyTemporaryCredentialAuthorization(env, { ...context, ...change }));
  }
  assert.equal(verifyAgencyTemporaryCredentialAuthorization({ ...env, GITHUB_JOB: "apply", APPLY_CONFIRMATION }, context).job, "apply");
});

test("temporary connection evidence accepts only the pinned pooler, project, role and TLS", () => {
  const connection = {
    host: TEMPORARY_DATABASE_HOST, port: 5432, database: "postgres", user: `cli_login_synthetic.${PROJECT_REF}`,
    sslmode: "verify-full", connectionMode: "explicit-db-url", certificateTrust: "pinned-supabase-root-2021",
    credentialMode: "temporary-write-capable",
  };
  assert.deepEqual(verifyAgencyConnectionEvidence(connection, "temporary-write-capable"), connection);
  assert.throws(() => verifyAgencyConnectionEvidence(connection, "saved-password"));
  for (const change of [
    { host: `db.${PROJECT_REF}.supabase.co` }, { host: "other.pooler.supabase.com" }, { port: 6543 },
    { database: "template1" }, { user: "postgres" }, { user: "cli_login_x.otherproject" },
    { user: `cli_login_.${PROJECT_REF}` }, { sslmode: "require" }, { credentialMode: "saved-password" },
    { password: "must-not-be-in-evidence" }, { certificateTrust: "system" },
  ]) assert.throws(() => verifyAgencyConnectionEvidence({ ...connection, ...change }, "temporary-write-capable"));
});

test("temporary preflight artifact binds credential mode and cannot be reused as saved-password evidence", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "agency-temporary-evidence-"));
  const directory = path.join(parent, "evidence");
  fs.mkdirSync(directory);
  try {
    const { evidence } = stageAgencyProductionWorkdir(ROOT, path.join(parent, "stage"), SOURCE_SHA);
    makePreflightEvidence(directory, evidence, agencyPreflightRows(), true);
    assert.throws(() => createPreflightManifest(directory, { sourceRoot: ROOT, env: WORKFLOW_ENV }));
    const env = { ...WORKFLOW_ENV, USE_TEMPORARY_DATABASE_CREDENTIAL: "true" };
    const { manifestSha256, manifest } = createPreflightManifest(directory, { sourceRoot: ROOT, env });
    assert.equal(manifest.binding.credentialMode, "temporary-write-capable");
    const metadata = { id: 99, name: `agency-followup-production-preflight-${env.GITHUB_RUN_ID}-1`,
      digest: "sha256:" + "b".repeat(64), expired: false,
      workflow_run: { id: Number(env.GITHUB_RUN_ID), head_sha: SOURCE_SHA, head_branch: "main" } };
    const artifactEnv = { ...env, EXPECTED_ARTIFACT_ID: "99", EXPECTED_ARTIFACT_DIGEST: metadata.digest,
      EXPECTED_ARTIFACT_NAME: metadata.name, EXPECTED_MANIFEST_SHA256: manifestSha256 };
    assert.equal(verifyPreflightArtifact(directory, metadata, { sourceRoot: ROOT, env: artifactEnv }).verified, true);
    assert.throws(() => verifyPreflightArtifact(directory, metadata, {
      sourceRoot: ROOT, env: { ...artifactEnv, USE_TEMPORARY_DATABASE_CREDENTIAL: "false" },
    }), /agency_followup_preflight_manifest_invalid/);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test("workflow keeps temporary token isolated, authenticates only after source/evidence approval and rechecks expiry", () => {
  const workflow = yaml.load(fs.readFileSync(path.join(ROOT, ".github/workflows/agency-followup-production-release.yml"), "utf8"));
  assert.equal(workflow.on.workflow_dispatch.inputs.use_temporary_database_credential.default, false);
  assert.match(workflow.jobs.apply.if, /inputs\.apply_confirmation == 'APPLY-AGENCY-FOLLOWUP-MIGRATIONS-V1'/);
  for (const [name, job] of Object.entries(workflow.jobs)) {
    const mint = job.steps.findIndex(step => (step.run ?? "").includes("node scripts/prospect-enrichment/temporary-credential.mjs"));
    const authorization = job.steps.findIndex(step => (step.run ?? "").includes("credential-authorization"));
    const staticLoader = job.steps.find(step => step.env?.STATIC_MIGRATION_DATABASE_URL);
    assert.ok(authorization >= 0 && mint > authorization);
    assert.equal(staticLoader.if, "${{ !inputs.use_temporary_database_credential }}");
    assert.equal(job.steps[mint].if, "inputs.use_temporary_database_credential");
    assert.equal(job.steps[mint].run, "node scripts/prospect-enrichment/temporary-credential.mjs");
    assert.equal(job.steps[mint].env.MIGRATION_ACCESS_TOKEN, "${{ secrets.CASELOAD_PRODUCTION_SUPABASE_MIGRATOR_TOKEN }}");
    if (name === "apply") {
      const verify = job.steps.findIndex(step => (step.run ?? "").includes(" verify-preflight "));
      assert.ok(verify >= 0 && verify < authorization);
    }
    for (const [index, step] of job.steps.entries()) {
      if (index !== mint) assert.equal(step.env?.MIGRATION_ACCESS_TOKEN, undefined);
      assert.equal(step.env?.MIGRATION_DATABASE_URL, undefined);
      if (!step.run) continue;
      const lines = step.run.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes("supabase db ") || lines[i].includes("--help")) continue;
        const preceding = lines.slice(Math.max(0, i - 3), i).join("\n");
        assert.match(preceding, /agency-followup-production-release-gate\.mjs connection-check/);
      }
    }
  }
});
