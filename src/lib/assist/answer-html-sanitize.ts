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

// A tag name outside allowedTags with no special nonTextTags handling: when
// transformTags renames a disallowed-host <a> to this, sanitize-html's
// normal behavior for an unrecognized tag applies (drop the tag, keep the
// inner text), which is exactly the "unwrap" the host constraint wants.
const UNWRAP_TAG = 'assist-unwrap';

function hostnameOf(href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Sanitize model-generated answer HTML to the Firm Assist allowlist. Pure.
 *
 * When `allowedHosts` is provided (Ses.18 audit F6b), any <a> whose href
 * hostname is not in the set is unwrapped: the link is removed but its text
 * stays. The corpus is firm-controlled, so an offsite link is unlikely, but
 * this closes the theoretical gap without depending on model discipline.
 * Omitting the argument keeps prior behavior unchanged (every existing
 * caller and test).
 */
export function sanitizeAnswerHtml(
  html: string | null | undefined,
  allowedHosts?: Iterable<string>,
): string {
  if (!html || !html.trim()) return '';

  if (!allowedHosts) {
    return sanitizeHtml(html, ANSWER_SANITIZE_OPTIONS).trim();
  }

  const hostSet = new Set(Array.from(allowedHosts, (h) => h.toLowerCase()));
  const options: sanitizeHtml.IOptions = {
    ...ANSWER_SANITIZE_OPTIONS,
    transformTags: {
      a: (tagName, attribs) => {
        const host = hostnameOf(attribs.href);
        if (!host || !hostSet.has(host)) {
          return { tagName: UNWRAP_TAG, attribs: {} };
        }
        return { tagName, attribs };
      },
    },
  };
  return sanitizeHtml(html, options).trim();
}
