import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CRM_CONSOLE_OIDC_AUDIENCE, CRM_CONSOLE_OIDC_ENVIRONMENT, CRM_CONSOLE_OIDC_WORKFLOW, resetCrmConsoleOidcKeyCacheForTests, verifyCrmConsoleWorkflowToken, diagnoseCrmConsoleWorkflowToken } from "../crm-agent-github-oidc";

const now = 1_797_000_000_000;
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig", alg: "RS256" };
const claims = () => ({
  iss: "https://token.actions.githubusercontent.com", aud: CRM_CONSOLE_OIDC_AUDIENCE,
  sub: `repo:adrianosortudo-source/caseload-select:environment:${CRM_CONSOLE_OIDC_ENVIRONMENT}`,
  repository: "adrianosortudo-source/caseload-select", repository_id: "1206232496", repository_owner: "adrianosortudo-source", repository_owner_id: "274647202",
  ref: "refs/heads/main", ref_type: "branch", sha: "a".repeat(40), workflow: "Read-only Casey and Moss CRM console read QA", workflow_ref: CRM_CONSOLE_OIDC_WORKFLOW,
  workflow_sha: "a".repeat(40), environment: CRM_CONSOLE_OIDC_ENVIRONMENT,
  event_name: "workflow_dispatch", run_id: "123456", run_attempt: "1", run_number: "7",
  actor: "adriano", actor_id: "274647202", runner_environment: "github-hosted", iat: Math.floor(now / 1000) - 30,
  nbf: Math.floor(now / 1000) - 30, exp: Math.floor(now / 1000) + 240, jti: "one-use-test-token",
});
function token(value: Record<string, unknown> = claims(), tokenKeys = keys, kid = "test-key") {
  const enc = (input: unknown) => Buffer.from(JSON.stringify(input)).toString("base64url");
  const signing = `${enc({ alg: "RS256", kid, typ: "JWT" })}.${enc(value)}`;
  return `${signing}.${sign("RSA-SHA256", Buffer.from(signing), tokenKeys.privateKey).toString("base64url")}`;
}
function keyFetcher(values: unknown[]): typeof fetch { return async () => {
  const response = new Response(JSON.stringify({ keys: values }), { status: 200, headers: { "content-type": "application/json" } });
  Object.defineProperty(response, "url", { value: "https://token.actions.githubusercontent.com/.well-known/jwks" });
  return response;
}; }
const fetcher = keyFetcher([jwk]);

