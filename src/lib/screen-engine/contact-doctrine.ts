/**
 * Contact-capture doctrine — the gate between "information" and "lead."
 *
 * Doctrine (adopted 2026-05-15): "No contact, no lead. A lead the lawyer
 * can't reach is information, not a lead."
 *
 * Trigger: a Family Law smoke test on 2026-05-15 produced a Forwarded-to-firm
 * brief with zero contact fields populated. The lawyer received a brief but
 * had no way to reach the person. That state must never recur.
 *
 * Required fields for a brief to be persisted as a screened lead:
 *   1. client_name (any non-empty trimmed string the lead provided), AND
 *   2. AT LEAST ONE of client_email OR client_phone (non-empty trimmed string)
 *
 * Anything else is an "unconfirmed inquiry" — persisted separately for ops
 * visibility, never surfaced to the lawyer's triage portal.
 *
 * This helper is the single source of truth for the gate. The engine report
 * builder calls it to set `LawyerReport.contact_complete`; the route
 * handlers and channel processor call it to branch on persistence.
 *
 * Notes:
 *   - The email/phone shape checks are intentionally lenient — we accept
 *     anything the lead typed, validation lives elsewhere. The point of
 *     the gate is "is there SOMETHING to call/email," not "is it a valid
 *     RFC 5322 address." A typo'd email is still better than no email.
 *   - Both the app engine (this repo) and the sandbox engine
 *     (CaseLoadScreen_2.0_2026-05-03) must apply the same gate.
 */

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ContactFields {
  client_name?: string | null;
  client_email?: string | null;
  client_phone?: string | null;
}

export interface ContactGateResult {
  /** True if name AND (email OR phone) are present and non-empty. */
  complete: boolean;
  /** Each individual slot's truthiness, for diagnostics. */
  hasName: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  /** When complete=false, the missing piece(s). 'name' | 'reachability' | 'both'. */
  missing: 'name' | 'reachability' | 'both' | null;
}

function nonEmpty(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

function emailShape(v: string | null | undefined): boolean {
  if (!nonEmpty(v)) return false;
  return EMAIL_SHAPE.test((v as string).trim());
}

function phoneShape(v: string | null | undefined): boolean {
  if (!nonEmpty(v)) return false;
  const digits = (v as string).replace(/\D/g, '');
  return digits.length >= 7;
}

/**
 * Evaluate the contact gate from a flat object of contact-slot values.
 * Accepts `null` and `undefined` so callers can pass `state.slots` or a
 * `{ name, email, phone }` shape without coercion.
 */
export function evaluateContactGate(fields: ContactFields): ContactGateResult {
  const hasName = nonEmpty(fields.client_name);
  const hasEmail = emailShape(fields.client_email);
  const hasPhone = phoneShape(fields.client_phone);
  const reach = hasEmail || hasPhone;
  const complete = hasName && reach;

  let missing: ContactGateResult['missing'] = null;
  if (!complete) {
    if (!hasName && !reach) missing = 'both';
    else if (!hasName) missing = 'name';
    else missing = 'reachability';
  }

  return { complete, hasName, hasEmail, hasPhone, missing };
}

/**
 * Boolean shortcut. Engine report uses this for `LawyerReport.contact_complete`.
 */
export function isContactComplete(fields: ContactFields): boolean {
  return evaluateContactGate(fields).complete;
}

/**
 * Reason string for `unconfirmed_inquiries.reason`. Kept as a small enum so
 * the cron / ops dashboard can filter.
 */
export type UnconfirmedReason =
  | 'no_contact_provided'
  | 'abandoned'
  | 'engine_refused';
