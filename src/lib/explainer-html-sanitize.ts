import 'server-only';

/**
 * Authoritative sanitizer for explainer-article HTML (S8 Phase 2).
 *
 * Sibling of welcome-html-sanitize. Explainer articles are longer-form client
 * education content, so the allowlist adds headings (h2-h4) and blockquote on
 * top of the welcome set. body_html is authored by the operator and rendered
 * into the CLIENT portal, so it is sanitized on save (the admin PATCH route)
 * before storage — never trusting the editor or a direct API call.
 *
 * server-only: pulls in sanitize-html (Node). Must not be bundled into a client
 * component; the admin explainer editor stays client-simple and relies on this
 * server pass.
 */

import sanitizeHtml from 'sanitize-html';

const EXPLAINER_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br',
    'strong', 'b', 'em', 'i', 'u',
    'ul', 'ol', 'li',
    'a',
    'h2', 'h3', 'h4',
    'blockquote',
  ],
  allowedAttributes: {
    a: ['href'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { a: ['http', 'https', 'mailto'] },
  // Stripped tags are unwrapped (text kept) EXCEPT these, whose contents are
  // dropped entirely so a removed <script> leaves nothing behind.
  nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe'],
  // h1 is intentionally NOT allowed: the page chrome owns the article title; a
  // body h1 would duplicate it. h1 is unwrapped to text by the rule above.
  allowedClasses: {},
};

/**
 * Sanitize explainer body HTML to the article allowlist. Returns '' for
 * null/empty input. Pure given the same input.
 */
export function sanitizeExplainerHtml(html: string | null | undefined): string {
  if (!html || !html.trim()) return '';
  return sanitizeHtml(html, EXPLAINER_SANITIZE_OPTIONS).trim();
}
