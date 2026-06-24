import 'server-only';

/**
 * Authoritative sanitizer for matter message bodies.
 *
 * Message bodies are written by clients (the lowest-trust role), lawyers, and
 * operators, and rendered into the other party's thread via
 * dangerouslySetInnerHTML. Before this pass the body was stored verbatim
 * (sanitiseBody only trims/collapses/caps, it does NOT strip HTML) and the
 * renderers rendered any body containing "<" as raw HTML, which is a stored
 * XSS path from an external client into the lawyer/operator origin.
 *
 * This is the single server-side sanitization point. insertMessage runs it on
 * every body before persistence, so nothing reaches a thread unsanitized
 * regardless of what the compose form or a direct API call submits. Plain text
 * survives intact (a stray "<" is HTML-encoded, not dropped); a small rich
 * subset (the same tags the welcome draft emits, used when a welcome is sent
 * as a message) is preserved; scripts, event handlers, and javascript:/data:
 * URLs are removed.
 *
 * server-only: pulls in sanitize-html (a Node library); must never be bundled
 * into a client component.
 */

import sanitizeHtml from 'sanitize-html';

const MESSAGE_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a', 'blockquote'],
  allowedAttributes: {
    a: ['href', 'rel', 'target'],
  },
  // Links are rendered into the other party's thread (operator, lawyer, or
  // client) via dangerouslySetInnerHTML. Force rel + target on every anchor so
  // a stored link cannot reach window.opener (reverse tabnabbing) and is not
  // treated as endorsed.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }, true),
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { a: ['http', 'https', 'mailto', 'tel'] },
  // Disallowed tags are unwrapped (text kept) EXCEPT these, whose contents are
  // dropped entirely so a removed <script> leaves nothing behind.
  nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe'],
  allowedClasses: {},
};

/**
 * Sanitize a matter message body. Returns '' for null/empty input. Plain text
 * passes through (with HTML metacharacters encoded); a stray "<" becomes
 * "&lt;" rather than being interpreted as a tag.
 */
export function sanitizeMessageHtml(body: string | null | undefined): string {
  if (!body || !body.trim()) return '';
  return sanitizeHtml(body, MESSAGE_SANITIZE_OPTIONS);
}
