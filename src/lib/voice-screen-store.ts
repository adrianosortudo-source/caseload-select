import "server-only";
import { createHmac } from "node:crypto";
import { createContinuation, hashToken, invitationEligible, seedLiveState, tokenForNonce, type LiveCall } from "./voice-screen-live";
import type { EngineState } from "./screen-engine/types";

export interface Inquiry {
  id: string; firm_id: string; location_id: string; agent_id: string; call_id: string; contact_id: string;
  caller_facts: LiveCall; engine_state: EngineState;
  answers: Array<{ question: string; answer: string; source: "screen"; at: string }>;
  token_hash: string; token_nonce: string; expires_at: string; ended_at: string;
  revision: number; status: string; human_status: string; invitation_eligible: boolean; created_at: string;
}

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const providerId = (value: string) => /^[a-zA-Z0-9_-]{1,100}$/.test(value);

export function voiceScreenScopeConfig() {
  const firmId = process.env.V2S_FIRM_ID ?? "";
  const locationId = process.env.V2S_LOCATION_ID ?? "";
  const agentId = process.env.V2S_AGENT_ID ?? "";
  const appId = process.env.V2S_GHL_MARKETPLACE_APP_ID ?? "";
  if (!uuid(firmId) || !providerId(locationId) || !providerId(agentId) || !providerId(appId)) return null;
  return { firmId, locationId, agentId, appId };
}

export function voiceScreenIsEnabled() {
  return process.env.V2S_ENABLED === "true" && process.env.V2S_RETENTION_ENABLED === "true";
}

export function liveConfig() {
  if (!voiceScreenIsEnabled()) return null;
  const scope = voiceScreenScopeConfig();
  if (!scope) return null;
  const key = process.env.V2S_TOKEN_KEY ?? "";
  const subjectSuppressionKeys = (process.env.V2S_SUBJECT_SUPPRESSION_KEYS ?? "").split(",").map(value => value.trim()).filter(Boolean);
  const origin = process.env.V2S_PUBLIC_ORIGIN ?? "";
  const retentionDays = Number(process.env.V2S_RETENTION_DAYS ?? "7");
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 30) return null;
  if (key.length < 32 || subjectSuppressionKeys.length < 1 || subjectSuppressionKeys.length > 4 ||
      new Set(subjectSuppressionKeys).size !== subjectSuppressionKeys.length ||
      subjectSuppressionKeys.some(value => !/^[A-Za-z0-9_-]{43}$/.test(value) || Buffer.from(value, "base64url").length !== 32)) return null;
  try { const u = new URL(origin); if (u.protocol !== "https:" || u.pathname !== "/" || u.search || u.hash || u.username || u.password) return null; } catch { return null; }
  return { ...scope, key, subjectSuppressionKeys, retentionDays, origin: origin.replace(/\/$/, "") };
}

export function voiceScreenSubjectDigests(config: { firmId: string; locationId: string; subjectSuppressionKeys: string[] }, contactId: string) {
  return config.subjectSuppressionKeys.map(key => createHmac("sha256", Buffer.from(key, "base64url"))
    .update("v2s-subject:v1\0").update(config.firmId).update("\0").update(config.locationId).update("\0").update(contactId)
    .digest("hex"));
}

export async function database() { return (await import("./supabase-admin")).supabaseAdmin; }

export async function ingestLiveCall(call: LiveCall, config: NonNullable<ReturnType<typeof liveConfig>>) {
  const token = createContinuation(config.key);
  const db = await database();
  const { data, error } = await db.rpc("v2s_ingest", { p_inquiry: {
    firm_id: config.firmId, location_id: call.locationId, agent_id: call.agentId, call_id: call.callId,
    contact_id: call.contactId, caller_facts: call, engine_state: seedLiveState(call),
    subject_digests: voiceScreenSubjectDigests(config, call.contactId),
    marketplace_app_id: config.appId,
    token_hash: token.hash, token_nonce: token.nonce,
    expires_at: new Date(Date.now() + config.retentionDays * 86400000).toISOString(), ended_at: call.endedAt,
    invitation_eligible: invitationEligible(call, config),
  } });
  if (error) throw new Error("ingest_unavailable");
  return data as { id: string | null; created: boolean; reason?: "event_replay" | "subject_suppressed" | "integration_not_installed"; invitation_eligible?: boolean };
}

export async function revokeGhlInstallation(config: NonNullable<ReturnType<typeof voiceScreenScopeConfig>>, identity: { locationId?: string; companyId?: string }) {
  const db = await database();
  const { data, error } = await db.rpc("v2s_revoke_ghl_installation", {
    p_firm_id: config.firmId,
    p_marketplace_app_id: config.appId,
    p_location_id: identity.locationId ?? null,
    p_company_id: identity.companyId ?? null,
  });
  if (error || typeof data !== "number") throw new Error("ghl_uninstall_unavailable");
  return data;
}

export async function inquiryByToken(token: string): Promise<Inquiry | null> {
  const db = await database();
  const config = liveConfig();
  if (!config) return null;
  const { data, error } = await db.from("voice_screen_inquiries").select("*")
    .eq("token_hash", hashToken(token)).eq("firm_id", config.firmId).eq("location_id", config.locationId).eq("agent_id", config.agentId)
    .gt("expires_at", new Date().toISOString()).neq("status", "stopped").neq("human_status", "taken_over").maybeSingle();
  if (error) throw new Error("continuation_unavailable");
  // Rotation deliberately revokes previously issued links, not only queued sends.
  if (data && hashToken(tokenForNonce(data.token_nonce, config.key)) !== data.token_hash) return null;
  return data as Inquiry | null;
}

export async function saveInquiry(inquiry: Inquiry, state: EngineState, answers: Inquiry["answers"], status: string) {
  const db = await database();
  const { data, error } = await db.rpc("v2s_save", { p_id: inquiry.id, p_hash: inquiry.token_hash, p_revision: inquiry.revision, p_state: state, p_answers: answers, p_status: status });
  if (error) throw new Error("save_unavailable");
  return data === true;
}
