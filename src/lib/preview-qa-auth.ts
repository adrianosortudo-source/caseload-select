/**
 * Preview-only, read-only QA principal.
 *
 * This is intentionally separate from portal-auth: it uses a dedicated cookie,
 * dedicated signing key, strict deployment audience, a short expiry, and a
 * route allowlist. Production and local development fail closed. The principal
 * is never accepted as a lawyer or operator session.
 */

import "server-only";

import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import { cookies, headers } from "next/headers";
import { constantTimeEquals } from "./cron-auth";
import { PREVIEW_QA_COOKIE_NAME, isPreviewQaReadRequest } from "./preview-qa-policy";

const PREVIEW_QA_TTL_SECONDS = 15 * 60;
const MINIMUM_SECRET_BYTES = 32;
const PRODUCTION_SUPABASE_PROJECT_REF = "ssxryjxifwiivghglqer";
const PURPOSE = "preview_qa_read" as const;

export interface PreviewQaSession {
  purpose: typeof PURPOSE;
  audience: string;
  session_id: string;
  capability: "read";
  version: string;
  commit_sha: string;
  exp: number;
}

function normalizedHost(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "").split(":", 1)[0] ?? "";
}

function configuredPreviewHost(): string | null {
  if (process.env.VERCEL_ENV !== "preview" || process.env.PREVIEW_QA_ENABLED !== "true") return null;
  const host = normalizedHost(process.env.VERCEL_URL ?? "");
  return host.endsWith(".vercel.app") ? host : null;
}

function hasIsolatedPreviewData(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const allowedProjectRef = process.env.PREVIEW_QA_ALLOWED_SUPABASE_PROJECT_REF?.trim().toLowerCase() ?? "";
  if (!url || !allowedProjectRef || allowedProjectRef === PRODUCTION_SUPABASE_PROJECT_REF) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === `${allowedProjectRef}.supabase.co`;
  } catch {
    return false;
  }
}

function tokenVersion(): string | null {
  const version = process.env.PREVIEW_QA_TOKEN_VERSION?.trim();
  return version && version.length >= 16 ? version : null;
}

function configuredCommitSha(): string | null {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{7,64}$/.test(sha) ? sha : null;
}

function bootstrapGrantId(): string | null {
  const id = process.env.PREVIEW_QA_BOOTSTRAP_GRANT_ID?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id) ? id : null;
}

function signingKey(): string | null {
  const key = process.env.PREVIEW_QA_SIGNING_SECRET;
  return hasMinimumSecretStrength(key) ? key : null;
}

/**
 * Configuration can establish a cryptographic secret's entropy, while a
 * caller can only present it. Reject under-sized configured values before
 * they can enable preview bootstrap.
 */
function hasMinimumSecretStrength(value: unknown): value is string {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") >= MINIMUM_SECRET_BYTES;
}

function bootstrapAccessSecret(): string | null {
  const secret = process.env.PREVIEW_QA_ACCESS_SECRET;
  return hasMinimumSecretStrength(secret) ? secret : null;
}

function bootstrapNonce(): string | null {
  const nonce = process.env.PREVIEW_QA_BOOTSTRAP_NONCE;
  return hasMinimumSecretStrength(nonce) ? nonce : null;
}

function encode(data: object): string {
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

function decode<T>(encoded: string): T {
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sameSecret(candidate: string, expected: string): boolean {
  return constantTimeEquals(candidate, expected);
}

function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const candidate of cookieHeader.split(";")) {
    const separator = candidate.indexOf("=");
    if (separator === -1) continue;
    if (candidate.slice(0, separator).trim() === name) {
      return candidate.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

/** True only for the exact configured Vercel preview backed by nonproduction data. */
export function isPreviewQaEnvironment(hostname: string): boolean {
  const audience = configuredPreviewHost();
  return Boolean(
    audience
    && normalizedHost(hostname) === audience
    && hasIsolatedPreviewData()
    && signingKey()
    && bootstrapAccessSecret()
    && bootstrapNonce()
    && tokenVersion()
    && configuredCommitSha()
    && bootstrapGrantId(),
  );
}

export function isPreviewQaBootstrapAuthorized(hostname: string, candidateSecret: string, candidateNonce: string): boolean {
  const expected = bootstrapAccessSecret();
  const expectedNonce = bootstrapNonce();
  return Boolean(
    expected
    && expectedNonce
    && isPreviewQaEnvironment(hostname)
    && sameSecret(candidateSecret, expected)
    && sameSecret(candidateNonce, expectedNonce),
  );
}

function readSignedPreviewQaSession(token: string, hostname: string): PreviewQaSession | null {
  if (!isPreviewQaEnvironment(hostname)) return null;
  const key = signingKey();
  const audience = configuredPreviewHost();
  const version = tokenVersion();
  const commitSha = configuredCommitSha();
  if (!key || !audience || !version || !commitSha) return null;

  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(payload, key);
  if (expected.length !== signature.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  } catch {
    return null;
  }

  let data: Partial<PreviewQaSession>;
  try {
    data = decode<Partial<PreviewQaSession>>(payload);
  } catch {
    return null;
  }
  if (
    data.purpose !== PURPOSE
    || data.audience !== audience
    || data.capability !== "read"
    || data.version !== version
    || data.commit_sha !== commitSha
    || typeof data.session_id !== "string"
    || data.session_id.length < 1
    || typeof data.exp !== "number"
    || Date.now() > data.exp
  ) return null;
  return data as PreviewQaSession;
}

async function registerPreviewQaSession(
  session: PreviewQaSession,
  rawToken: string,
  bootstrapNonce: string,
  previousSessionId?: string,
  previousToken?: string,
): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("./supabase-admin");
    const { data, error } = await supabaseAdmin.rpc("consume_preview_qa_bootstrap_and_issue_session", {
      p_id: session.session_id,
      p_audience: session.audience,
      p_token_hash: tokenHash(rawToken),
      p_expires_at: new Date(session.exp).toISOString(),
      p_previous_id: previousSessionId ?? null,
      p_previous_token_hash: previousToken ? tokenHash(previousToken) : null,
      p_bootstrap_grant_id: bootstrapGrantId(),
      p_bootstrap_nonce_hash: tokenHash(bootstrapNonce),
    });
    return !error && data === true;
  } catch {
    console.warn("[preview-qa] session_registry_issue_failed");
    return false;
  }
}

async function sessionIsActive(session: PreviewQaSession, rawToken: string): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("./supabase-admin");
    const { data, error } = await supabaseAdmin.rpc("verify_preview_qa_session", {
      p_id: session.session_id,
      p_audience: session.audience,
      p_token_hash: tokenHash(rawToken),
    });
    return !error && data === true;
  } catch {
    console.warn("[preview-qa] session_registry_verify_failed");
    return false;
  }
}

