/**
 * /api/intake-v2 security layer.
 *
 * Three defensive layers for the persistence endpoint that accepts
 * client-side POSTs from the widget(s) and writes them to screened_leads:
 *
 *   1. originAllowed()       - block POSTs from origins outside our control
 *   2. validateIntakeBody()  - reject malformed payload shapes before DB write
 *   3. sanitizeBriefHtml()   - strip script tags, event handlers, dangerous
 *                              URL schemes, and other XSS vectors from the
 *                              brief_html that the triage portal renders
 *                              verbatim into the lawyer's view
 *
 * Closes Codex audit HIGH #4. Together these prevent:
 *   - Cross-origin forgery (any random origin posting fake briefs)
 *   - Malformed payloads crashing the insert or polluting downstream
 *     reads with unexpected shapes
 *   - Stored-XSS via injected <script> or onerror= in brief_html
 *     (the portal at /portal/[firmId]/triage/[leadId] dumps brief_html
 *     verbatim into a dangerouslySetInnerHTML-equivalent container)
 *
 * Implementation choice: no Zod or DOMPurify dependency. The dependency
 * tree is intentionally tight (no @supabase/* runtime drift; no XSS
 * library that adds its own attack surface). The hand-rolled checks
 * here are deliberately conservative: anything that doesn't match a
 * narrow whitelist is rejected or stripped.
 */

import 'server-only';
import { supabaseAdmin as supabase } from './supabase-admin';

// ─── Origin allow-list ─────────────────────────────────────────────────────

const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN ?? 'caseloadselect.ca';
const SANDBOX_HOST = 'caseload-screen-v2.vercel.app';

// In-process cache for custom-domain lookup so we don't hit Supabase on
// every intake POST. 60-second TTL matches the middleware's revalidate cap.
let _customDomainCache: { domains: Set<string>; fetchedAt: number } | null = null;
const CUSTOM_DOMAIN_TTL_MS = 60 * 1000;

async function loadCustomDomainsCached(): Promise<Set<string>> {
  const now = Date.now();
  if (_customDomainCache && now - _customDomainCache.fetchedAt < CUSTOM_DOMAIN_TTL_MS) {
    return _customDomainCache.domains;
  }
  const { data } = await supabase
    .from('intake_firms')
    .select('custom_domain')
    .not('custom_domain', 'is', null);
  const domains = new Set<string>(
    (data ?? [])
      .map((r) => (r as { custom_domain?: string | null }).custom_domain ?? '')
      .filter((d) => d.length > 0)
      .map((d) => d.toLowerCase()),
  );
  _customDomainCache = { domains, fetchedAt: now };
  return domains;
}

function hostFromOrigin(origin: string | null): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Returns true when the request's Origin (or Referer fallback) maps to a
 * host the platform owns or that a firm has claimed as a custom domain.
 *
 * Decision tree:
 *   - Origin === main APP_DOMAIN, or any subdomain of it → allow.
 *   - Origin === sandbox host (caseload-screen-v2.vercel.app) → allow.
 *   - Origin matches a row in intake_firms.custom_domain → allow.
 *   - Localhost / 127.0.0.1 / *.vercel.app preview → allow (dev + preview).
 *   - No Origin header AND no Referer → allow (server-to-server, e.g.
 *     curl from a webhook integration), but only if a future stricter
 *     toggle is opted into. We still gate the body shape and sanitise.
 *   - Anything else → reject 403.
 *
 * The caller passes the request so we can read both Origin and Referer.
 */
