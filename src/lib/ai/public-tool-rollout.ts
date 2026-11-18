import "server-only";
import { createHash, createHmac } from "node:crypto";
import { getProvider, type AiProvider } from "./openai";
import { publicToolPilotEnabled } from "./public-tool-pilot-budget";

export function publicToolProvider(providerSetting: string, percentSetting: string, identity?: string): AiProvider {
  if (getProvider(providerSetting) !== "openai" || !publicToolPilotEnabled()) return "gemini";
  const guarded = process.env.VERCEL_ENV === "production" || process.env.CASELOAD_OPENAI_PILOT_BUDGET === "true";
  const percent = process.env[percentSetting] ?? (guarded ? "0" : "100");
  // Visitors may clear cookies and start a new browser session. A keyed bucket
  // keeps the percentage opaque to callers supplying their own cookie values.
  const secret = process.env.CASELOAD_OPENAI_API_KEY?.trim();
  const session = secret && identity && identity !== "unknown"
    ? createHmac("sha256", secret).update("public-pilot:" + identity).digest("hex") : undefined;
  return cohortProvider(providerSetting, percent, session);
}

export function cohortProvider(salt: string, percent: string, identity?: string): AiProvider {
  if (percent === "100") return "openai";
  if (!/^[1-9]\d?$/.test(percent) || !identity || identity === "unknown") return "gemini";
  const bucket = createHash("sha256").update(salt + ":" + identity).digest().readUInt32BE(0) % 100;
  return bucket < Number(percent) ? "openai" : "gemini";
}
