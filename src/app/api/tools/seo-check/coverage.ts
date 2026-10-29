import { createHash } from "node:crypto";
import { crawlUrlKey } from "./engine-core";

export type CoverageStopReason = "page-limit" | "time-budget" | "discovery-exhausted" | "fetch-failure" | "blocked" | "other";

export function resolveCoverageState(input: {
  hitTimeBudget: boolean;
  hitPageLimit: boolean;
  failedPages: number;
  blockedCandidates: boolean;
  attemptedChildPages: number;
  frontierCapSkipped: boolean;
  sitemapIncomplete: boolean;
}): { partial: boolean; stopReason: CoverageStopReason } {
  const partial = input.hitTimeBudget || input.hitPageLimit || input.failedPages > 0 || input.blockedCandidates || input.frontierCapSkipped || input.sitemapIncomplete;
  const stopReason: CoverageStopReason = input.hitTimeBudget
    ? "time-budget"
    : input.hitPageLimit
      ? "page-limit"
      : input.failedPages > 0
        ? "fetch-failure"
        : input.blockedCandidates && input.attemptedChildPages === 0
          ? "blocked"
          : input.frontierCapSkipped || input.sitemapIncomplete
            ? "other"
            : "discovery-exhausted";
  return { partial, stopReason };
}

/** Count URL/page skip reasons only. Non-page events belong in separate fields. */
export function countSkippedPages(skippedReasons: Record<string, number>): number {
  return Object.values(skippedReasons).reduce((total, count) => total + count, 0);
}

/** Hash normalized URL identities, not page contents or response bytes. */
export function hashPageUrlIdentities(urls: string[]): string {
  return createHash("sha256")
    .update(urls.map(crawlUrlKey).sort().join("\n"))
    .digest("hex");
}
