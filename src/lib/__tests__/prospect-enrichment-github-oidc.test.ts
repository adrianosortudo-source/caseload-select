import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PROSPECT_COMPARISON_OIDC_AUDIENCE, PROSPECT_COMPARISON_OIDC_ENVIRONMENT, PROSPECT_COMPARISON_OIDC_WORKFLOW, resetProspectComparisonOidcKeyCacheForTests, verifyProspectComparisonWorkflowToken, diagnoseProspectComparisonWorkflowToken } from "../prospect-enrichment-github-oidc";

const now = 1_797_000_000_000;
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig", alg: "RS256" };
const claims = () => ({
  iss: "https://token.actions.githubusercontent.com", aud: PROSPECT_COMPARISON_OIDC_AUDIENCE,
  sub: `repo:adrianosortudo-source/caseload-select:environment:${PROSPECT_COMPARISON_OIDC_ENVIRONMENT}`,
  repository: "adrianosortudo-source/caseload-select", repository_id: "1206232496", repository_owner: "adrianosortudo-source", repository_owner_id: "274647202",
  ref: "refs/heads/main", ref_type: "branch", sha: "a".repeat(40), workflow: "Read-only Casey and Moss prospect comparison", workflow_ref: PROSPECT_COMPARISON_OIDC_WORKFLOW,
  workflow_sha: "a".repeat(40), environment: PROSPECT_COMPARISON_OIDC_ENVIRONMENT,
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

describe("GitHub Actions prospect comparison OIDC", () => {
  it("accepts only the pinned workflow identity and returns a hashed jti", async () => {
    resetProspectComparisonOidcKeyCacheForTests();
    const identity = await verifyProspectComparisonWorkflowToken(token(), { now, fetcher });
    expect(identity.repository).toBe("adrianosortudo-source/caseload-select");
    expect(identity.workflowRef).toBe(PROSPECT_COMPARISON_OIDC_WORKFLOW);
    expect(identity.jtiSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(identity)).not.toContain("one-use-test-token");
  });

  it.each([
    ["audience", { aud: "other-audience" }],
    ["environment", { environment: "Production prospect migrations" }],
    ["workflow", { workflow_ref: "adrianosortudo-source/caseload-select/.github/workflows/other.yml@refs/heads/main", workflow_sha: "a".repeat(40) }],
    ["workflow SHA", { workflow_sha: "b".repeat(40) }],
    ["reusable workflow", { job_workflow_ref: PROSPECT_COMPARISON_OIDC_WORKFLOW }],
    ["reusable workflow SHA", { job_workflow_sha: "a".repeat(40) }],
    ["issuer", { iss: "https://example.com" }],
    ["subject", { sub: "repo:other/repository:environment:Prospect comparison read" }],
    ["branch", { ref: "refs/heads/other" }],
    ["repository", { repository_id: "0" }],
    ["run", { run_id: "0" }],
    ["attempt", { run_attempt: "0" }],
    ["lifetime", { exp: Math.floor(now / 1000) + 601 }],
    ["issued type", { iat: String(Math.floor(now / 1000) - 30) }],
    ["event", { event_name: "pull_request" }],
    ["expired", { exp: Math.floor(now / 1000) }],
  ])("rejects changed %s claims", async (_label, changed) => {
    resetProspectComparisonOidcKeyCacheForTests();
    await expect(verifyProspectComparisonWorkflowToken(token({ ...claims(), ...changed }), { now, fetcher })).rejects.toThrow();
  });

  it.each(["workflow_ref", "workflow_sha", "repository_id", "environment", "run_id", "exp"])("rejects missing %s without weakening required identity checks", async (key) => {
    resetProspectComparisonOidcKeyCacheForTests();
    const value: Record<string, unknown> = claims();
    delete value[key];
    await expect(verifyProspectComparisonWorkflowToken(token(value), { now, fetcher })).rejects.toThrow();
  });

  it("refreshes the pinned JWKS once when a real signing key rotates", async () => {
    resetProspectComparisonOidcKeyCacheForTests();
    const rotated = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const rotatedJwk = { ...rotated.publicKey.export({ format: "jwk" }), kid: "rotated-key", use: "sig", alg: "RS256" };
    let calls = 0;
    const rotatingFetcher: typeof fetch = async (...args) => keyFetcher(calls++ === 0 ? [jwk] : [rotatedJwk])(...args);
    await verifyProspectComparisonWorkflowToken(token(), { now, fetcher: rotatingFetcher });
    await expect(verifyProspectComparisonWorkflowToken(token(claims(), rotated, "rotated-key"), { now, fetcher: rotatingFetcher })).resolves.toMatchObject({ repositoryId: "1206232496" });
    expect(calls).toBe(2);
  });

  it("fails closed after one bounded refresh for an unknown signing key", async () => {
    resetProspectComparisonOidcKeyCacheForTests();
    let calls = 0;
    const missingFetcher: typeof fetch = async (...args) => { calls++; return fetcher(...args); };
    await expect(verifyProspectComparisonWorkflowToken(token(claims(), keys, "unknown-key"), { now, fetcher: missingFetcher })).rejects.toThrow("github_oidc_signing_key_unknown");
    expect(calls).toBe(2);
  });

  it.each([[null], [[]]])("rejects malformed JWKS key entries", async (value) => {
    resetProspectComparisonOidcKeyCacheForTests();
    await expect(verifyProspectComparisonWorkflowToken(token(), { now, fetcher: keyFetcher([value]) })).rejects.toThrow("github_oidc_keys_invalid");
  });

  it("rejects a forged signature and malformed token without fetching a signing key", async () => {
    resetProspectComparisonOidcKeyCacheForTests();
    const valid = token(), altered = valid.slice(0, -1) + (valid.endsWith("A") ? "B" : "A");
    await expect(verifyProspectComparisonWorkflowToken(altered, { now, fetcher })).rejects.toThrow();
    await expect(verifyProspectComparisonWorkflowToken("Bearer bad", { now, fetcher })).rejects.toThrow();
  });
});


describe("credential-safe workflow diagnostics", () => {
  it("exposes fixed check names and booleans only, without token or claim values", () => {
    const credential = token();
    const result = diagnoseProspectComparisonWorkflowToken(credential, now);
    expect(Object.values(result).every(value => typeof value === "boolean")).toBe(true);
    expect(Object.values(result).every(Boolean)).toBe(true);
    const logged = JSON.stringify(result);
    for (const sensitive of [credential, claims().jti, claims().sub, claims().workflow_ref]) expect(logged).not.toContain(sensitive);
  });
  it("identifies an exact failed identity condition without granting authentication", async () => {
    const credential = token({ ...claims(), repository_owner_id: "other-owner" });
    expect(diagnoseProspectComparisonWorkflowToken(credential, now).repositoryOwnerId).toBe(false);
    await expect(verifyProspectComparisonWorkflowToken(credential, { now, fetcher })).rejects.toThrow();
  });
  it.each(["bad", "", "e30.e30.bad"])("contains malformed input without exposing it", value => {
    expect(diagnoseProspectComparisonWorkflowToken(value, now)).toEqual({ tokenFormat: false });
  });
});
