// Opt-in authentication preparation; production execution requires protected approval.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PROJECT_REF, TEMPORARY_DATABASE_HOST, verifyDirectDatabaseUrl } from "./migration-gate.mjs";

export const LOGIN_ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/cli/login-role`;
const fail = (code) => { throw new Error(code); };
const safeFailureCodes = new Set([
  "temporary_credential_opt_in_required",
  "temporary_credential_gate_invalid",
  "temporary_credential_source_authorization_failed",
  "migration_access_token_missing_or_invalid",
  "temporary_credential_transport_failed",
  "temporary_credential_timeout",
  "temporary_credential_http_unexpected",
  "temporary_credential_response_unreadable",
  "temporary_credential_response_invalid",
  "temporary_credential_expired_or_too_short",
  "temporary_credential_connection_rejected",
]);
export function redactedFailureCode(error) {
  const code = error instanceof Error ? error.message : "";
  if (safeFailureCodes.has(code) || /^temporary_credential_http_(?:4\d\d|5\d\d)$/.test(code)) return code;
  return "temporary_credential_unexpected_failure";
}
const GATES = Object.freeze({
  "complete-release": ["complete-release-gate.mjs", "credential-authorization"],
  "candidate-recovery": ["candidate-recovery-gate.mjs", "credential-authorization"],
  enrichment: ["migration-gate.mjs", "source-authorization"],
  "candidate-preflight": ["additive-release-gate.mjs", "source-authorization"],
  "candidate-release": ["additive-release-gate.mjs", "application-source-authorization"],
});

export function validateTemporaryCredential(payload, issuedAt, now = Date.now()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      typeof payload.role !== "string" || !/^cli_login_[a-z0-9_]{1,53}$/.test(payload.role) ||
      typeof payload.password !== "string" || !payload.password || payload.password.length > 4096 ||
      /[\x00-\x20\x7f]/.test(payload.password) ||
      !Number.isSafeInteger(payload.ttl_seconds) || payload.ttl_seconds < 60 || payload.ttl_seconds > 86400 ||
      !Number.isSafeInteger(issuedAt) || issuedAt > now) fail("temporary_credential_response_invalid");
  const expiresAt = issuedAt + payload.ttl_seconds * 1000;
  if (expiresAt - now < 30000) fail("temporary_credential_expired_or_too_short");
  const url = `postgresql://${payload.role}.${PROJECT_REF}:${encodeURIComponent(payload.password)}@${TEMPORARY_DATABASE_HOST}:5432/postgres?sslmode=verify-full`;
  return { url, role: payload.role, expiresAt, issuedAt };
}

export async function acquireTemporaryCredential({ environment, authorize, fetchImpl = fetch, now = Date.now, mask, persist }) {
  if (environment.USE_TEMPORARY_DATABASE_CREDENTIAL !== "true") fail("temporary_credential_opt_in_required");
  if (!GATES[environment.CREDENTIAL_GATE]) fail("temporary_credential_gate_invalid");
  try { await authorize(); }
  catch { fail("temporary_credential_source_authorization_failed"); }
  const token = environment.MIGRATION_ACCESS_TOKEN;
  if (typeof token !== "string" || !token || /[\x00-\x20\x7f]/.test(token)) fail("migration_access_token_missing_or_invalid");
  const issuedAt = now();
  let response;
  try {
    response = await fetchImpl(LOGIN_ENDPOINT, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ read_only: false }),
    });
  } catch (error) {
    fail(error instanceof Error && error.name === "TimeoutError" ? "temporary_credential_timeout" : "temporary_credential_transport_failed");
  }
  if (response.status !== 201) {
    fail(Number.isInteger(response.status) && response.status >= 400 && response.status <= 599
      ? `temporary_credential_http_${response.status}` : "temporary_credential_http_unexpected");
  }
  let payload;
  try { payload = await response.json(); }
  catch { fail("temporary_credential_response_unreadable"); }
  const credential = validateTemporaryCredential(payload, issuedAt, now());
  for (const value of [payload.password, encodeURIComponent(payload.password), credential.url]) mask(value);
  try {
    verifyDirectDatabaseUrl(credential.url, {
      ...environment, TEMPORARY_DATABASE_ROLE: credential.role,
      TEMPORARY_DATABASE_ISSUED_AT: String(issuedAt), TEMPORARY_DATABASE_EXPIRES_AT: String(credential.expiresAt),
    }, []);
  } catch { fail("temporary_credential_connection_rejected"); }
  persist(credential);
  return { projectRef: PROJECT_REF, credentialMode: "temporary-write-capable", issuedAt, expiresAt: credential.expiresAt };
}

async function main() {
  if (process.argv.length !== 2) fail("temporary_credential_arguments_prohibited");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const environment = process.env;
  const authorize = () => {
    const gate = GATES[environment.CREDENTIAL_GATE];
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    execFileSync("git", ["fetch", "--no-tags", "origin", "main"], { cwd: root, stdio: "pipe" });
    const mainSha = execFileSync("git", ["rev-parse", "origin/main"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (sha !== mainSha) fail("reviewed_source_sha_changed");
    execFileSync(process.execPath, [path.join(root, "scripts/prospect-enrichment", gate[0]), gate[1]], {
      cwd: root, env: { ...environment, CHECKOUT_SHA: sha }, stdio: "pipe",
    });
    // Enrichment's own manifest covers six files. Validate the complete additive
    // receipt and committed sources too, before creating any authentication.
    execFileSync(process.execPath, [path.join(root, "scripts/prospect-enrichment/additive-release-gate.mjs"), "receipt"], {
      cwd: root, env: environment, stdio: "pipe",
    });
    if (!environment.GITHUB_ENV || !environment.RUNNER_TEMP ||
        !path.resolve(environment.GITHUB_ENV).startsWith(path.resolve(environment.RUNNER_TEMP) + path.sep)) fail("runner_environment_file_required");
  };
  const proof = await acquireTemporaryCredential({ environment, authorize,
    mask: (value) => process.stdout.write(`::add-mask::${value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}\n`),
    persist: ({ url, role, issuedAt, expiresAt }) => fs.appendFileSync(environment.GITHUB_ENV,
      `MIGRATION_DATABASE_URL=${url}\nTEMPORARY_DATABASE_ROLE=${role}\nTEMPORARY_DATABASE_ISSUED_AT=${issuedAt}\nTEMPORARY_DATABASE_EXPIRES_AT=${expiresAt}\n`),
  });
  process.stdout.write(JSON.stringify(proof) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) { process.stderr.write(`${redactedFailureCode(error)}\n`); process.exitCode = 1; }
}
