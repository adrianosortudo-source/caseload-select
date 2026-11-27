import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getProvider, hasOpenAIKey } from "./openai";
import { transcriptionConsentVersion } from "./transcription-consent";

const ttlMs = 30 * 60 * 1000;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

function signingKeyFor(firmId: string): string | undefined {
  if (!uuid.test(firmId) || getProvider("SCREEN_TRANSCRIPTION_AI_PROVIDER") !== "openai" || !hasOpenAIKey()) return;
  const enrolled = (process.env.SCREEN_TRANSCRIPTION_OPENAI_FIRM_IDS ?? "").split(",").some(id => id.trim() === firmId);
  const secret = process.env.SCREEN_TRANSCRIPTION_SIGNING_SECRET?.trim();
  return enrolled && secret && Buffer.byteLength(secret) >= 32 ? secret : undefined;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(transcriptionConsentVersion + ":" + payload).digest("base64url");
}

/** Minted only by the server-rendered firm widget, after resolving its database row. */
export function offerWidgetTranscription(firmId: string, now = Date.now()): string | undefined {
  const key = signingKeyFor(firmId);
  if (!key) return;
  const payload = firmId + "." + (now + ttlMs);
  return payload + "." + sign(payload, key);
}

export function validTranscriptionOffer(token: string | null, now = Date.now()): boolean {
  if (!token || token.length > 160) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [firmId, expiry, signature] = parts;
  const expires = Number(expiry);
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + ttlMs) return false;
  const key = signingKeyFor(firmId);
  if (!key) return false;
  const expected = Buffer.from(sign(firmId + "." + expiry, key));
  const supplied = Buffer.from(signature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
