import { describe, expect, it } from "vitest";
import { AI_CRAWLER_POLICIES, buildAiBotStatuses, normalizeLegacyPurposes } from "../crawler-policy";

describe("provider-specific crawler policy registry", () => {
  const byToken = new Map(AI_CRAWLER_POLICIES.map((entry) => [entry.token, entry]));

  it("keeps provider purposes separate and marks control tokens explicitly", () => {
    expect(byToken.get("Google-Extended")).toMatchObject({ purposes: ["training", "grounding"], isControlToken: true });
    expect(byToken.get("Applebot-Extended")).toMatchObject({ purposes: ["training"], isControlToken: true });
    expect(byToken.get("Applebot")?.purposes).toEqual(["search", "grounding", "training"]);
    expect(byToken.get("CCBot")?.purposes).toEqual(["open-dataset"]);
    expect(byToken.get("Meta-ExternalAgent")?.purposes).toEqual(["training", "product-indexing"]);
    expect(byToken.get('ChatGPT-User')?.robotsSemantics).toBe('may-not-apply');
    expect(byToken.get('Perplexity-User')?.robotsSemantics).toBe('generally-ignores');
    expect(byToken.get('Google-Extended')?.robotsSemantics).toBe('controls-specified-uses');
    expect(byToken.get('Applebot-Extended')?.robotsSemantics).toBe('controls-specified-uses');
    expect(byToken.get('GPTBot')?.robotsSemantics).toBe('respects');
  });

  it("does not assign an unsupported purpose or verified source to Bytespider", () => {
    expect(byToken.get("Bytespider")).toMatchObject({ purposes: ["unknown"], sourceUrl: null, sourceVerification: "unavailable" });
  });

  it("records robots policy separately from unverified actual fetching", () => {
    const statuses = buildAiBotStatuses((token) => token === "GPTBot" ? true : token === "Bytespider" ? null : false);
    expect(statuses.find((bot) => bot.token === "GPTBot")).toMatchObject({
      policyObservation: "blocking-rule-observed", blocked: true, actualFetchAccess: "not-verified",
    });
    expect(statuses.find((bot) => bot.token === "OAI-SearchBot")).toMatchObject({
      policyObservation: "no-blocking-rule-observed", blocked: false, actualFetchAccess: "not-verified",
    });
    expect(statuses.find((bot) => bot.token === "Bytespider")).toMatchObject({
      policyObservation: "not-assessed", blocked: null, actualFetchAccess: "not-verified",
    });
    expect(statuses.every((bot) => !("category" in bot))).toBe(true);
  });

  it("normalizes legacy categories conservatively", () => {
    expect(normalizeLegacyPurposes(undefined, "search")).toEqual(["search"]);
    expect(normalizeLegacyPurposes(undefined, "user-initiated")).toEqual(["user-initiated"]);
    expect(normalizeLegacyPurposes(undefined, "training")).toEqual(["unknown"]);
    expect(normalizeLegacyPurposes(undefined, undefined)).toEqual(["unknown"]);
  });
});
