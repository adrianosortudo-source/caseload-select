/**
 * CASL comms gate: pure consent evaluation for Canadian leads.
 *
 * This module is the send-gate for every outbound communication to a lead
 * (email cadences, SMS, portal invites). It reads persisted consent columns
 * from screened_leads and returns whether a given channel is permitted.
 *
 * Rules (CASL 2014, s.6):
 * - Email: explicit OR implied consent, and the six-month implied-consent
 *   window must not have expired.
 * - SMS: explicit consent only (no implied consent for SMS per CASL s.6(1)(b)
 *   and CRTC guidance on commercial electronic messages to wireless devices).
 * - Revoked/declined: blocked on every channel.
 * - Unknown/none: blocked by default (opt-in architecture, not opt-out).
 *
 * All inputs are typed strings, not DB-native enums, so the gate works
 * identically in tests and production without importing Supabase types.
 *
 * DR reference: DR-075 (CASL consent gate architecture).
 * Schema migration: supabase/migrations-draft/20260626_screened_leads_consent.sql
 */

export type ConsentStatus =
  | 'explicit'  // lead checked a consent box or sent a CASL double-opt-in confirmation
  | 'implied'   // transactional relationship (lead submitted intake, visible business relationship)
  | 'declined'  // lead opted out / sent STOP
  | 'revoked'   // operator-recorded explicit revocation
  | 'unknown'   // default before any consent signal is captured
  | 'none';     // used by legacy rows predating the consent columns

export interface LeadConsentState {
  /** CASL consent status for email channel. */
  email_consent_status: ConsentStatus | null;
  /** CASL consent status for SMS channel (requires explicit; implied is insufficient). */
  sms_consent_status: ConsentStatus | null;
  /**
   * ISO 8601 timestamp after which implied email consent expires (CASL s.6(6)(d)).
   * Null if never set or if consent is explicit (explicit does not expire under CASL).
   * When this timestamp is in the past, the lead is treated as declined for email.
   */
  six_month_expiry_date: string | null;
}

export type CommChannel = 'email' | 'sms' | 'all';

/**
 * Returns true when the lead's consent state permits sending on the given channel.
 *
 * @param lead     Persisted consent columns from screened_leads.
 * @param channel  'email', 'sms', or 'all' (all requires both channels to pass).
 * @param asOf     Reference time for expiry check. Defaults to now. Inject in tests.
 */
export function isConsentGated(
  lead: LeadConsentState,
  channel: CommChannel,
  asOf?: Date,
): boolean {
  const now = asOf ?? new Date();

  if (channel === 'email' || channel === 'all') {
    if (!emailConsentOpen(lead, now)) return false;
  }

  if (channel === 'sms' || channel === 'all') {
    if (!smsConsentOpen(lead)) return false;
  }

  return true;
}

function emailConsentOpen(lead: LeadConsentState, now: Date): boolean {
  const status = lead.email_consent_status;
  if (status !== 'explicit' && status !== 'implied') return false;
  if (status === 'implied' && lead.six_month_expiry_date) {
    const expiry = new Date(lead.six_month_expiry_date);
    if (now > expiry) return false;
  }
  return true;
}

function smsConsentOpen(lead: LeadConsentState): boolean {
  return lead.sms_consent_status === 'explicit';
}

/**
 * Returns a human-readable reason code for why the gate blocked a send.
 * Returns null when the gate is open.
 * Intended for logging, not for surfacing to end users.
 */
export function consentBlockReason(
  lead: LeadConsentState,
  channel: CommChannel,
  asOf?: Date,
): string | null {
  const now = asOf ?? new Date();

  if (channel === 'email' || channel === 'all') {
    const status = lead.email_consent_status;
    if (status !== 'explicit' && status !== 'implied') {
      return `email_consent_status=${String(status)}`;
    }
    if (status === 'implied' && lead.six_month_expiry_date) {
      const expiry = new Date(lead.six_month_expiry_date);
      if (now > expiry) return 'implied_consent_expired';
    }
  }

  if (channel === 'sms' || channel === 'all') {
    const status = lead.sms_consent_status;
    if (status !== 'explicit') return `sms_consent_status=${String(status)}`;
  }

  return null;
}
