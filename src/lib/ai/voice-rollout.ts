import "server-only";
import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { getProvider, type AiProvider } from "./openai";
import { publicPilotGrantExpired } from "./public-tool-pilot-budget";

function openAIKey(): string | undefined {
  if (getProvider("FIRM_VOICE_BUILDER_PROVIDER") !== "openai" || publicPilotGrantExpired()) return;
  return process.env.CASELOAD_OPENAI_API_KEY?.trim() || undefined;
}

function percentage(): number {
  const value = process.env.FIRM_VOICE_BUILDER_OPENAI_PERCENT ?? "100";
  return /^(?:100|[1-9]?\d)$/.test(value) ? Number(value) : 0;
}

function sign(key: string, id: string): string {
  return createHmac("sha256", key).update("firm-voice:" + id).digest("hex");
}

export function newVoiceAssignment() {
  const key = openAIKey();
  const enabled = !!key && percentage() > 0;
  const generation = enabled ? sign(key!, "generation").slice(0, 12) : "";
  if (!key || !enabled || randomInt(100) >= percentage()) {
    return { provider: "gemini" as AiProvider, token: "", generation };
  }
  const id = randomUUID();
  return { provider: "openai" as AiProvider, token: id + "." + sign(key, id), generation };
}

/** Existing Gemini sessions finish on Gemini. Disabling GPT invalidates every GPT assignment. */
export function voiceTurnProvider(headers: Headers): AiProvider | null {
  const claimed = headers.get("X-CaseLoad-AI-Provider") ?? "gemini";
  if (claimed === "gemini") return "gemini";
  const key = openAIKey();
  if (claimed !== "openai" || !key || percentage() === 0) return null;
  const token = headers.get("X-CaseLoad-Voice-Assignment") ?? "";
  const parts = /^([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(token);
  if (!parts || !timingSafeEqual(Buffer.from(parts[2]), Buffer.from(sign(key, parts[1])))) return null;
  return "openai";
}