describe("GitHub Actions CRM console read QA OIDC", () => {
  it("accepts only the pinned workflow identity and returns a hashed jti", async () => {
    resetCrmConsoleOidcKeyCacheForTests();
    const identity = await verifyCrmConsoleWorkflowToken(token(), { now, fetcher });
    expect(identity.repository).toBe("adrianosortudo-source/caseload-select");
    expect(identity.workflowRef).toBe(CRM_CONSOLE_OIDC_WORKFLOW);
    expect(identity.jtiSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(identity)).not.toContain("one-use-test-token");
  });

  it("accepts paired job metadata only for the same pinned workflow and commit", async () => {
    resetCrmConsoleOidcKeyCacheForTests();
    const value = { ...claims(), job_workflow_ref: CRM_CONSOLE_OIDC_WORKFLOW, job_workflow_sha: claims().sha };
    await expect(verifyCrmConsoleWorkflowToken(token(value), { now, fetcher })).resolves.toMatchObject({
      workflowRef: CRM_CONSOLE_OIDC_WORKFLOW, sha: value.sha,
    });
    expect(diagnoseCrmConsoleWorkflowToken(token(value), now)).toMatchObject({
      directWorkflow: true, jobWorkflowRefPresent: true, jobWorkflowShaPresent: true,
      jobWorkflowRefMatches: true, jobWorkflowShaMatches: true,
    });
  });

  it.each([
    { job_workflow_ref: "other/repo/.github/workflows/read.yml@refs/heads/main", job_workflow_sha: claims().sha },
    { job_workflow_ref: CRM_CONSOLE_OIDC_WORKFLOW, job_workflow_sha: "b".repeat(40) },
    { job_workflow_ref: null, job_workflow_sha: claims().sha },
    { job_workflow_ref: CRM_CONSOLE_OIDC_WORKFLOW, job_workflow_sha: null },
    { job_workflow_ref: [], job_workflow_sha: claims().sha },
    { job_workflow_ref: CRM_CONSOLE_OIDC_WORKFLOW, job_workflow_sha: 1 },
  ])("rejects mismatched or malformed paired job metadata %j", async (changed) => {
    resetCrmConsoleOidcKeyCacheForTests();
    const credential = token({ ...claims(), ...changed });
    expect(diagnoseCrmConsoleWorkflowToken(credential, now).directWorkflow).toBe(false);
    await expect(verifyCrmConsoleWorkflowToken(credential, { now, fetcher })).rejects.toThrow("github_oidc_claims_rejected");
  });

  it.each(["workflow_ref", "workflow_sha"])("paired job metadata never replaces mandatory %s", async (key) => {
    const value: Record<string, unknown> = { ...claims(), job_workflow_ref: CRM_CONSOLE_OIDC_WORKFLOW, job_workflow_sha: claims().sha };
    delete value[key];
    await expect(verifyCrmConsoleWorkflowToken(token(value), { now, fetcher })).rejects.toThrow("github_oidc_claims_invalid");
  });

  it("requires a valid signature even when all paired metadata checks match", async () => {
    resetCrmConsoleOidcKeyCacheForTests();
    const untrusted = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const credential = token({ ...claims(), job_workflow_ref: CRM_CONSOLE_OIDC_WORKFLOW, job_workflow_sha: claims().sha }, untrusted);
    expect(diagnoseCrmConsoleWorkflowToken(credential, now).directWorkflow).toBe(true);
    await expect(verifyCrmConsoleWorkflowToken(credential, { now, fetcher })).rejects.toThrow("github_oidc_signature_invalid");
  });

  it.each([
    ["prospect comparison audience", { aud: "caseload-prospect-comparison-read/v1" }],
    ["runner", { runner_environment: "self-hosted" }],
    ["owner", { repository_owner_id: "0" }],
    ["audience", { aud: "other-audience" }],
    ["environment", { environment: "Production prospect migrations" }],
    ["workflow", { workflow_ref: "adrianosortudo-source/caseload-select/.github/workflows/other.yml@refs/heads/main", workflow_sha: "a".repeat(40) }],
    ["workflow SHA", { workflow_sha: "b".repeat(40) }],
    ["reusable workflow", { job_workflow_ref: CRM_CONSOLE_OIDC_WORKFLOW }],
    ["reusable workflow SHA", { job_workflow_sha: "a".repeat(40) }],
    ["issuer", { iss: "https://example.com" }],
    ["subject", { sub: "repo:other/repository:environment:CRM console read QA" }],
    ["branch", { ref: "refs/heads/other" }],
    ["repository", { repository_id: "0" }],
    ["run", { run_id: "0" }],
    ["attempt", { run_attempt: "0" }],
    ["lifetime", { exp: Math.floor(now / 1000) + 601 }],
    ["issued type", { iat: String(Math.floor(now / 1000) - 30) }],
    ["event", { event_name: "pull_request" }],
    ["expired", { exp: Math.floor(now / 1000) }],
  ])("rejects changed %s claims", async (_label, changed) => {
    resetCrmConsoleOidcKeyCacheForTests();
    await expect(verifyCrmConsoleWorkflowToken(token({ ...claims(), ...changed }), { now, fetcher })).rejects.toThrow();
  });

  it.each(["workflow_ref", "workflow_sha", "repository_id", "environment", "run_id", "exp"])("rejects missing %s without weakening required identity checks", async (key) => {
    resetCrmConsoleOidcKeyCacheForTests();
    const value: Record<string, unknown> = claims();
    delete value[key];
    await expect(verifyCrmConsoleWorkflowToken(token(value), { now, fetcher })).rejects.toThrow();
  });

  it("refreshes the pinned JWKS once when a real signing key rotates", async () => {
    resetCrmConsoleOidcKeyCacheForTests();
    const rotated = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const rotatedJwk = { ...rotated.publicKey.export({ format: "jwk" }), kid: "rotated-key", use: "sig", alg: "RS256" };
    let calls = 0;
    const rotatingFetcher: typeof fetch = async (...args) => keyFetcher(calls++ === 0 ? [jwk] : [rotatedJwk])(...args);
    await verifyCrmConsoleWorkflowToken(token(), { now, fetcher: rotatingFetcher });
    await expect(verifyCrmConsoleWorkflowToken(token(claims(), rotated, "rotated-key"), { now, fetcher: rotatingFetcher })).resolves.toMatchObject({ repositoryId: "1206232496" });
    expect(calls).toBe(2);
  });

  it("fails closed after one bounded refresh for an unknown signing key", async () => {
    resetCrmConsoleOidcKeyCacheForTests();
    let calls = 0;
    const missingFetcher: typeof fetch = async (...args) => { calls++; return fetcher(...args); };
    await expect(verifyCrmConsoleWorkflowToken(token(claims(), keys, "unknown-key"), { now, fetcher: missingFetcher })).rejects.toThrow("github_oidc_signing_key_unknown");
    expect(calls).toBe(2);
  });

  it.each([[null], [[]]])("rejects malformed JWKS key entries", async (value) => {
    resetCrmConsoleOidcKeyCacheForTests();
    await expect(verifyCrmConsoleWorkflowToken(token(), { now, fetcher: keyFetcher([value]) })).rejects.toThrow("github_oidc_keys_invalid");
  });

  it("rejects a forged signature and malformed token without fetching a signing key", async () => {
    resetCrmConsoleOidcKeyCacheForTests();
    const valid = token(), altered = valid.slice(0, -1) + (valid.endsWith("A") ? "B" : "A");
    await expect(verifyCrmConsoleWorkflowToken(altered, { now, fetcher })).rejects.toThrow();
    await expect(verifyCrmConsoleWorkflowToken("Bearer bad", { now, fetcher })).rejects.toThrow();
  });
});