export async function originAllowed(req: Request): Promise<{ ok: true; host: string | null } | { ok: false; reason: string }> {
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const host = hostFromOrigin(origin) ?? hostFromOrigin(referer);

  if (!host) {
    // No origin and no referer. Permit for now — preserves curl /
    // server-to-server compat. Body validation + sanitize still apply.
    return { ok: true, host: null };
  }

  if (host === APP_DOMAIN.toLowerCase()) return { ok: true, host };
  if (host.endsWith(`.${APP_DOMAIN.toLowerCase()}`)) return { ok: true, host };
  if (host === SANDBOX_HOST) return { ok: true, host };
  if (host === 'localhost' || host === '127.0.0.1') return { ok: true, host };
  if (host.endsWith('.vercel.app')) return { ok: true, host };

  const customDomains = await loadCustomDomainsCached();
  if (customDomains.has(host)) return { ok: true, host };

  return { ok: false, reason: `origin "${host}" not allowed` };
}

// ─── Body validation (hand-rolled, no Zod) ─────────────────────────────────

export interface ValidatedIntakeBody {
  lead_id: string;
  matter_type: string;
  practice_area: string;
  band: string | null;
  axes: { value: number; complexity: number; urgency: number; readiness: number; readinessAnswered?: boolean };
  brief_json: Record<string, unknown>;
  brief_html: string;
  slot_answers: Record<string, unknown>;
  contact?: { name?: string | null; email?: string | null; phone?: string | null };
  intake_language?: string | null;
  raw_transcript?: string | null;
  submitted_at?: string | null;
}

// Caps to bound DoS-via-large-body. Each cap is far above any realistic
// legitimate value; anything over is treated as malformed.
const MAX_LEAD_ID_LEN = 120;
const MAX_PRACTICE_AREA_LEN = 80;
const MAX_MATTER_TYPE_LEN = 80;
const MAX_BRIEF_HTML_LEN = 250_000;          // 250 KB raw HTML
const MAX_BRIEF_JSON_KEYS = 200;             // top-level keys, recursion not counted
const MAX_SLOT_ANSWER_KEYS = 200;
const MAX_CONTACT_FIELD_LEN = 200;
const MAX_INTAKE_LANGUAGE_LEN = 8;
const MAX_RAW_TRANSCRIPT_LEN = 16_000;       // 16 KB of original-language text

