/**
 * Portal authentication utilities.
 *
 * Magic links and session cookies are signed HMAC-SHA256 tokens. No DB row
 * is needed to verify; the signature IS the authorisation. Two role tiers:
 *
 *   role='lawyer'    — firm-scoped. The token's firm_id must match the
 *                      requested route's firmId. Lands at /portal/[firmId].
 *   role='operator'  — cross-firm. Bypasses the firm match. Lands at
 *                      /admin/triage. firm_id on the token is informational
 *                      (the firm the operator belonged to when they last
 *                      logged in, used for the "switch into firm" view).
 *
 * Cookie name: portal_session
 * Path: "/" so the cookie rides along on /api/portal/* fetches from client
 * components (Take/Pass action bar). Bug fix from Phase 3 — earlier path
 * "/portal" caused 401 on /api/* fetches. The cookie is httpOnly + signed,
 * so broader path doesn't widen the attack surface.
 *
 * Backward compat: tokens issued before the role field was added (payload
 * shape `{ firm_id, exp }` instead of `{ firm_id, role, lawyer_id, exp }`)
 * still verify. The verifier defaults missing role to 'lawyer'.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "portal_session";
const LINK_TTL_HOURS = 48;
const SESSION_TTL_HOURS = 720; // 30 days

export type PortalRole = "lawyer" | "operator";

export interface PortalSession {
  firm_id: string;
  role: PortalRole;
  lawyer_id?: string;        // firm_lawyers.id when known; absent for legacy tokens and operator-only tokens not tied to a row
  exp: number;
}

function signingKey(): string {
  const key = process.env.PORTAL_SECRET ?? process.env.CRON_SECRET;
  if (!key) throw new Error("PORTAL_SECRET not set");
  return key;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

function encode(data: object): string {
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

function decode<T>(encoded: string): T {
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
}

// ─── Token (magic link) ─────────────────────────────────────────────────────

export interface TokenOptions {
  role?: PortalRole;
  lawyer_id?: string;
  ttlHours?: number;
}

export function generatePortalToken(firmId: string, options: TokenOptions = {}): string {
  const role: PortalRole = options.role ?? "lawyer";
  const ttlHours = options.ttlHours ?? LINK_TTL_HOURS;
  const payload = encode({
    firm_id: firmId,
    role,
    lawyer_id: options.lawyer_id,
    exp: Date.now() + ttlHours * 3600 * 1000,
  });
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

export function verifyPortalToken(token: string): PortalSession | null {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  // Constant-time signature compare. Plain !== is vulnerable to timing
  // attacks: an attacker can incrementally guess the correct signature by
  // measuring how long the comparison takes on each prefix. timingSafeEqual
  // requires equal-length buffers, so we guard with a length check first
  // (length is not secret — only the contents are).
  const expected = sign(payload);
  if (expected.length !== sig.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  } catch {
    return null;
  }
  let data: Partial<PortalSession>;
  try {
    data = decode<Partial<PortalSession>>(payload);
  } catch {
    return null;
  }
  if (!data.firm_id || typeof data.exp !== "number") return null;
  if (Date.now() > data.exp) return null;
  return {
    firm_id: data.firm_id,
    role: (data.role === "operator" ? "operator" : "lawyer") as PortalRole,
    lawyer_id: data.lawyer_id,
    exp: data.exp,
  };
}

// ─── Session cookie ──────────────────────────────────────────────────────────

const COOKIE_BASE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  // Path "/" so the cookie rides along on /api/portal/* fetches from client
  // components (Take/Pass action bar). Earlier "/portal" caused 401 on
  // /api/* fetches. The cookie is httpOnly + HMAC-signed; broader path does
  // not widen the attack surface.
  path: "/",
} as const;

export function createSessionCookie(
  firmId: string,
  options: { role?: PortalRole; lawyer_id?: string } = {},
): { name: string; value: string; options: object } {
  const role: PortalRole = options.role ?? "lawyer";
  const payload = encode({
    firm_id: firmId,
    role,
    lawyer_id: options.lawyer_id,
    exp: Date.now() + SESSION_TTL_HOURS * 3600 * 1000,
  });
  const sig = sign(payload);
  return {
    name: COOKIE_NAME,
    value: `${payload}.${sig}`,
    options: {
      ...COOKIE_BASE_OPTIONS,
      maxAge: SESSION_TTL_HOURS * 3600,
    },
  };
}

export async function getPortalSession(): Promise<PortalSession | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return verifyPortalToken(raw);
}

/**
 * Convenience: return the session ONLY if it has operator role. Used by
 * /admin/* layouts to gate cross-firm access.
 */
export async function getOperatorSession(): Promise<PortalSession | null> {
  const session = await getPortalSession();
  if (!session || session.role !== "operator") return null;
  return session;
}

/**
 * Convenience: return the session if it matches a specific firm AND has the
 * lawyer role. Used by /portal/[firmId]/* layouts. An operator session is
 * NOT accepted here — operators have their own surface.
 */
export async function getFirmSession(firmId: string): Promise<PortalSession | null> {
  const session = await getPortalSession();
  if (!session) return null;
  if (session.role === "operator") return null; // operators use /admin/*
  if (session.firm_id !== firmId) return null;
  return session;
}
