import "server-only";

/**
 * Short sign-in links: an opaque DB code behind the long HMAC magic-link token.
 *
 * The operator mints a code for a firm member; /l/[code] resolves it, mints the
 * normal token server-side, and redirects into /api/portal/login. The code, not
 * the token, is what gets shared (out-of-band, e.g. WhatsApp). Reusable until
 * expiry, mirroring the 48h magic link.
 *
 * Service-role only. Callers MUST authorise (operator session) before minting.
 */

import { randomBytes } from "crypto";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

const TTL_HOURS = 48;

export interface SigninCodeTarget {
  firmId: string;
  lawyerId: string | null;
  role: "lawyer" | "operator";
}

/** Mint a short, unguessable code (~12 url-safe chars, ~72 bits) for a member. */
export async function createSigninCode(input: {
  firmId: string;
  lawyerId: string | null;
  role: "lawyer" | "operator";
  createdByRole?: string | null;
}): Promise<{ ok: true; code: string; expiresAt: string } | { ok: false; error: string }> {
  const code = randomBytes(9).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_HOURS * 3600 * 1000).toISOString();

  const { error } = await supabase.from("portal_signin_codes").insert({
    code,
    firm_id: input.firmId,
    lawyer_id: input.lawyerId,
    role: input.role,
    expires_at: expiresAt,
    created_by_role: input.createdByRole ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, code, expiresAt };
}

/** Resolve a code to its target, or null if unknown or expired. */
export async function resolveSigninCode(code: string): Promise<SigninCodeTarget | null> {
  if (!code) return null;
  const { data } = await supabase
    .from("portal_signin_codes")
    .select("firm_id, lawyer_id, role, expires_at")
    .eq("code", code)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at as string).getTime() < Date.now()) return null;
  return {
    firmId: data.firm_id as string,
    lawyerId: (data.lawyer_id as string | null) ?? null,
    role: (data.role as "lawyer" | "operator") ?? "lawyer",
  };
}