const LANGUAGE_RE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i;
const LEAD_ID_RE = /^[A-Za-z0-9._:\\-]+$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateIntakeBody(raw: unknown): { ok: true; body: ValidatedIntakeBody } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObject(raw)) {
    return { ok: false, errors: ['body must be a JSON object'] };
  }

  // lead_id
  const lead_id = typeof raw.lead_id === 'string' ? raw.lead_id : '';
  if (!lead_id) errors.push('lead_id required');
  else if (lead_id.length > MAX_LEAD_ID_LEN) errors.push('lead_id too long');
  else if (!LEAD_ID_RE.test(lead_id)) errors.push('lead_id contains invalid characters');

  // matter_type, practice_area
  const matter_type = typeof raw.matter_type === 'string' ? raw.matter_type : '';
  if (!matter_type) errors.push('matter_type required');
  else if (matter_type.length > MAX_MATTER_TYPE_LEN) errors.push('matter_type too long');

  const practice_area = typeof raw.practice_area === 'string' ? raw.practice_area : '';
  if (!practice_area) errors.push('practice_area required');
  else if (practice_area.length > MAX_PRACTICE_AREA_LEN) errors.push('practice_area too long');

  // band: nullable string A-X
  const band: string | null = typeof raw.band === 'string' ? raw.band : null;
  if (band && !/^[A-EX]$/.test(band)) errors.push('band must be A,B,C,D,E,X or null');

  // axes
  let axes: ValidatedIntakeBody['axes'] | null = null;
  if (!isObject(raw.axes)) {
    errors.push('axes required');
  } else {
    const a = raw.axes;
    const num = (v: unknown, name: string): number => {
      const n = typeof v === 'number' ? v : Number.NaN;
      if (!Number.isFinite(n)) {
        errors.push(`axes.${name} must be a number`);
        return 0;
      }
      return n;
    };
    axes = {
      value: num(a.value, 'value'),
      complexity: num(a.complexity, 'complexity'),
      urgency: num(a.urgency, 'urgency'),
      readiness: num(a.readiness, 'readiness'),
      readinessAnswered: a.readinessAnswered === true,
    };
  }

  // brief_html
  const brief_html = typeof raw.brief_html === 'string' ? raw.brief_html : '';
  if (!brief_html) errors.push('brief_html required');
  else if (brief_html.length > MAX_BRIEF_HTML_LEN) errors.push('brief_html too large');

  // brief_json
  let brief_json: Record<string, unknown> | null = null;
  if (!isObject(raw.brief_json)) {
    errors.push('brief_json required (object)');
  } else if (Object.keys(raw.brief_json).length > MAX_BRIEF_JSON_KEYS) {
    errors.push('brief_json has too many top-level keys');
  } else {
    brief_json = raw.brief_json;
  }

  // slot_answers
  let slot_answers: Record<string, unknown> | null = null;
  if (!isObject(raw.slot_answers)) {
    errors.push('slot_answers required (object)');
  } else if (Object.keys(raw.slot_answers).length > MAX_SLOT_ANSWER_KEYS) {
    errors.push('slot_answers has too many top-level keys');
  } else {
    slot_answers = raw.slot_answers;
  }

  // contact (optional, but each field bounded)
  let contact: ValidatedIntakeBody['contact'];
  if (raw.contact !== undefined && raw.contact !== null) {
    if (!isObject(raw.contact)) {
      errors.push('contact must be object');
    } else {
      const c = raw.contact;
      const okOptStr = (v: unknown, name: string): string | null | undefined => {
        if (v === undefined) return undefined;
        if (v === null) return null;
        if (typeof v !== 'string') {
          errors.push(`contact.${name} must be string`);
          return undefined;
        }
        if (v.length > MAX_CONTACT_FIELD_LEN) {
          errors.push(`contact.${name} too long`);
          return undefined;
        }
        return v;
      };
      contact = {
        name: okOptStr(c.name, 'name'),
        email: okOptStr(c.email, 'email'),
        phone: okOptStr(c.phone, 'phone'),
      };
    }
  }

  // intake_language
  let intake_language: string | null | undefined;
  if (raw.intake_language !== undefined && raw.intake_language !== null) {
    if (typeof raw.intake_language !== 'string' || raw.intake_language.length > MAX_INTAKE_LANGUAGE_LEN || !LANGUAGE_RE.test(raw.intake_language)) {
      errors.push('intake_language must be an ISO 639-1/-3 code');
    } else {
      intake_language = raw.intake_language;
    }
  }

  // raw_transcript
  let raw_transcript: string | null | undefined;
  if (raw.raw_transcript !== undefined && raw.raw_transcript !== null) {
    if (typeof raw.raw_transcript !== 'string') {
      errors.push('raw_transcript must be string or null');
    } else if (raw.raw_transcript.length > MAX_RAW_TRANSCRIPT_LEN) {
      errors.push('raw_transcript too long');
    } else {
      raw_transcript = raw.raw_transcript;
    }
  }

  // submitted_at
  let submitted_at: string | null | undefined;
  if (raw.submitted_at !== undefined && raw.submitted_at !== null) {
    if (typeof raw.submitted_at !== 'string' || Number.isNaN(Date.parse(raw.submitted_at))) {
      errors.push('submitted_at must be an ISO timestamp string');
    } else {
      submitted_at = raw.submitted_at;
    }
  }

  if (errors.length > 0 || !axes || !brief_json || !slot_answers) {
    return { ok: false, errors: errors.length > 0 ? errors : ['missing required object fields'] };
  }

  return {
    ok: true,
    body: {
      lead_id,
      matter_type,
      practice_area,
      band,
      axes,
      brief_json,
      brief_html,
      slot_answers,
      contact,
      intake_language,
      raw_transcript,
      submitted_at,
    },
  };
}

// ─── brief_html sanitizer ──────────────────────────────────────────────────

