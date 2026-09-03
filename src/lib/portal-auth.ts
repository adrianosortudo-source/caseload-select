/**
 * Portal authentication utilities.
 *
 * Magic links and session cookies are signed HMAC-SHA256 tokens. Lawyer and
 * client sessions are authorized by the signed scope. Operator sessions also
 * require a live, exact firm_lawyers membership on every authorization check,
 * so disabling, deleting, moving, or re-roling the member revokes access.
 * Two role tiers:
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
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPreviewIntent, type PreviewIntent } from "./preview-mode";
import { isLocalOrPreviewHost, isOperatorHost } from "./app-origins";

const COOKIE_NAME = "portal_session";
const LINK_TTL_HOURS = 48;
const SESSION_TTL_HOURS = 720; // 30 days

export type PortalRole = "lawyer" | "operator" | "client";

export interface PortalSession {
  firm_id: string;
  role: PortalRole;
  lawyer_id?: string;        // firm_lawyers.id when known; absent for legacy tokens and operator-only tokens not tied to a row
  matter_id?: string;        // client_matters.id; ONLY set on role='client' tokens. Client sessions are scoped to ONE matter.
  client_email?: string;     // primary_email on the matter at invite time; carried for audit and welcome routing
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
  matter_id?: string;
  client_email?: string;
  ttlHours?: number;
}

export function generatePortalToken(firmId: string, options: TokenOptions = {}): string {
  const role: PortalRole = options.role ?? "lawyer";
  const ttlHours = options.ttlHours ?? LINK_TTL_HOURS;
  const payload = encode({
    firm_id: firmId,
    role,
    lawyer_id: options.lawyer_id,
    matter_id: options.matter_id,
    client_email: options.client_email,
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
  const role: PortalRole =
    data.role === "operator" ? "operator"
      : data.role === "client" ? "client"
      : "lawyer";
  return {
    firm_id: data.firm_id,
    role,
    lawyer_id: data.lawyer_id,
    matter_id: data.matter_id,
    client_email: data.client_email,
    exp: data.exp,
  };
}

// ─── Session cookie ──────────────────────────────────────────────────────────

const COOKIE_BASE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  // Path "/" — DEFENSE-IN-DEPTH NOTE (Jim Manico audit APP-010).
  //
  // Cookie rides along on /api/portal/* and /api/admin/* fetches from
  // client components (Take/Pass action bar, operator console actions).
  // An earlier "/portal" scope caused 401 on /api/* fetches because the
  // browser would not attach the cookie to the API origin path.
  //
  // The cookie is httpOnly + HMAC-signed + 30-day-max so a stolen
  // cookie is bounded by signature validity, but the broad path means:
  //
  //   ANY future /api/* route that reads session-derived data MUST
  //   verify the firm scope on the loaded row, not just trust the
  //   cookie's presence. The Take/Pass routes do exactly this: they
  //   reload the screened_leads row, compare row.firm_id to URL.firmId,
  //   and return 404 on mismatch. Mirror that pattern on any new route.
  //
  // If you add an /api/* route under a different concern (e.g. a public
  // /api/webhooks/* with no session needs), the cookie still rides
  // along; that route must ignore the session cookie entirely rather
  // than treat it as authorization.
  path: "/",
} as const;

export function createSessionCookie(
  firmId: string,
  options: {
    role?: PortalRole;
    lawyer_id?: string;
    matter_id?: string;
    client_email?: string;
  } = {},
): { name: string; value: string; options: object } {
  const role: PortalRole = options.role ?? "lawyer";
  const payload = encode({
    firm_id: firmId,
    role,
    lawyer_id: options.lawyer_id,
    matter_id: options.matter_id,
    client_email: options.client_email,
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

async function getRawPortalSession(): Promise<PortalSession | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return verifyPortalToken(raw);
}

async function isTrustedOperatorRequestHost(): Promise<boolean> {
  const requestHeaders = await headers();
  const hostname = requestHeaders.get("host") ?? "";
  return isLocalOrPreviewHost(hostname) || isOperatorHost(hostname);
}

/**
 * Resolve the exact active database row behind an operator identity.
 *
 * HMAC verification proves that CaseLoad Select issued the cookie or link; it
 * does not prove the member is still entitled to operator access. Keeping this
 * lookup in one place ensures link consumption and every later request apply
 * the same id, firm, role, and disabled-state boundary.
 */
