import "server-only";
import { createContinuation, hashToken, invitationEligible, seedLiveState, type LiveCall } from "./voice-screen-live";
import type { EngineState } from "./screen-engine/types";

export interface Inquiry {
  id: string; firm_id: string; location_id: string; agent_id: string; call_id: string; contact_id: string;
  caller_facts: LiveCall; engine_state: EngineState;
  answers: Array<{ question: string; answer: string; source: "screen"; at: string }>;
  token_hash: string; token_nonce: string; expires_at: string; ended_at: string;
  revision: number; status: string; human_status: string; invitation_eligible: boolean; created_at: string;
}

export function liveConfig() {
  if (process.env.V2S_ENABLED !== "true") return null;
  const firmId = process.env.V2S_FIRM_ID ?? "";
  const locationId = process.env.V2S_LOCATION_ID ?? "";
  const agentId = process.env.V2S_AGENT_ID ?? "";
  const key = process.env.V2S_TOKEN_KEY ?? "";
  const webhookSecret = process.env.V2S_WEBHOOK_SECRET ?? "";
  const origin = process.env.V2S_PUBLIC_ORIGIN ?? "";
  const retentionDays = Number(process.env.V2S_RETENTION_DAYS ?? "7");
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 30) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(firmId) || !/^[a-zA-Z0-9_-]{1,100}$/.test(locationId) || !/^[a-zA-Z0-9_-]{1,100}$/.test(agentId) || key.length < 32 || webhookSecret.length < 32) return null;
  try { const u = new URL(origin); if (u.protocol !== "https:" || u.pathname !== "/" || u.search || u.hash || u.username || u.password) return null; } catch { return null; }
  return { firmId, locationId, agentId, key, webhookSecret, retentionDays, origin: origin.replace(/\/$/, "") };
}

export async function database() { return (await import("./supabase-admin")).supabaseAdmin; }

export async function ingestLiveCall(call: LiveCall, config: NonNullable<ReturnType<typeof liveConfig>>) {
  const token = createContinuation(config.key);
  const db = await database();
  const { data, error } = await db.rpc("v2s_ingest", { p_inquiry: {
    firm_id: config.firmId, location_id: call.locationId, agent_id: call.agentId, call_id: call.callId,
    contact_id: call.contactId, caller_facts: call, engine_state: seedLiveState(call),
    token_hash: token.hash, token_nonce: token.nonce,
    expires_at: new Date(Date.now() + config.retentionDays * 86400000).toISOString(), ended_at: call.endedAt,
    invitation_eligible: invitationEligible(call, config),
  } });
  if (error) throw new Error("ingest_unavailable");
  return data as { id: string; created: boolean };
}

export async function inquiryByToken(token: string): Promise<Inquiry | null> {
  const db = await database();
  const config = liveConfig();
  if (!config) return null;
  const { data, error } = await db.from("voice_screen_inquiries").select("*")
    .eq("token_hash", hashToken(token)).eq("firm_id", config.firmId).eq("location_id", config.locationId).eq("agent_id", config.agentId)
    .gt("expires_at", new Date().toISOString()).neq("status", "stopped").neq("human_status", "taken_over").maybeSingle();
  if (error) throw new Error("continuation_unavailable");
  return data as Inquiry | null;
}

export async function saveInquiry(inquiry: Inquiry, state: EngineState, answers: Inquiry["answers"], status: string) {
  const db = await database();
  const { data, error } = await db.rpc("v2s_save", { p_id: inquiry.id, p_hash: inquiry.token_hash, p_revision: inquiry.revision, p_state: state, p_answers: answers, p_status: status });
  if (error) throw new Error("save_unavailable");
  return data === true;
}