describe("credential-safe workflow diagnostics", () => {
  it("exposes fixed check names and booleans only, without token or claim values", () => {
    const credential = token();
    const result = diagnoseCrmConsoleWorkflowToken(credential, now);
    expect(Object.values(result).every(value => typeof value === "boolean")).toBe(true);
    expect(Object.entries(result).filter(([key]) => !key.startsWith("jobWorkflow")).every(([, value]) => value)).toBe(true);
    expect(result).toMatchObject({ directWorkflow: true, jobWorkflowRefPresent: false, jobWorkflowShaPresent: false,
      jobWorkflowRefMatches: false, jobWorkflowShaMatches: false });
    const logged = JSON.stringify(result);
    for (const sensitive of [credential, claims().jti, claims().sub, claims().workflow_ref]) expect(logged).not.toContain(sensitive);
  });
  it("identifies an exact failed identity condition without granting authentication", async () => {
    const credential = token({ ...claims(), repository_owner_id: "other-owner" });
    expect(diagnoseCrmConsoleWorkflowToken(credential, now).repositoryOwnerId).toBe(false);
    await expect(verifyCrmConsoleWorkflowToken(credential, { now, fetcher })).rejects.toThrow();
  });
  it.each(["bad", "", "e30.e30.bad"])("contains malformed input without exposing it", value => {
    expect(diagnoseCrmConsoleWorkflowToken(value, now)).toEqual({ tokenFormat: false });
  });
});
