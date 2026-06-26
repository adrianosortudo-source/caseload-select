/**
 * Tests for comms-gate: CASL consent evaluation.
 *
 * Rules under test:
 * - Email: explicit or implied open; declined/revoked/unknown/none blocked.
 * - Email implied: blocked after six_month_expiry_date.
 * - SMS: explicit only; implied/declined/unknown blocked.
 * - channel='all': both email and SMS must pass independently.
 * - consentBlockReason: returns null when open, reason code when blocked.
 */

import { describe, it, expect } from "vitest";
import {
  isConsentGated,
  consentBlockReason,
  type LeadConsentState,
} from "@/lib/comms-gate";

const PAST = new Date("2025-12-01T00:00:00.000Z");
const NOW = new Date("2026-06-26T12:00:00.000Z");
const FUTURE = new Date("2027-01-01T00:00:00.000Z");

function lead(overrides: Partial<LeadConsentState> = {}): LeadConsentState {
  return {
    email_consent_status: null,
    sms_consent_status: null,
    six_month_expiry_date: null,
    ...overrides,
  };
}

describe("isConsentGated: email channel", () => {
  it("explicit consent: gate open", () => {
    expect(isConsentGated(lead({ email_consent_status: 'explicit' }), 'email', NOW)).toBe(true);
  });

  it("implied consent within window: gate open", () => {
    expect(
      isConsentGated(
        lead({ email_consent_status: 'implied', six_month_expiry_date: FUTURE.toISOString() }),
        'email',
        NOW,
      ),
    ).toBe(true);
  });

  it("implied consent past expiry: gate closed", () => {
    expect(
      isConsentGated(
        lead({ email_consent_status: 'implied', six_month_expiry_date: PAST.toISOString() }),
        'email',
        NOW,
      ),
    ).toBe(false);
  });

  it("implied consent with no expiry date: gate open (explicit-equivalent intent)", () => {
    expect(
      isConsentGated(lead({ email_consent_status: 'implied', six_month_expiry_date: null }), 'email', NOW),
    ).toBe(true);
  });

  it("declined: gate closed", () => {
    expect(isConsentGated(lead({ email_consent_status: 'declined' }), 'email', NOW)).toBe(false);
  });

  it("revoked: gate closed", () => {
    expect(isConsentGated(lead({ email_consent_status: 'revoked' }), 'email', NOW)).toBe(false);
  });

  it("unknown (default before consent capture): gate closed", () => {
    expect(isConsentGated(lead({ email_consent_status: 'unknown' }), 'email', NOW)).toBe(false);
  });

  it("none (legacy row predating consent columns): gate closed", () => {
    expect(isConsentGated(lead({ email_consent_status: 'none' }), 'email', NOW)).toBe(false);
  });

  it("null status: gate closed", () => {
    expect(isConsentGated(lead({ email_consent_status: null }), 'email', NOW)).toBe(false);
  });

  it("explicit consent does not expire even when six_month_expiry_date is set in the past", () => {
    // Explicit consent never expires under CASL; only implied does.
    expect(
      isConsentGated(
        lead({ email_consent_status: 'explicit', six_month_expiry_date: PAST.toISOString() }),
        'email',
        NOW,
      ),
    ).toBe(true);
  });
});

describe("isConsentGated: sms channel", () => {
  it("explicit consent: gate open", () => {
    expect(isConsentGated(lead({ sms_consent_status: 'explicit' }), 'sms', NOW)).toBe(true);
  });

  it("implied consent: gate closed (SMS requires explicit per CASL wireless device rule)", () => {
    expect(isConsentGated(lead({ sms_consent_status: 'implied' }), 'sms', NOW)).toBe(false);
  });

  it("declined: gate closed", () => {
    expect(isConsentGated(lead({ sms_consent_status: 'declined' }), 'sms', NOW)).toBe(false);
  });

  it("unknown: gate closed", () => {
    expect(isConsentGated(lead({ sms_consent_status: 'unknown' }), 'sms', NOW)).toBe(false);
  });

  it("null status: gate closed", () => {
    expect(isConsentGated(lead({ sms_consent_status: null }), 'sms', NOW)).toBe(false);
  });
});

describe("isConsentGated: channel=all", () => {
  it("both explicit: gate open", () => {
    expect(
      isConsentGated(
        lead({ email_consent_status: 'explicit', sms_consent_status: 'explicit' }),
        'all',
        NOW,
      ),
    ).toBe(true);
  });

  it("email explicit + sms implied: gate closed (SMS requirement fails)", () => {
    expect(
      isConsentGated(
        lead({ email_consent_status: 'explicit', sms_consent_status: 'implied' }),
        'all',
        NOW,
      ),
    ).toBe(false);
  });

  it("email implied within window + sms explicit: gate open", () => {
    expect(
      isConsentGated(
        lead({
          email_consent_status: 'implied',
          six_month_expiry_date: FUTURE.toISOString(),
          sms_consent_status: 'explicit',
        }),
        'all',
        NOW,
      ),
    ).toBe(true);
  });

  it("email declined + sms explicit: gate closed (email requirement fails)", () => {
    expect(
      isConsentGated(
        lead({ email_consent_status: 'declined', sms_consent_status: 'explicit' }),
        'all',
        NOW,
      ),
    ).toBe(false);
  });

  it("both unknown: gate closed", () => {
    expect(
      isConsentGated(
        lead({ email_consent_status: 'unknown', sms_consent_status: 'unknown' }),
        'all',
        NOW,
      ),
    ).toBe(false);
  });
});

describe("consentBlockReason", () => {
  it("returns null when gate is open (email explicit)", () => {
    expect(consentBlockReason(lead({ email_consent_status: 'explicit' }), 'email', NOW)).toBeNull();
  });

  it("returns reason when email status is unknown", () => {
    expect(consentBlockReason(lead({ email_consent_status: 'unknown' }), 'email', NOW)).toBe(
      'email_consent_status=unknown',
    );
  });

  it("returns implied_consent_expired when implied past expiry", () => {
    expect(
      consentBlockReason(
        lead({ email_consent_status: 'implied', six_month_expiry_date: PAST.toISOString() }),
        'email',
        NOW,
      ),
    ).toBe('implied_consent_expired');
  });

  it("returns SMS reason when SMS status is not explicit", () => {
    expect(consentBlockReason(lead({ sms_consent_status: 'declined' }), 'sms', NOW)).toBe(
      'sms_consent_status=declined',
    );
  });

  it("returns null when SMS explicit", () => {
    expect(consentBlockReason(lead({ sms_consent_status: 'explicit' }), 'sms', NOW)).toBeNull();
  });

  it("returns email reason first when both channels fail on channel=all", () => {
    const reason = consentBlockReason(
      lead({ email_consent_status: 'none', sms_consent_status: 'unknown' }),
      'all',
      NOW,
    );
    expect(reason).toBe('email_consent_status=none');
  });
});
