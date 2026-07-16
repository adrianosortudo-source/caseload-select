/**
 * Pure, network-free SSRF (server-side request forgery) range classification,
 * shared by every outbound fetch this app makes to a URL an operator or a
 * receipt supplied, not one this codebase controls: publication-receipt
 * verification (ssrf-fetch.ts, used by channel-validation.ts) and the SEO
 * check crawler (app/api/tools/seo-check/engine-core.ts, which re-exports
 * these three from here so the two callers never carry two
 * independently-drifting blocklists).
 *
 * No `server-only` import: this file only classifies strings (node:net's
 * isIP does no I/O), matching engine-core.ts's own "pure, network-free"
 * convention so it can be re-exported there without pulling a server-only
 * guard into that file's test-import graph.
 */

import { isIP } from "node:net";

export const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "169.254.169.254",
]);

/**
 * Returns true when an IP literal falls in a private, reserved, loopback,
 * link-local, CGNAT, deprecated site-local, or multicast range. Used both as
 * a fast literal check and inside the DNS-validating lookup hook in
 * ssrf-fetch.ts.
 */
export function ipInBlockedRange(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const o = ip.split(".").map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b, c] = o;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local (includes cloud metadata 169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments
    if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET-1
    if (a === 192 && b === 88 && c === 99) return true; // 192.88.99.0/24 6to4 relay anycast
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
    if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (kind === 6) {
    let v = ip.toLowerCase();
    const zone = v.indexOf("%");
    if (zone >= 0) v = v.slice(0, zone);
    if (v === "::1" || v === "::") return true; // loopback / unspecified
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
    if (mapped) return ipInBlockedRange(mapped[1]);
    // NAT64 well-known prefix 64:ff9b::/96 embeds an IPv4 in the low 32 bits.
    // 64:ff9b::a9fe:a9fe and 64:ff9b::169.254.169.254 both mean 169.254.169.254,
    // so a private/metadata IPv4 can be smuggled past the v6 range checks.
    if (v.startsWith("64:ff9b::") || v.startsWith("64:ff9b:0:0:0:0:")) {
      const dotted = v.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
      if (dotted) return ipInBlockedRange(dotted[1]);
      const parts = v.split(":");
      const last = parts[parts.length - 1];
      const prev = parts[parts.length - 2];
      const h2 = parseInt(last, 16);
      const h1 = parseInt(prev, 16);
      if (last && prev && Number.isFinite(h1) && Number.isFinite(h2)) {
        return ipInBlockedRange(`${(h1 >> 8) & 255}.${h1 & 255}.${(h2 >> 8) & 255}.${h2 & 255}`);
      }
      return true; // unparseable NAT64 embedding: refuse
    }
    // 6to4 2002::/16 embeds an IPv4 in the 32 bits immediately after the
    // prefix (2002:AABB:CCDD::/48 encodes AA.BB.CC.DD), the same
    // encode-a-private-IPv4-as-IPv6 shape as the NAT64/mapped forms above.
    if (v.startsWith("2002:")) {
      const parts = v.split(":");
      const h1 = parseInt(parts[1] || "", 16);
      const h2 = parseInt(parts[2] || "", 16);
      if (Number.isFinite(h1) && Number.isFinite(h2)) {
        return ipInBlockedRange(`${(h1 >> 8) & 255}.${h1 & 255}.${(h2 >> 8) & 255}.${h2 & 255}`);
      }
      return true; // unparseable 6to4 embedding: refuse
    }
    // Teredo tunneling 2001:0000::/32 is IPv4-in-IPv6 encapsulation
    // infrastructure, never a legitimate direct fetch destination; block
    // the whole prefix rather than decode its obfuscated embedded address.
    // Matches both the RFC5952-canonical isolated-zero form ("2001:0:...",
    // the shape a real Teredo address takes since its Server-IPv4 group
    // right after the fixed "0" group is essentially never itself zero)
    // and any further "::"-compressed form of the same /32 prefix.
    if (v.startsWith("2001:0:") || v.startsWith("2001::")) return true;
    const firstHex = v.startsWith("::") ? 0 : parseInt(v.split(":")[0] || "0", 16);
    if (Number.isNaN(firstHex)) return true; // malformed: refuse
    if (firstHex >= 0xfe80 && firstHex <= 0xfebf) return true; // link-local fe80::/10
    if (firstHex >= 0xfec0 && firstHex <= 0xfeff) return true; // deprecated site-local fec0::/10
    if (firstHex >= 0xfc00 && firstHex <= 0xfdff) return true; // unique-local fc00::/7
    if (firstHex >= 0xff00) return true; // multicast ff00::/8
    return false;
  }
  return true; // not a valid IP: refuse
}

export function isSsrfBlocked(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (isIP(h) !== 0) return ipInBlockedRange(h);
  return false;
}

export interface OutboundUrlCheck {
  ok: boolean;
  reason: string | null;
}

/**
 * Validates a URL BEFORE any fetch is attempted: scheme, embedded
 * credentials, and hostname. Every redirect target must pass this same
 * check before being followed -- never fetch-then-reject.
 */
export function validateOutboundUrl(url: URL, opts?: { allowedSchemes?: string[] }): OutboundUrlCheck {
  const allowedSchemes = opts?.allowedSchemes ?? ["https:"];
  if (!allowedSchemes.includes(url.protocol)) {
    return { ok: false, reason: `unsupported protocol "${url.protocol}"` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "url carries embedded credentials (user:pass@host), refused" };
  }
  if (isSsrfBlocked(url.hostname)) {
    return { ok: false, reason: `hostname "${url.hostname}" is blocked` };
  }
  return { ok: true, reason: null };
}
