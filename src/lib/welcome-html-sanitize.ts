import 'server-only';

/**
 * Authoritative sanitizer for welcome-draft HTML (S8 Phase 2).
 *
 * The welcome draft is composed by the firm (lawyer) and rendered into the
 * CLIENT's portal + email via dangerouslySetInnerHTML / an email body, so it
 * crosses an account boundary. Before Phase 2 the lawyer's raw HTML was stored
 * and rendered with no sanitization. This is the single server-side
 * sanitization point: the PATCH /welcome route runs it on save, and
 * /welcome/send runs it on the body it sends, so nothing reaches a client
 * unsanitized regardless of what the editor (or a direct API call) submits.
 *
 * The allowlist is deliberately the exact tag set buildWelcomeDraft emits
 * (p, ol/ul/li, a, br) plus the inline emphasis a lawyer is likely to add
 * (strong/b, em/i, u). This guarantees the original generated draft round-trips
 * through the sanitizer unchanged, and keeps the rich-text editor's surface
 * narrow. Anything outside the allowlist (script/style/iframe, event handlers,
 * javascript: URLs, inline styles, classes) is stripped.
 *
 * server-only: this pulls in sanitize-html (a Node library) and must never be
 * bundled into a client component. The rich-text editor stays client-simple and
 * relies on this server pass for safety.
 */

import sanitizeHtml from 'sanitize-html';

const WELCOME_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a'],
  allowedAttributes: {
    a: ['href'],
  },
  // Links only: real navigable schemes. javascript:/data: are dropped.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { a: ['http', 'https', 'mailto'] },
  // Disallowed tags are unwrapped (their text is kept) EXCEPT these, whose
  // contents are dropped entirely — a stripped <script> must not leave its body
  // behind as text.
  nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe'],
  // No class / id / style / data-* anywhere (only a[href] survives above). No
  // transforms: the generated draft must round-trip through this unchanged.
  allowedClasses: {},
};

/**
 * Sanitize welcome-draft HTML to the welcome allowlist. Pure (given the same
 * input, same output). Returns '' for null/empty input.
 */
export function sanitizeWelcomeHtml(html: string | null | undefined): string {
  if (!html || !html.trim()) return '';
  return sanitizeHtml(html, WELCOME_SANITIZE_OPTIONS).trim();
}
