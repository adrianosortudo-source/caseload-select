import { createHash } from "node:crypto";
import { crawlUrlKey } from "./engine-core";

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
