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
 * Expands a validated IPv6 literal into its 8 numeric hextets, resolving the
 * "::" zero run and any trailing dotted quad (::ffff:127.0.0.1). Returns null
 * on anything it cannot parse, so callers can refuse rather than guess.
 *
 * Text matching alone is not safe for IPv6: the same address has many legal
 * spellings, and WHATWG `new URL()` re-serializes to its own canonical form.
 * Comparing numbers, not strings, is what makes the range checks total.
 */
function ipv6ToHextets(v: string): number[] | null {
  let s = v;
  // A trailing dotted quad occupies the final two hextets.
  const dotted = s.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) {
    const o = dotted[1].split(".").map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const h1 = ((o[0] << 8) | o[1]).toString(16);
    const h2 = ((o[2] << 8) | o[3]).toString(16);
    s = s.slice(0, s.length - dotted[1].length) + `${h1}:${h2}`;
  }
  const dbl = s.indexOf("::");
  let head: string[];
  let tail: string[];
  if (dbl >= 0) {
    const before = s.slice(0, dbl);
    const after = s.slice(dbl + 2);
    head = before ? before.split(":") : [];
    tail = after ? after.split(":") : [];
  } else {
    head = s.split(":");
    tail = [];
  }
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  if (dbl < 0 && fill !== 0) return null; // uncompressed form must be exactly 8 groups
  const groups = [...head, ...Array(fill).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out = groups.map((g) => (g === "" ? NaN : parseInt(g, 16)));
  if (out.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
  return out;
}

/**
 * Returns the embedded IPv4 (dotted) when an IPv6 address carries one in its
 * low 32 bits, else null. Covers all three ::-prefixed embeddings:
 *   ::a.b.c.d          IPv4-compatible, ::/96 (deprecated)
 *   ::ffff:a.b.c.d     IPv4-mapped, ::ffff:0:0/96
 *   ::ffff:0:a.b.c.d   IPv4-translated, ::ffff:0:0:0/96 (RFC 2765)
 *
 * All three are reachable as URL hostnames and all three decode to a real
 * IPv4 destination, so each must be range-checked as that IPv4. The mapped
 * form is the one that matters most in practice: `new URL()` normalizes
 * "[::ffff:127.0.0.1]" to "[::ffff:7f00:1]", so a dotted-only text match
 * never fires on a URL-derived hostname and the address reads as unblocked.
 */
function embeddedIpv4(h: number[]): string | null {
  const zeroHigh = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0;
  if (!zeroHigh) return null;
  const compatible = h[4] === 0 && h[5] === 0;
  const mapped = h[4] === 0 && h[5] === 0xffff;
  const translated = h[4] === 0xffff && h[5] === 0;
  if (!compatible && !mapped && !translated) return null;
  return `${(h[6] >> 8) & 255}.${h[6] & 255}.${(h[7] >> 8) & 255}.${h[7] & 255}`;
}

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
    // Decode any IPv4 embedded in the low 32 bits (compatible / mapped /
    // translated) and range-check it as that IPv4. Numeric, so it holds for
    // every legal spelling including the hex form new URL() produces.
    const hextets = ipv6ToHextets(v);
    if (!hextets) return true; // unparseable: refuse
    const embedded = embeddedIpv4(hextets);
    if (embedded) return ipInBlockedRange(embedded);
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
