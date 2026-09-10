import { parseLiveCall, type LiveCall } from "./voice-screen-live";

/** Official VoiceAiCallEnd adapter. Input MUST be the byte-exact body of a
 * successfully verified X-GHL-Signature request, never caller-supplied data.
 * https://marketplace.gohighlevel.com/docs/webhook/VoiceAiCallEnd/index.html
 * No contact-history lookup, caller-ID fallback, or nearest-call matching.
 */
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : null;
const text = (v: unknown, max = 2000) => typeof v === "string" ? v.trim().slice(0, max) : "";
const identifier = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const normalize = (v: string) => v.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
const negative = (v: string) => /\b(no|not|never|don't|do not|cannot|can't|unsafe|stop|decline|withdraw)\b/i.test(v);
const affirmative = (v: string) => /^(yes|yeah|yep|sure|okay|ok|absolutely)\b/i.test(v) && !negative(v) &&
  !/\b(but|if|later|tomorrow|after|when|only|maybe|perhaps|wait)\b/i.test(v);

function captureFor(data: Obj): Obj {
  const raw = data["contact.v2s_test_call_capture"] ?? data.v2s_test_call_capture ?? data["8RPkjSKTZveeJg7qMVQr"];
  if (typeof raw === "string" && raw.length <= 16000) {
    try { return obj(JSON.parse(raw)) ?? {}; } catch { return {}; }
  }
  return obj(raw) ?? {};
}

interface Turn { speaker: "caller" | "assistant"; content: string }
function turnsFor(transcript: string): Turn[] {
  // Unknown or unlabelled transcript formats cannot establish affirmative proof.
  const turns: Turn[] = [];
  for (const line of transcript.split(/\r?\n/)) {
    const match = /^\s*(human|caller|user|assistant|bot|agent)\s*:\s*(.*)$/i.exec(line);
    if (match) turns.push({ speaker: /^(human|caller|user)$/i.test(match[1]) ? "caller" : "assistant", content: match[2].trim() });
    // Deliberately do not append unlabelled lines; attribution is not established.
  }
  return turns;
}

function proofFor(turns: Turn[], kind: "consent" | "safe") {
  let result: "yes" | "no" | "unknown" = "unknown";
  let quote = "";
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index];
    if (turn.speaker !== "caller") continue;
    const body = normalize(turn.content);
    const previous = index > 0 && turns[index - 1].speaker === "assistant" ? normalize(turns[index - 1].content) : "";
    const question = kind === "consent"
      ? /\b(may|can|permission|okay|ok)\b/.test(previous) && /\b(text|sms)\b/.test(previous) && /\blink\b/.test(previous) && !/\b(marketing|newsletter|promotion)\b/.test(previous)
      : /\bsafe\b/.test(previous) && /\b(text|sms)\b/.test(previous);
    const explicit = kind === "consent"
      ? /\b(text|sms|send)\b/.test(body) && /\blink\b/.test(body) && !/\b(marketing|newsletter|promotion)\b/.test(body)
      : /\bsafe\b/.test(body) && /\b(text|sms)\b/.test(body);
    const withdrawal = /\b(stop|don't|do not|never|no)\b.*\b(text|sms|send|link)\b/.test(body);
    if (/\bchanged my mind\b/.test(body)) { result = "unknown"; quote = ""; }
    else if ((question || explicit || withdrawal) && negative(body)) { result = "no"; quote = turn.content; }
    else if (!/\b(marketing|newsletter|promotion)\b/.test(body) &&
      ((question && affirmative(body)) || (explicit && affirmative(body)))) { result = "yes"; quote = turn.content; }
    else if (question) { result = "unknown"; quote = ""; }
  }
  return { value: result, quote: quote.slice(0, 500) };
}

/** The signed native event must carry the exact configured location identity.
 * createdAt + duration is an approximate end bound; not an exact hangup or
 * consent timestamp. Timestamp provenance is returned and must be persisted.
 */
export function parseProviderCall(value: unknown, expectedLocationId: string): LiveCall | null {
  const raw = obj(value);
  if (!raw || !identifier(expectedLocationId) || !identifier(raw.id) || !identifier(raw.agentId) || !identifier(raw.contactId)) return null;
  if (raw.locationId !== expectedLocationId) return null;
  const created = typeof raw.createdAt === "string" ? Date.parse(raw.createdAt) : NaN;
  if (!Number.isFinite(created) || typeof raw.duration !== "number" || !Number.isFinite(raw.duration) || raw.duration < 0 || raw.duration > 86400) return null;
  const ended = created + raw.duration * 1000;
  if (!Number.isFinite(ended) || ended > 8640000000000000 || ended < -8640000000000000) return null;
  const endedAt = new Date(ended).toISOString();
  const extracted = captureFor(obj(raw.extractedData) ?? {});
  // Do not silently cut off a long transcript: its tail could revoke consent.
  const transcript = typeof raw.transcript === "string" && raw.transcript.length <= 200000 ? raw.transcript : "";
  const turns = turnsFor(transcript);
  const consent = proofFor(turns, "consent");
  const safe = proofFor(turns, "safe");
  const callback = text(extracted.callbackPhone, 30);
  const callbackDigits = callback.replace(/\D/g, "");
  const callbackTurn = /^\+[1-9]\d{7,14}$/.test(callback)
    ? turns.find(t => t.speaker === "caller" && !negative(t.content) && t.content.replace(/\D/g, "") === callbackDigits)
    : undefined;
  // Extraction flags alone never prove consent, safety or ownership of a number.
  const callerType = ["new", "existing", "other"].includes(text(extracted.callerType)) ? text(extracted.callerType) as LiveCall["callerType"] : "unknown";
  const urgency = ["urgent", "routine"].includes(text(extracted.urgency)) ? text(extracted.urgency) as LiveCall["urgency"] : "unknown";
  const explicitHumanRequest = turns.some(t => t.speaker === "caller" && /\b(human|real person|someone from the team)\b/i.test(t.content) && !negative(t.content));
  const suppliedNeed = text(extracted.broadNeed) || text(raw.summary);
  const hasReason = suppliedNeed.length >= 10;
  const humanRequested = explicitHumanRequest || extracted.humanRequested !== "no" || !hasReason;
  const broadNeed = hasReason ? suppliedNeed : "Reason for calling was not captured. Human review is required.";
  const call: LiveCall = {
    callId: raw.id, locationId: expectedLocationId, agentId: raw.agentId, contactId: raw.contactId,
    endedAt, endedAtSource: "provider_created_plus_duration", permissionCapturedAtSource: "call_end_bound",
    callerType, urgency, humanRequested,
    callerName: text(extracted.callerName, 120), broadNeed, deadline: text(extracted.deadline, 300),
    callback: { number: /^\+[1-9]\d{7,14}$/.test(callback) ? callback : "", verifiedOnCallId: callbackTurn ? raw.id : "unverified" },
    permission: { value: consent.value === "yes" ? "granted" : consent.value === "no" ? "declined" : "unknown", callId: raw.id, capturedAt: endedAt },
    safeToText: { value: safe.value, callId: raw.id },
    evidence: { callId: raw.id, consentQuote: consent.quote, safeToTextQuote: safe.quote, callbackQuote: callbackTurn?.content.slice(0, 500) ?? "" },
    // Captured slots are not provider-defined and require their own attribution.
    capturedSlots: {},
  };
  return parseLiveCall(call);
}
