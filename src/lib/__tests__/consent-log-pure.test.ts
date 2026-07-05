import { describe, it, expect } from 'vitest';
import { buildIntakeConsentLogRow, INTAKE_CONSENT_PURPOSE } from '@/lib/consent-log-pure';

describe('buildIntakeConsentLogRow', () => {
  it('builds an express consent row when the widget checkbox was checked', () => {
    const row = buildIntakeConsentLogRow({
      firmId: 'firm-1',
      screenedLeadId: 'lead-1',
      explicit: true,
      capturedAtIso: '2026-07-05T00:00:00.000Z',
      sixMonthExpiryIso: '2027-01-05T00:00:00.000Z',
      ipAddress: '1.2.3.4',
      userAgent: 'test-agent',
    });
    expect(row).toMatchObject({
      firm_id: 'firm-1',
      subject_id: 'lead-1',
      channel: 'email',
      event_type: 'consent_granted',
      consent_type: 'express',
      consent_status: 'granted',
      basis_source: 'widget_optin',
      purpose: INTAKE_CONSENT_PURPOSE,
      ip_address: '1.2.3.4',
      user_agent: 'test-agent',
      created_by: 'system',
    });
    // Express consent never expires under CASL, regardless of the caller's expiry input.
    expect(row.expires_at).toBeNull();
    expect(row.obtained_at).toBe('2026-07-05T00:00:00.000Z');
    expect(row.captured_at).toBe('2026-07-05T00:00:00.000Z');
  });

  it('builds an implied consent row (the inquiry itself) with the 6-month expiry set', () => {
    const row = buildIntakeConsentLogRow({
      firmId: 'firm-1',
      screenedLeadId: 'lead-2',
      explicit: false,
      capturedAtIso: '2026-07-05T00:00:00.000Z',
      sixMonthExpiryIso: '2027-01-05T00:00:00.000Z',
      ipAddress: null,
      userAgent: null,
    });
    expect(row.event_type).toBe('implied_set');
    expect(row.consent_type).toBe('implied_inquiry');
    expect(row.basis_source).toBe('screen_inquiry');
    expect(row.expires_at).toBe('2027-01-05T00:00:00.000Z');
    expect(row.ip_address).toBeNull();
    expect(row.user_agent).toBeNull();
  });
});
