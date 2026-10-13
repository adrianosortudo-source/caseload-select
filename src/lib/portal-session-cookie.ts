import { createHmac } from "node:crypto";

const SESSION_TTL_HOURS = 720;

/**
 * Creates the same signed operator session cookie used by portal-auth.ts.
 * This pure helper stays independent of Next request modules so local browser
 * harnesses can sign a test principal without starting an auth bypass.
 */
export function createSessionCookie(
  firmId: string,
  options: {
    role?: "lawyer" | "operator" | "client";
    lawyer_id?: string;
    matter_id?: string;
    client_email?: string;
  } = {},
): { name: string; value: string; options: object } {
  const secret = process.env.PORTAL_SECRET ?? process.env.CRON_SECRET;
  if (!secret) throw new Error("PORTAL_SECRET not set");
  const role = options.role ?? "lawyer";
  const payload = Buffer.from(JSON.stringify({
    firm_id: firmId,
    role,
    lawyer_id: options.lawyer_id,
    matter_id: options.matter_id,
    client_email: options.client_email,
    exp: Date.now() + SESSION_TTL_HOURS * 3600 * 1000,
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return {
    name: "portal_session",
    value: `${payload}.${signature}`,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: SESSION_TTL_HOURS * 3600,
    },
  };
}
