import type { AiBotPurpose, AiBotStatus } from "./engine-core";

export type AiBotPolicyDefinition = Omit<AiBotStatus, "blocked" | "policyObservation" | "actualFetchAccess" | "category">;

const REVIEWED_AT = "2026-10-28";
const OPENAI = "https://developers.openai.com/api/docs/bots";
const ANTHROPIC = "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler";
const PERPLEXITY = "https://docs.perplexity.ai/docs/resources/perplexity-crawlers";
const GOOGLE = "https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers#google-extended";
const APPLE = "https://support.apple.com/en-us/119829";
const COMMON_CRAWL = "https://www.commoncrawl.org/ccbot";
const META = "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/";

function policy(
  token: string,
  name: string,
  purposes: AiBotPurpose[],
  isControlToken: boolean,
  robotsSemantics: AiBotStatus["robotsSemantics"],
  sourceUrl: string | null
): AiBotPolicyDefinition {
  return {
    token,
    name,
    purposes,
    isControlToken,
    robotsSemantics,
    sourceUrl,
    reviewedAt: REVIEWED_AT,
    sourceVerification: sourceUrl ? "verified" : "unavailable",
  };
}

/**
 * Provider-specific purposes describe what each policy token is documented
 * for. Robots observations below remain policy only; this list does not test
 * actual fetch access or assert that allowing a token improves search results.
 */
export const AI_CRAWLER_POLICIES: AiBotPolicyDefinition[] = [
  policy("OAI-SearchBot", "OpenAI SearchBot", ["search"], false, "respects", OPENAI),
  policy("GPTBot", "GPTBot", ["training"], false, "respects", OPENAI),
  policy("ChatGPT-User", "ChatGPT-User", ["user-initiated"], false, "may-not-apply", OPENAI),
  policy("Claude-SearchBot", "Claude Search", ["search"], false, "respects", ANTHROPIC),
  policy("ClaudeBot", "ClaudeBot", ["training"], false, "respects", ANTHROPIC),
  policy("Claude-User", "Claude-User", ["user-initiated"], false, "respects", ANTHROPIC),
  policy("PerplexityBot", "PerplexityBot", ["search"], false, "respects", PERPLEXITY),
  policy("Perplexity-User", "Perplexity-User", ["user-initiated"], false, "generally-ignores", PERPLEXITY),
  policy("Google-Extended", "Google-Extended", ["training", "grounding"], true, "controls-specified-uses", GOOGLE),
  policy("Applebot", "Applebot", ["search", "grounding", "training"], false, "respects", APPLE),
  policy("Applebot-Extended", "Applebot-Extended", ["training"], true, "controls-specified-uses", APPLE),
  policy("CCBot", "CCBot", ["open-dataset"], false, "respects", COMMON_CRAWL),
  policy("Meta-ExternalAgent", "Meta-ExternalAgent", ["training", "product-indexing"], false, "respects", META),
  policy("Meta-WebIndexer", "Meta-WebIndexer", ["search"], false, "respects", META),
  policy("Bytespider", "Bytespider", ["unknown"], false, "unknown", null),
];

export function buildAiBotStatuses(isBlocked: (token: string) => boolean | null): AiBotStatus[] {
  return AI_CRAWLER_POLICIES.map((definition) => {
    const blocked = isBlocked(definition.token);
    return {
      ...definition,
      blocked,
      policyObservation: blocked === null
        ? "not-assessed"
        : blocked ? "blocking-rule-observed" : "no-blocking-rule-observed",
      actualFetchAccess: "not-verified",
    };
  });
}

/** Normalize old stored rows without inventing provider sources or purposes. */
export function normalizeLegacyPurposes(
  purposes: AiBotPurpose[] | undefined,
  legacyCategory: AiBotStatus["category"]
): AiBotPurpose[] {
  if (purposes?.length) return purposes;
  if (legacyCategory === "search") return ["search"];
  if (legacyCategory === "training") return ["unknown"];
  if (legacyCategory === "user-initiated") return ["user-initiated"];
  return ["unknown"];
}
