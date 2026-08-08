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
 * Three header sets:
 *
 * 1. Main app (everything except /widget/*, /widget-public/*, and the
 *    tools-embed routes below) — strict frame-ancestors 'none' so attacker
 *    pages can't iframe the lawyer portal or admin console for
 *    clickjacking.
 *
 * 2. /widget/* — same CSP, but frame-ancestors *. The widget is
 *    intentionally embeddable as an iframe on firm websites; per-firm
 *    allow-listing is a follow-up (would need a request-time middleware
 *    decision based on intake_firms.allowed_embed_origins).
 *
 * 3. /tools/seo-check, /screen-demo, /tools/firm-voice-builder,
 *    /tools/start-a-conversation, and /tools/website-design-check
 *    (2026-08-06, Tools embed decision; the fourth and fifth routes both
 *    added 2026-08-07, per BUILD_PLAN_start_conversation_flow_v1.md and the
 *    Website Design & Conversion Check ship respectively) — same CSP,
 *    frame-ancestors scoped to CaseLoad Select's own marketing origins only
 *    (not '*' like /widget/*). These public tool pages are embedded inline
 *    on the Version3_CaseLoadSelect static site (tools.html and, for
 *    start-a-conversation, the new conversation.html) so a visitor can run
 *    them without leaving the page. Unlike /widget/*, this is not meant to
 *    be embeddable by arbitrary firm websites, so the allow-list stays
 *    narrow rather than open. /tools/firm-voice-builder ships noindex (its
 *    own page.tsx metadata) and was previously unlinked pending an
 *    email-gate and consent-wiring follow-up
 *    (BUILD_PLAN_firm_voice_builder_tool_v1.md S8); Adriano directed
 *    embedding it now regardless, 2026-08-06. /tools/start-a-conversation
 *    also ships noindex until launch (its own page.tsx metadata), same
 *    posture. http://localhost:3300 is also on this allow-list
 *    (2026-08-06): the Version3_CaseLoadSelect static site has no
 *    deployment target yet, so Adriano previews its pages via a local
 *    `serve` static server on that port. Low risk to add permanently: these
 *    five routes carry no auth, no session, and no per-visitor state to
 *    hijack by framing, so a malicious page framing them from localhost
 *    gains nothing a real visitor couldn't already do by visiting the URL
 *    directly. Remove once the static site has a real deployed origin and
 *    local-preview testing is no longer needed.
 *
 *    Both halves of the tier are load-bearing: a route needs its own
 *    source entry here AND an exclusion in the catch-all's negative
 *    lookahead below. With only the first, headers() merges the main set
 *    on top and its X-Frame-Options: DENY blocks framing outright.
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
 * - frame-ancestors 'none' on main app, * on /widget/*, a scoped
 *   CaseLoad-plus-local-dev allow-list on the five tools-embed routes.
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

const toolsEmbedSecurityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.supabase.co https://api.resend.com https://generativelanguage.googleapis.com https://openrouter.ai",
      // frame-src for the Cal.com hosted booking widget (2026-08-07). The
      // booking ending of /tools/start-a-conversation embeds Cal.com's page
      // by URL (the adapter pattern in booking-adapter-pure.ts: no API
      // client, the iframe IS the integration). Without this the directive
      // falls back to default-src 'self' and the browser blocks the widget,
      // so the booking outcome renders an empty frame.
      //
      // Declared on the shared tools tier rather than a fourth header set:
      // the other three routes gain only the ability to frame cal.com, and
      // none of them has an injection sink that would let an attacker
      // choose an iframe source. A separate near-identical tier would be
      // more surface to keep in sync for no real reduction in risk.
      "frame-src https://cal.com https://app.cal.com",
      // Scoped, not '*': only our own marketing origins may frame these
      // four public tool pages. www is the canonical host; the bare apex
      // is kept in case anything still resolves without the www redirect
      // applied; localhost:3300 is the local static-preview server, see
      // the file-header comment above for why it's safe to leave permanent.
      "frame-ancestors 'self' https://www.caseloadselect.ca https://caseloadselect.ca http://localhost:3300",
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
  // No X-Frame-Options here: XFO checks the exact framing origin and has no
  // concept of a scoped allow-list, so SAMEORIGIN would still block
  // www.caseloadselect.ca framing caseloadselect.ca (or the reverse) even
  // though both are us. The CSP frame-ancestors list above is the gate.
];

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
        // Tools embed set (2026-08-06): the SEO/AEO Check page and the
        // Screen demo, including its quiz subpath, are framed inline by
        // Version3_CaseLoadSelect/tools.html. Scoped to our own origins,
        // not the open '*' the widget uses.
        source: "/tools/seo-check",
        headers: toolsEmbedSecurityHeaders,
      },
      {
        source: "/screen-demo",
        headers: toolsEmbedSecurityHeaders,
      },
      {
        source: "/screen-demo/:path*",
        headers: toolsEmbedSecurityHeaders,
      },
      {
        // Added 2026-08-06 alongside the other two: the Firm Voice Builder
        // interview tool is a single route (no subpaths — confirmed no
        // router.push/Link/window.location in the component tree), embedded
        // on tools.html per Adriano's explicit override of the plan's S8
        // unlinked-until-email-gate step.
        source: "/tools/firm-voice-builder",
        headers: toolsEmbedSecurityHeaders,
      },
      {
        // Added 2026-08-07 (BUILD_PLAN_start_conversation_flow_v1.md):
        // the Start a Conversation flow, single route, no subpaths, framed
        // inline by the new static conversation.html.
        source: "/tools/start-a-conversation",
        headers: toolsEmbedSecurityHeaders,
      },
      {
        // Added 2026-08-07 as the Website Design & Conversion Check ships:
        // a single route with no subpaths (no router.push/Link/
        // window.location anywhere in src/components/website-design-check —
        // the report renders in place, the scan is a fetch to
        // /api/tools/website-design-check). Same tier as the other four,
        // framed on tools.html.
        source: "/tools/website-design-check",
        headers: toolsEmbedSecurityHeaders,
      },
      {
        // Catch-all for EVERYTHING that is NOT a widget or a tools-embed
        // route. Negative lookahead is required here because Next.js
        // headers() MERGES headers from every matching rule rather than
        // letting the more-specific rule win outright. Without this
        // exclusion the widget and the tools-embed routes would receive
        // both their embeddable set AND the strict main-app set, and the
        // latter's X-Frame-Options: DENY would block iframe embedding.
        source:
          "/((?!widget/|widget-public/|tools/seo-check|tools/firm-voice-builder|tools/start-a-conversation|tools/website-design-check|screen-demo).*)",
        headers: mainSecurityHeaders,
      },
    ];
  },
  // Canonical-domain fix (2026-07-02, Website Strategy decision D4): / is
  // now the canonical homepage (relocated from home/page.tsx to the
  // (marketing) route-group root page.tsx). /home 301s to / for any
  // existing bookmarks, backlinks, or cached search results. Permanent
  // (308) so search engines re-index / as canonical, not /home.
  async redirects() {
    return [
      {
        source: "/home",
        destination: "/",
        permanent: true,
      },
      // /next-steps outage fix (2026-08-08): the page embedded the GHL
      // strategy-call booking widget in an iframe. This app's default CSP
      // (mainSecurityHeaders, see the header comment above) has no
      // frame-src, so it falls back to default-src 'self' and blocks any
      // third-party frame outright -- verified live, a real
      // securitypolicyviolation naming api.leadconnectorhq.com as the
      // blocked URI. Every visitor who clicked "Book a Strategy Call" got
      // an empty box where the calendar should be.
      //
      // Fix is a redirect to the working, already-qualified booking flow
      // at /tools/start-a-conversation (its own toolsEmbedSecurityHeaders
      // tier carries frame-src for cal.com) rather than adding frame-src
      // to the whole (marketing) group for one page: /next-steps no
      // longer exists as a route (the GHL iframe page is deleted), so
      // there is nothing left under (marketing) that needs to frame
      // anything. Permanent (308): the page is gone for good, and any
      // existing bookmark, backlink, or indexed URL should resolve to the
      // real destination rather than 404.
      {
        source: "/next-steps",
        destination: "/tools/start-a-conversation",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
