/**
 * SSRF-safe outbound fetch wrapper — Jim Manico audit APP-003.
 *
 * The platform makes outbound HTTP calls to operator-controlled URLs in
 * two places:
 *   - postToWebhookUrl(firm.ghl_webhook_url, ...)  - per-firm GHL webhook
 *   - firm.custom_domain admin paths              - resolves through Vercel
 *
 * Without IP-range filtering, an attacker who can write intake_firms (e.g.
 * via the unauthenticated admin routes we closed in APP-001/APP-002, or
 * any future write path that lacks input validation) can point the
 * webhook at a cloud-metadata service (169.254.169.254/...) or an internal
 * 10.x.x.x address and exfiltrate lead PII over the wire.
 *
 * What this wrapper enforces:
 *
 *   1. Scheme allow-list: http and https only. file:, gopher:, ftp:,
 *      dict:, ldap: — all blocked.
 *   2. IP-range filter: rejects RFC 1918 + 169.254/16 + 127/8 + ::1 +
 *      fc00::/7 + fe80::/10 + ::ffff:0:0/96 (v4-mapped private space).
 *   3. Bounded timeout via AbortController.
 *
 * What this wrapper does NOT enforce (documented limitations):
 *
 *   - DNS rebinding. Between our dns.lookup() and the underlying fetch()
 *     making the connection, an attacker-controlled DNS server can
 *     return a different IP. Mitigation requires pinning the resolved
 *     IP via a custom undici dispatcher; that's a follow-up. The cost
 *     of DNS rebinding here is bounded by the timeout and the lack of
 *     credentials on the outbound request (no Authorization header,
 *     no cookies). Worth fixing eventually but not the critical hop.
 *
 *   - HTTP redirects to private IPs. fetch() follows 30x by default; a
 *     legit-looking public host could redirect to a private one. We set
 *     redirect: "manual" so the caller decides whether to follow.
 *
 *   - DNS resolution is async and adds ~5-50ms per call. Acceptable for
 *     the webhook path; would be too slow for high-RPS request handling.
 */

import "server-only";
import { lookup } from "dns/promises";

// IPv4 private + reserved ranges (RFC 1918, link-local, loopback,
// CGNAT, multicast). Matches against the dotted-decimal resolved IP.
const V4_BLOCKED: RegExp[] = [
  /^10\./,                          // 10.0.0.0/8
  /^127\./,                         // 127.0.0.0/8 (loopback)
  /^169\.254\./,                    // 169.254.0.0/16 (link-local + AWS metadata)
  /^172\.(1[6-9]|2\d|3[01])\./,     // 172.16.0.0/12
  /^192\.168\./,                    // 192.168.0.0/16
  /^192\.0\.0\./,                   // 192.0.0.0/24 (IETF reserved)
  /^192\.0\.2\./,                   // 192.0.2.0/24 (TEST-NET-1)
  /^198\.51\.100\./,                // 198.51.100.0/24 (TEST-NET-2)
  /^203\.0\.113\./,                 // 203.0.113.0/24 (TEST-NET-3)
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 (CGNAT)
  /^22[4-9]\./,                     // 224.0.0.0/4 (multicast)
  /^2[3-5]\d\./,                    // 240.0.0.0/4 (reserved future)
  /^0\./,                           // 0.0.0.0/8 (this network)
];

// IPv6 private + reserved prefixes (case-insensitive, normalized to lowercase).
const V6_BLOCKED_PREFIXES: string[] = [
  "::1",        // loopback
  "fc",         // fc00::/7 (unique local addresses, both fc and fd start)
  "fd",
  "fe80:",      // fe80::/10 (link-local)
  "::ffff:",    // IPv4-mapped — caller could embed a private v4 here
  "::",         // unspecified
];

export interface SafeFetchResult {
  ok: boolean;
  status: number | null;
  body: string | null;
  reason: string | null;
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Follow redirects? Default: "manual" (caller decides). */
  redirect?: "manual" | "follow" | "error";
}

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Returns the family of an IP string ('v4' | 'v6') and whether it's in a
 * blocked range. Caller treats blocked === true as a hard reject.
 */
function isPrivateIp(ip: string, family: 4 | 6): boolean {
  if (family === 4) {
    return V4_BLOCKED.some((re) => re.test(ip));
  }
  const lower = ip.toLowerCase();
  if (V6_BLOCKED_PREFIXES.includes(lower)) return true;
  for (const prefix of V6_BLOCKED_PREFIXES) {
    if (lower.startsWith(prefix)) {
      // Special case: ::ffff:1.2.3.4 — v4-mapped v6, check the v4 part too.
      if (prefix === "::ffff:") {
        const v4 = lower.slice(prefix.length);
        if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
          return V4_BLOCKED.some((re) => re.test(v4));
        }
        return true;
      }
      return true;
    }
  }
  return false;
}

/**
 * Performs an outbound HTTP request with SSRF protections.
 * Never throws on validation failure; returns a typed result instead.
 *
 * Caller responsibility: the caller still has to treat the result.ok
 * as a soft signal. A returned ok=true means the HTTP exchange happened
 * and the response status was 2xx. ok=false means either the request
 * was blocked pre-flight (private IP, bad scheme) or the response was
 * non-2xx or the fetch threw.
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  // Parse URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, status: null, body: null, reason: "malformed url" };
  }

  // Scheme allow-list
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, status: null, body: null, reason: `scheme ${parsed.protocol} not allowed` };
  }

  // Resolve hostname → IP, then block private ranges.
  // If hostname IS an IP literal (e.g. http://192.168.1.1/), the lookup
  // returns it unchanged. Either way the same range check applies.
  let address: string;
  let family: 4 | 6;
  try {
    const result = await lookup(parsed.hostname);
    address = result.address;
    family = result.family === 6 ? 6 : 4;
  } catch (err) {
    return {
      ok: false,
      status: null,
      body: null,
      reason: `dns lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (isPrivateIp(address, family)) {
    return {
      ok: false,
      status: null,
      body: null,
      reason: `host ${parsed.hostname} resolves to private IP ${address}`,
    };
  }

  // Execute the fetch with timeout.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: options.method ?? "POST",
      headers: options.headers ?? {},
      body: options.body,
      signal: controller.signal,
      redirect: options.redirect ?? "manual",
    });
    clearTimeout(timeout);

    let body: string | null = null;
    try {
      body = await res.text();
    } catch {
      // body unavailable; non-fatal
    }

    return {
      ok: res.ok,
      status: res.status,
      body,
      reason: res.ok ? null : `http ${res.status}`,
    };
  } catch (err) {
    clearTimeout(timeout);
    return {
      ok: false,
      status: null,
      body: null,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Export for tests — the IP classification helper is pure and useful to
 * exercise directly with table-driven cases.
 */
export { isPrivateIp };
