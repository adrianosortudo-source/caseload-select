import "server-only";

import { createHmac, randomInt, randomUUID } from "crypto";
import type { NextRequest } from "next/server";
import { getFirmSession, type PortalSession } from "@/lib/portal-auth";
import { denyWriteIfPreview } from "@/lib/preview-guard";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const CLIENT_IMPORT_AUTHORIZATION_POLICY_VERSION = "secure-import-v1";
export const CLIENT_IMPORT_AUTHORIZATION_TEXT =
  "I am authorized by this firm to import this relationship database. I understand that importing a contact does not authorize marketing or client communications.";
export const CLIENT_IMPORT_CHALLENGE_TTL_MS = 10 * 60 * 1000;

export interface ClientImportActor {
  id: string;
  firmId: string;
  email: string;
  name: string | null;
  role: "lawyer" | "admin";
}

export interface ClientImportFirmConfig {
  enabled: boolean;
  liveWritesEnabled: boolean;
  maxRows: number;
  locationId: string | null;
  token: string | null;
}

export type ClientImportGuardResult =
  | { ok: true; actor: ClientImportActor; session: PortalSession; config: ClientImportFirmConfig }
  | { ok: false; status: number; error: string; response?: Response };

function signingSecret(): string {
  const secret = process.env.CLIENT_IMPORT_HMAC_SECRET ?? process.env.PORTAL_SECRET ?? process.env.CRON_SECRET;
  if (!secret) throw new Error("CLIENT_IMPORT_HMAC_SECRET or PORTAL_SECRET is required");
  return secret;
}

export function clientImportDigest(scope: string, value: string): string {
  return createHmac("sha256", signingSecret()).update(`${scope}:${value}`).digest("hex");
}

export function clientImportCodeDigest(challengeId: string, code: string): string {
  return clientImportDigest("step-up", `${challengeId}:${code}`);
}

export function clientImportLiveWritesGloballyEnabled(): boolean {
  return process.env.CLIENT_IMPORT_LIVE_WRITES_ENABLED === "true";
}

export function validateSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost ?? req.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function guardClientImportWrite(req: NextRequest, firmId: string): Promise<ClientImportGuardResult> {
  if (!validateSameOrigin(req)) return { ok: false, status: 403, error: "invalid_origin" };
  const previewDenied = await denyWriteIfPreview(firmId);
  if (previewDenied) return { ok: false, status: 403, error: "support_preview_read_only", response: previewDenied };
  const session = await getFirmSession(firmId);
  if (!session) return { ok: false, status: 401, error: "unauthenticated" };
  if (!session.lawyer_id) return { ok: false, status: 403, error: "fresh_member_session_required" };

  const [{ data: member }, { data: firm }] = await Promise.all([
    supabase
      .from("firm_lawyers")
      .select("id, firm_id, email, name, role, disabled")
      .eq("id", session.lawyer_id)
      .eq("firm_id", firmId)
      .maybeSingle(),
    supabase
      .from("intake_firms")
      .select(
        "id, secure_client_import_enabled, secure_client_import_live_writes_enabled, secure_client_import_max_rows, ghl_location_id, ghl_contacts_write_token",
      )
      .eq("id", firmId)
      .maybeSingle(),
  ]);
  if (!member || member.disabled === true) return { ok: false, status: 403, error: "member_disabled_or_missing" };
  if (member.role !== "lawyer" && member.role !== "admin") return { ok: false, status: 403, error: "member_not_authorized" };
  if (!firm) return { ok: false, status: 404, error: "firm_not_found" };

  return {
    ok: true,
    session,
    actor: {
      id: member.id as string,
      firmId,
      email: member.email as string,
      name: (member.name as string | null) ?? null,
      role: member.role as "lawyer" | "admin",
    },
    config: {
      enabled: firm.secure_client_import_enabled === true,
      liveWritesEnabled: firm.secure_client_import_live_writes_enabled === true,
      maxRows: Math.min(Number(firm.secure_client_import_max_rows ?? 2500), 5000),
      locationId: (firm.ghl_location_id as string | null) ?? null,
      token: (firm.ghl_contacts_write_token as string | null) ?? null,
    },
  };
}

export function importFeatureGate(config: ClientImportFirmConfig): { ok: true } | { ok: false; error: string } {
  if (!config.enabled) return { ok: false, error: "secure_import_not_enabled" };
  if (!config.liveWritesEnabled) return { ok: false, error: "firm_live_writes_not_enabled" };
  if (!clientImportLiveWritesGloballyEnabled()) return { ok: false, error: "global_live_writes_not_enabled" };
  if (!config.locationId || !config.token) return { ok: false, error: "crm_import_configuration_missing" };
  return { ok: true };
}

export async function createClientImportChallenge(actor: ClientImportActor): Promise<
  | { ok: true; id: string; code: string; expiresAt: string }
  | { ok: false; error: string }
> {
  const id = randomUUID();
  const code = String(randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + CLIENT_IMPORT_CHALLENGE_TTL_MS).toISOString();
  const { error } = await supabase.from("secure_client_import_challenges").insert({
    id,
    firm_id: actor.firmId,
    lawyer_id: actor.id,
    code_hash: clientImportCodeDigest(id, code),
    recipient_hash: clientImportDigest("recipient", actor.email.trim().toLowerCase()),
    expires_at: expiresAt,
  });
  if (error) return { ok: false, error: "challenge_create_failed" };
  return { ok: true, id, code, expiresAt };
}

export async function revokeClientImportChallenge(id: string): Promise<void> {
  await supabase
    .from("secure_client_import_challenges")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("verified_at", null);
}

export async function verifyClientImportChallenge(input: {
  id: string;
  code: string;
  actor: ClientImportActor;
  attested: boolean;
}): Promise<{ ok: true; verifiedAt: string } | { ok: false; status: number; error: string }> {
  const digest = /^\d{6}$/.test(input.code)
    ? clientImportCodeDigest(input.id, input.code)
    : clientImportDigest("invalid-code-shape", input.id);
  const { data, error } = await supabase.rpc("verify_secure_client_import_challenge", {
    p_challenge_id: input.id,
    p_firm_id: input.actor.firmId,
    p_lawyer_id: input.actor.id,
    p_code_hash: digest,
    p_attested: input.attested,
  });
  if (error) return { ok: false, status: 500, error: "challenge_verify_failed" };
  const result = Array.isArray(data) ? data[0] as { outcome?: unknown; verified_at?: unknown } | undefined : undefined;
  const outcome = typeof result?.outcome === "string" ? result.outcome : "challenge_verify_failed";
  if (outcome === "ok" && typeof result?.verified_at === "string") return { ok: true, verifiedAt: result.verified_at };
  const statuses: Record<string, number> = {
    challenge_not_found: 404,
    challenge_unavailable: 409,
    challenge_already_verified: 409,
    challenge_expired: 410,
    challenge_locked: 429,
    invalid_code: 400,
    authorization_attestation_required: 400,
  };
  return { ok: false, status: statuses[outcome] ?? 500, error: outcome };
}

export function maskedEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "your address";
  return `${local.slice(0, 1)}${"*".repeat(Math.max(2, Math.min(local.length - 1, 5)))}@${domain}`;
}
