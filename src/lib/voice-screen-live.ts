import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { SLOT_REGISTRY } from "./screen-engine/slotRegistry";
import { planVoiceScreenCall, type VoiceScreenCall } from "./voice-screen-bridge";

export interface LiveCall extends VoiceScreenCall {
  endedAtSource?: "provider_created_plus_duration" | "provider_ended_at";
  permissionCapturedAtSource?: "call_end_bound";
  contactId: string;
  callerName: string;
  broadNeed: string;
  deadline: string;
  /** Current-call extraction proof from the trusted adapter, never contact history. */
  evidence: { callId: string; consentQuote: string; safeToTextQuote: string; callbackQuote: string };
  capturedSlots: Record<string, string>;
}

const id = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const short = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
export function parseLiveCall(value: unknown): LiveCall | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const c = value as LiveCall;
  if (![c.callId, c.locationId, c.agentId, c.contactId].every(id) ||
      !short(c.callerName, 120) || !short(c.broadNeed, 2000) || c.broadNeed.trim().length < 10 || !short(c.deadline, 300) ||
      !["new", "existing", "other", "unknown"].includes(c.callerType) || !["urgent", "routine", "unknown"].includes(c.urgency) || typeof c.humanRequested !== "boolean" ||
      !c.callback || !short(c.callback.number, 30) || !id(c.callback.verifiedOnCallId) ||
      !c.permission || !["granted", "declined", "unknown"].includes(c.permission.value) || !id(c.permission.callId) ||
      !c.safeToText || !["yes", "no", "unknown"].includes(c.safeToText.value) || !id(c.safeToText.callId) ||
      !c.evidence || !id(c.evidence.callId) || !short(c.evidence.consentQuote, 500) || !short(c.evidence.safeToTextQuote, 500) || !short(c.evidence.callbackQuote, 500) ||
      !Number.isFinite(Date.parse(c.endedAt)) || !Number.isFinite(Date.parse(c.permission.capturedAt)) ||
      !c.capturedSlots || typeof c.capturedSlots !== "object" || Array.isArray(c.capturedSlots) || Object.keys(c.capturedSlots).length > 20) return null;
  const allowed = new Set(SLOT_REGISTRY.filter(s => !s.id.startsWith("client_")).map(s => s.id));
  if (Object.entries(c.capturedSlots).some(([key, val]) => !allowed.has(key) || !short(val, 500))) return null;
  return c;
}

export function invitationEligible(call: LiveCall, scope: { locationId: string; agentId: string }, now = Date.now()) {
  const plan = planVoiceScreenCall(call, scope);
  return plan.invitationEligible && call.evidence.callId === call.callId &&
    [call.evidence.consentQuote, call.evidence.safeToTextQuote, call.evidence.callbackQuote].every(v => v.trim().length >= 2) &&
    Date.parse(call.endedAt) <= now && now - Date.parse(call.endedAt) < 24 * 60 * 60 * 1000;
}

export { seedContinuationState as seedLiveState, scoreContinuationState as scoreLiveState, continuationView } from "./voice-screen-continuation";

export function tokenForNonce(nonce: string, secret: string) {
  if (secret.length < 32) throw new Error("continuation_key_unconfigured");
  return createHmac("sha256", secret).update(`voice-screen:v1:${nonce}`).digest("base64url");
}
export function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function createContinuation(secret: string) {
  const nonce = randomBytes(32).toString("base64url");
  const token = tokenForNonce(nonce, secret);
  return { nonce, token, hash: hashToken(token) };
}
export function validToken(token: string | null): token is string { return !!token && /^[A-Za-z0-9_-]{43}$/.test(token); }
export function secretMatches(provided: string | null, expected: string | undefined) {
  if (!expected || expected.length < 32 || !provided || provided.length > 512) return false;
  return timingSafeEqual(createHash("sha256").update(provided).digest(), createHash("sha256").update(expected).digest());
}