export async function createPreviewQaSession(hostname: string, bootstrapNonce: string, previousToken?: string): Promise<{ name: string; value: string; options: object; session: PreviewQaSession } | null> {
  if (!isPreviewQaEnvironment(hostname)) return null;
  const key = signingKey();
  const audience = configuredPreviewHost();
  const version = tokenVersion();
  const commitSha = configuredCommitSha();
  if (!key || !audience || !version || !commitSha) return null;

  const session: PreviewQaSession = {
    purpose: PURPOSE,
    audience,
    session_id: randomUUID(),
    capability: "read",
    version,
    commit_sha: commitSha,
    exp: Date.now() + PREVIEW_QA_TTL_SECONDS * 1000,
  };
  const payload = encode(session);
  const value = `${payload}.${sign(payload, key)}`;
  const previousSessionId = previousToken
    ? readSignedPreviewQaSession(previousToken, hostname)?.session_id
    : undefined;
  if (!await registerPreviewQaSession(session, value, bootstrapNonce, previousSessionId, previousToken)) return null;
  return {
    name: PREVIEW_QA_COOKIE_NAME,
    value,
    options: {
      httpOnly: true,
      secure: true,
      sameSite: "strict" as const,
      path: "/",
      maxAge: PREVIEW_QA_TTL_SECONDS,
    },
    session,
  };
}

export async function verifyPreviewQaSession(token: string, hostname: string): Promise<PreviewQaSession | null> {
  const session = readSignedPreviewQaSession(token, hostname);
  if (!session) return null;
  return await sessionIsActive(session, token) ? session : null;
}

/**
 * Read-only authorization for server components. Path and method are written
 * by middleware, which overwrites any inbound values before this runs.
 */
/**
 * `request` is supplied by route handlers when it is already available.  Its
 * URL and method, rather than caller-controlled x-* headers, define the
 * allowlist decision. This also keeps direct route-unit tests outside Next's
 * async request store. Server components have no request object, so their
 * branch uses the middleware-overwritten headers.
 */
export async function getPreviewQaReadSession(
  request?: Pick<Request, "headers" | "method" | "url">,
): Promise<PreviewQaSession | null> {
  let pathname: string;
  let method: string;
  let hostname: string;
  let raw: string | null;
  if (request) {
    try {
      const url = new URL(request.url);
      pathname = url.pathname;
      method = request.method;
      hostname = url.hostname;
      raw = cookieValue(request.headers.get("cookie"), PREVIEW_QA_COOKIE_NAME);
    } catch {
      return null;
    }
  } else {
    let requestHeaders: Headers;
    try {
      requestHeaders = await headers();
    } catch {
      // Direct server-component unit tests do not have Next's async request
      // store. This is an authentication check, so unavailable context denies.
      return null;
    }
    pathname = requestHeaders.get("x-caseload-request-path") ?? "";
    method = requestHeaders.get("x-caseload-request-method") ?? "";
    hostname = requestHeaders.get("host") ?? "";
    raw = (await cookies()).get(PREVIEW_QA_COOKIE_NAME)?.value ?? null;
  }
  if (!isPreviewQaReadRequest(pathname, method)) return null;
  if (!raw) return null;
  return await verifyPreviewQaSession(raw, hostname);
}

/** Records only nonsecret identifiers suitable for the deployment audit log. */
export function recordPreviewQaAudit(event: "issued" | "denied", details: { audience?: string; session_id?: string }): void {
  console.info("[preview-qa]", JSON.stringify({ event, ...details }));
}
