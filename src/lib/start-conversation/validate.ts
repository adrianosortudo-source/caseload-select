/**
 * Request-body validation for POST /api/start-conversation.
 *
 * Hand-rolled rather than schema-library-driven: this repository has no
 * validation dependency (see package.json), and the established pattern for
 * a public tool route is a pure validator module beside the route, the same
 * shape as lib/firm-voice-builder/turn.ts's validateTranscript. Pure, so it
 * is unit-testable without booting the route.
 *
 * The consent gate does NOT live here. It lives in the route, before any
 * write, and it is checked again there rather than trusted from a validator
 * result. See the route's own header for why.
 */

import {
  QUESTIONS,
  isValidValue,
  optionRevealsText,
  resolveOutcome,
  type Outcome,
  type QuestionId,
} from './questions';

/** Free-text and contact-field length caps. Generous for humans, bounded for scripts. */
export const MAX_NAME = 120;
export const MAX_FIRM_NAME = 160;
export const MAX_EMAIL = 254; // RFC 5321 maximum path length
export const MAX_PROVINCE = 60;
export const MAX_FREE_TEXT = 300;

/**
 * Canadian provinces and territories, plus an outside-Canada escape. The
 * contact screen asks for province; an unrecognised free-text province is
 * the kind of thing that ends up in an email subject line, so it is a
 * closed list here too.
 */
export const PROVINCES: readonly { value: string; label: string }[] = [
  { value: 'ON', label: 'Ontario' },
  { value: 'AB', label: 'Alberta' },
  { value: 'BC', label: 'British Columbia' },
  { value: 'MB', label: 'Manitoba' },
  { value: 'NB', label: 'New Brunswick' },
  { value: 'NL', label: 'Newfoundland and Labrador' },
  { value: 'NS', label: 'Nova Scotia' },
  { value: 'NT', label: 'Northwest Territories' },
  { value: 'NU', label: 'Nunavut' },
  { value: 'PE', label: 'Prince Edward Island' },
  { value: 'QC', label: 'Quebec' },
  { value: 'SK', label: 'Saskatchewan' },
  { value: 'YT', label: 'Yukon' },
  { value: 'OUTSIDE_CA', label: 'Outside Canada' },
] as const;

export function provinceLabel(value: string): string | null {
  return PROVINCES.find((p) => p.value === value)?.label ?? null;
}

export interface StartConversationAnswers {
  practice_area: string;
  practice_area_other: string | null;
  firm_size: string;
  prompt_reason: string;
  prompt_reason_other: string | null;
  decision_role: string;
  timeline: string;
}

export interface StartConversationContact {
  name: string;
  firm_name: string;
  email: string;
  province: string;
}

export interface ValidStartConversationSubmission {
  answers: StartConversationAnswers;
  contact: StartConversationContact;
  outcome: Outcome;
}

export type ValidationResult =
  | { valid: true; submission: ValidStartConversationSubmission }
  | { valid: false; error: string };

/**
 * Deliberately conservative and deliberately not a full RFC 5322 parser.
 * One local part, one @, a dotted domain with a 2+ character final label,
 * no whitespace, no angle brackets, no commas. Anything a real firm inbox
 * uses passes; header-injection shapes and obvious junk do not.
 */
const EMAIL_RE = /^[^\s@,<>"]{1,64}@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

export function isValidEmail(value: string): boolean {
  if (value.length > MAX_EMAIL) return false;
  return EMAIL_RE.test(value);
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const raw = source[key];
  if (typeof raw !== 'string') return null;
  // Collapse control characters so a crafted value can never inject a header
  const collapsed = raw.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  return collapsed.length > 0 ? collapsed : null;
}

/**
 * Validates an untrusted request body into a typed submission.
 *
 * Free-text lines are accepted only for the option that reveals them, and
 * dropped otherwise: a visitor who picks "Family" and posts a
 * practice_area_other is either a stale client or a probe, and neither
 * deserves a stored string.
 */
export function validateSubmission(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'invalid body' };
  }
  const source = body as Record<string, unknown>;

  const answers: Partial<StartConversationAnswers> = {};

  for (const question of QUESTIONS) {
    const value = readString(source, question.id);
    if (!value) {
      return { valid: false, error: `missing answer: ${question.id}` };
    }
    if (!isValidValue(question.id as QuestionId, value)) {
      return { valid: false, error: `invalid answer: ${question.id}` };
    }
    (answers as Record<string, string>)[question.id] = value;

    if (question.otherField) {
      const free = readString(source, question.otherField);
      const allowed = optionRevealsText(question.id as QuestionId, value);
      if (free && free.length > MAX_FREE_TEXT) {
        return { valid: false, error: `too long: ${question.otherField}` };
      }
      (answers as Record<string, string | null>)[question.otherField] =
        allowed && free ? free : null;
    }
  }

  const name = readString(source, 'name');
  if (!name) return { valid: false, error: 'missing name' };
  if (name.length > MAX_NAME) return { valid: false, error: 'too long: name' };

  const firmName = readString(source, 'firm_name');
  if (!firmName) return { valid: false, error: 'missing firm_name' };
  if (firmName.length > MAX_FIRM_NAME) return { valid: false, error: 'too long: firm_name' };

  const email = readString(source, 'email');
  if (!email) return { valid: false, error: 'missing email' };
  if (!isValidEmail(email)) return { valid: false, error: 'invalid email' };

  const province = readString(source, 'province');
  if (!province) return { valid: false, error: 'missing province' };
  if (province.length > MAX_PROVINCE) return { valid: false, error: 'too long: province' };
  if (!provinceLabel(province)) return { valid: false, error: 'invalid province' };

  const complete = answers as StartConversationAnswers;

  return {
    valid: true,
    submission: {
      answers: complete,
      contact: { name, firm_name: firmName, email, province },
      outcome: resolveOutcome({
        decision_role: complete.decision_role,
        timeline: complete.timeline,
      }),
    },
  };
}

/**
 * The honeypot. A hidden field no sighted or assistive-technology user ever
 * fills; a form-filling script fills everything it finds. Any value at all
 * means drop the submission.
 */
export const HONEYPOT_FIELD = 'firm_website_url';

export function honeypotTripped(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const value = (body as Record<string, unknown>)[HONEYPOT_FIELD];
  return typeof value === 'string' && value.trim().length > 0;
}
