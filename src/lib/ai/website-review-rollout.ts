import "server-only";
import { createHash } from "node:crypto";
import { getProvider, type AiProvider } from "./openai";

type WebsiteReview = "WEBSITE_DESIGN_CHECK" | "POSITIONING_CHECK";

/** Stable, independently salted cohorts use the same identity as each tool's rate limiter. */
export function websiteReviewProvider(feature: WebsiteReview, identity?: string): AiProvider {
  if (getProvider(feature + "_PROVIDER") !== "openai") return "gemini";
  const percent = process.env[feature + "_OPENAI_PERCENT"] ?? "100";
  if (percent === "100") return "openai";
  if (!/^[1-9]\d?$/.test(percent) || !identity || identity === "unknown") return "gemini";
  const bucket = createHash("sha256").update(feature + ":" + identity).digest().readUInt32BE(0) % 100;
  return bucket < Number(percent) ? "openai" : "gemini";
}
