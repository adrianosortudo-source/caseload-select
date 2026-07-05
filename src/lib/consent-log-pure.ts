/**
 * Pure builder for consent_log rows written at CASL consent capture points.
 *
 * consent_log (H5/DR-075) already exists in prod with one live write site
 * (conflict_waiver, in the conflict-checks route). The intake consent
 * checkbox itself (email_consent_status set on screened_leads at persist
 * time, api/intake-v2/route.ts) never wrote an audit-log row until this
 * module: the CASL columns were set, but the append-only evidentiary trail
 * consent_log exists specifically to provide was empty for every intake.
 *
 * No I/O here; consent-log.ts is the thin insert wrapper.
 */

export interface IntakeConsentLogInput {
  firmId: string;
  screenedLeadId: string;
  explicit: boolean; // widget checkbox checked (express) vs bare inquiry (implied)
  capturedAtIso: string; // submission time
  sixMonthExpiryIso: string | null; // required when !explicit, null when explicit
  ipAddress: string | null;
  userAgent: string | null;
}

export interface ConsentLogInsertRow {
  firm_id: string;
  subject_id: string;
  channel: 'email';
  event_type: 'consent_granted' | 'implied_set';
  consent_type: 'express' | 'implied_inquiry';
  consent_status: 'granted';
  purpose: string;
  basis_source: 'widget_optin' | 'screen_inquiry';
  ip_address: string | null;
  user_agent: string | null;
  obtained_at: string;
  expires_at: string | null;
  created_by: 'system';
  captured_at: string;
}

export const INTAKE_CONSENT_PURPOSE = 'CaseLoad Screen intake and case-status communications';

/**
 * Builds the consent_log row for an intake's email consent capture. Explicit
 * (widget checkbox) never expires; implied (the inquiry itself, CASL
 * s.6(6)(d)) expires at the 6-month mark already computed by the caller.
 */
export function buildIntakeConsentLogRow(input: IntakeConsentLogInput): ConsentLogInsertRow {
  return {
    firm_id: input.firmId,
    subject_id: input.screenedLeadId,
    channel: 'email',
    event_type: input.explicit ? 'consent_granted' : 'implied_set',
    consent_type: input.explicit ? 'express' : 'implied_inquiry',
    consent_status: 'granted',
    purpose: INTAKE_CONSENT_PURPOSE,
    basis_source: input.explicit ? 'widget_optin' : 'screen_inquiry',
    ip_address: input.ipAddress,
    user_agent: input.userAgent,
    obtained_at: input.capturedAtIso,
    expires_at: input.explicit ? null : input.sixMonthExpiryIso,
    created_by: 'system',
    captured_at: input.capturedAtIso,
  };
}
