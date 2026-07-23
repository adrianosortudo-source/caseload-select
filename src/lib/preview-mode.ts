/**
 * Operator preview mode (DR-084).
 *
 * The operator can step into a firm's lawyer portal or an end-client's matter
 * portal and see it as that user sees it. Preview is carried by a dedicated
 * signed cookie, `portal_preview`, set alongside the operator's normal
 * `portal_session`. The operator's session identity is unchanged; the preview
 * cookie only records "this operator is currently previewing target X".
 *
 * Two guarantees rely on this cookie:
 *   1. Rendering: pages read the intent to render the target role's interface
 *      with no operator chrome (see resolveEffectiveView in portal-auth.ts).
 *   2. Read-only: while a valid preview cookie is present, the operator-accepting
 *      write routes (the deliverables mutations) refuse to write. Every other
 *      portal write route already rejects an operator session (getFirmSession
 *      returns null for operators) or requires a client token the operator does
 *      not hold, so preview is read-only across the whole portal.
 *
 * The cookie is HMAC-signed with the same key as the portal session, httpOnly,
 * and short-lived. A tampered or expired cookie verifies as absent, which is
 * fail-safe: absence means "not previewing", so a bad cookie never grants a
 * write it should not, and a stale one at worst blocks a write until the
 * operator exits preview.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const PREVIEW_COOKIE = "portal_preview";
const PREVIEW_TTL_HOURS = 4;

export type PreviewTarget = "lawyer" | "client";

export interface PreviewIntent {
  operator_id: string;      // operator identity, for audit
  operator_email?: string;  // carried for the preview strip label and audit
  firm_id: string;          // the firm whose portal is being previewed
  matter_id?: string;       // set only when target === 'client'
  target: PreviewTarget;
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

/**
 * Verify a raw cookie value and return the intent, or null when the value is
 * missing, malformed, tampered, or expired. Pure over its input (no cookie
 * store access) so it is directly unit-testable.
 */
export function verifyPreviewValue(raw: string | undefined | null): PreviewIntent | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(payload);
  if (expected.length !== sig.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  } catch {
    return null;
  }
  let data: Partial<PreviewIntent>;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<PreviewIntent>;
  } catch {
    return null;
  }
  if (!data.operator_id || !data.firm_id || typeof data.exp !== "number") return null;
  if (data.target !== "lawyer" && data.target !== "client") return null;
  if (data.target === "client" && !data.matter_id) return null;
  if (Date.now() > data.exp) return null;
  return {
    operator_id: data.operator_id,
    operator_email: data.operator_email,
    firm_id: data.firm_id,
    matter_id: data.matter_id,
    target: data.target,
    exp: data.exp,
  };
}

/** Build the signed cookie value for a preview intent (TTL applied here). */
export function makePreviewCookieValue(
  intent: Omit<PreviewIntent, "exp">,
): { name: string; value: string; options: object } {
  const payload = encode({
    ...intent,
    exp: Date.now() + PREVIEW_TTL_HOURS * 3600 * 1000,
  });
  const value = `${payload}.${sign(payload)}`;
  return {
    name: PREVIEW_COOKIE,
    value,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: PREVIEW_TTL_HOURS * 3600,
    },
  };
}

/** Cookie descriptor that clears the preview cookie (exit preview). */
export function clearPreviewCookieValue(): { name: string; value: string; options: object } {
  return {
    name: PREVIEW_COOKIE,
    value: "",
    options: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 0 },
  };
}

/**
 * Read + verify the preview intent from the request cookie store. Returns null
 * when there is no request scope (e.g. a unit test invoking a route handler
 * directly): no scope means no cookie means not previewing, the same fail-safe
 * as a missing or tampered cookie.
 */
export async function getPreviewIntent(): Promise<PreviewIntent | null> {
  try {
    const store = await cookies();
    return verifyPreviewValue(store.get(PREVIEW_COOKIE)?.value);
  } catch {
    return null;
  }
}

/**
 * Does this preview intent apply to a write on the given firm? Used by the
 * operator-accepting write routes to refuse a write while previewing. A preview
 * cookie for any firm blocks writes on that firm; a null intent never blocks.
 * Pure and unit-testable.
 */
export function previewBlocksWrite(intent: PreviewIntent | null, firmId: string): boolean {
  if (!intent) return false;
  return intent.firm_id === firmId;
}

/**
 * Resolve what a portal layout should do with a preview intent for the
 * firm in the URL. "mismatch" means the operator carries a live preview
 * bound to a DIFFERENT firm: the layout must terminate the preview
 * (redirect to the exit route) instead of silently rendering the other
 * firm's operator view. Pure and unit-testable.
 */
export function resolvePreviewForFirm(
  intent: PreviewIntent | null,
  firmId: string,
): "none" | "match" | "mismatch" {
  if (!intent) return "none";
  return intent.firm_id === firmId ? "match" : "mismatch";
}
