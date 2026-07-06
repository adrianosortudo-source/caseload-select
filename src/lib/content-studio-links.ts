// Pure helpers for internal_link_targets domain handling (Ses.17 WP-3, SEO/AEO
// spec Section 8). Shared by content-validators.ts (the post-hoc
// validateInternalLinkDomains check) and both draft routes (filtering a
// non-firm-host link out of the prompt before the model ever sees it, so a
// bad link is excluded rather than merely flagged after the fact). No I/O.

export interface InternalLinkTarget {
  url: string;
  anchor_text_hint?: string;
  relation?: string;
}

export function extractHost(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Splits internal_link_targets into those that resolve to the firm's own
 * website host and those that do not. firmWebsiteUrl is the raw
 * strategy_json.canonical_nap.website value (e.g. "https://drglaw.ca").
 * When the firm has no website on file, nothing is excluded: there is
 * nothing to filter against, matching validateInternalLinkDomains's own
 * no-op-when-missing behavior so the two never disagree.
 */
export function filterInternalLinkTargetsToFirmHost(
  targets: InternalLinkTarget[] | undefined,
  firmWebsiteUrl: string | undefined
): { allowed: InternalLinkTarget[]; excluded: string[] } {
  const firmHost = extractHost(firmWebsiteUrl);
  if (!targets || targets.length === 0 || !firmHost) {
    return { allowed: targets ?? [], excluded: [] };
  }
  const allowed: InternalLinkTarget[] = [];
  const excluded: string[] = [];
  for (const t of targets) {
    const host = extractHost(t.url);
    if (host === firmHost) allowed.push(t);
    else excluded.push(t.url);
  }
  return { allowed, excluded };
}
