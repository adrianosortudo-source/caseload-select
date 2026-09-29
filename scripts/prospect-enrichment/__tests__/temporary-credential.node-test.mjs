import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { acquireTemporaryCredential, validateTemporaryCredential, redactedFailureCode, LOGIN_ENDPOINT } from "../temporary-credential.mjs";
import { verifyDirectDatabaseUrl, verifyExecutionGate, PROJECT_REF, TEMPORARY_DATABASE_HOST } from "../migration-gate.mjs";
import { DATABASE_CA_PATH } from "../database-ca.mjs";
import { verifyApplicationGate, verifySourceGate } from "../additive-release-gate.mjs";
const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const payload = { role: "cli_login_postgres", password: "synthetic:/?@%secret", ttl_seconds: 3600 };
const environment = { USE_TEMPORARY_DATABASE_CREDENTIAL: "true", CREDENTIAL_GATE: "enrichment", MIGRATION_ACCESS_TOKEN: "synthetic-token" };
const reviewed = "a".repeat(40);
const gate = { event: "workflow_dispatch", ref: "refs/heads/main", repository: "adrianosortudo-source/caseload-select", operation: "dry-run", reviewedSourceSha: reviewed, configuredReviewedSha: reviewed, checkoutSha: reviewed, githubSha: reviewed, authorizationOnly: true };

test("authorization-only gates retain SHA, receipt, environment and operation checks", () => {
  assert.deepEqual(verifyExecutionGate(gate).connection, { pending: true });
  assert.deepEqual(verifySourceGate(gate).connection, { pending: true });
  const application = { ...gate, reviewedReceiptSha256: "b".repeat(64), configuredReceiptSha256: "b".repeat(64), actualReceiptSha256: "b".repeat(64) };
  assert.deepEqual(verifyApplicationGate(application).connection, { pending: true });
  for (const validate of [verifyExecutionGate, verifySourceGate, verifyApplicationGate]) {
    assert.throws(() => validate({ ...application, checkoutSha: "c".repeat(40) }));
    assert.throws(() => validate({ ...application, environment: { PGPASSWORD: "synthetic" } }));
    assert.throws(() => validate({ ...application, projectEnvFiles: [".env.local"] }));
  }
  assert.throws(() => verifyApplicationGate({ ...application, actualReceiptSha256: "c".repeat(64) }));
  assert.throws(() => verifyApplicationGate({ ...application, operation: "apply" }));
  assert.throws(() => verifySourceGate({ ...gate, operation: "apply" }));
});

test("acquisition authorizes before POST and masks all credentials before persistence", async () => {
  const events = [];
  const proof = await acquireTemporaryCredential({ environment,
    authorize: () => events.push("authorized"),
    fetchImpl: async (endpoint, options) => {
      assert.deepEqual(events, ["authorized"]);
      assert.equal(endpoint, LOGIN_ENDPOINT);
      assert.equal(endpoint, `https://api.supabase.com/v1/projects/${PROJECT_REF}/cli/login-role`);
      assert.equal(options.redirect, "error");
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), { read_only: false });
      assert.equal(options.headers.Authorization, "Bearer synthetic-token");
      events.push("post"); return { status: 201, json: async () => payload };
    },
    mask: value => events.push(value),
    persist: credential => {
      assert.deepEqual(events.slice(2), [payload.password, encodeURIComponent(payload.password), credential.url]);
      events.push("persisted");
    },
  });
  assert.equal(events.at(-1), "persisted");
  assert.doesNotMatch(JSON.stringify(proof), /synthetic|postgresql|password/);
});

test("no acquisition on default mode, invalid gate, or failed source authorization", async () => {
  let called = false;
  for (const change of [{ USE_TEMPORARY_DATABASE_CREDENTIAL: "false" }, { USE_TEMPORARY_DATABASE_CREDENTIAL: undefined }, { CREDENTIAL_GATE: "other" }]) {
    await assert.rejects(acquireTemporaryCredential({ environment: { ...environment, ...change }, authorize: () => {}, fetchImpl: () => { called = true; } }));
  }
  await assert.rejects(acquireTemporaryCredential({ environment, authorize: () => { throw Error("source_rejected"); }, fetchImpl: () => { called = true; } }));
  assert.equal(called, false);
});

