import { createPublicKey, createHash, verify as verifySignature, type JsonWebKey } from "node:crypto";

export const PROSPECT_COMPARISON_OIDC_AUDIENCE = "caseload-prospect-comparison-read/v1";
export const PROSPECT_COMPARISON_OIDC_ENVIRONMENT = "Prospect comparison read";
export const PROSPECT_COMPARISON_OIDC_WORKFLOW = "adrianosortudo-source/caseload-select/.github/workflows/prospect-enrichment-comparison-read.yml@refs/heads/main";
const issuer = "https://token.actions.githubusercontent.com";
const repository = "adrianosortudo-source/caseload-select";
const repositoryId = "1206232496";
const maxTokenBytes = 16_384;
const maxLifetimeSeconds = 600;
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const hasKeys = (value: unknown, keys: readonly string[]) => value !== null && typeof value === "object" && !Array.isArray(value) && keys.every((key) => Object.hasOwn(value, key));

export type ProspectComparisonWorkflowIdentity = {
  repository: typeof repository;
  repositoryId: typeof repositoryId;
  ref: "refs/heads/main";
  sha: string;
  workflowRef: typeof PROSPECT_COMPARISON_OIDC_WORKFLOW;
  environment: typeof PROSPECT_COMPARISON_OIDC_ENVIRONMENT;
  eventName: "workflow_dispatch";
  runId: string;
  runAttempt: string;
  jtiSha256: string;
};

let cachedJwks: { expiresAt: number; keys: Record<string, unknown>[] } | null = null;
async function signingKeys(fetcher: typeof fetch, now: number, refresh = false): Promise<Record<string, unknown>[]> {
  if (!refresh && cachedJwks && cachedJwks.expiresAt > now) return cachedJwks.keys;
  const response = await fetcher(`${issuer}/.well-known/jwks`, { signal: AbortSignal.timeout(3000), headers: { accept: "application/json" } });
  if (!response.ok || new URL(response.url).origin !== issuer || Number(response.headers.get("content-length") ?? 0) > 65_536) throw Error("github_oidc_keys_unavailable");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 65_536) throw Error("github_oidc_keys_invalid");
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw Error("github_oidc_keys_invalid"); }
  const keys = value && typeof value === "object" ? (value as Record<string, unknown>).keys : null;
  if (!Array.isArray(keys) || keys.length > 20 || keys.some((key) => !key || typeof key !== "object" || Array.isArray(key))) throw Error("github_oidc_keys_invalid");
  cachedJwks = { expiresAt: now + 5 * 60_000, keys: keys as Record<string, unknown>[] };
  return cachedJwks.keys;
}

/** Only fixed check names and booleans are emitted. Decoded claims are untrusted until signature verification. */
export function prospectComparisonWorkflowClaimChecks(claims: Record<string, unknown>, now = Date.now()): Record<string, boolean> {
  const seconds = Math.floor(now / 1000), issued = Number(claims.iat), notBefore = Number(claims.nbf), expires = Number(claims.exp);
  return {
    issuer: claims.iss === issuer,
    audience: claims.aud === PROSPECT_COMPARISON_OIDC_AUDIENCE,
    subject: claims.sub === `repo:${repository}:environment:${PROSPECT_COMPARISON_OIDC_ENVIRONMENT}`,
    repository: claims.repository === repository,
    repositoryId: claims.repository_id === repositoryId,
    repositoryOwner: claims.repository_owner === "adrianosortudo-source",
    repositoryOwnerId: claims.repository_owner_id === "274647202",
    ref: claims.ref === "refs/heads/main",
    refType: claims.ref_type === "branch",
    workflowRef: claims.workflow_ref === PROSPECT_COMPARISON_OIDC_WORKFLOW,
    workflowSha: claims.workflow_sha === claims.sha && sha(claims.sha),
    // GitHub can emit job metadata for this direct workflow. It must bind the same approved code.
    directWorkflow: (!Object.hasOwn(claims, "job_workflow_ref") && !Object.hasOwn(claims, "job_workflow_sha")) ||
      (Object.hasOwn(claims, "job_workflow_ref") && Object.hasOwn(claims, "job_workflow_sha") &&
        claims.job_workflow_ref === PROSPECT_COMPARISON_OIDC_WORKFLOW && claims.job_workflow_sha === claims.sha),
    environment: claims.environment === PROSPECT_COMPARISON_OIDC_ENVIRONMENT,
    event: claims.event_name === "workflow_dispatch",
    runId: typeof claims.run_id === "string" && /^[1-9][0-9]{0,19}$/.test(claims.run_id),
    runAttempt: typeof claims.run_attempt === "string" && /^[1-9][0-9]{0,5}$/.test(claims.run_attempt),
    timeTypes: typeof claims.iat === "number" && typeof claims.nbf === "number" && typeof claims.exp === "number" && Number.isSafeInteger(issued) && Number.isSafeInteger(notBefore) && Number.isSafeInteger(expires),
    issued: issued <= seconds + 30,
    notBefore: notBefore <= seconds + 30 && notBefore <= issued,
    expiry: expires > seconds && expires >= issued,
    lifetime: expires - issued <= maxLifetimeSeconds,
    tokenId: typeof claims.jti === "string" && /^[A-Za-z0-9._-]{1,256}$/.test(claims.jti),
  };
}