export async function revalidateOperatorMembership(
  session: PortalSession,
  options: { recordSignIn?: boolean } = {},
): Promise<{ id: string } | null> {
  if (session.role !== "operator" || !session.lawyer_id) return null;

  try {
    // Dynamic import keeps token-only consumers from initializing the
    // privileged Supabase client when they do not perform operator auth.
    const { supabaseAdmin } = await import("./supabase-admin");
    const table = supabaseAdmin.from("firm_lawyers");
    const query = options.recordSignIn
      ? table
        .update({ last_signed_in_at: new Date().toISOString() })
        .eq("id", session.lawyer_id)
        .eq("firm_id", session.firm_id)
        .eq("role", "operator")
        .eq("disabled", false)
        .select("id")
      : table
        .select("id")
        .eq("id", session.lawyer_id)
        .eq("firm_id", session.firm_id)
        .eq("role", "operator")
        .eq("disabled", false);

    const { data, error } = await query.maybeSingle<{ id: string }>();
    if (error) {
      console.error(`[portal-auth] operator membership revalidation failed: ${error.message}`);
      return null;
    }
    return data;
  } catch (error) {
    console.error(
      `[portal-auth] operator membership revalidation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

/**
 * Return the signed portal session after applying role-specific live checks.
 *
 * Lawyer and client cookies remain self-contained and scoped by their signed
 * firm or matter identifiers. Every operator-valued cookie, regardless of the
 * page or API that consumes it, must be on the trusted operator origin and map
 * to a currently active database membership. This is the public session
 * boundary; callers must not decode the cookie independently.
 */
export async function getPortalSession(): Promise<PortalSession | null> {
  const session = await getRawPortalSession();
  if (!session || session.role !== "operator") return session;
  if (!await isTrustedOperatorRequestHost()) return null;
  return await revalidateOperatorMembership(session) ? session : null;
}

/**
 * Return a live operator session only on the origin that owns the host-only
 * operator cookie. Legacy operator cookies on app.caseloadselect.ca are
 * intentionally rejected; users must complete the operator sign-in flow on
 * the admin origin to establish the new session boundary.
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
  if (session.role === "client") return null;   // clients use /portal/[firmId]/m/[matterId]
  if (session.firm_id !== firmId) return null;
  return session;
}

export interface PortalViewer {
  session: PortalSession;
  /** True when an operator (cross-firm) is viewing this firm's portal read-only. */
  isOperator: boolean;
  /** True when a firm-scoped lawyer/admin/staff session is the viewer. */
  isLawyer: boolean;
  /**
   * True when an operator is viewing this firm's portal in a faithful preview
   * (DR-084): the lawyer interface renders with no operator chrome and controls
   * present-but-inert. Distinct from the default operator view, which keeps the
   * "Operator view" banner and disabled controls.
   */
  isPreview: boolean;
  /** The preview intent when isPreview is true; carries the operator identity. */
  previewIntent?: PreviewIntent;
}

/**
 * Single page guard for every lawyer-facing portal surface (triage, dashboard,
 * pipeline, leads, files, clients, matters, deliverables, messages). It encodes
 * the operator-view contract (DR-076) in ONE place:
 *
 *   - operator session  -> admitted, isOperator=true. Cross-firm; the portal
 *                          renders read-only with the "Operator view" banner.
 *                          Write controls are gated on !isOperator; the write
 *                          API routes reject operator sessions independently.
 *   - lawyer session     -> admitted only when the token firm_id matches the
 *                          route firmId. isLawyer=true.
 *   - client session     -> rejected here (clients live under /m/[matterId]).
 *   - no / mismatched    -> redirect to the real /portal/login.
 *
 * redirect() throws, so on any failure this never returns; callers can treat
 * the returned session as guaranteed non-null. This replaced the prior per-page
 * guards that diverged three ways: getFirmSession() nulled operators then
 * redirected to the non-existent /portal/[firmId]/login (a hard 404 that also
 * hit real lawyers), a firm_id check with no operator bypass bounced operators
 * to login, and the messages page rendered console chrome.
 */
export async function requirePortalViewer(firmId: string): Promise<PortalViewer> {
  const session = await getPortalSession();
  if (!session) redirect("/portal/login");
  if (session.role === "client") redirect("/portal/login");
  if (session.role === "operator") {
    // DR-084: an operator with a live preview cookie for THIS firm (target
    // 'lawyer') gets the faithful mirror. Any other operator visit keeps the
    // default read-only banner view from DR-076.
    const preview = await getPreviewIntent();
    if (preview && preview.target === "lawyer" && preview.firm_id === firmId) {
      return { session, isOperator: true, isLawyer: false, isPreview: true, previewIntent: preview };
    }
    return { session, isOperator: true, isLawyer: false, isPreview: false };
  }
  // lawyer / admin / staff: must match the firm in the route.
  if (session.firm_id !== firmId) redirect("/portal/login");
  return { session, isOperator: false, isLawyer: true, isPreview: false };
}

export interface ClientMatterView {
  /** The client session, or the operator session when previewing (DR-084). */
  session: PortalSession;
  /** True when an operator is previewing this matter as the client. */
  isPreview: boolean;
  previewIntent?: PreviewIntent;
}

/**
 * Read guard for the client matter surfaces at `/portal/[firmId]/m/[matterId]`.
 * Admits the real client (matter-scoped client token) OR an operator with a live
 * preview cookie targeting this exact matter (DR-084). Returns null otherwise.
 *
 * This is a READ guard only. The client WRITE routes keep using
 * getClientMatterSession, which requires a client token, so an operator in
 * preview can render the client view but cannot post as the client: the operator
 * holds no client token and getClientMatterSession returns null for them.
 */
export async function resolveClientMatterView(
  firmId: string,
  matterId: string,
): Promise<ClientMatterView | null> {
  const session = await getPortalSession();
  if (!session) return null;
  if (
    session.role === "client" &&
    session.firm_id === firmId &&
    session.matter_id === matterId
  ) {
    return { session, isPreview: false };
  }
  if (session.role === "operator") {
    const preview = await getPreviewIntent();
    if (
      preview &&
      preview.target === "client" &&
      preview.firm_id === firmId &&
      preview.matter_id === matterId
    ) {
      return { session, isPreview: true, previewIntent: preview };
    }
  }
  return null;
}

/**
 * Convenience: return the session ONLY if it has client role AND the
 * matter_id matches. Used by the client-facing matter surfaces at
 * /portal/[firmId]/m/[matterId]/*. The session is scoped to a single
 * matter; cross-matter access requires a separate token per matter.
 */
export async function getClientMatterSession(
  firmId: string,
  matterId: string,
): Promise<PortalSession | null> {
  const session = await getPortalSession();
  if (!session) return null;
  if (session.role !== "client") return null;
  if (session.firm_id !== firmId) return null;
  if (session.matter_id !== matterId) return null;
  return session;
}