test("API errors and malformed responses never expose credential text or persist", async () => {
  for (const [fetchImpl, expectedCode] of [
    [async () => { throw Error("synthetic-secret"); }, "temporary_credential_transport_failed"],
    [async () => { throw Object.assign(Error("synthetic-secret"), { name: "TimeoutError" }); }, "temporary_credential_timeout"],
    [async () => ({ status: 401, json: async () => { throw Error("body_must_not_be_read"); } }), "temporary_credential_http_401"],
    [async () => ({ status: 403, json: async () => { throw Error("body_must_not_be_read"); } }), "temporary_credential_http_403"],
    [async () => ({ status: 429, json: async () => { throw Error("body_must_not_be_read"); } }), "temporary_credential_http_429"],
    [async () => ({ status: 500, json: async () => { throw Error("body_must_not_be_read"); } }), "temporary_credential_http_500"],
    [async () => ({ status: 201, json: async () => { throw Error("synthetic-secret"); } }), "temporary_credential_response_unreadable"],
    [async () => ({ status: 201, json: async () => ({ ...payload, role: "postgres" }) }), "temporary_credential_response_invalid"],
    [async () => ({ status: 201, json: async () => ({ ...payload, password: "synthetic\nsecret" }) }), "temporary_credential_response_invalid"],
  ]) {
    let persisted = false;
    await assert.rejects(acquireTemporaryCredential({ environment, authorize: () => {}, fetchImpl, mask: () => {}, persist: () => { persisted = true; } }), error => {
      assert.equal(redactedFailureCode(error), expectedCode);
      assert.doesNotMatch(redactedFailureCode(error), /synthetic|postgresql|password/); return true;
    });
    assert.equal(persisted, false);
  }
});

test("redacted diagnostics never print untrusted exception text", () => {
  assert.equal(redactedFailureCode(Error("Bearer synthetic-token")), "temporary_credential_unexpected_failure");
  assert.equal(redactedFailureCode(Error("postgresql://synthetic")), "temporary_credential_unexpected_failure");
  assert.equal(redactedFailureCode(Error("temporary_credential_http_200")), "temporary_credential_unexpected_failure");
  assert.equal(redactedFailureCode(Error("temporary_credential_http_403 extra")), "temporary_credential_unexpected_failure");
  assert.equal(redactedFailureCode(Error("migration_access_token_missing_or_invalid")), "migration_access_token_missing_or_invalid");
  assert.equal(redactedFailureCode(Error("temporary_credential_source_authorization_failed")), "temporary_credential_source_authorization_failed");
});

test("role, TTL and TLS validation fails closed", () => {
  const issuedAt = Date.now();
  for (const change of [{ role: "postgres" }, { role: "cli_login_" }, { role: "cli_login_a.other" }, { password: "x\nY" }, { ttl_seconds: 0 }, { ttl_seconds: 59 }, { ttl_seconds: 86401 }, { ttl_seconds: 60.5 }]) {
    assert.throws(() => validateTemporaryCredential({ ...payload, ...change }, issuedAt));
  }
  assert.throws(() => validateTemporaryCredential({ ...payload, ttl_seconds: 60 }, issuedAt, issuedAt + 31000));
  const credential = validateTemporaryCredential(payload, issuedAt);
  const parsedCredentialUrl = new URL(credential.url);
  assert.equal(parsedCredentialUrl.searchParams.get("options"), null);
  assert.equal(parsedCredentialUrl.searchParams.get("sslmode"), "verify-full");
  const env = { ...environment, TEMPORARY_DATABASE_ROLE: credential.role, TEMPORARY_DATABASE_ISSUED_AT: String(issuedAt), TEMPORARY_DATABASE_EXPIRES_AT: String(credential.expiresAt) };
  assert.equal(verifyDirectDatabaseUrl(credential.url, env).credentialMode, "temporary-write-capable");
  assert.equal(verifyDirectDatabaseUrl(credential.url + "&sslrootcert=" + encodeURIComponent(DATABASE_CA_PATH), env).credentialMode, "temporary-write-capable");
  assert.throws(() => verifyDirectDatabaseUrl(credential.url, {}));
  assert.throws(() => verifyDirectDatabaseUrl(credential.url, { ...env, USE_TEMPORARY_DATABASE_CREDENTIAL: "false" }));
  assert.throws(() => verifyDirectDatabaseUrl(credential.url, { ...env, TEMPORARY_DATABASE_ROLE: "cli_login_other" }));
  assert.throws(() => verifyDirectDatabaseUrl(credential.url, { ...env, TEMPORARY_DATABASE_EXPIRES_AT: String(Date.now() + 1000) }));
  assert.throws(() => verifyDirectDatabaseUrl(credential.url.replace("verify-full", "require"), env));
  assert.throws(() => verifyDirectDatabaseUrl(credential.url + "&options=-c%20statement_timeout%3D240s", env));
  assert.equal(new URL(credential.url).hostname, TEMPORARY_DATABASE_HOST);
  assert.equal(new URL(credential.url).username, payload.role + "." + PROJECT_REF);
  assert.throws(() => verifyDirectDatabaseUrl(credential.url.replace(TEMPORARY_DATABASE_HOST, "aws-1-other.pooler.supabase.com"), env));
  assert.throws(() => verifyDirectDatabaseUrl(credential.url.replace(PROJECT_REF, "otherproject"), env));
  assert.throws(() => verifyDirectDatabaseUrl(credential.url.replace(":5432/", ":6543/"), env));
  assert.throws(() => verifyDirectDatabaseUrl(credential.url.replace(TEMPORARY_DATABASE_HOST, `db.${PROJECT_REF}.supabase.co`), env));
});