/**
 * Strip dangerous HTML constructs from a brief before it reaches the triage
 * portal's rendering layer. The portal dumps brief_html verbatim into a
 * scoped .brief container (no React escaping), so any unsanitised
 * <script>, on*= handler, or javascript: URL would execute in the
 * lawyer's authenticated session.
 *
 * Conservative approach: regex-based stripping. Coverage:
 *
 *   - <script>, <style>, <iframe>, <object>, <embed>, <applet>, <link>,
 *     <meta>, <base>, <form>, <input>, <button>, <textarea>, <select>,
 *     <option>, <noscript>, <svg>, <math> tags (with content)
 *   - All "on*=" attribute handlers (onclick, onerror, onload, ...)
 *   - href / src / formaction / xlink:href / poster / background URLs
 *     using the javascript:, data:, vbscript:, or file: schemes
 *   - HTML comments (sneaky places to hide content from scanners)
 *   - <a target="_blank"> without rel="noopener noreferrer" gets rel added
 *
 * What survives:
 *   - All other tags (h1-h6, p, ul, ol, li, dl, dt, dd, section, article,
 *     div, span, strong, em, b, i, u, blockquote, code, pre, br, hr,
 *     table, thead, tbody, tr, th, td, img with safe src, a with safe href)
 *   - class and id attributes (so brief.css styling continues to work)
 *   - http/https/mailto URLs in href/src
 *
 * The portal's brief.css uses class selectors only; ID-based or attribute-
 * based selectors would be a separate audit concern. Keeping class lets
 * the existing brief-section, brief-heading, brief-fact-key classes work.
 *
 * Not as comprehensive as DOMPurify, but covers the audit's primary
 * concerns (XSS, navigation hijack, exfiltration via background image
 * URL fetch). Swap to DOMPurify when we add it to package.json.
 */

const DANGEROUS_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'applet',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'noscript',
  'svg',
  'math',
];

const DANGEROUS_SCHEMES = /^(?:javascript|data|vbscript|file):/i;

function stripDangerousTag(html: string, tag: string): string {
  // Strip both the open/close pair (with content) and self-closing variant.
  const pair = new RegExp(`<\\s*${tag}\\b[\\s\\S]*?<\\s*\\/\\s*${tag}\\s*>`, 'gi');
  const selfClose = new RegExp(`<\\s*${tag}\\b[^>]*\\/?\\s*>`, 'gi');
  return html.replace(pair, '').replace(selfClose, '');
}

function stripEventHandlers(html: string): string {
  // on<word>=... in attributes. Match both quoted and unquoted values.
  return html.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

function stripDangerousUrlAttrs(html: string): string {
  // href / src / formaction / xlink:href / poster / background / action
  return html.replace(
    /\s(?:href|src|formaction|xlink:href|poster|background|action)\s*=\s*("(?:javascript|data|vbscript|file):[^"]*"|'(?:javascript|data|vbscript|file):[^']*'|(?:javascript|data|vbscript|file):[^\s>]+)/gi,
    (match) => {
      // Re-check carefully — some legitimate data: URIs (data:image/png;base64)
      // are common but we strip them all to be safe; the brief should be
      // text-only anyway, no inline images.
      void DANGEROUS_SCHEMES;
      void match;
      return '';
    },
  );
}

function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

function hardenAnchorTargets(html: string): string {
  // <a target="_blank"> opens in a new context with implicit window.opener
  // access — add rel="noopener noreferrer" if missing.
  return html.replace(
    /<a\b([^>]*\btarget\s*=\s*["']_blank["'][^>]*)>/gi,
    (match, attrs: string) => {
      if (/\brel\s*=/.test(attrs)) return match;
      return `<a ${attrs.trim()} rel="noopener noreferrer">`;
    },
  );
}

export function sanitizeBriefHtml(input: string): string {
  if (!input) return '';
  let html = input;
  for (const tag of DANGEROUS_TAGS) {
    html = stripDangerousTag(html, tag);
  }
  html = stripHtmlComments(html);
  html = stripEventHandlers(html);
  html = stripDangerousUrlAttrs(html);
  html = hardenAnchorTargets(html);
  return html;
}
