/**
 * Portal authentication utilities.
 *
 * Magic links are signed tokens (HMAC-SHA256) containing { firm_id, exp }.
 * No database table required — the signature is the authorization.
 *
 * Cookie name: portal_session
 * Signing key: PORTAL_SECRET (dedicated env var — do NOT reuse CRON_SECRET;
 *              rotating the cron secret must not invalidate active portal sessions)
 */

import { createHmac } from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "portal_session";
const LINK_TTL_HOURS = 48;
const SESSION_TTL_HOURS = 720; // 30 days

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

export function generatePortalToken(firmId: string, ttlHours = LINK_TTL_HOURS): string {
  const payload = encode({ firm_id: firmId, exp: Date.now() + ttlHours * 3600 * 1000 });
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

export function verifyPortalToken(token: string): { firm_id: string } | null {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (sign(payload) !== sig) return null;
  const data = decode<{ firm_id: string; exp: number }>(payload);
  if (Date.now() > data.exp) return null;
  return { firm_id: data.firm_id };
}

// ─── Session cookie ──────────────────────────────────────────────────────────

export function createSessionCookie(firmId: string): { name: string; value: string; options: object } {
  const payload = encode({ firm_id: firmId, exp: Date.now() + SESSION_TTL_HOURS * 3600 * 1000 });
  const sig = sign(payload);
  return {
    name: COOKIE_NAME,
    value: `${payload}.${sig}`,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/portal",
      maxAge: SESSION_TTL_HOURS * 3600,
    },
  };
}

export async function getPortalSession(): Promise<{ firm_id: string } | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (sign(payload) !== sig) return null;
  const data = decode<{ firm_id: string; exp: number }>(payload);
  if (Date.now() > data.exp) return null;
  return { firm_id: data.firm_id };
}