test("all workflows authorize before optional authentication and retain connection/plan gates", () => {
  for (const name of ["prospect-enrichment-migration-gate", "prospect-candidate-additive-preflight", "prospect-candidate-additive-release"]) {
    const workflow = yaml.load(fs.readFileSync(path.join(root, `.github/workflows/${name}.yml`), "utf8"));
    assert.equal(workflow.on.workflow_dispatch.inputs.use_temporary_database_credential.default, false);
    const job = Object.values(workflow.jobs)[0];
    assert.equal(job.environment.name, "Production prospect migrations");
    const auth = job.steps.findIndex(s => /source-authorization-check/.test(s.run ?? ""));
    const mint = job.steps.findIndex(s => /temporary-credential\.mjs/.test(s.run ?? ""));
    const db = job.steps.findIndex(s => /supabase db (query|push)/.test(s.run ?? "") && !/--help/.test(s.run ?? ""));
    assert.ok(auth >= 0 && mint > auth && db > mint);
    assert.equal(job.steps[mint].if, "inputs.use_temporary_database_credential");
    assert.ok(job.steps[mint].env.MIGRATION_ACCESS_TOKEN);
    for (const [index, step] of job.steps.entries()) {
      if (index !== mint) assert.equal(step.env?.MIGRATION_ACCESS_TOKEN, undefined);
      if (/supabase db (query|push)/.test(step.run ?? "") && !/--help/.test(step.run ?? "")) assert.match(step.run, /gate\.mjs connection/);
      if (step.uses?.startsWith("actions/upload-artifact")) assert.doesNotMatch(step.with.path, /GITHUB_ENV|credential|\.env/);
    }
    assert.doesNotMatch(JSON.stringify(workflow), /supabase link|--linked|--debug/);
  }
  const recovery = fs.readFileSync(path.join(root, "scripts/prospect-enrichment/candidate-recovery-gate.mjs"), "utf8");
  assert.match(recovery, /"preflight", "reconcile", "coverage", "coverage-backfill", "coverage-readback", "profile-link"/);
  const helper = fs.readFileSync(path.join(root, "scripts/prospect-enrichment/temporary-credential.mjs"), "utf8");
  assert.match(helper, /additive-release-gate\.mjs"\), "receipt"/);
  assert.doesNotMatch(helper, /method: "DELETE"|read_only: true|SUPABASE_ACCESS_TOKEN/);
});

test("preflight workflows preserve the selected connection without logging it", () => {
  for (const name of ["prospect-enrichment-migration-gate", "prospect-candidate-additive-preflight"]) {
    const workflow = yaml.load(fs.readFileSync(path.join(root, `.github/workflows/${name}.yml`), "utf8"));
    const steps = Object.values(workflow.jobs)[0].steps;
    const authorization = steps.findIndex(step => /source-authorization-check/.test(step.run ?? ""));
    const staticConnection = steps.findIndex(step => step.name === "Load protected static database connection");
    const temporaryConnection = steps.findIndex(step => /temporary-credential\.mjs/.test(step.run ?? ""));
    assert.ok(authorization >= 0 && staticConnection > authorization && temporaryConnection > staticConnection);
    assert.equal(steps[staticConnection].if, "${{ !inputs.use_temporary_database_credential }}");
    assert.equal(steps[staticConnection].env.STATIC_MIGRATION_DATABASE_URL,
      "${{ secrets.CASELOAD_PRODUCTION_SUPABASE_MIGRATOR_DB_URL }}");
    assert.match(steps[staticConnection].run, /printf 'MIGRATION_DATABASE_URL=%s\\n'.*>> "\$GITHUB_ENV"/);
    assert.doesNotMatch(steps[staticConnection].run, /echo .*STATIC_MIGRATION_DATABASE_URL/);
    for (const step of steps) assert.equal(step.env?.MIGRATION_DATABASE_URL, undefined);
  }
});
