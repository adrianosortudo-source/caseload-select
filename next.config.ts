import type { NextConfig } from "next";

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
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
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
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
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
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // No X-Frame-Options on /widget/* — would override CSP frame-ancestors and
  // block embedding. The CSP frame-ancestors omission above is the gate.
];

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        // /widget/* matched first so the more-specific rule wins. Next.js
        // headers() ordering: routes are matched in declaration order, so
        // putting /widget/:path* before the catch-all gives it precedence.
        source: "/widget/:path*",
        headers: widgetSecurityHeaders,
      },
      {
        source: "/:path*",
        headers: mainSecurityHeaders,
      },
    ];
  },
};

export default nextConfig;