/** Diagnostic only: never grants access, returns claim values, or retains a credential. */
export function diagnoseProspectComparisonWorkflowToken(token: string, now = Date.now()): Record<string, boolean> {
  try {
    if (typeof token !== "string" || Buffer.byteLength(token) > maxTokenBytes) return { tokenFormat: false };
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part) || Buffer.from(part, "base64url").toString("base64url") !== part)) return { tokenFormat: false };
    const header: unknown = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const claims: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!hasKeys(header, ["alg", "kid", "typ"]) || !hasKeys(claims, ["iss", "aud", "sub"])) return { tokenFormat: false };
    const h = header as Record<string, unknown>;
    const c = claims as Record<string, unknown>;
    return { tokenFormat: true, header: h.alg === "RS256" && typeof h.kid === "string" && h.typ === "JWT",
      ...prospectComparisonWorkflowClaimChecks(c, now),
      // Observations only: absence is supported and must never enter the all-true acceptance map.
      jobWorkflowRefPresent: Object.hasOwn(c, "job_workflow_ref"),
      jobWorkflowShaPresent: Object.hasOwn(c, "job_workflow_sha"),
      jobWorkflowRefMatches: c.job_workflow_ref === PROSPECT_COMPARISON_OIDC_WORKFLOW,
      jobWorkflowShaMatches: sha(c.sha) && c.job_workflow_sha === c.sha,
    };
  } catch { return { tokenFormat: false }; }
}

/** Verifies the single approved GitHub Actions workflow identity. Never returns the bearer token. */
export async function verifyProspectComparisonWorkflowToken(token: string, options: { now?: number; fetcher?: typeof fetch } = {}): Promise<ProspectComparisonWorkflowIdentity> {
  const now = options.now ?? Date.now(), fetcher = options.fetcher ?? fetch;
  if (typeof token !== "string" || Buffer.byteLength(token) > maxTokenBytes) throw Error("github_oidc_token_invalid");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part) || Buffer.from(part, "base64url").toString("base64url") !== part)) throw Error("github_oidc_token_invalid");
  let header: Record<string, unknown>, claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch { throw Error("github_oidc_token_invalid"); }
  if (!hasKeys(header, ["alg", "kid", "typ"]) || header.alg !== "RS256" || typeof header.kid !== "string" || header.typ !== "JWT" ||
      !hasKeys(claims, ["iss", "aud", "sub", "repository", "repository_id", "repository_owner", "repository_owner_id", "ref", "ref_type", "sha", "workflow_ref", "workflow_sha", "environment", "event_name", "run_id", "run_attempt", "iat", "nbf", "exp", "jti"])) throw Error("github_oidc_claims_invalid");
  if (Object.values(prospectComparisonWorkflowClaimChecks(claims, now)).some(value => !value)) throw Error("github_oidc_claims_rejected");
  const matchesKey = (candidate: Record<string, unknown>) => candidate.kid === header.kid && candidate.kty === "RSA" && candidate.use === "sig" && candidate.alg === "RS256";
  let key = (await signingKeys(fetcher, now)).find(matchesKey);
  if (!key) key = (await signingKeys(fetcher, now, true)).find(matchesKey);
  if (!key) throw Error("github_oidc_signing_key_unknown");
  let signature: Buffer;
  try {
    const publicKey = createPublicKey({ key: key as JsonWebKey, format: "jwk" });
    signature = Buffer.from(parts[2], "base64url");
    if (signature.length < 256 || signature.length > 1024 || !verifySignature("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, signature)) throw Error();
  } catch { throw Error("github_oidc_signature_invalid"); }
  return { repository, repositoryId, ref: "refs/heads/main", sha: String(claims.sha), workflowRef: PROSPECT_COMPARISON_OIDC_WORKFLOW,
    environment: PROSPECT_COMPARISON_OIDC_ENVIRONMENT, eventName: "workflow_dispatch", runId: String(claims.run_id), runAttempt: String(claims.run_attempt),
    jtiSha256: createHash("sha256").update(String(claims.jti)).digest("hex") };
}

export function resetProspectComparisonOidcKeyCacheForTests() { cachedJwks = null; }
