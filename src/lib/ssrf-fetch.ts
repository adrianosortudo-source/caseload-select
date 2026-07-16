/**
 * SSRF-safe outbound fetch. Every hop (the initial URL and every redirect
 * target) is validated by validateOutboundUrl BEFORE it is requested --
 * never fetch-then-reject -- and the DNS lookup itself is pinned to
 * addresses that pass ipInBlockedRange, closing the rebinding gap where a
 * hostname resolves to a public IP at validation time and a private one at
 * connect time. Generalizes the SEO check tool's own safeFetch
 * (app/api/tools/seo-check/route.ts) into a reusable helper; that route
 * keeps its own copy untouched (out of this change's scope) but both now
 * share the same range classification via ssrf.ts.
 */

import "server-only";
import { lookup as dnsLookup } from "node:dns";
import { Agent } from "undici";
import { ipInBlockedRange, validateOutboundUrl } from "@/lib/ssrf";

interface DnsAddr {
  address: string;
  family: number;
}
type LookupOptions = { all?: boolean };
type LookupCb = (
  err: NodeJS.ErrnoException | null,
  address: string | DnsAddr[],
  family?: number,
) => void;

function validatingDnsLookup(hostname: string, options: LookupOptions, callback: LookupCb): void {
  const wantsAll = !!(options && options.all);
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) {
      callback(err, wantsAll ? [] : "", 0);
      return;
    }
    const list: DnsAddr[] = Array.isArray(addresses) ? addresses : [];
    if (list.length === 0) {
      callback(new Error("ssrf_no_address"), wantsAll ? [] : "", 0);
      return;
    }
    for (const a of list) {
      if (ipInBlockedRange(a.address)) {
        callback(Object.assign(new Error("ssrf_blocked_ip"), { code: "ESSRFBLOCKED" }), wantsAll ? [] : "", 0);
        return;
      }
    }
    if (wantsAll) callback(null, list);
    else callback(null, list[0].address, list[0].family);
  });
}

let sharedAgent: Agent | null = null;
function getSharedAgent(): Agent {
  if (!sharedAgent) {
    sharedAgent = new Agent({
      connect: { lookup: validatingDnsLookup, timeout: 8000 },
      headersTimeout: 15000,
      bodyTimeout: 15000,
    });
  }
  return sharedAgent;
}

export interface SsrfSafeFetchResult {
  res: Response;
  finalUrl: string;
}

/**
 * Fetches a URL with the initial URL and every redirect target validated
 * before it is requested. Redirects are followed manually, up to
 * maxRedirects, so a target that fails validation is refused before any
 * request reaches it. Host-authenticity checks (is this the firm's own
 * domain) are a separate, caller-side concern applied to the returned
 * finalUrl; an ordinary redirect hop (a tracking or CDN edge before landing
 * on the real domain) is not itself an SSRF problem once validated.
 */
export async function ssrfSafeFetch(
  startUrl: string,
  opts: { method?: string; timeoutMs: number; maxRedirects?: number; allowedSchemes?: string[] },
): Promise<SsrfSafeFetchResult> {
  const maxRedirects = opts.maxRedirects ?? 5;
  const agent = getSharedAgent();
  let currentUrl = startUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = new URL(currentUrl);
    const check = validateOutboundUrl(parsed, { allowedSchemes: opts.allowedSchemes });
    if (!check.ok) throw new Error(check.reason ?? "url rejected");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method: opts.method ?? "GET",
        signal: controller.signal,
        redirect: "manual",
        dispatcher: agent,
      } as RequestInit & { dispatcher: Agent });
    } catch (e) {
      const code = (e as { cause?: { code?: string } })?.cause?.code;
      if (code === "ESSRFBLOCKED") throw new Error("hostname resolved to a blocked address");
      throw e;
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      if (hop === maxRedirects) throw new Error("too many redirects");
      const location = res.headers.get("location");
      if (!location) throw new Error("redirect response carried no location header");
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }
    return { res, finalUrl: currentUrl };
  }
  throw new Error("too many redirects");
}
