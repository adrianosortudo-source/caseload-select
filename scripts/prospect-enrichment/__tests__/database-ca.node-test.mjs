import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { DATABASE_CA_PATH, DATABASE_CA_SHA256, verifyDatabaseCa, verifyDatabaseCaFile } from "../database-ca.mjs";
import { configureMigrationTls } from "../configure-migration-tls.mjs";
import { PROJECT_REF, verifyDirectDatabaseUrl } from "../migration-gate.mjs";
import { validateTemporaryCredential } from "../temporary-credential.mjs";
const yaml = createRequire(import.meta.url)("js-yaml");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const staticUrl = `postgresql://postgres:synthetic-password@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=verify-full`;

test("only the exact downloaded, currently valid Supabase root is accepted", () => {
  assert.equal(verifyDatabaseCaFile().certificateSha256, DATABASE_CA_SHA256);
  const bytes = fs.readFileSync(DATABASE_CA_PATH);
  assert.throws(() => verifyDatabaseCa(Buffer.concat([bytes, Buffer.from("\n")])) , /database_ca_hash_mismatch/);
  assert.throws(() => verifyDatabaseCa(bytes, Date.parse("2020-01-01")), /database_ca_invalid_or_expired/);
  assert.throws(() => verifyDatabaseCa(bytes, Date.parse("2031-04-26T10:56:53Z")), /database_ca_invalid_or_expired/);
});

test("static and temporary credentials keep target, password and verify-full with pinned absolute CA", () => {
  const issuedAt = Date.now();
  const credential = validateTemporaryCredential({ role: "cli_login_postgres", password: "synthetic:/?@%secret", ttl_seconds: 3600 }, issuedAt);
  const cases = [
    { MIGRATION_DATABASE_URL: staticUrl },
    { MIGRATION_DATABASE_URL: credential.url, USE_TEMPORARY_DATABASE_CREDENTIAL: "true", TEMPORARY_DATABASE_ROLE: credential.role,
      TEMPORARY_DATABASE_ISSUED_AT: String(issuedAt), TEMPORARY_DATABASE_EXPIRES_AT: String(credential.expiresAt) },
  ];
  for (const environment of cases) {
    const events = [];
    const proof = configureMigrationTls({ environment, mask: value => events.push(["masked", value]), persist: value => events.push(["persisted", value]) });
    assert.equal(events.length, 2);
    assert.deepEqual(events[0], ["masked", events[1][1]]);
    assert.equal(events[1][0], "persisted");
    const before = new URL(environment.MIGRATION_DATABASE_URL), after = new URL(events[1][1]);
    for (const key of ["protocol", "username", "password", "hostname", "port", "pathname"]) assert.equal(after[key], before[key]);
    assert.equal(after.searchParams.get("sslmode"), "verify-full");
    assert.equal(after.searchParams.get("sslrootcert"), DATABASE_CA_PATH);
    assert.ok(path.isAbsolute(after.searchParams.get("sslrootcert")));
    assert.equal(proof.certificateTrust, "pinned-supabase-root-2021");
    assert.equal(proof.certificateSha256, DATABASE_CA_SHA256);
    assert.doesNotMatch(JSON.stringify(proof), /synthetic|postgresql|password|sslrootcert/);
    verifyDirectDatabaseUrl(after.href, environment);
  }
});

test("unreviewed CA paths, duplicates, TLS downgrade and ambient trust overrides fail before persistence", () => {
  for (const suffix of ["&sslrootcert=/tmp/attacker.pem", "&sslrootcert=system", "&sslrootcert=", "&sslmode=require", "&sslcert=/tmp/client.pem"]) {
    let written = false;
    assert.throws(() => configureMigrationTls({ environment: { MIGRATION_DATABASE_URL: staticUrl + suffix }, mask: () => {}, persist: () => { written = true; } }));
    assert.equal(written, false);
  }
  for (const key of ["PGSSLROOTCERT", "PGSSLCERT", "PGSSLKEY", "NODE_EXTRA_CA_CERTS", "NODE_OPTIONS", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_TLS_REJECT_UNAUTHORIZED"]) {
    assert.throws(() => configureMigrationTls({ environment: { MIGRATION_DATABASE_URL: staticUrl, [key]: "synthetic" }, mask: () => {}, persist: () => assert.fail("must not persist") }), /ambient_database_configuration_prohibited/);
  }
  const duplicate = new URL(staticUrl);
  duplicate.searchParams.append("sslrootcert", DATABASE_CA_PATH);
  duplicate.searchParams.append("sslrootcert", DATABASE_CA_PATH);
  assert.throws(() => verifyDirectDatabaseUrl(duplicate.href), /database_url_target_or_options_prohibited/);
});

test("all protected database workflows configure pinned TLS after either credential source and before queries", () => {
  for (const name of ["prospect-enrichment-migration-gate", "prospect-candidate-additive-preflight", "prospect-candidate-additive-release"]) {
    const workflow = yaml.load(fs.readFileSync(path.join(root, `.github/workflows/${name}.yml`), "utf8"));
    const steps = Object.values(workflow.jobs)[0].steps;
    const staticIndex = steps.findIndex(step => step.name === "Load protected static database connection");
    const temporaryIndex = steps.findIndex(step => /temporary-credential\.mjs/.test(step.run ?? ""));
    const tlsIndex = steps.findIndex(step => /configure-migration-tls\.mjs/.test(step.run ?? ""));
    const validateIndex = steps.findIndex(step => step.name === "Validate authorized database connection before database operations");
    assert.ok(staticIndex >= 0 && temporaryIndex > staticIndex && tlsIndex > temporaryIndex && validateIndex > tlsIndex);
    assert.equal(steps[tlsIndex].if, undefined);
    for (const [index, step] of steps.entries()) {
      if (/supabase (?:db (?:query|push)|migration repair)/.test(step.run ?? "") && !/--help/.test(step.run ?? "")) assert.ok(index > tlsIndex);
      if (index > tlsIndex) assert.equal(step.env?.MIGRATION_DATABASE_URL, undefined);
    }
    const artifacts = steps.filter(step => step.uses?.startsWith("actions/upload-artifact")).map(step => step.with.path).join("\n");
    assert.match(artifacts, /database-tls-check\.json/);
    assert.doesNotMatch(artifacts, /GITHUB_ENV|\.env/);
  }
});
