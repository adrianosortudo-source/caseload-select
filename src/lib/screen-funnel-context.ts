import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ScreenFunnelSurface } from "./screen-funnel-schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface ScreenFunnelContext {
  surface: ScreenFunnelSurface;
  firmId: string | null;
}

interface SignedScreenFunnelContext {
  surface: ScreenFunnelSurface;
  firm_id: string | null;
  iat: number;
  exp: number;
}

function contextSecret(): string | null {
  const secret = process.env.SCREEN_FUNNEL_CONTEXT_SECRET?.trim();
  return secret || null;
}

function enabledFlag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function allowedFirmIds(): Set<string> {
  return new Set(
    (process.env.SCREEN_FUNNEL_TELEMETRY_FIRM_ALLOWLIST ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => UUID_RE.test(value)),
  );
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function mintScreenFunnelContextToken(
  context: ScreenFunnelContext,
  secret: string,
  now = Date.now(),
): string {
  const payload: SignedScreenFunnelContext = {
    surface: context.surface,
    firm_id: context.firmId,
    iat: now,
    exp: now + TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

/** Verify and derive attribution; never trust surface or firm IDs from a client event. */
export function verifyScreenFunnelContextToken(token: string, now = Date.now()): ScreenFunnelContext | null {
  const secret = contextSecret();
  const dot = token.lastIndexOf(".");
  if (!secret || dot <= 0 || dot === token.length - 1) return null;
  const encoded = token.slice(0, dot);
  const suppliedSignature = token.slice(dot + 1);
  const expectedSignature = sign(encoded, secret);
  if (suppliedSignature.length !== expectedSignature.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(suppliedSignature), Buffer.from(expectedSignature))) return null;
  } catch {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const allowed = new Set(["surface", "firm_id", "iat", "exp"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return null;
  const surface = record.surface;
  const firmId = record.firm_id;
  const iat = record.iat;
  const exp = record.exp;
  if ((surface !== "marketing_demo" && surface !== "firm_widget") ||
    (firmId !== null && (typeof firmId !== "string" || !UUID_RE.test(firmId))) ||
    !Number.isSafeInteger(iat) || !Number.isSafeInteger(exp) ||
    iat > now + CLOCK_SKEW_MS || exp <= now || exp - iat > TOKEN_TTL_MS) return null;
  if ((surface === "marketing_demo" && firmId !== null) ||
    (surface === "firm_widget" && firmId === null)) return null;
  return { surface, firmId };
}

/** Global endpoint switch. It stays false without the signing secret. */
export function isScreenFunnelTelemetryCollectionEnabled(): boolean {
  return Boolean(contextSecret()) && (
    enabledFlag(process.env.SCREEN_FUNNEL_TELEMETRY_DEMO_ENABLED) || allowedFirmIds().size > 0
  );
}

/**
 * Server-component configuration for a future widget integration. Nothing
 * calls this from a widget in this foundation change.
 */
export function resolveScreenFunnelTelemetryContext(context: ScreenFunnelContext): {
  telemetryEnabled: boolean;
  contextToken: string | null;
} {
  const secret = contextSecret();
  if (!secret) return { telemetryEnabled: false, contextToken: null };
  const enabled = context.surface === "marketing_demo"
    ? enabledFlag(process.env.SCREEN_FUNNEL_TELEMETRY_DEMO_ENABLED)
    : Boolean(context.firmId && UUID_RE.test(context.firmId) && allowedFirmIds().has(context.firmId.toLowerCase()));
  if (!enabled) return { telemetryEnabled: false, contextToken: null };
  return { telemetryEnabled: true, contextToken: mintScreenFunnelContextToken(context, secret) };
}
