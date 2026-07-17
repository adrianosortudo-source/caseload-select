import { lookup as dnsLookup } from "node:dns";
import {
  ipInBlockedRange,
  isSsrfBlocked,
} from "@/app/api/tools/seo-check/engine-core";

/**
 * SSRF protection for the renderer's own network requests. seo-check's
 * SSRF guard (engine-core.ts + the DNS-validating undici agent in
 * route.ts) only covers ONE outbound fetch per hop. A headless browser is
 * different: it issues its own request for every subresource an untrusted
 * page references (images, scripts, stylesheets, iframes, fonts) and
 * follows its own redirects, none of which pass through that agent. Every
 * one of those requests needs the same check, resolved fresh each time
 * (DNS-rebinding-safe), not just a hostname-string comparison.
 *
 * Reuses ipInBlockedRange/isSsrfBlocked from seo-check's engine-core.ts
 * rather than re-deriving the blocked-range table, per the 2026-07-16
 * decision to share crawler/SSRF infrastructure between the two tools.
 */

export interface ResolvedRequestCheck {
  blocked: boolean;
  reason?: "blocked_hostname" | "blocked_ip" | "dns_failed" | "unsupported_protocol";
}

function resolveAll(hostname: string): Promise<string[]> {
  return new Promise((resolve) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err || !addresses) {
        resolve([]);
        return;
      }
      resolve((Array.isArray(addresses) ? addresses : [addresses]).map((a) => a.address));
    });
  });
}

/**
 * Checks a single outbound request URL before letting the browser send it.
 * Blocks on: unsupported protocol, a hostname on the static blocked list
 * (localhost, metadata endpoints), a literal IP in a blocked range, or a
 * hostname that resolves to any blocked IP (the DNS-rebinding case: a
 * hostname that looks public at request-interception time but answers
 * with a private/loopback/link-local address).
 */
export async function checkOutboundRequest(rawUrl: string): Promise<ResolvedRequestCheck> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { blocked: true, reason: "unsupported_protocol" };
  }

  // data:/blob:/about: and similar are same-document, no network request.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { blocked: false };
  }

  const hostname = parsed.hostname;
  if (isSsrfBlocked(hostname)) {
    return { blocked: true, reason: "blocked_hostname" };
  }

  const addresses = await resolveAll(hostname);
  if (addresses.length === 0) {
    // Cannot resolve: refuse rather than let the browser's own resolver
    // (which may see a different answer) decide.
    return { blocked: true, reason: "dns_failed" };
  }
  if (addresses.some((a) => ipInBlockedRange(a))) {
    return { blocked: true, reason: "blocked_ip" };
  }

  return { blocked: false };
}
