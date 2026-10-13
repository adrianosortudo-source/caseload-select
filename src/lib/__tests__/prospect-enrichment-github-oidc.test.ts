import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PROSPECT_COMPARISON_OIDC_AUDIENCE, PROSPECT_COMPARISON_OIDC_ENVIRONMENT, PROSPECT_COMPARISON_OIDC_WORKFLOW, resetProspectComparisonOidcKeyCacheForTests, verifyProspectComparisonWorkflowToken } from "../prospect-enrichment-github-oidc";

const now = 1_797_000_000_000;
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig", alg: "RS256" };
const claims = () => ({
  iss: "https://token.actions.githubusercontent.com", aud: PROSPECT_COMPARISON_OIDC_AUDIENCE,
  sub: `repo:adrianosortudo-source/caseload-select:environment:${PROSPECT_COMPARISON_OIDC_ENVIRONMENT}`,
  repository: "adrianosortudo-source/caseload-select", repository_id: "1206232496", repository_owner: "adrianosortudo-source", repository_owner_id: "274647202",
  ref: "refs/heads/main", ref_type: "branch", sha: "a".repeat(40), workflow: "Read-only Casey and Moss prospect comparison", workflow_ref: PROSPECT_COMPARISON_OIDC_WORKFLOW,
  job_workflow_ref: PROSPECT_COMPARISON_OIDC_WORKFLOW, job_workflow_sha: "b".repeat(40), environment: PROSPECT_COMPARISON_OIDC_ENVIRONMENT,
  event_name: "workflow_dispatch", run_id: "123456", run_attempt: "1", run_number: "7", run_started_at: "2026-10-13T12:00:00Z",
  actor: "adriano", actor_id: "274647202", runner_environment: "github-hosted", iat: Math.floor(now / 1000) - 30,
  nbf: Math.floor(now / 1000) - 30, exp: Math.floor(now / 1000) + 240, jti: "one-use-test-token",
});
function token(value = claims()) {
  const enc = (input: unknown) => Buffer.from(JSON.stringify(input)).toString("base64url");
  const signing = `${enc({ alg: "RS256", kid: "test-key", typ: "JWT" })}.${enc(value)}`;
  return `${signing}.${sign("RSA-SHA256", Buffer.from(signing), keys.privateKey).toString("base64url")}`;
}
const fetcher: typeof fetch = async () => {
  const response = new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "content-type": "application/json" } });
  Object.defineProperty(response, "url", { value: "https://token.actions.githubusercontent.com/.well-known/jwks" });
  return response;
};

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
    ["workflow", { workflow_ref: "adrianosortudo-source/caseload-select/.github/workflows/other.yml@refs/heads/main", job_workflow_ref: "adrianosortudo-source/caseload-select/.github/workflows/other.yml@refs/heads/main" }],
    ["repository", { repository_id: "0" }],
    ["event", { event_name: "pull_request" }],
    ["expired", { exp: Math.floor(now / 1000) }],
  ])("rejects changed %s claims", async (_label, changed) => {
    resetProspectComparisonOidcKeyCacheForTests();
    await expect(verifyProspectComparisonWorkflowToken(token({ ...claims(), ...changed }), { now, fetcher })).rejects.toThrow();
  });

  it("rejects a forged signature and malformed token without fetching a signing key", async () => {
    resetProspectComparisonOidcKeyCacheForTests();
    const valid = token(), altered = valid.slice(0, -1) + (valid.endsWith("A") ? "B" : "A");
    await expect(verifyProspectComparisonWorkflowToken(altered, { now, fetcher })).rejects.toThrow();
    await expect(verifyProspectComparisonWorkflowToken("Bearer bad", { now, fetcher })).rejects.toThrow();
  });
});
