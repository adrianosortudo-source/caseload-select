/**
 * Pure request/response shaping for POST /api/assist/[firmId] (DR-100,
 * DR-102). No I/O: CORS origin matching, question validation, and mapping
 * the model's raw intent to the fixed-copy exit shape the frontend renders.
 * Kept separate from the route so these rules get direct vitest coverage.
 */

import type { AnswerModelResponse } from './answer-prompt';
import { sanitizeAnswerHtml } from './answer-html-sanitize';

const MIN_QUESTION_CHARS = 3;
const MAX_QUESTION_CHARS = 500;

export interface QuestionValidation {
  ok: boolean;
  question?: string;
  error?: string;
}

/** Strips any HTML tags from the raw question and enforces the length bounds. */
export function validateQuestion(raw: unknown): QuestionValidation {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'question must be a string' };
  }
  const stripped = raw.replace(/<[^>]*>/g, '').trim();
  if (stripped.length < MIN_QUESTION_CHARS) {
    return { ok: false, error: `question must be at least ${MIN_QUESTION_CHARS} characters` };
  }
  if (stripped.length > MAX_QUESTION_CHARS) {
    return { ok: false, error: `question must be at most ${MAX_QUESTION_CHARS} characters` };
  }
  return { ok: true, question: stripped };
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Returns the matched origin (to echo back in Access-Control-Allow-Origin)
 * or null when the request's Origin header is not on the firm's allow-list.
 * The allow-list is embed_origins plus the firm's own custom_domain
 * (apex + www), so a firm with no embed_origins configured and no
 * custom_domain rejects every cross-origin call by default.
 */
export function resolveAllowedOrigin(
  originHeader: string | null,
  embedOrigins: string[],
  customDomain: string | null,
): string | null {
  if (!originHeader) return null;
  const normalizedRequest = normalizeOrigin(originHeader);

  const allowed = new Set(embedOrigins.map(normalizeOrigin));
  if (customDomain) {
    const host = customDomain.trim().toLowerCase();
    allowed.add(normalizeOrigin(`https://${host}`));
    if (!host.startsWith('www.')) {
      allowed.add(normalizeOrigin(`https://www.${host}`));
    }
  }

  return allowed.has(normalizedRequest) ? originHeader : null;
}

export const SCREEN_HANDOFF_MESSAGE =
  "That reads like a question about your own situation. The firm reviews those directly: describe what happened in your own words and a lawyer will look at whether it fits the practice.";

export const NO_COVERAGE_MESSAGE =
  "This page doesn't cover that yet. Send your question through for review and a lawyer will look at whether it fits the practice.";

export interface SourcePage {
  id: string;
  title: string | null;
  url: string;
}

export type AssistExitResponse =
  | { exit: 'answered'; answer_html: string; sources: Array<{ title: string | null; url: string }> }
  | { exit: 'screen_handoff'; message: string }
  | { exit: 'no_coverage'; message: string };

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Maps the model's raw response to the fixed-copy exit shape the frontend
 * renders. case_specific and no_coverage messages are constants, never
 * model-generated text, so LSO-sensitive copy is never at the model's
 * discretion. Hallucinated source_page_ids (not present in pagesById) are
 * dropped silently rather than surfaced as a broken link.
 *
 * customDomain (Ses.18 audit F6b, optional) constrains any <a href> in the
 * model's answer_html to the firm's own source-page hosts plus its custom
 * domain when set; an offsite link is unwrapped by sanitizeAnswerHtml.
 */
export function buildExitResponse(
  modelResponse: AnswerModelResponse,
  pagesById: Map<string, SourcePage>,
  customDomain?: string | null,
): AssistExitResponse {
  if (modelResponse.intent === 'case_specific') {
    return { exit: 'screen_handoff', message: SCREEN_HANDOFF_MESSAGE };
  }
  if (modelResponse.intent === 'out_of_corpus') {
    return { exit: 'no_coverage', message: NO_COVERAGE_MESSAGE };
  }

  const sources = modelResponse.source_page_ids
    .map((id) => pagesById.get(id))
    .filter((p): p is SourcePage => Boolean(p))
    .map((p) => ({ title: p.title, url: p.url }));

  const allowedHosts = new Set<string>();
  for (const page of pagesById.values()) {
    const host = hostnameOf(page.url);
    if (host) allowedHosts.add(host);
  }
  if (customDomain) allowedHosts.add(customDomain.trim().toLowerCase());

  return {
    exit: 'answered',
    answer_html: sanitizeAnswerHtml(modelResponse.answer_html, allowedHosts),
    sources,
  };
}
