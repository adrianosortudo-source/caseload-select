/**
 * Sanitizer for Firm Assist answer_html (DR-100). The model is instructed
 * to emit only p/ul/ol/li/strong/a, but the prompt is not the enforcement
 * boundary: this is the last gate before the answer reaches a cross-origin
 * visitor's browser, regardless of what the model actually returned.
 *
 * Same allowlist shape as welcome-html-sanitize.ts, narrowed to the tags
 * this surface's prompt actually asks for (no lists of inline formatting
 * beyond strong, since answers are short factual excerpts, not authored
 * rich text).
 */

import sanitizeHtml from 'sanitize-html';

const ANSWER_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'ul', 'ol', 'li', 'strong', 'a'],
  allowedAttributes: {
    a: ['href'],
  },
  allowedSchemes: ['http', 'https'],
  allowedSchemesByTag: { a: ['http', 'https'] },
  nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe'],
  allowedClasses: {},
};

/** Sanitize model-generated answer HTML to the Firm Assist allowlist. Pure. */
export function sanitizeAnswerHtml(html: string | null | undefined): string {
  if (!html || !html.trim()) return '';
  return sanitizeHtml(html, ANSWER_SANITIZE_OPTIONS).trim();
}
