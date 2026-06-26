import type { NextConfig } from "next";

const scriptSrc = process.env.NODE_ENV === "production"
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

/**
 * Security headers — Jim Manico audit (2026-05-14) APP-004.
 *
 * The triage portal at /portal/[firmId]/triage/[leadId] renders
 * brief_html via dangerouslySetInnerHTML. The regex-based sanitizer at
 * src/lib/intake-v2-security.ts is the only line of defense without
 * these headers. CSP is the browser-level fallback.
 *
 * Two header sets:
 *
 * 1. Main app (everything except /widget/*) — strict frame-ancestors
 *    'none' so attacker pages can't iframe the lawyer portal or admin
 *    console for clickjacking.
 *
 * 2. /widget/* — same CSP, but frame-ancestors *. The widget is
 *    intentionally embeddable as an iframe on firm websites; per-firm
 *    allow-listing is a follow-up (would need a request-time middleware
 *    decision based on intake_firms.allowed_embed_origins).
 *
 * CSP design notes:
 * - script-src 'self' 'unsafe-inline' — Next.js 16 with React Server
 *   Components ships inline scripts for hydration. 'unsafe-inline' is
 *   the friction we accept for now. The proper fix (nonce-based CSP via
 *   middleware) is a follow-up.
 * - style-src 'self' 'unsafe-inline' — Tailwind CSS works without
 *   inline styles, but Next.js's compiled CSS bundle uses some inline
 *   <style> tags for critical-path. 'unsafe-inline' is required here.
 * - img-src 'self' data: https: — allows data: URIs (icons in the brief
 *   renderer) and any HTTPS image source (firm logos, lawyer avatars).
 * - connect-src — Supabase, Resend, Gemini, and any other server
 *   integrations the client calls. Add new origins explicitly.
 * - font-src 'self' data: https://fonts.gstatic.com — Google Fonts.
 * - frame-ancestors 'none' on main app, * on /widget/*.
 * - base-uri 'none' — blocks <base href=...> attacks.
 * - form-action 'self' — forms post only to same-origin endpoints.
 */
const mainSecurityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.supabase.co https://api.resend.com https://generativelanguage.googleapis.com https://openrouter.ai",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "X-Frame-Options", value: "DENY" },
];

const widgetSecurityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.supabase.co https://api.resend.com https://generativelanguage.googleapis.com https://openrouter.ai",
      // /widget/* MUST be embeddable on firm websites — no frame-ancestors lock.
      // Per-firm allow-list is a follow-up that needs middleware support.
      "base-uri 'none'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // microphone=* (not (self)) because the widget is meant to be embedded on
    // client firm sites and use the mic from inside a cross-origin iframe.
    // WebKit/iOS Safari mishandles `self` in a subframe's Permissions-Policy
    // header (it can resolve against the top origin, blocking the widget),
    // while Chrome honors it. The wildcard avoids that quirk. Access stays
    // gated by the embedder's iframe allow="microphone" attribute, so this is
    // not a widening of who can actually reach the mic. Camera, geolocation,
    // payment, and usb remain disabled; the widget only needs the microphone.
    value: "camera=(), microphone=*, geolocation=(), payment=(), usb=()",
  },
  // No X-Frame-Options on /widget/* — would override CSP frame-ancestors and
  // block embedding. The CSP frame-ancestors omission above is the gate.
];

// /voice-handoff is the top-level first-party voice recorder for the iOS
// handoff. It is NOT embeddable (it must run as its own tab), so it keeps the
// strict main-app frame lock, but it needs the mic, so microphone=(self)
// instead of the main-app microphone=(). Derived from mainSecurityHeaders so
// the rest of the posture stays in sync.
const voiceHandoffSecurityHeaders = mainSecurityHeaders.map(h =>
  h.key === "Permissions-Policy"
    ? { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()" }
    : h
);

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        // /widget/* gets the embeddable header set (no frame-ancestors lock,
        // no X-Frame-Options).
        source: "/widget/:path*",
        headers: widgetSecurityHeaders,
      },
      {
        // /widget-public/* gets the same embeddable header set for public
        // law-firm website intake flows that should not use OTP.
        source: "/widget-public/:path*",
        headers: widgetSecurityHeaders,
      },
      {
        // /voice-handoff is top-level and first-party but needs the mic.
        source: "/voice-handoff",
        headers: voiceHandoffSecurityHeaders,
      },
      {
        // Catch-all for EVERYTHING that is NOT a widget or the voice-handoff
        // recorder. Negative lookahead is required here because Next.js
        // headers() MERGES headers from every matching rule rather than
        // letting the more-specific rule win outright. Without this exclusion
        // the widget would receive both its embeddable set AND the strict
        // main-app set, and the latter's X-Frame-Options: DENY would block
        // iframe embedding by firms; voice-handoff would get microphone=().
        source: "/((?!widget/|widget-public/|voice-handoff).*)",
        headers: mainSecurityHeaders,
      },
    ];
  },
  // Apex / catches visitors at the bare domain (caseloadselect.ca) once the
  // GHL-hosted marketing site is cut over. The Next.js marketing route group
  // lives at /home; without this redirect the apex would 404. Permanent (308)
  // so search engines treat /home as canonical.
  async redirects() {
    return [
      {
        source: "/",
        destination: "/home",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
