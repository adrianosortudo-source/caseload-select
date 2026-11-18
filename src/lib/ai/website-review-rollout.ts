import "server-only";
import { getProvider, type AiProvider } from "./openai";
import { cohortProvider } from "./public-tool-rollout";

type WebsiteReview = "WEBSITE_DESIGN_CHECK" | "POSITIONING_CHECK";

/** Stable, independently salted cohorts use the same identity as each tool's rate limiter. */
export function websiteReviewProvider(feature: WebsiteReview, identity?: string): AiProvider {
  if (getProvider(feature + "_PROVIDER") !== "openai") return "gemini";
  const percent = process.env[feature + "_OPENAI_PERCENT"] ?? "100";
  return cohortProvider(feature, percent, identity);
}
